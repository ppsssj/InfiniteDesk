# Virtual-display input spike

This is a driver-free go/no-go test for the hardest part of the proposed virtual-display architecture.
It uses the second physical monitor as a temporary stand-in for a future IddCx monitor:

- the real target window stays at its original size on one monitor;
- a DWM-scaled mirror is shown on the other monitor;
- F8 moves and confines the real Windows cursor over the original target;
- the target receives genuine hardware mouse, wheel, modifier, and keyboard input;
- a software cursor is drawn over the scaled mirror;
- Ctrl+Alt+F10 restores the physical cursor and Ctrl+Alt+F12 exits safely.

No target window is resized, reparented, or moved by this prototype.

## Run

Use Windows PowerShell in STA mode:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\prototypes\virtual-display-input-proxy.ps1 -ListWindows
```

Put the selected target on one monitor and run the proxy on the other monitor:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\prototypes\virtual-display-input-proxy.ps1 -TargetHwnd 0x123456
```

If there is exactly one visible window for the process, `-ProcessName chrome` or `-ProcessName Code` can be used instead.

## Test sequence

1. Point inside the mirrored image and press F8.
2. Verify click, drag, vertical wheel, Shift+wheel, and keyboard input.
3. Press Ctrl+Alt+F10 and confirm that the cursor returns to its saved position.
4. Repeat at least 100 wheel events in Chrome/Figma and VS Code.
5. Press Ctrl+Alt+F12 to close the prototype.

The physical target monitor exposes the otherwise-hidden real cursor during this spike. A real virtual monitor would not
be physically visible; the software cursor in the mirror is the intended user-facing cursor.

## Go/no-go

Proceed to an IddCx prototype only if Chrome/Figma and VS Code accept the real wheel and keyboard path reliably, the
software cursor remains aligned with the mirror, and Ctrl+Alt+F10 always restores the cursor. Stop if focus is unstable, wheel
events are lost, or cursor recovery cannot be made deterministic.

## Result (2026-08-17)

Go. The dual-monitor stand-in test passed with a Chrome window (including Figma content) and Visual Studio Code:

- genuine click and wheel input reached the covered target;
- no extension or app-specific adapter was used;
- the target window was not resized, reparented, or moved;
- the physical cursor was restored to the full 3840x1080 desktop after leaving input mode.

The remaining unproven part is replacing the second physical monitor with an IddCx virtual monitor. That requires a
separately built and test-signed UMDF indirect-display driver.
