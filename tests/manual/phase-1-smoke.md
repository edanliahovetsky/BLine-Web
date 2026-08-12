# Phase 1 Manual Smoke

Use this checklist for the Phase 1 exit gate after the automated suite is green.

## Browser-Hosted Web

- Open `http://127.0.0.1:1420/`.
- With browser storage empty, confirm the start center shows Create, Open,
  Import, Recent Projects, and Open sample.
- Create a named project and first path. Confirm the field canvas, right
  inspector, and flat status bar open.
- Press `1`, click the field, and confirm a waypoint is inserted and selected.
- Press `V`, use the arrow keys to change selection, and use `Alt` + arrow keys
  to reorder the selected element.
- Select the waypoint from the list and edit `X (m)`, `Y (m)`, and `Rotation (deg)`.
- Confirm the canvas and list update.
- Drag a translation-bearing element on the canvas and confirm the selected element status changes.
- Click `Undo`, then `Redo`, and confirm the structural edit changes correctly.
- Press `Cmd/Ctrl+K`, search for a tool and a path, run each result, and confirm
  Escape returns focus to the command trigger.
- Press `?` and confirm the keyboard shortcut reference opens.
- Click the save status (or press `Cmd/Ctrl+S`) and confirm it reports saved.
- Reload the page and confirm the saved project reopens with the edited values.
- Make another edit, wait for autosave to report saved, reload again, and confirm the autosaved edit recovered.
- Open Project Navigator, search for a path, switch collections, and open the
  selected path.
- At a compact desktop viewport, confirm the inspector opens as a drawer and
  closes from its close button or backdrop without resizing the canvas.
- On desktop, drag the inspector's left edge and confirm its width changes and
  survives reload. Toggle it from the top-right button and confirm the canvas
  expands and restores.
- Click every canvas tool and view control, confirming the selected/pressed
  state changes without also placing or dragging a path element.
- Use J/K/L and Left/Right to restart, play or pause, and finish the simulation.
  Confirm the simulated trajectory grows behind the robot instead of drawing
  the future route before the robot reaches it.
- Open Constraints and confirm the velocity status starts at Not generated.
  Choose Generate and confirm the ranges are applied immediately and the status
  becomes Up to date. Edit the path, confirm it becomes Path changed, then
  generate again and clear the generated ranges.
- Add a new translation target or waypoint and confirm its handoff radius starts
  in Auto. With Keep in sync enabled, move the anchor and confirm both its auto
  radius and generated velocity caps refresh.
- Shift-click two velocity ranges, then two handoff radii. Confirm the shared
  controls can switch Auto/Manual, set one value, and delete the selection.
  Auto mode must read green, Manual blue; radius geometry stays purple with
  dashed/hatched Auto and solid Manual styling.
- Choose Expand on a ranged constraint. Confirm the larger editor opens for
  that constraint, can be dragged without leaving the viewport, stays
  synchronized with the compact inspector, closes with Escape, and returns
  focus to Expand.
- Use Export to download the current project bundle.
- Use Import to load a JSON project bundle and confirm the imported project opens.

## Tauri Desktop

- Run `npm run tauri:dev`.
- Confirm the desktop shell opens and renders the same frontend.
- Create, edit, save, close, and relaunch.
- Confirm the project is recovered from Tauri app-data storage.

## Notes

- Editor-only layout and tool preferences must not appear in project JSON.
- Saving a project remains separate from robot deployment.
