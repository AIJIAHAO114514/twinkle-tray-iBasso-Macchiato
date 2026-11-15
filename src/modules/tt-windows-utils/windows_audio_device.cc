#include <napi.h>

#include <windows.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propsys.h>
#include <propvarutil.h>

#include <atomic>
#include <string>

#pragma comment(lib, "ole32")
#pragma comment(lib, "propsys")

namespace {

std::string WideToUtf8(const wchar_t *wide) {
  if (wide == nullptr) return std::string();

  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return std::string();

  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
  return out;
}

std::string ReadStringProperty(IPropertyStore *store, const PROPERTYKEY &key) {
  if (store == nullptr) return std::string();

  PROPVARIANT value;
  PropVariantInit(&value);

  std::string out;
  if (SUCCEEDED(store->GetValue(key, &value))) {
    PWSTR text = nullptr;
    if (SUCCEEDED(PropVariantToStringAlloc(value, &text)) && text != nullptr) {
      out = WideToUtf8(text);
      CoTaskMemFree(text);
    }
  }

  PropVariantClear(&value);
  return out;
}

// COM is initialized per call and torn down again. This only ever runs on the
// Electron main process in response to a poll, so the overhead of a per-call
// CoInitializeEx is negligible compared to keeping an apartment alive forever.
class ComScope {
public:
  ComScope() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    // RPC_E_CHANGED_MODE means another apartment mode is already active on this
    // thread. That is fine: the enumerator still works, we just must not
    // uninitialize the apartment we did not create.
    initialized_ = SUCCEEDED(hr);
    usable_ = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
  }

  ~ComScope() {
    if (initialized_) CoUninitialize();
  }

  bool usable() const { return usable_; }

private:
  bool initialized_ = false;
  bool usable_ = false;
};


// ── Default render device notifications ──────────────────────────────
// IMMNotificationClient callbacks arrive on COM-owned threads, so the JS side is
// notified through a ThreadSafeFunction instead of polling.
class DefaultDeviceWatcher : public IMMNotificationClient {
public:
  explicit DefaultDeviceWatcher(Napi::ThreadSafeFunction callback)
      : callback_(callback), refs_(1) {}

  ULONG STDMETHODCALLTYPE AddRef() override {
    return static_cast<ULONG>(InterlockedIncrement(&refs_));
  }

  ULONG STDMETHODCALLTYPE Release() override {
    LONG refs = InterlockedDecrement(&refs_);
    if (refs == 0) delete this;
    return static_cast<ULONG>(refs);
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
    if (out == nullptr) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IMMNotificationClient)) {
      *out = static_cast<IMMNotificationClient *>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }

  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role,
                                                   LPCWSTR /*deviceId*/) override {
    // eConsole is the role GetDefaultAudioEndpoint(eRender, eConsole) reports,
    // which is what the tray icon reflects.
    if (flow == eRender && role == eConsole && alive_.load()) {
      callback_.NonBlockingCall();
    }
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR, DWORD) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR, const PROPERTYKEY) override {
    return S_OK;
  }

  // Called before the ThreadSafeFunction is released, so a late COM callback
  // cannot touch a dead function reference.
  void Disable() { alive_.store(false); }

private:
  ~DefaultDeviceWatcher() = default;

  Napi::ThreadSafeFunction callback_;
  std::atomic<bool> alive_{true};
  LONG refs_;
};

Napi::ThreadSafeFunction g_watchCallback;
DefaultDeviceWatcher *g_watcher = nullptr;
IMMDeviceEnumerator *g_watchEnumerator = nullptr;

}  // namespace

