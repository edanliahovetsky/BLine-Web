# UI

React UI for the editor lives here. Shared reusable controls are defined under
`src/ui/controls`; new UI code should start there before adding local button,
switch, select, or numeric-input markup.

Use local CSS for layout and feature-specific composition. Use shared control
classes and components for recurring control behavior, states, and icons.

## Editor UX Structure

- `app/StartCenter.tsx` owns the no-project experience and explicit sample
  entry point.
- `app/editorCommands.ts` defines command-palette metadata, keyboard shortcut
  matching, and persisted editor-only preferences.
- `app/CommandPalette.tsx` owns command search and the shortcut reference.
- `app/pathDiagnostics.ts` derives lightweight path-health messages without
  changing serialized BLine project data.
- `canvas/PathStage.tsx` owns direct field placement, the tool rail, and view
  controls. Canvas chrome must stop pointer events before they reach field
  placement and pan handlers.
- `sidebar/Sidebar.tsx` owns the tabbed Elements / Constraints inspector.
- `sidebar/sections/ConstraintEditor.tsx` keeps compact constraint cards and
  the synchronized, draggable expanded editor on the same command path.

The top bar is for navigation and infrequent project actions. The canvas rail
is for path creation. The inspector is for editing the selected object or
constraint. The bottom status bar combines selection context, tool guidance,
diagnostics, autosave state, and manual save/retry.

The desktop inspector is visible by default and collapses into the canvas when
closed. At compact widths it becomes an overlay drawer. Simulation transport
uses the familiar J/K/L keys in addition to arrow/Home/End and Space controls.
Each ranged constraint exposes an Expand action; the expanded editor stays
non-modal so teams can keep the field visible, closes with Escape, and restores
focus to the action that opened it.

Editor-only preferences belong in local storage and must not be added to
`config.json` or path JSON. Project actions must continue through the state and
project IO boundaries.

New modal surfaces should use `useDialogFocusTrap`, close on Escape, restore
focus to their trigger, and expose one specific dialog name.
