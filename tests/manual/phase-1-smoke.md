# Phase 1 Manual Smoke

Use this checklist for the Phase 1 exit gate after the automated suite is green.

## Browser-Hosted Web

- Open `http://127.0.0.1:1420/`.
- Confirm the app shell renders with the field canvas, right inspector, and status bar.
- Create a new project with `New`.
- Add a waypoint from `Path Elements`.
- Select the waypoint from the list and edit `X (m)`, `Y (m)`, and `Rotation (deg)`.
- Confirm the canvas and list update.
- Drag a translation-bearing element on the canvas and confirm the selected element status changes.
- Click `Undo`, then `Redo`, and confirm the structural edit changes correctly.
- Click `Save` and confirm the status reports saved.
- Reload the page and confirm the saved project reopens with the edited values.
- Make another edit, wait for autosave to report saved, reload again, and confirm the autosaved edit recovered.
- Use `Export` to download the current project bundle.
- Use `Import` to load a JSON project bundle and confirm the imported project opens.

## Tauri Desktop

- Run `npm run tauri:dev`.
- Confirm the desktop shell opens and renders the same frontend.
- Create, edit, save, close, and relaunch.
- Confirm the project is recovered from Tauri app-data storage.

## Notes

- Phase 1 only requires basic local persistence and editor usability.
- Full constraint editing, full simulation parity, advanced config dialogs, Systemcore packaging, and live robot deployment are Phase 2+ work.
