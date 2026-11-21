<p align="center">
  <img src="https://raw.githubusercontent.com/xanderfrangos/twinkle-tray/master/src/assets/logo.png" width="128px" height="128px" alt="Twinkle Tray brightness slider logo">
</p>
<h1 align="center">Twinkle Tray</h1>

<p align="center"><a href="https://github.com/xanderfrangos/twinkle-tray/releases" target="_blank"><img src="https://img.shields.io/github/v/release/xanderfrangos/twinkle-tray" alt="Latest release" /></a> <a href="https://github.com/xanderfrangos/twinkle-tray/releases" target="_blank"><img src="https://img.shields.io/github/downloads/xanderfrangos/twinkle-tray/total" alt="Total downloads" /></a> <a href="https://hosted.weblate.org/projects/twinkle-tray/twinkle-tray/" target="_blank"><img src="https://hosted.weblate.org/widgets/twinkle-tray/-/twinkle-tray/svg-badge.svg" alt="Translations" /></a></p>

> **本仓库是个人分支**，基于上游 [`v1.18.0-beta2`](https://github.com/xanderfrangos/twinkle-tray/releases) 重做，为 **iBasso Macchiato** USB DAC 增加了硬件音量控制。以下为与上游的差异说明，再往下是上游原始 README。

## 这个分支做了什么

| 功能 | 说明 |
|---|---|
| **滚轮调音量** | 在托盘图标上滚动调节当前默认输出的音量：Macchiato 走 DAC 硬件音量，其他设备走 Windows 音量；按住修饰键（默认 Ctrl）滚动则调节显示器亮度。两个槽位都可以在设置里改成任意组合，或设为「无」 |
| **音量 OSD** | 滚动时弹出与亮度 OSD 同样式的音量浮窗，复用面板窗口，不会出现两个窗口抢焦点 |
| **音量试听** | 点击或拖动音量条时播放 Windows 系统提示音；滚轮调节保持静音，可在「设置 → 音频」关闭 |
| **一键切回上次输出** | 面板按钮切换到上一次使用的音频设备（跨启动持久记录）；没有记录或该设备已拔出时，按设备列表顺延一位 |
| **面板音量条** | 音量条跟随当前默认输出：Macchiato 走 HID 硬件音量，其他设备走 Windows 端点音量；静音时进度条和数值变红，点喇叭图标切换静音 |
| **切换音频输出** | 音量条上方的「切换」按钮与右侧汉堡菜单相互独立：按钮一键切回上次输出（无目标时隐藏），菜单列出所有活动播放设备，当前设备带标记，未插入 DAC 时菜单仍可用 |
| **图标状态** | DAC 是 Windows 默认播放设备时，托盘图标从空心星变为实心星。由 `IMMNotificationClient` 事件驱动，切换设备即时生效 |
| **托盘增强** | tooltip 显示当前输出音量/静音状态；双击托盘图标静音当前输出；右键菜单直达 [Macchiato Web 控制台](https://ibasso.cn/uac/#/device/Macchiato) |
| **移除自动更新** | 更新检查、下载器、设置页「更新」分页、使用统计上报全部删除 |

## 实现要点

- `src/MacchiatoDevice.js` —— 直接讲 USB HID 协议（`node-hid`，可选依赖），自带热插拔监听和静音状态机
- `src/services/MacchiatoService.js` —— 主进程里唯一持有设备知识的地方，向上只暴露事件
- `src/modules/tt-windows-utils` —— 新增原生能力：查询/切换默认渲染端点、读写并监听任意端点的 Windows 音量（COM）、同步读取按键状态
- 音量写入按 25ms 合并，快速滚轮不会把 USB 或 COM 写入逐条堆积
- 需要 Node.js 22+，Windows 10/11 x64

## 开发

```
npm install                 # 会顺带编译原生模块
npm start                   # 开发模式（Parcel + Electron）
npm test                    # 纯逻辑单测，不需要 Electron
npm run electron-build      # 打包
```

若原生模块编译失败，可先 `npm install --ignore-scripts`，再对 `src/modules/*` 逐个执行 `node-gyp rebuild --target=<electron 版本> --dist-url=https://electronjs.org/headers`。

**GPU 兜底**：新版 Chromium 的 GPU 进程在部分 Windows 11 构建上无法启动（`GPU process isn't usable`）。本分支默认关闭硬件加速以规避，需要时可显式开启：

```
npm start -- --twinkle-gpu
```

或设置环境变量 `TWINKLE_TRAY_GPU=1`。

## 版本与命名

安装包按 **软件-上游版本-芯片型号-分支版本** 命名：

```
Twinkle-Tray-1.18.0-beta2-ibassoMacchiato-1.0.0.exe
```

`package.json` 的 `version` 走这条分支自己的版本线（当前 `1.0.0`），上游基线固定在文件名里，一眼能看出是基于哪个上游版本改的。

发版流程：**每次推送到 `master` 都会自动打标签、打包 NSIS 安装器并发布 GitHub Release**。自动版本号取当前 `1.0.x` 版本线，补丁号使用 GitHub Actions 运行号（例如 `v1.0.12`），不会重复。

也可以手动指定版本，或推送 `v*` 标签覆盖自动版本：

```
git tag -a v1.0.20 -m "..." && git push origin v1.0.20
```

## 已知限制

- 当前没有任何活动播放端点时，滚轮自动回落到调节显示器亮度
- 实心图标只对默认星形托盘图标生效；选 `mdl2` / `fluent` 时没有实心版本
- Macchiato 的静音是 HID 软件模拟（写入 0 并记住原值），退出程序后设备保持该状态；其他输出使用 Windows 原生静音
- 除中英外其余语言回退英文

---

<sub>以下为上游原始说明。</sub>

Twinkle Tray enables brightness control on external displays in Windows 10 & 11. Even though Windows is capable of adjusting the backlight on most monitors, it doesn't support external monitors natively. Windows also lacks any options to manage the brightness of multiple displays. This app inserts a new icon into your system tray, where you can click to have instant access to the brightness levels of all compatible displays. 

<img src="https://raw.githubusercontent.com/xanderfrangos/twinkle-tray/gh-pages/assets/img/tt-screenshot-w11.jpg" alt="Win 10 brightness slider" />

## Features
- Adds brightness sliders to the system tray, similar to the built-in Windows volume flyout.
- Seamlessly blends in with Windows 10 and Windows 11. Uses your Personalization settings to match your taskbar.
- Can automatically change monitor brightness depending on the time of day or when idle.
- Bind hotkeys to adjust the brightness of specific or all displays.
- Normalize backlight across different monitors.
- Control DDC/CI features such as contrast.
- Starts up with Windows.

### Design & Personalization

Twinkle Tray will automatically adjust the look and feel to match your Windows version and preferences. Additional options are available to select the Windows version and theme of your choice.

<img src="https://raw.githubusercontent.com/xanderfrangos/twinkle-tray/gh-pages/assets/img/tt-comparison.jpg" alt="Win 11 brightness slider" />

## Download

**Download the lastest version from [twinkletray.com](https://twinkletray.com/) or the [Releases page](https://github.com/xanderfrangos/twinkle-tray/releases).**

<a href="https://www.microsoft.com/store/productId/9PLJWWSV01LK" target="_blank"><img width="156" src="https://crushee.app/assets/img/ms-store.svg" alt="Get Twinkle Tray brightness slider from the Microsoft Store"></a>

## Install via Package Manager

### Windows Package Manager

```powershell
winget install xanderfrangos.twinkletray
```

### Chocolatey (unofficial)

[Chocolatey](https://chocolatey.org/) users can download and install Twinkle Tray from Chocolatey's Community Repository by installing the `twinkle-tray` package:

```powershell
choco install twinkle-tray
```

To upgrade to the latest approved package version, run the following command:

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
