/**
 * key-state.cc
 * Tiny N-API addon wrapping Win32 GetAsyncKeyState.
 *
 * Exports:
 *   isCtrlPressed()   → Boolean  (VK_CONTROL & 0x8000)
 *   isKeyPressed(vk)  → Boolean  (arbitrary virtual-key code)
 */

#include <napi.h>
#include <windows.h>

// ── isCtrlPressed() ─────────────────────────────────────────────
Napi::Value IsCtrlPressed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool down = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
  return Napi::Boolean::New(env, down);
}

// ── isKeyPressed(vKey) ──────────────────────────────────────────
Napi::Value IsKeyPressed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected a virtual-key code (Number)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int vKey = info[0].As<Napi::Number>().Int32Value();
  bool down = (GetAsyncKeyState(vKey) & 0x8000) != 0;
  return Napi::Boolean::New(env, down);
}

// ── Module init ─────────────────────────────────────────────────
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isCtrlPressed", Napi::Function::New(env, IsCtrlPressed));
  exports.Set("isKeyPressed",  Napi::Function::New(env, IsKeyPressed));
  return exports;
}

NODE_API_MODULE(key_state, Init)
