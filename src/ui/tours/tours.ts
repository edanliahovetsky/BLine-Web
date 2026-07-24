import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type PathModel,
} from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import type { TourDefinition } from "./tourStore";

export const editorBasicsTourId = "editor-basics";

/** Scratch path a tour switches to so nothing it teaches touches real autos. */
export const tourPracticePathName = "Tour practice";

/**
 * The practice path starts with a small, valid two-waypoint run so the editor
 * has something to show (and Path Health has nothing to flag) before the
 * learner adds their own elements.
 */
export function createTourPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 3,
          y_meters: 3,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: 0,
          t_ratio: 0,
        }),
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 6.5,
          y_meters: 4.5,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: 0,
          t_ratio: 0,
        }),
      }),
    ],
  });
}

/**
 * Element counts are captured when the tour starts so the "place a waypoint"
 * step can tell that the user actually added something.
 */
let elementCountAtStepStart = 0;

export function captureElementCount(): void {
  elementCountAtStepStart =
    projectStore.getState().project?.path.path_elements.length ?? 0;
}

function elementWasAdded(): boolean {
  const current =
    projectStore.getState().project?.path.path_elements.length ?? 0;
  return current > elementCountAtStepStart;
}

export const editorBasicsTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Editor basics",
  summary: "Place, shape, simulate and save a path",
  steps: [
    {
      target: "path-breadcrumb",
      title: "You are on a practice path",
      body: `Every edit applies to the path named here. The tour moved you to “${tourPracticePathName}”, so try anything — your real autos are untouched.`,
      placement: "below",
    },
    {
      target: "tool-rail",
      title: "Pick a tool, then click the field",
      body: "Choose the Waypoint tool and click anywhere on the field to drop one. Each tool has a number key.",
      keys: ["V", "1", "2", "3"],
      placement: "right",
      completeWhen: elementWasAdded,
    },
    {
      target: "path-canvas",
      title: "Shape the path",
      body: "Drag any anchor to move it. With one selected, arrow keys nudge it 5 cm — hold Shift for bigger steps.",
      keys: ["←", "↑", "↓", "→", "Shift"],
      placement: "right",
    },
    {
      target: "inspector-panel",
      title: "Every element, in order",
      body: "The inspector lists the path from start to finish. Select a row to type exact coordinates or duplicate it.",
      keys: ["⌘D", "[", "]"],
      placement: "left",
      prepare: { inspector: "open" },
    },
    {
      target: "inspector-constraints",
      title: "Tune how fast it drives",
      body: "Open the Constraints tab to set a max velocity per segment, or let the optimizer generate them.",
      placement: "left",
      prepare: { inspector: "open" },
    },
    {
      target: "simulation-transport",
      title: "Watch the run",
      body: "Play the simulation to see the robot follow your path, then keep refining. That is the whole loop.",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
    },
  ],
};

export const tours: readonly TourDefinition[] = [editorBasicsTour];

export function findTour(tourId: string | null): TourDefinition | null {
  return tours.find((tour) => tour.id === tourId) ?? null;
}
