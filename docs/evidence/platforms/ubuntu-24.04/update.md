# Updater test against the GitHub release · Ubuntu 24.04.5 LTS · Orca 1.4.258

| Step | Result | Detail |
| --- | --- | --- |
| update --check (nothing installed: reports the release) | ✅ | exit 0 (expected 0) |
| update --yes (download, SHA-256, unpack, install) | ✅ | exit 0 (expected 0) |
| installed version equals the latest release (0.2.0) | ✅ | exit 0 (expected 0) |
| update --check again: up to date | ✅ | exit 0 (expected 0) |
| update --force reinstalls the same release | ✅ | exit 0 (expected 0) |
| per-user folder holds the release | ✅ | exit 0 (expected 0) |
