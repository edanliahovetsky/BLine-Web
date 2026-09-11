import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
} from "../../core/model/path";
import type { ProjectPath } from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { practiceConfig } from "./tourScenario";
import type { TourDefinition, TourStep } from "./tourStore";

export function createPathGroupPracticePaths(): ProjectPath[] {
  return [
    {
      name: "Approach",
      points: [
        [5, 2],
        [9, 6],
      ],
    },
    {
      name: "Return",
      points: [
        [9, 6],
        [14, 2],
      ],
    },
  ].map(({ name, points }) => ({
    path_id: `lesson-${name.toLowerCase()}`,
    display_name: name,
    file_name: `${name.toLowerCase()}.json`,
    path: createPathModel({
      path_elements: points.map(([x_meters, y_meters]) =>
        createWaypoint({
          translation_target: createTranslationTarget({ x_meters, y_meters }),
        }),
      ),
    }),
  }));
}

const navigatorOpen = () =>
  !!document.querySelector('[data-tour="project-navigator"]');
const practiceGroup = () =>
  projectStore
    .getState()
    .project?.path_groups.find((group) => group.display_name === "Practice");
const hasPaths = (ids: string[]) => {
  const group = practiceGroup();
  return (
    !!group &&
    group.path_ids.length === ids.length &&
    ids.every((id) => group.path_ids.includes(id))
  );
};
const preservedPaths = () =>
  feedback(
    projectStore.getState().project?.paths.length === 2 &&
      ["lesson-approach", "lesson-return"].every((id) =>
        projectStore
          .getState()
          .project?.paths.some((path) => path.path_id === id),
      ),
    "Keep both practice paths. Press ⌘Z or Ctrl+Z to undo an extra path or a deletion.",
    "",
  );
const navigatorControls = ["navigator-button", "project-navigator"];
const steps: TourStep[] = [
  {
    title: "Organize related paths",
    body: "Path Groups collect paths you want to view together. This project has two paths, Approach and Return. Open the Project Navigator at the top left.",
    phase: "Build",
    target: "navigator-button",
    interact: navigatorControls,
    visible: ["project-navigator"],
    task: "Open the Project Navigator",
    prepare: {
      navigator: "closed",
      inspector: "closed",
      tool: "select",
      simulation: "start",
    },
    check: () =>
      feedback(
        navigatorOpen(),
        "Click the navigator button at the top left.",
        "Navigator open.",
      ),
  },
  {
    title: "Create a Path Group",
    body: "Click + beside Path Groups. Name the group Practice and press Enter.",
    phase: "Build",
    target: "navigator-groups",
    interact: navigatorControls,
    prepare: { navigator: "open" },
    task: "Create a group named Practice",
    check: () =>
      feedback(
        !!practiceGroup(),
        "Create the group and save its name.",
        "Practice group created.",
      ),
  },
  {
    title: "Connect both paths",
    body: "Select Practice in the left column. Click the connection point beside Approach, then Return. The lines show which paths belong to the group.",
    phase: "Challenge",
    target: "navigator-paths",
    interact: navigatorControls,
    prepare: { navigator: "open" },
    task: "Connect Approach and Return to Practice",
    check: () =>
      feedback(
        hasPaths(["lesson-approach", "lesson-return"]),
        "Practice needs both paths connected.",
        "Both paths connected.",
      ),
    hints: [
      "Keep Practice selected. Use the small circles facing the center of the navigator.",
    ],
  },
  {
    title: "Preview the group",
    body: "Select Practice and click Preview Path Group. One path stays active while the other appears as a faint overlay on the field.",
    phase: "Observe",
    target: "navigator-preview",
    interact: navigatorControls,
    prepare: { navigator: "open", showGhostPaths: true },
    task: "Preview Practice on the field",
    check: () =>
      feedback(
        hasPaths(["lesson-approach", "lesson-return"]) &&
          projectStore.getState().activePathGroupId ===
            practiceGroup()?.group_id &&
          !navigatorOpen(),
        "Select Practice, then click Preview Path Group.",
        "Both paths are visible on the field.",
      ),
  },
  {
    title: "Remove a connection",
    body: "Open the navigator again and select Practice. Click Return’s connected point to remove it from the group. Return stays in All Paths.",
    phase: "Challenge",
    target: "navigator-button",
    visible: ["project-navigator"],
    interact: navigatorControls,
    task: "Disconnect Return from Practice",
    check: () =>
      feedback(
        hasPaths(["lesson-approach"]),
        "Remove Return’s connection. Keep Approach connected.",
        "Return is still saved in All Paths.",
      ),
  },
  {
    title: "Keep paths reusable",
    body: "A path can belong to more than one group. Groups help organize and compare paths; your robot code decides the order in which they run.",
    phase: "Review",
    prepare: { navigator: "closed" },
  },
];

export const pathGroupsTour: TourDefinition = {
  id: "organize-path-groups",
  title: "Organize Path Groups",
  summary: "Connect paths, preview a group, and remove a connection",
  durationMinutes: 3,
  completionMessage: "Lesson complete.",
  practicePath: () => createPathGroupPracticePaths()[0].path,
  practicePaths: createPathGroupPracticePaths,
  practiceConfig,
  steps: steps.map((step) => ({ ...step, validate: preservedPaths })),
};
