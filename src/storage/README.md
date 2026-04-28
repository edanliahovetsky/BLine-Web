# Storage

Storage adapters for browser and Tauri modes live here.

- Browser mode uses `window.localStorage` under the `bline-web:project:` key
  prefix for legacy one-path records and `bline-web:workspace:` for current
  multi-path workspaces. Browser storage is persistent per origin until the user
  clears site data, changes browsers/profiles, or opens the app from a different
  origin.
- Browser project import/export is centered on the BLine autos folder shape:
  `config.json` plus `paths/*.json`. Project archives remain supported as a
  secondary portable JSON format.
- Desktop/Tauri mode treats the selected BLine autos directory as source of
  truth. It reads and writes one workspace over `config.json` and
  `paths/*.json`, resolving an FRC repo root to `src/main/deploy/autos` like the
  PySide GUI.
