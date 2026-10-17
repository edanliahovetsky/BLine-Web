import { isWaypoint } from "../../core/model/path";
import {
  detectEnvironmentCapabilities,
  type ShellKind,
} from "../../env/capabilities";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { observedTourCondition } from "./tourInteraction";
import {
  createLinkedElementGroups,
  createTransferPaths,
  organizationMarkers,
  scorePose,
} from "./supplementalScenarios";
import { practiceConfig } from "./tourScenario";
import { currentPracticeTransferError } from "./tourTransfer";
import { showProperties } from "./tourShowMe";
import { tourStore, type TourDefinition, type TourStep } from "./tourStore";

const fileMenus = [
  "export-menu-entry",
  "export-menu-panel",
  "top-menu-project-transfer",
];
const playback = ["simulation-transport", "transport-timeline"];
const hasAction = (action: "exportFolder" | "importFolder" | "play") =>
  (tourStore.getState().actions[action] ?? 0) > 0;
const activePath = () => {
  const state = projectStore.getState();
  return state.project?.paths.find(
    (path) => path.path_id === state.activePathId,
  );
};

const shown = (selector: string) =>
  typeof document !== "undefined" && !!document.querySelector(selector);
/** Show me's first stop: open File, skipped once File or what it leads to is open. */
const openFile = (...alsoOpen: string[]) => ({
  target: "export-menu-entry",
  done: () =>
    ['[data-tour="export-menu-entry"][aria-expanded="true"]', ...alsoOpen].some(
      shown,
    ),
});

const webSteps: TourStep[] = [
  {
    title: "Export an autos folder",
    task: "Export the practice autos to a spare folder",
    body: "Pick any spare folder, not your robot project. Some browsers download autos.zip instead; keep it.",
    why: "Outside lessons, Export to Robot saves into your robot project’s src/main/deploy/autos and remembers that folder. This practice export never uses or replaces it.",
    target: "export-menu-entry",
    visible: ["path-canvas", "robot-export-dialog"],
    interact: [...fileMenus, "export-to-robot", "robot-export-dialog"],
    showMe: [
      openFile('[data-tour="robot-export-dialog"]'),
      {
        target: "export-to-robot",
        done: () => shown('[data-tour="robot-export-dialog"]'),
      },
      "text:Choose folder…",
    ],
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () => feedback(hasAction("exportFolder"), "", "Autos exported."),
  },
  {
    title: "Import the autos folder",
    task: "Import the autos folder you saved",
    body: "Use Import Autos Folder, or Import Autos ZIP for autos.zip.",
    why: "An autos folder holds config.json, paths, and project.json. This lesson imports into its practice project, so your own work is untouched.",
    target: "export-menu-entry",
    interact: [...fileMenus, "lesson-import-folder", "lesson-import-zip"],
    prepare: { closeMenus: true },
    // The submenu's panel carries its id, and exists only while open.
    showMe: [
      openFile('[data-tour="top-menu-project-transfer"]'),
      {
        target: "text:Import / Export",
        done: () => shown('[data-tour="top-menu-project-transfer"]'),
      },
      "text:Import Autos Folder...",
    ],
    check: () => {
      const failure = currentPracticeTransferError();
      return failure && !hasAction("importFolder")
        ? {
            complete: false,
            message: `That didn’t import: ${failure.replace(/\.?$/, ".")} Pick the autos folder you exported, not a single path.`,
          }
        : feedback(hasAction("importFolder"), "", "Autos imported.");
    },
  },
  {
    title: "Check the imported paths",
    task: "Open Score to Pickup and press Play",
    body: "Importing a folder brings in every path and shared setting together.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...playback],
    prepare: { navigator: "closed", simulation: "start", closeMenus: true },
    checks: [
      {
        label: "Score to Pickup open",
        showMe: [
          {
            target: "path-breadcrumb",
            done: () =>
              shown('[data-tour="path-breadcrumb"] [aria-expanded="true"]'),
          },
          "text:Score to Pickup",
        ],
        check: () =>
          feedback(
            hasAction("importFolder") &&
              activePath()?.file_name === "score-to-pickup.json",
            hasAction("importFolder")
              ? ""
              : "Nothing was imported yet. Go Back and import the folder.",
            "",
          ),
      },
      {
        label: "Played it",
        showMe: ["transport-play"],
        check: () =>
          feedback(
            activePath()?.file_name === "score-to-pickup.json" &&
              hasAction("play"),
            "",
            "",
          ),
      },
    ],
  },
  {
    title: "Save changes for your robot",
    body: "Edits save in this browser only. To update the robot, Export to Robot again, then deploy your robot code.",
    why: "An imported folder is a copy; it doesn’t stay in sync with the files on disk.",
    visible: ["path-canvas"],
    prepare: { closeMenus: true },
  },
];

