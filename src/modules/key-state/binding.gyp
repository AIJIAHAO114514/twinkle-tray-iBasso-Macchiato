{
  "targets": [
    {
      "target_name": "key_state",
      "cflags!": [],
      "cflags_cc!": [],
      "sources": [ "key-state.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": [ "-std:c++17" ] }
      },
      "defines": [ "NAPI_CPP_EXCEPTIONS" ]
    }
  ]
}
