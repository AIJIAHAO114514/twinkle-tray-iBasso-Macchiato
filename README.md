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

```powershell
choco upgrade twinkle-tray
```

**This package is not maintained at this repository**. Please do not create issues relating to the package here. Instead, go to the [package page](https://community.chocolatey.org/packages/twinkle-tray) and follow the [Package Triage Process](https://docs.chocolatey.org/en-us/community-repository/users/package-triage-process).

### Scoop (unofficial)

[Scoop](https://scoop.sh/) users can download and install Twinkle Tray from Scoop's Extras bucket by installing the `twinkle-tray` package:

```sh
scoop bucket add extras
scoop install extras/twinkle-tray
```

To upgrade to the latest approved package version, run the following command:

```sh
scoop update twinkle-tray
```

**This package is not maintained at this repository**. Please do not create issues relating to the package here. Instead, go to [ScoopInstallers/Extras](https://github.com/ScoopInstaller/Extras) and search for an existing [issue](https://github.com/ScoopInstaller/Extras/issues?q=is%3Aissue+twinkle-tray) or [discussion](https://github.com/ScoopInstaller/Extras/discussions?discussions_q=twinkle-tray) and create a new [issue](https://github.com/ScoopInstaller/Extras/issues/new/choose) or [discussion](https://github.com/ScoopInstaller/Extras/discussions/new/choose) if one does not already exist.

## Usage

- Download from the [Releases page](https://github.com/xanderfrangos/twinkle-tray/releases) and run the installer EXE.
- Once installation has finished, you should see the Twinkle Tray icon in your system tray. 
- Click the icon to bring up the Adjust Brightness flyout. 
- Click away to hide the flyout.
- Right-click the system tray icon to quit.

## Compatibility
Twinkle Tray uses DDC/CI and WMI to communicate with your monitors. Most monitors offer DDC/CI compatibility, but it may be off by default. Make sure you have the appropriate option(s) enabled on your monitor so that it can work with Twinkle Tray. Refer to your monitor's user manual for more information.

**Known issues:**
- The AMD Radeon Control Panel can interfere with Twinkle Tray. Ensure "Custom Colors" is not enabled.
- VGA/DVI may not be compatible.
- USB/Thunderbolt/Surface docks with HDMI or DisplayPort may not be compatible. 
- DDC/CI features such as brightness control and power state may cause certain models of monitors to behave poorly. This applies to any DDC/CI software, not just Twinkle Tray.

If some of your monitors are not being detected, please see [this page](https://github.com/xanderfrangos/twinkle-tray/wiki/Display-Detection-&-Support-Issues) for troubleshooting steps.

## Command Line Arguments

Twinkle Tray (v1.13.0+) supports requesting brightness changes from the command line. Twinkle Tray must already be running. One monitor argument and one brightness argument are required. Multiple arguments will override each other.

For example: `"%LocalAppData%\Programs\twinkle-tray\Twinkle Tray.exe" --MonitorNum=1 --Offset=-30` will adjust monitor number 1 by -30 brightness.

### Supported args:

- `--List` List all displays. *(available in v1.14.0+)*
- `--MonitorNum` Select monitor by number. Starts at 1. *Example: `--MonitorNum=2`*
- `--MonitorID` Select monitor by internal ID. Partial or whole matches accepted. *Example: `--MonitorID="UID2353"`*
- `--All` Flag to select all monitors.
- `--Set` Set brightness percentage. *Example: `--Set=95`*
- `--Offset` Adjust brightness percentage. *Example: `--Offset=-20`*
- `--VCP` Send a specific DDC/CI VCP code and value instead of brightness. The first part is the VCP code (decimal or hexadecimal), and the second is the value. *Example: `--VCP="0xD6:5"`* *(available in v1.14.4+)*
- `--Overlay` Flag to show new brightness levels in the overlay *Example: `--Overlay`*
- `--Panel` Flag to show new brightness levels in the panel *Example: `--Panel`*

*If you are using the Microsoft Store version of Twinkle Tray, you can access Twinkle Tray using the alias `Twinkle-Tray.exe` (v1.17.1+).*

## Localization
Thanks to [several contributors](https://github.com/xanderfrangos/twinkle-tray/graphs/contributors), Twinkle Tray is localized for multiple languages. If you'd like to create or update a localization, see [this page](https://github.com/xanderfrangos/twinkle-tray/wiki/Localization-files) for details. Special thanks to [Weblate](https://weblate.org/) for allowing free use of their service.

#### Localization progress
<a href="https://hosted.weblate.org/engage/twinkle-tray/?utm_source=widget">
<img src="https://hosted.weblate.org/widgets/twinkle-tray/-/multi-auto.svg" alt="Translation status" />
</a>

## Build Instructions
If you wish to run a development build of Twinkly Tray:

- Download or clone.
- Install the build tools for [`node-gyp`](https://github.com/nodejs/node-gyp#installation), if not already installed. You may already have these from installing NodeJS.
- Run `npm install`.
- Run `npm run build` to build an executable or `npm start` to run a development build.

*Note: Twinkle Tray must be built on Windows.*

## Special Thanks

Twinkle Tray was built using frameworks & libraries such as [Electron](https://electronjs.org/), [Node.js](https://nodejs.org/), [node-ddcci](https://github.com/hensm/node-ddcci), and [win32-displayconfig](<https://github.com/djsweet/win32-displayconfig>). Thanks to Weblate for allowing free use of their service, along with the many contributors to the localizations of Twinkle Tray. The app would not be nearly as popular without all of your help. And thank you for the many donations, small and large, over the years. 

## License

Copyright © 2020 Xander Frangos

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
