import {
  readEditorLayoutPreferences,
  rememberEditorLayoutPreferences,
} from "../../userData";

export type EditorTool =
  | "select"
  | "waypoint"
  | "translation"
  | "rotation"
  | "event"
  | "curve";

// Global shortcuts may run from editable controls; editor shortcuts wait until
// the shell's editable/interactive focus guards have passed.
export type CommandScope = "global" | "editor";

export interface ShortcutBinding {
  key: string;
  alt?: boolean;
  metaOrCtrl?: boolean;
  shift?: boolean;
}

export interface EditorCommand {
  id: string;
  label: string;
  category: string;
  keywords?: readonly string[];
  shortcut?: ShortcutBinding;
  shortcutAliases?: readonly ShortcutBinding[];
  scope?: CommandScope;
  disabled?: boolean;
  run(): void | Promise<void>;
}

export function executeCommand(command: EditorCommand): boolean {
  if (command.disabled) {
    return false;
  }

  void command.run();
  return true;
}

export function commandForShortcut(
  commands: readonly EditorCommand[],
  event: KeyboardEvent,
  scope: CommandScope,
): EditorCommand | null {
  return (
    commands.find(
      (command) =>
        command.scope === scope &&
        [command.shortcut, ...(command.shortcutAliases ?? [])].some(
          (shortcut) => shortcut && shortcutMatches(event, shortcut),
        ),
    ) ?? null
  );
}

export interface EditorUiPreferencesV1 {
  version: 1;
  inspectorTab: "elements" | "constraints";
  inspectorWidth: number;
  showGhostPaths: boolean;
}

export const defaultEditorUiPreferences: EditorUiPreferencesV1 = {
  version: 1,
  inspectorTab: "elements",
  inspectorWidth: 340,
  showGhostPaths: true,
};

export const inspectorWidthMin = 280;
export const inspectorWidthMax = 560;

export function readEditorUiPreferences(): EditorUiPreferencesV1 {
  const preferences = readEditorLayoutPreferences();
  return {
    version: 1,
    inspectorTab: preferences.inspector_tab,
    inspectorWidth: clampInspectorWidth(preferences.inspector_width),
    showGhostPaths: preferences.show_ghost_paths,
  };
}

export function writeEditorUiPreferences(
  preferences: EditorUiPreferencesV1,
): void {
  rememberEditorLayoutPreferences({
    inspector_tab: preferences.inspectorTab,
    inspector_width: clampInspectorWidth(preferences.inspectorWidth),
    show_ghost_paths: preferences.showGhostPaths,
  });
}

export function commandMatchesQuery(
  command: EditorCommand,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    command.label,
    command.category,
    command.id,
    ...(command.keywords ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function shortcutMatches(
  event: KeyboardEvent,
  binding: ShortcutBinding,
): boolean {
  return (
    event.key.toLocaleLowerCase() === binding.key.toLocaleLowerCase() &&
    Boolean(event.altKey) === Boolean(binding.alt) &&
    (binding.key === "?" ||
      Boolean(event.shiftKey) === Boolean(binding.shift)) &&
    Boolean(event.metaKey || event.ctrlKey) === Boolean(binding.metaOrCtrl)
  );
}

export function formatShortcut(
  binding: ShortcutBinding | undefined,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  if (!binding) {
    return "";
  }

  const mac = /mac|iphone|ipad/i.test(platform);
  const parts: string[] = [];
  if (binding.metaOrCtrl) {
    parts.push(mac ? "⌘" : "Ctrl");
  }
  if (binding.alt) {
    parts.push(mac ? "⌥" : "Alt");
  }
  if (binding.shift) {
    parts.push(mac ? "⇧" : "Shift");
  }

  const key = normalizeShortcutKey(binding.key);
  return mac ? `${parts.join("")}${key}` : [...parts, key].join("+");
}

function normalizeShortcutKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key === "ArrowUp") {
    return "↑";
  }
  if (key === "ArrowDown") {
    return "↓";
  }
  if (key === "ArrowLeft") {
    return "←";
  }
  if (key === "ArrowRight") {
    return "→";
  }
  return key.length === 1 ? key.toLocaleUpperCase() : key;
}

export function clampInspectorWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(
        inspectorWidthMax,
        Math.max(inspectorWidthMin, Math.round(value)),
      )
    : defaultEditorUiPreferences.inspectorWidth;
}
