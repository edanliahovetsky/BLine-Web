import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false) }));
import {
  serializeBLineProjectFolder,
  type ProjectFolderImportFile,
} from "../../../src/core/io/projectFolder";
import { serializeProjectFiles } from "../../../src/core/io/projectFiles";
import { createProject } from "../../../src/core/model/project";
import { isWaypoint } from "../../../src/core/model/path";
import { projectStore } from "../../../src/state/projectStore";
import {
  capturePracticeTransfer,
  importPracticeFolder,
} from "../../../src/ui/tours/tourTransfer";
import { createImportExportTour } from "../../../src/ui/tours/importExportLesson";
import { tourStore } from "../../../src/ui/tours/tourStore";

function startPractice() {
  const lesson = createImportExportTour("browser-web");
  const project = createProject({
    project_id: "isolated-practice",
    display_name: "Practice",
    config: lesson.practiceConfig!(),
    paths: lesson.practicePaths!(),
    path_groups: lesson.practiceGroups!(),
  });
  project.config.kinematic_constraints.default_intermediate_handoff_radius_meters = 0.4534567;
  const end = project.paths[0].path.path_elements.at(-1)!;
  if (isWaypoint(end)) end.rotation_target.rotation_radians = Math.PI / 7;
  projectStore.setState({
    project,
    activePathId: project.paths[0].path_id,
    projectSessionId: "practice-session",
    io: null,
  });
  tourStore.getState().start("import-export");
  const files: ProjectFolderImportFile[] = serializeBLineProjectFolder(
    project,
  ).files.map((file) => ({
    name: file.relativePath.split("/").at(-1)!,
    webkitRelativePath: `autos/${file.relativePath}`,
    text: () => file.blob.text(),
  }));
  return { lesson, project, files, token: capturePracticeTransfer()! };
}

beforeEach(() => projectStore.getState().reset());
afterEach(() => {
  projectStore.getState().reset();
  tourStore.getState().exit();
  vi.mocked(isTauri).mockReturnValue(false);
});

describe("lesson autos folder transfer", () => {
  it("round-trips all paths, settings, events and groups through the normal folder format in memory", async () => {
    const { project, files, token, lesson } = startPractice();
    expect(lesson.steps[0].check!().complete).toBe(false);
    tourStore.getState().recordAction("export");
    expect(lesson.steps[0].check!().complete).toBe(false);
    tourStore.getState().recordAction("exportFolder");
    expect(lesson.steps[0].check!().complete).toBe(true);
    expect(lesson.steps[1].check!().complete).toBe(false);
    expect(await importPracticeFolder(files, token)).toBe(true);
    const state = projectStore.getState();
    expect(state.io).toBeNull();
    expect(state.projectSessionId).toBe("practice-session");
    expect(state.project!.project_id).toBe("isolated-practice");
    // Folder import fills omitted waypoint radii from the imported config.
    const expected = structuredClone(project);
    for (const path of expected.paths) {
      for (const element of path.path.path_elements) {
        if (isWaypoint(element)) {
          element.translation_target.intermediate_handoff_radius_meters ??=
            expected.config.kinematic_constraints.default_intermediate_handoff_radius_meters;
        }
      }
    }
    expect(serializeProjectFiles(state.project!)).toEqual(
      serializeProjectFiles(expected),
    );
    expect(lesson.steps[1].check!().complete).toBe(true);
    expect(lesson.steps[2].check!().complete).toBe(false);
    projectStore.setState({
      activePathId: state.project!.paths.find(
        (path) => path.file_name === "score-to-pickup.json",
      )!.path_id,
    });
    tourStore.getState().recordAction("play");
    expect(lesson.steps[2].check!().complete).toBe(true);
  });

  it("rejects a malformed folder without changing the project or completing the action", async () => {
    const { project, files, token } = startPractice();
    const broken = files.map((file) =>
      file.name === "config.json"
        ? { ...file, text: async () => "{broken" }
        : file,
    );
    await expect(importPracticeFolder(broken, token)).rejects.toThrow();
    expect(projectStore.getState().project).toBe(project);
    expect(tourStore.getState().actions.importFolder).toBeUndefined();
  });

  it.each(["exit", "restart", "step", "session"])(
    "ignores a pending folder import after %s",
    async (change) => {
      const { files, token } = startPractice();
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = importPracticeFolder(
        files.map((file) => ({
          ...file,
          text: async () => {
            await waiting;
            return file.text();
          },
        })),
        token,
      );
      if (change === "exit") tourStore.getState().exit();
      if (change === "restart") tourStore.getState().restartAt(0);
      if (change === "step") tourStore.getState().next(4);
      if (change === "session")
        projectStore.setState({ projectSessionId: "another-project" });
      const project = projectStore.getState().project;
      release();
      expect(await pending).toBe(false);
      expect(projectStore.getState().project).toBe(project);
      expect(tourStore.getState().actions.importFolder).toBeUndefined();
    },
  );

  it("chooses the installed shell's lesson automatically", () => {
    expect(createImportExportTour().steps[0].title).toBe(
      "Export an autos folder",
    );
    vi.mocked(isTauri).mockReturnValue(true);
    expect(createImportExportTour().steps[0].title).toBe(
      "Open an autos folder on desktop",
    );
  });

  it("teaches different file and saving workflows on desktop and web", () => {
    const web = createImportExportTour("browser-web");
    const desktop = createImportExportTour("tauri");
    const copy = (lesson: typeof web) =>
      lesson.steps.map((step) => step.body).join(" ");
    expect(copy(web)).toContain("Export Autos Folder");
    expect(copy(web)).toContain("autos.zip");
    expect(copy(web)).toContain("saves edits in this browser");
    expect(copy(desktop)).toContain("Open Project Folder");
    expect(copy(desktop)).toContain("edits save directly to the open folder");
    expect(copy(desktop)).not.toContain("Import Autos Folder");
    expect(copy(desktop)).not.toContain("Project Archive");
    startPractice();
    expect(desktop.steps[1].check!().complete).toBe(false);
    const project = structuredClone(projectStore.getState().project!);
    const end = project.paths[0].path.path_elements.at(-1)!;
    if (isWaypoint(end)) end.translation_target.x_meters += 0.5;
    projectStore.setState({ project });
    expect(desktop.steps[1].check!().complete).toBe(true);
    expect(desktop.steps[2].check!().complete).toBe(false);
    tourStore.getState().recordAction("play");
    expect(desktop.steps[2].check!().complete).toBe(true);
  });
});
