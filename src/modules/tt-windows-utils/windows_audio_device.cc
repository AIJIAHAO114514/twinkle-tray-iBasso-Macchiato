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

std::wstring Utf8ToWide(const std::string &text) {
  if (text.empty()) return std::wstring();

  int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()),
                                 nullptr, 0);
  if (size <= 0) return std::wstring();

  std::wstring out(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()),
                      &out[0], size);
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


// ── Default output switching ─────────────────────────────────────────
// Windows has no public API for changing the default playback device. The shell
// and the Settings app use this COM interface, which has stayed compatible from
// Windows 7 through Windows 11. It needs no elevation and no driver.
struct DeviceShareMode;

MIDL_INTERFACE("f8679f50-850a-41cf-9c72-430f290290c8")
IPolicyConfig : public IUnknown {
public:
  virtual HRESULT STDMETHODCALLTYPE GetMixFormat(PCWSTR, void **) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetDeviceFormat(PCWSTR, INT, void **) = 0;
  virtual HRESULT STDMETHODCALLTYPE ResetDeviceFormat(PCWSTR) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDeviceFormat(PCWSTR, void *, void *) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetProcessingPeriod(PCWSTR, INT, LONGLONG *, LONGLONG *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetProcessingPeriod(PCWSTR, LONGLONG *) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetShareMode(PCWSTR, DeviceShareMode *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetShareMode(PCWSTR, DeviceShareMode *) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetPropertyValue(PCWSTR, const PROPERTYKEY &,
                                                     PROPVARIANT *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetPropertyValue(PCWSTR, const PROPERTYKEY &,
                                                     PROPVARIANT *) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(PCWSTR, ERole) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetEndpointVisibility(PCWSTR, INT) = 0;
};

const CLSID CLSID_PolicyConfigClient = {
    0x870af99c, 0x171d, 0x4f9e,
    {0xaf, 0x0d, 0xe6, 0x3d, 0xf4, 0x0c, 0x2b, 0xc9}};

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

std::wstring ReadDeviceId(IMMDevice *device) {
  if (device == nullptr) return std::wstring();

  LPWSTR deviceId = nullptr;
  std::wstring out;
  if (SUCCEEDED(device->GetId(&deviceId)) && deviceId != nullptr) {
    out.assign(deviceId);
    CoTaskMemFree(deviceId);
  }
  return out;
}

Napi::Object BuildRenderDevice(Napi::Env env, IMMDevice *device, IPropertyStore *store,
                               const std::wstring &id, bool isDefault) {
  std::string endpointName = ReadStringProperty(store, PKEY_Device_FriendlyName);
  std::string deviceName = ReadStringProperty(store, PKEY_DeviceInterface_FriendlyName);

  std::string displayName = endpointName;
  if (!deviceName.empty() && endpointName.find(deviceName) == std::string::npos) {
    displayName = endpointName.empty() ? deviceName : (endpointName + " (" + deviceName + ")");
  }

  Napi::Object out = Napi::Object::New(env);
  out.Set("endpointName", Napi::String::New(env, endpointName));
  out.Set("deviceName", Napi::String::New(env, deviceName));
  out.Set("displayName", Napi::String::New(env, displayName));
  out.Set("id", Napi::String::New(env, WideToUtf8(id.c_str())));
  out.Set("isDefault", Napi::Boolean::New(env, isDefault));
  return out;
}

}  // namespace

// Returns every active render endpoint:
//   [{ endpointName, deviceName, displayName, id, isDefault }]
// isDefault reflects the eConsole role, which is what the tray icon follows.
Napi::Value GetRenderDevices(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  ComScope com;
  if (!com.usable()) return Napi::Array::New(env);

  IMMDeviceEnumerator *enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void **>(&enumerator));
  if (FAILED(hr) || enumerator == nullptr) return Napi::Array::New(env);

  std::wstring defaultId;
  IMMDevice *defaultDevice = nullptr;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice))) {
    defaultId = ReadDeviceId(defaultDevice);
  }
  if (defaultDevice != nullptr) defaultDevice->Release();

  IMMDeviceCollection *collection = nullptr;
  hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
  if (FAILED(hr) || collection == nullptr) {
    enumerator->Release();
    return Napi::Array::New(env);
  }

  UINT count = 0;
  collection->GetCount(&count);

  Napi::Array result = Napi::Array::New(env, count);
  uint32_t written = 0;

  for (UINT i = 0; i < count; ++i) {
    IMMDevice *device = nullptr;
    if (FAILED(collection->Item(i, &device)) || device == nullptr) continue;

    IPropertyStore *store = nullptr;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &store)) && store != nullptr) {
      const std::wstring id = ReadDeviceId(device);
      const bool isDefault = !id.empty() && id == defaultId;
      result.Set(written++, BuildRenderDevice(env, device, store, id, isDefault));
      store->Release();
    }

    device->Release();
  }

  collection->Release();
  enumerator->Release();
  return result;
}

// Switches the default playback endpoint to the given device id. Windows keeps
// separate defaults per role, so all three are updated; a failure on the
// communications role alone is not treated as a failure for the button.
Napi::Value SetDefaultRenderDevice(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "setDefaultRenderDevice expects a device id")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::wstring deviceId = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  Napi::Object result = Napi::Object::New(env);

  if (deviceId.empty()) {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("message", Napi::String::New(env, "empty device id"));
    return result;
  }

  ComScope com;
  if (!com.usable()) {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("message", Napi::String::New(env, "COM is not available"));
    return result;
  }

  IPolicyConfig *policy = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_PolicyConfigClient, nullptr, CLSCTX_ALL,
                                __uuidof(IPolicyConfig),
                                reinterpret_cast<void **>(&policy));
  if (FAILED(hr) || policy == nullptr) {
    char message[64];
    sprintf_s(message, "policy client failed (0x%08X)", static_cast<unsigned>(hr));
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("message", Napi::String::New(env, message));
    return result;
  }

  const HRESULT console = policy->SetDefaultEndpoint(deviceId.c_str(), eConsole);
  const HRESULT multimedia = policy->SetDefaultEndpoint(deviceId.c_str(), eMultimedia);
  policy->SetDefaultEndpoint(deviceId.c_str(), eCommunications);
  policy->Release();

  const bool ok = SUCCEEDED(console) && SUCCEEDED(multimedia);
  result.Set("ok", Napi::Boolean::New(env, ok));
  if (!ok) {
    char message[64];
    const HRESULT first = FAILED(console) ? console : multimedia;
    sprintf_s(message, "SetDefaultEndpoint failed (0x%08X)", static_cast<unsigned>(first));
    result.Set("message", Napi::String::New(env, message));
  }
  return result;
}

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
  exports.Set("getRenderDevices", Napi::Function::New(env, GetRenderDevices));
  exports.Set("setDefaultRenderDevice", Napi::Function::New(env, SetDefaultRenderDevice));
  exports.Set("startDefaultDeviceWatch", Napi::Function::New(env, StartDefaultDeviceWatch));
  exports.Set("stopDefaultDeviceWatch", Napi::Function::New(env, StopDefaultDeviceWatch));
  return exports;
}

NODE_API_MODULE(windows_audio_device, Init)
