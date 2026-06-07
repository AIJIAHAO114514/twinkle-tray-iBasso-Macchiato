# Twinkle Tray × iBasso Macchiato

> 基于 Twinkle Tray v1.17.2 的增强版本，集成 iBasso Macchiato USB DAC 音量控制。

## 项目简介

本项目在 Twinkle Tray 原有显示器亮度控制功能的基础上，新增了对 **iBasso Macchiato** 系列 USB DAC 的音量控制支持。所有改动遵循最小侵入原则——仅修改 4 个文件，原版 Twinkle Tray 的全部功能完整保留。

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

## 修改范围

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/MacchiatoDevice.js` | **新增** | HID 设备通信模块 (VID=0x0661) |
| `src/electron.js` | +42 行 | 主进程：设备初始化、IPC handler、Tooltip、双击静音 |
| `src/components/BrightnessPanel.jsx` | +50 行 | 面板 UI：Macchiato 音量滑块 + 滚轮调节 |
| `src/panel-preload.js` | +3 行 | IPC 状态转发 |

## 技术实现

- **HID 协议**：通过 `node-hid` 与 Macchiato 进行原始 HID 报告通信，音量读写命令对齐原厂 C# 驱动
- **无原生模块时自动降级**：若 `node-hid` 未安装，自动切换为 Mock 模式，保证程序可运行
- **批量发送**：100ms 间隔批量写入音量（对齐 Twinkle Tray 原生亮度同步策略）
- **乐观静音**：UI 即时响应静音操作，无需等待轮询确认

## 致谢

- **[Twinkle Tray](https://github.com/xanderfrangos/twinkle-tray)** — 优秀的 Windows 显示器亮度控制工具，本项目在其 v1.17.2 基础上构建
- **[DeepSeek](https://www.deepseek.com/)** — AI 辅助编程，完成了从需求分析到代码实现的全流程

## License

Copyright © 2020 Xander Frangos

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
