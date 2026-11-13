# Updater test against the GitHub release · Windows 11 Pro (10.0.26200) · Orca 1.4.258

Run on the development PC against the published v0.2.0 release (2026-11-13).

| Step | Result | Detail |
| --- | --- | --- |
| `update -Check` (nothing installed) | ✅ | `Release: 0.2.0` · `Update available: 0.2.0` |
| `update -Yes` with the v0.2.0 script | ❌ | `Checksum mismatch` — GitHub serves `.sha256` as `application/octet-stream`, so `Invoke-WebRequest` returned bytes and the parsed hash was wrong (assets themselves verified correct with `sha256sum`) |
| `update -Yes` with the fix (saved to a file, read as text) | ✅ | downloaded `orca-file-preview-0.2.0.zip`, `SHA-256 OK: 34cb5c7a…`, installed from `%LOCALAPPDATA%\FilePreviewForOrca\0.2.0`, `local.file-preview 0.2.0 idle` |
| `update -Check` again | ✅ | `Installed: 0.2.0 · Release: 0.2.0 · Up to date` |
| `update -Yes` from the installed 0.2.0 to the v0.2.1 release | ✅ | `Installed: 0.2.0 · Release: 0.2.1`, `SHA-256 OK: e033fe5b…`, `local.file-preview 0.2.1 idle`, then `Up to date`; per-user folder keeps 0.2.0 and 0.2.1 |

The fix ships in v0.2.1. The Windows updater inside v0.2.0 (`update.cmd`, `FilePreviewSetup-0.2.0.exe /update`)
cannot update itself; download v0.2.1 once by hand. macOS/Linux updaters were not affected (Ubuntu 22.04/24.04 6/6).
