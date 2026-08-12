# Security Policy

## Supported versions

InfiniteDesk is currently in pre-release development. Security fixes are provided for the latest published version only.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/ppsssj/InfiniteDesk/security/advisories/new).

Do not include exploit details, private window contents, credentials, or other sensitive information in a public GitHub issue. A useful report should include the affected version, Windows version, reproduction steps, security impact, and any relevant logs with personal information removed.

## Security-sensitive behavior

InfiniteDesk controls other Windows application windows through Win32 APIs and local PowerShell host processes. It can enumerate windows, move and focus windows, relay pointer input, launch trusted Dock entries, and display DWM previews. Reports involving these boundaries are especially important.
