# Installer test · Ubuntu 22.04.5 LTS · Orca 1.4.258

| Step | Result | Detail |
| --- | --- | --- |
| status before install | ✅ | exit 0 (expected 0) |
| install declined without a terminal (nothing installed) | ✅ | exit 1 (expected 1) |
| plugin absent after decline | ✅ | exit 0 (expected 0) |
| install --yes (approval shown, then approved) | ✅ | exit 0 (expected 0) |
| plugin listed and idle | ✅ | exit 0 (expected 0) |
| editor renders a .docx in the installed copy | ✅ | exit 0 (expected 0) |
| install again = update | ✅ | exit 0 (expected 0) |
| uninstall --yes | ✅ | exit 0 (expected 0) |
| plugin gone after uninstall | ✅ | exit 0 (expected 0) |
| uninstall when not installed is a no-op | ✅ | exit 0 (expected 0) |
