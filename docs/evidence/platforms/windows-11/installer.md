# Installer test · Windows 11 Pro (10.0.26200, x64) · Orca 1.4.258

Run on the development PC with the installed Orca desktop app (2026-11-13). The development registration
of the plugin was unloaded for the test and restored afterwards.

| Step | Result | Detail |
| --- | --- | --- |
| status (development copy loaded) | ✅ | lists `local.file-preview 0.1.0 idle sandboxed-ui, dev` |
| install while a development copy is loaded | ✅ | refused with the `plugin dev unload` hint (exit 1), nothing changed |
| install -Yes (approval shown, then approved) | ✅ | Orca's approval text printed (access, 8 custom editors, source folder, fingerprint), installed `idle` |
| editor renders an .xlsx in the installed copy | ✅ | `plugin shot` ok, editor `sheet`, 0 errors |
| install again = update | ✅ | `plugin update local.file-preview` (folder re-copied), still `idle` |
| uninstall -Yes | ✅ | `Removed: local.file-preview`, gone from `plugin list` |
| install declined (answer `n`) | ✅ | `Cancelled: nothing was installed.` (exit 1), nothing installed |
| release zip: install / uninstall from the extracted `File Preview` folder | ✅ | source `…\Temp\fp-pkg-test\File Preview\plugin` (path with a space), installed then removed |

Korean output displays correctly in Windows PowerShell 5.1 (script saved as UTF-8 with BOM; `install.cmd`
switches the console to UTF-8).
