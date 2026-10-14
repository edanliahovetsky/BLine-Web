import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";
import { createImportExportTour } from "../../../src/ui/tours/importExportLesson";
import type { TourDefinition } from "../../../src/ui/tours/tourStore";

const lessons: readonly TourDefinition[] = [
  ...tours,
  // The picker only lists the installed shell's variant; lint both.
  createImportExportTour("browser-web"),
  createImportExportTour("tauri"),
];

describe("lesson lint", () => {
  it("lets the learner reach every control a checked step waits for", () => {
    const deadEnds = lessons.flatMap((lesson) =>
      lesson.steps.flatMap((step, index) =>
        step.check && (step.interact ?? []).length === 0
          ? [`${lesson.id} step ${index + 1} “${step.title}”`]
          : [],
      ),
    );
    expect(deadEnds).toEqual([]);
  });

  it("does not ask for a Settings Save button the walkthrough hides", () => {
    const saves = lessons.flatMap((lesson) =>
      lesson.steps.flatMap((step, index) =>
        step.settingsSection &&
        [step.body, step.task ?? ""].some((text) =>
          /\bsave settings\b|\band save\b/i.test(text),
        )
          ? [`${lesson.id} step ${index + 1}`]
          : [],
      ),
    );
    expect(saves).toEqual([]);
    const handoffDefault = lessons
      .find((lesson) => lesson.id === "handoff-modes")!
      .steps.find((step) => step.settingsSection === "path-defaults")!;
    expect(handoffDefault.interact).toContain("settings-dialog");
    expect(handoffDefault.check?.().message).not.toMatch(/save/i);
  });
});
