#include <napi.h>

#include <windows.h>

// Synchronous virtual-key state query. GetAsyncKeyState works for keyboard keys
// as well as the mouse buttons (VK_LBUTTON..VK_XBUTTON2), which is what the
// scroll-modifier feature needs.
Napi::Value IsKeyPressed(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "isKeyPressed expects a virtual-key code")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int virtualKey = info[0].As<Napi::Number>().Int32Value();
  if (virtualKey <= 0 || virtualKey > 0xFF) {
    return Napi::Boolean::New(env, false);
  }

  // High bit set => key is currently down.
  return Napi::Boolean::New(env, (GetAsyncKeyState(virtualKey) & 0x8000) != 0);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isKeyPressed", Napi::Function::New(env, IsKeyPressed));
  return exports;
}

NODE_API_MODULE(windows_key_state, Init)
