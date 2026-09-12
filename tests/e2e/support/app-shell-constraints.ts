import type { Page } from "@playwright/test";
import { gotoSampleEditor } from "./app-shell-shared";

/** Stable authored values for tests of manual range/radius editing. */
export async function gotoManualConstraintEditor(page: Page): Promise<void> {
  await gotoSampleEditor(page);
  await page.evaluate(async () => {
    const storePath = "/src/state/projectStore.ts";
    const { projectStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import("../../../src/state/projectStore");
    projectStore.getState().applyPathCommand({
      description: "Set manual constraint test fixture",
      apply: (path) => ({
        ...path,
        path_elements: path.path_elements.map((element, index) => {
          if (element.type === "waypoint") {
            return {
              ...element,
              translation_target: {
                ...element.translation_target,
                intermediate_handoff_radius_meters: index === 0 ? 0.4 : null,
                handoff_radius_source: index === 0 ? "manual" : undefined,
              },
            };
          }
          return element.type === "translation"
            ? {
                ...element,
                intermediate_handoff_radius_meters: 0.4,
                handoff_radius_source: "manual",
              }
            : element;
        }),
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 3,
            start_ordinal: 1,
            end_ordinal: 4,
          },
        ],
      }),
      revert: (path) => path,
    });
    projectStore.getState().history.getState().clear();
  });
}

export async function openConstraintsTab(page: Page): Promise<void> {
  const constraintsTab = page.getByRole("tab", { name: /Constraints/ });
  if (!(await constraintsTab.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector" }).click();
  }
  await constraintsTab.click();
}