function desktopSteps(): TourStep[] {
  const folderMenuOpened = observedTourCondition(() =>
    shown('[data-testid="top-menu-project-folder"]'),
  );
  return [
    {
      title: "Open an autos folder on desktop",
      task: "Open File, then Folder",
      body: "Open Project Folder edits an autos folder in place. Create Project Folder starts a new one.",
      target: "export-menu-entry",
      visible: ["path-canvas"],
      interact: [
        "export-menu-entry",
        "export-menu-panel",
        "top-menu-project-folder",
      ],
      showMe: [openFile(), "text:Folder"],
      prepare: { navigator: "closed", inspector: "closed" },
      check: () => feedback(folderMenuOpened(), "", ""),
    },
    {
      title: "Edit a path in the folder",
      task: "Change End’s X position",
      body: "End on Start to Score is selected. Practice edits stay inside the lesson.",
      target: "element-properties",
      visible: ["path-canvas"],
      interact: ["inspector-panel", "element-properties", "path-canvas"],
      element: (path) => path.path_elements.length - 1,
      showMe: [
        ...showProperties((path) => path.path_elements.length - 1),
        "label:X (m)",
      ],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        selectElement: (path) => path.path_elements.length - 1,
        closeMenus: true,
      },
      check: () => {
        const end = activePath()?.path.path_elements.at(-1);
        return feedback(
          !!end &&
            isWaypoint(end) &&
            Math.abs(end.translation_target.x_meters - scorePose.x_meters) >
              0.05,
          "",
          "Path edited.",
        );
      },
    },
    {
      title: "Preview before deploying",
      task: "Play the edited path",
      body: "On desktop, edits save straight to the open folder. There’s no need to export.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      showMe: [{ target: "transport-play" }],
      prepare: { inspector: "closed", simulation: "start" },
      check: () => feedback(hasAction("play"), "", ""),
    },
    {
      title: "Use the folder in your robot project",
      body: "Keep the autos folder at src/main/deploy/autos in your robot project. To share it, copy the whole folder.",
      why: "An autos folder holds config.json, paths, and project.json; they belong together.",
      visible: ["path-canvas"],
    },
  ];
}

export function createImportExportTour(
  shell: ShellKind = detectEnvironmentCapabilities().shell,
): TourDefinition {
  return {
    id: "import-export",
    title: "Importing and Exporting",
    summary:
      shell === "tauri"
        ? "Open an autos folder and save edits directly on desktop"
        : "Move autos folders between your browser and robot project",
    durationMinutes: 3,
    recap:
      shell === "tauri"
        ? [
            "On desktop, open your autos folder and edit it in place.",
            "Keep it at src/main/deploy/autos so each deploy uses your latest paths.",
          ]
        : [
            "Export and import whole autos folders from File → Import / Export.",
            "Export into src/main/deploy/autos, then deploy, to update the robot.",
          ],
    markers: organizationMarkers,
    practicePath: () => createTransferPaths()[0].path,
    practicePaths: createTransferPaths,
    practiceGroups: createLinkedElementGroups,
    practiceConfig,
    steps: shell === "tauri" ? desktopSteps() : webSteps,
  };
}
