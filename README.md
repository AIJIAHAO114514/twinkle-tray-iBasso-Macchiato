# Twinkle Tray × iBasso Macchiato

> 基于 Twinkle Tray v1.17.2 的增强版本，集成 iBasso Macchiato USB DAC 音量控制。
> 
<img width="543" height="493" alt="image" src="https://github.com/user-attachments/assets/48a73c6c-fb79-47de-932c-a0da37f66d65" />


*音量滑块、托盘 Tooltip、双击/点击静音*

<img width="477" height="380" alt="image" src="https://github.com/user-attachments/assets/a5fe4041-997a-49ec-8df9-56f8b2b7f930" />


## 项目简介

本项目在 Twinkle Tray 原有显示器亮度控制功能的基础上，新增了对 **iBasso Macchiato** 系列 USB DAC 的音量控制支持。同时移除了原版的自动更新功能，避免覆盖定制改动。所有改动遵循最小侵入原则，原版 Twinkle Tray 的全部功能完整保留。

## 与原版的区别

| 功能 | 原版 Twinkle Tray | 本项目 |
|------|:-:|:-:|
| 显示器亮度控制 (DDC/CI / WMI) | ✅ | ✅ |
| 多显示器联动 | ✅ | ✅ |
| 定时亮度调节 | ✅ | ✅ |
| 快捷键绑定 | ✅ | ✅ |
| HDR 支持 | ✅ | ✅ |
| **iBasso Macchiato 音量控制** | ❌ | **✅** |
| **托盘 Tooltip 显示 Macchiato 音量** | ❌ | **✅** |
| **托盘双击静音 Macchiato** | ❌ | **✅** |
| **Macchiato 热插拔自动检测** | ❌ | **✅** |
| **Macchiato Web 控制台入口** | ❌ | **✅** |
| **滚轮调节 Macchiato 音量** | ❌ | **✅** |
| **Ctrl+滚轮调节显示器亮度** | — | **✅** |
| **Electron 42 (Chromium 148)** | ❌ | **✅** |
| **分析上报已移除** | ❌ | **✅** |

## 修改范围

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/MacchiatoDevice.js` | **新增** | HID 设备通信模块 (VID=0x0661) |
| `src/electron.js` | +42 / -58 | 设备管理、Tooltip、双击静音、滚轮音量 + Ctrl+滚轮亮度、移除更新 & 分析上报 |
| `src/modules/key-state/` | **新增** | N-API 原生模块，封装 GetAsyncKeyState，零开销同步检测 Ctrl 键 |
| `src/components/BrightnessPanel.jsx` | +50 / -35 | Macchiato 滑块 UI、移除更新栏 |
| `src/components/SettingsWindow.jsx` | -60 | 移除更新设置 & 分析开关页面 |
| `src/panel-preload.js` | +3 / -40 | IPC 转发、移除更新函数 |
| `src/settings-preload.js` | -25 | 移除更新函数及 IPC 监听 |
| `package.json` | +2 | 构建配置、dev 脚本、npm 依赖升级 |
| `README.md` | 重写 | 项目说明 |

## 技术实现

- **HID 协议**：通过 `node-hid` 与 Macchiato 进行原始 HID 报告通信
- **无原生模块时自动降级**：若 `node-hid` 未安装，自动切换为 Mock 模式，保证程序可运行
- **批量发送**：100ms 间隔批量写入音量，对齐 Twinkle Tray 原生亮度同步策略
- **乐观静音**：UI 即时响应，写入冷却期防止轮询覆盖
- **移除了自动更新 & 分析上报**：避免覆盖定制功能，版本标识 `v1.17.2-macchiato`
- **托盘右键菜单**：增加「Macchiato Web 控制台」入口，直达 iBasso UAC 设置页
- **滚轮控制**：托盘上直接滚动滚轮 → 调节 Macchiato 音量（常用操作）；按住 `Ctrl` 滚动 → 调节显示器亮度。通过自研 N-API 原生模块 `key-state` 同步检测 Ctrl 键状态，无子进程、无轮询、延迟 < 1µs
- **内存优化**：`renderer-process-limit=1`，进程数从 12 降到 5

## 升级记录

- **Electron 28 → 42.4.0**（Chromium 120 → 148，Node 18 → 24）
- **11 个原生模块全部重编译**：node-hid、ddcci、win32-displayconfig 等
- **CI自动化构建**：推送 tag 自动触发 GitHub Actions 打包发布

## 致谢

- **[Twinkle Tray](https://github.com/xanderfrangos/twinkle-tray)** — 优秀的 Windows 显示器亮度控制工具，本项目在其 v1.17.2 基础上构建
- 
- **[DeepSeek](https://www.deepseek.com/)** — AI 辅助编程，完成了从需求分析到代码实现的全流程
<img width="254" height="256" alt="11111" src="https://github.com/user-attachments/assets/a953ecf7-2e3b-4200-bdf0-ddeb6cb811fc" />


## License

Copyright © 2020 Xander Frangos

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