// Returns the default render (playback) endpoint:
//   { endpointName, deviceName, displayName, id }
// or null when no default render device is available.
//
// endpointName comes from PKEY_Device_FriendlyName (e.g. "Speakers").
// deviceName comes from PKEY_DeviceInterface_FriendlyName (e.g. "Macchiato").
// displayName mirrors what Windows itself shows: "endpointName (deviceName)".
Napi::Value GetDefaultRenderDevice(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  ComScope com;
  if (!com.usable()) return env.Null();

  IMMDeviceEnumerator *enumerator = nullptr;
  IMMDevice *device = nullptr;
  IPropertyStore *store = nullptr;
  Napi::Value result = env.Null();

  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void **>(&enumerator));
  if (SUCCEEDED(hr) && enumerator != nullptr) {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  }

  if (SUCCEEDED(hr) && device != nullptr) {
    hr = device->OpenPropertyStore(STGM_READ, &store);
  }

  if (SUCCEEDED(hr) && store != nullptr) {
    std::string endpointName = ReadStringProperty(store, PKEY_Device_FriendlyName);
    std::string deviceName = ReadStringProperty(store, PKEY_DeviceInterface_FriendlyName);

    // Windows already folds the device name into the endpoint name for most
    // endpoints ("Speakers (Macchiato)"), so only append it when it is missing.
    std::string displayName = endpointName;
    if (!deviceName.empty() && endpointName.find(deviceName) == std::string::npos) {
      displayName = endpointName.empty() ? deviceName : (endpointName + " (" + deviceName + ")");
    }

    std::string id;
    LPWSTR deviceId = nullptr;
    if (SUCCEEDED(device->GetId(&deviceId)) && deviceId != nullptr) {
      id = WideToUtf8(deviceId);
      CoTaskMemFree(deviceId);
    }

    Napi::Object out = Napi::Object::New(env);
    out.Set("endpointName", Napi::String::New(env, endpointName));
    out.Set("deviceName", Napi::String::New(env, deviceName));
    out.Set("displayName", Napi::String::New(env, displayName));
    out.Set("id", Napi::String::New(env, id));
    result = out;
  }

  if (store != nullptr) store->Release();
  if (device != nullptr) device->Release();
  if (enumerator != nullptr) enumerator->Release();

  return result;
}

// Registers a callback that fires whenever the default playback endpoint changes.
// Returns false when COM refuses to hand out an enumerator, which lets the
// caller fall back to polling.
Napi::Value StartDefaultDeviceWatch(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "startDefaultDeviceWatch expects a callback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (g_watcher != nullptr) return Napi::Boolean::New(env, true);

  // An endpoint notification callback needs an initialized apartment on this
  // thread. Electron's UI thread normally has one; RPC_E_CHANGED_MODE means a
  // different mode is already active, which still works for registration.
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  IMMDeviceEnumerator *enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void **>(&enumerator));
  if (FAILED(hr) || enumerator == nullptr) {
    return Napi::Boolean::New(env, false);
  }

  g_watchCallback = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "defaultAudioDeviceWatch", 0, 1);

  g_watcher = new DefaultDeviceWatcher(g_watchCallback);
  hr = enumerator->RegisterEndpointNotificationCallback(g_watcher);

  if (FAILED(hr)) {
    g_watcher->Disable();
    g_watcher->Release();
    g_watcher = nullptr;
    g_watchCallback.Release();
    enumerator->Release();
    return Napi::Boolean::New(env, false);
  }

  // Keep the enumerator alive: unregistering needs the same instance.
  g_watchEnumerator = enumerator;
  return Napi::Boolean::New(env, true);
}

Napi::Value StopDefaultDeviceWatch(const Napi::CallbackInfo &info) {
  if (g_watchEnumerator != nullptr && g_watcher != nullptr) {
    g_watchEnumerator->UnregisterEndpointNotificationCallback(g_watcher);
  }
  if (g_watcher != nullptr) {
    g_watcher->Disable();
    g_watcher->Release();
    g_watcher = nullptr;
  }
  if (g_watchEnumerator != nullptr) {
    g_watchEnumerator->Release();
    g_watchEnumerator = nullptr;
  }
  if (g_watchCallback) {
    g_watchCallback.Release();
  }
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getDefaultRenderDevice", Napi::Function::New(env, GetDefaultRenderDevice));
  exports.Set("startDefaultDeviceWatch", Napi::Function::New(env, StartDefaultDeviceWatch));
  exports.Set("stopDefaultDeviceWatch", Napi::Function::New(env, StopDefaultDeviceWatch));
  return exports;
}

NODE_API_MODULE(windows_audio_device, Init)
