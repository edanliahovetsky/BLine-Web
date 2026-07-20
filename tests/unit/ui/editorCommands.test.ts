import { describe, expect, it } from "vitest";
import {
  clampInspectorWidth,
  commandMatchesQuery,
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

  it("keeps persisted inspector widths within usable desktop bounds", () => {
    expect(clampInspectorWidth(120)).toBe(280);
    expect(clampInspectorWidth(426.4)).toBe(426);
    expect(clampInspectorWidth(900)).toBe(560);
  });
});
