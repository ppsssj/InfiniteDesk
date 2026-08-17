# InfiniteDesk virtual display prototype

This is an x64 UMDF/IddCx feasibility driver for one hidden InfiniteDesk workspace monitor.
It is based on Microsoft's Windows Driver Samples video/IndirectDisplay sample and retains
the original Microsoft copyright headers.

The prototype exists to validate this architecture:

1. Windows renders Chrome, Figma, VS Code, and other target windows on a virtual monitor.
2. InfiniteDesk captures and scales those windows without resizing or reparenting them.
3. The real system cursor is parked over the target on the virtual monitor.
4. InfiniteDesk draws a software cursor over its physical-monitor preview.
5. The target receives genuine mouse, wheel, modifier, and keyboard input.

The driver exposes one monitor and the companion host creates a removable software device.
Closing the host removes that device for the current session.

## Requirements

- Windows 11 x64
- Visual Studio 2022 Build Tools with the C++ and WDK Build Tools components
- Windows SDK and WDK 10.0.26100
- Administrator rights for certificate and driver installation
- Test-signing configuration during local development

## Build

From the repository root:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\virtual-display\build.ps1

Outputs are written under native/virtual-display/x64/Debug.

## Local test sequence

Run the following scripts from an elevated PowerShell prompt. Enabling or disabling test
signing takes effect only after restarting Windows.

    .\native\virtual-display\set-test-signing.ps1 -Mode Enable
    # Restart Windows.
    .\native\virtual-display\install-test-driver.ps1
    .\native\virtual-display\x64\Debug\InfiniteDeskVirtualDisplayHost.exe

Press X in the host console to remove the software monitor for the current session.

To remove the package and return Windows to its normal signing policy:

    .\native\virtual-display\remove-test-driver.ps1
    .\native\virtual-display\set-test-signing.ps1 -Mode Disable
    # Restart Windows.

## Safety

This is not a production driver. Do not distribute its test certificate or package. Before
installation, verify that the INF hardware ID is InfiniteDeskVirtualDisplay and that the
package contains only this prototype's DLL, INF, CAT, and certificate.

The driver and host are deliberately separate from the Electron application until monitor
creation, removal, display recovery, and cursor recovery are proven reliable.

## Upstream

- Source: https://github.com/microsoft/Windows-driver-samples/tree/main/video/IndirectDisplay
- Model: https://learn.microsoft.com/windows-hardware/drivers/display/indirect-display-driver-model-overview
