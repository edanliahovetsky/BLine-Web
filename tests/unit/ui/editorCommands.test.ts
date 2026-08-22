import { describe, expect, it, vi } from "vitest";
import {
  clampInspectorWidth,
  commandForShortcut,
  commandMatchesQuery,
  executeCommand,
  formatShortcut,
  shortcutMatches,
  type EditorCommand,
} from "../../../src/ui/app/editorCommands";

const command: EditorCommand = {
  id: "project.navigator",
  label: "Open project navigator",
  category: "Project",
  keywords: ["paths", "collections"],
  run() {},
};

describe("editor commands", () => {
  it("matches labels, categories, ids, and keywords", () => {
    expect(commandMatchesQuery(command, "navigator")).toBe(true);
    expect(commandMatchesQuery(command, "collections")).toBe(true);
    expect(commandMatchesQuery(command, "project.nav")).toBe(true);
    expect(commandMatchesQuery(command, "velocity")).toBe(false);
  });

  it("formats platform-specific shortcuts", () => {
    expect(
      formatShortcut({ key: "k", metaOrCtrl: true, shift: true }, "MacIntel"),
    ).toBe("⌘⇧K");
    expect(
      formatShortcut({ key: "ArrowRight", alt: true }, "Linux x86_64"),
    ).toBe("Alt+→");
  });

  it("matches the requested modifier set exactly", () => {
    const event = {
      key: "s",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as KeyboardEvent;

    expect(shortcutMatches(event, { key: "s", metaOrCtrl: true })).toBe(true);
    expect(
      shortcutMatches(event, {
        key: "s",
        metaOrCtrl: true,
        shift: true,
      }),
    ).toBe(false);
  });

  it("matches command aliases only within their focus scope", () => {
    const redo: EditorCommand = {
      id: "edit.redo",
      label: "Redo",
      category: "Edit",
      shortcut: { key: "z", metaOrCtrl: true, shift: true },
      shortcutAliases: [{ key: "y", metaOrCtrl: true }],
      scope: "editor",
      run() {},
    };
    const event = {
      key: "y",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as KeyboardEvent;

    expect(commandForShortcut([redo], event, "editor")).toBe(redo);
    expect(commandForShortcut([redo], event, "global")).toBeNull();
  });

  it("recognizes the shifted question-mark key without displaying Shift", () => {
    const event = {
      key: "?",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    } as KeyboardEvent;

    expect(shortcutMatches(event, { key: "?" })).toBe(true);
    expect(formatShortcut({ key: "?" }, "Linux x86_64")).toBe("?");
  });

  it("does not execute disabled commands", () => {
    const run = vi.fn();
    expect(executeCommand({ ...command, disabled: true, run })).toBe(false);
    expect(run).not.toHaveBeenCalled();

    expect(executeCommand({ ...command, run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("keeps persisted inspector widths within usable desktop bounds", () => {
    expect(clampInspectorWidth(120)).toBe(280);
    expect(clampInspectorWidth(426.4)).toBe(426);
    expect(clampInspectorWidth(900)).toBe(560);
  });
});
