# InfiniteDesk

<p align="center">
  <img src="docs/assets/logo-concept.png" alt="InfiniteDesk logo concept" width="320" />
</p>

<p align="center">
  English | <a href="README.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe"><strong>Download InfiniteDesk 0.1.0 for Windows</strong></a>
</p>

InfiniteDesk is a desktop layout controller for Windows. It lets you scan currently running app windows, preview them in one workspace, arrange them on a canvas, and apply that layout back to the real desktop.

It is designed for workflows where several apps are open at once and window placement matters.

## Download

Download the Windows installer from GitHub Releases.

- [Download InfiniteDesk 0.1.0](https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe)
- [View all releases](https://github.com/ppsssj/InfiniteDesk/releases)

The current installer is not code-signed, so Windows SmartScreen or security warnings may appear.

## Demo

![InfiniteDesk demo](docs/video/infinitedesk_demo.gif)

[Watch the MP4 demo](docs/video/infinitedesk_demo.mp4)

![InfiniteDesk workspace](docs/assets/workspace-screenshot1.png)

![InfiniteDesk dock and app search](docs/assets/workspace-screenshot2.png)

![InfiniteDesk dark workspace](docs/assets/workspace-screenshot-dark.png)

## Features

- Scan currently open Windows app windows.
- Preview real windows with DWM-based live previews.
- Move and arrange window cards on a canvas.
- Apply the canvas layout back to real Windows windows.
- Select multiple windows with `Ctrl + Drag`.
- Move selected window groups together.
- Pan horizontally with `Shift + Scroll`.
- Save frequently used window arrangements as Workspaces.
- Search and launch local apps from the Dock.
- Use Mirror Control to relay clicks, drags, and scrolling from the preview to the original window.
- Use Native Overlay as a translucent control layer above the real desktop.

## Usage

1. Launch InfiniteDesk.
2. Click `Scan Windows` or press `Ctrl + R`.
3. Arrange window previews on the canvas.
4. Use `Ctrl + Drag` on empty canvas space to select multiple windows.
5. Drag one selected window to move the selected group together.
6. Click `Save Workspace` or press `Ctrl + S` to save the current arrangement.
7. Click `Apply Layout` or press `Ctrl + Enter` to apply the canvas layout to real windows.
8. Use Native Overlay and Mirror Control when you need more direct control over real windows.

## Development

### Requirements

- Windows
- Node.js 22 or newer recommended
- npm

### Install

```powershell
npm ci
```

### Development Server

```powershell
npm run dev
```

### Test

```powershell
npm test
```

### Build Windows Installer

```powershell
npm run package:win
```

The installer is generated at `release/InfiniteDesk Setup 0.1.0.exe`.

## Distribution

InfiniteDesk is currently in an early release state. Windows installers are distributed through GitHub Releases.

## Privacy

InfiniteDesk handles local desktop information such as window titles, process names, window bounds, and DWM previews. The current version does not use analytics SDKs, advertising SDKs, remote telemetry, or automatic updates.

See [PRIVACY.md](PRIVACY.md) for details.

## License

InfiniteDesk itself is not open source licensed. See [NOTICE.md](NOTICE.md).

Third-party open source notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

