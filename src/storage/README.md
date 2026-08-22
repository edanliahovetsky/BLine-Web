# Storage

Storage adapters for browser and Tauri modes live here.

- Browser mode stores each canonical Project file set in one versioned
  `window.localStorage` record under `bline-web:workspace:`. Older one-Path and
  combined-workspace records are read only for verified migration. Browser
  storage is persistent per origin until the user clears site data, changes
  browsers/profiles, or opens the app from a different origin.
- Browser project import/export is centered on the BLine autos folder shape:
  BLine-Lib runtime files at `config.json` and `paths/*.json`, plus the narrow,
  visible `project.json`. Field Backgrounds live in global User Data rather
  than Project folders or new archives. Legacy archives remain importable.
- Desktop/Tauri mode treats the selected BLine autos directory as source of
  truth. It writes the same canonical file set through a bounded old-or-new
  transaction, resolving an FRC repo root to `src/main/deploy/autos` like the
  PySide GUI. `.bline-web` is a read-once legacy migration source only.
