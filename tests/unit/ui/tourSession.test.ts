import { describe, expect, it, vi } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import { createProject } from "../../../src/core/model/project";
import {
  captureProjectMutationOwnership,
  createProjectStore,
  projectMutationIsCurrent,
} from "../../../src/state/projectStore";
import { createSelectionStore } from "../../../src/state/selectionStore";
import {
  createTourSessionController,
  type TourSessionController,
} from "../../../src/ui/tours/tourSession";
import {
  createTourStore,
  type TourDefinition,
} from "../../../src/ui/tours/tourStore";

interface TestView {
  fieldId: string;
  inspectorOpen: boolean;
  inspectorTab: "elements" | "constraints";
  tool: "select" | "waypoint";
}

const definition: TourDefinition = {
  id: "test-tour",
  title: "Test Tour",
  summary: "Exercises the isolated practice session",
  practicePath: () =>
    createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 1, y_meters: 2 }),
        createTranslationTarget({ x_meters: 3, y_meters: 4 }),
      ],
    }),
  steps: [{ title: "Practice", body: "Make an edit" }],
};

describe("Tour session", () => {
  it("isolates practice and restores the exact unsaved editor session", async () => {
    const projects = createProjectStore();
    const selections = createSelectionStore();
    const tours = createTourStore();
    const originalProject = createProject({
      project_id: "project-1",
      display_name: "Unsaved Project",
      paths: [
        {
          path_id: "path-1",
          display_name: "Original Path",
          file_name: "original.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({ x_meters: 5, y_meters: 6 }),
              createTranslationTarget({ x_meters: 7, y_meters: 8 }),
            ],
          }),
        },
      ],
      path_groups: [
        {
          group_id: "group-1",
          display_name: "Group",
          path_ids: ["path-1"],
        },
      ],
    });
    const io = { saveWorkspace: vi.fn() };
    projects.setState({
      project: originalProject,
      activePathId: "path-1",
      activePathGroupId: "group-1",
      io: io as never,
      version: "version-7",
      projectSessionId: "original-session",
      revision: 0,
    });
    projects.getState().renamePath("path-1", "First rename");
    projects.getState().renamePath("path-1", "Second rename");
    projects.getState().undo();
    selections
      .getState()
      .selectElement(1, projects.getState().project?.paths[0].path);
    const before = projects.getState();
    const beforeProject = before.project;
    const beforeHistory = before.history.getState();
    const beforeOwnership = captureProjectMutationOwnership(before);
    const beforeSelection = selections.getState();
    let view: TestView = {
      fieldId: "custom-field",
      inspectorOpen: false,
      inspectorTab: "elements",
      tool: "waypoint",
    };
    const restoredView = structuredClone(view);
    const controller = createController({
      projects,
      selections,
      tours,
      getView: () => view,
      setView: (next) => {
        view = next;
      },
    });

    expect(controller.start(definition.id)).toBe(true);
    const practice = projects.getState();
    const practiceOwnership = captureProjectMutationOwnership(practice);
    expect(practice.project).not.toBe(beforeProject);
    expect(practice.project?.project_id).toBe(originalProject.project_id);
    expect(practice.project?.paths).toHaveLength(1);
    expect(practice.project?.paths[0]).toMatchObject({
      path_id: "path-1",
      display_name: "Tour practice",
    });
    expect(practice.history.getState().undoStack).toEqual([]);
    expect(selections.getState().selectedElementIndex).toBeNull();
    expect(view).toEqual({
      fieldId: "blank-grid",
      inspectorOpen: true,
      inspectorTab: "elements",
      tool: "select",
    });

    projects.getState().renamePath("path-1", "Practice edit");
    expect(projects.getState().dirty).toBe(false);
    await expect(projects.getState().saveWorkspace()).resolves.toBeNull();
    expect(io.saveWorkspace).not.toHaveBeenCalled();

    tours.getState().exit();
    const restored = projects.getState();
    expect(restored.project).toBe(beforeProject);
    expect(restored.activePathId).toBe(before.activePathId);
    expect(restored.activePathGroupId).toBe(before.activePathGroupId);
    expect(restored.io).toBe(before.io);
    expect(restored.version).toBe(before.version);
    expect(restored.dirty).toBe(before.dirty);
    expect(restored.status).toBe(before.status);
    expect(restored.error).toBe(before.error);
    expect(restored.lastSavedAt).toBe(before.lastSavedAt);
    expect(restored.persistenceDamage).toBe(before.persistenceDamage);
    expect(restored.revision).toBe(before.revision);
    expect(restored.history.getState().undoStack).toBe(beforeHistory.undoStack);
    expect(restored.history.getState().redoStack).toBe(beforeHistory.redoStack);
    expect(restored.history.getState().canUndo).toBe(beforeHistory.canUndo);
    expect(restored.history.getState().canRedo).toBe(beforeHistory.canRedo);
    expect(selections.getState().selectedElementIndex).toBe(
      beforeSelection.selectedElementIndex,
    );
    expect(selections.getState().selectedRangedConstraint).toBe(
      beforeSelection.selectedRangedConstraint,
    );
    expect(view).toEqual(restoredView);
    expect(restored.projectSessionId).not.toBe("original-session");
    expect(beforeOwnership).not.toBeNull();
    expect(practiceOwnership).not.toBeNull();
    expect(projectMutationIsCurrent(restored, beforeOwnership!)).toBe(false);
    expect(projectMutationIsCurrent(restored, practiceOwnership!)).toBe(false);
  });

  it("restores on completion while persisting only the completed Tour id", () => {
    const completed = vi.fn();
    const projects = createProjectStore();
    const selections = createSelectionStore();
    const tours = createTourStore({ onCompletedChange: completed });
    const project = createProject({
      project_id: "project-2",
      display_name: "Project",
      paths: [
        {
          path_id: "path-2",
          display_name: "Path",
          file_name: "path.json",
          path: createPathModel(),
        },
      ],
    });
    projects.setState({
      project,
      activePathId: "path-2",
      projectSessionId: "project-session",
    });
    let view: TestView = {
      fieldId: "blank-grid",
      inspectorOpen: false,
      inspectorTab: "constraints",
      tool: "select",
    };
    const controller = createController({
      projects,
      selections,
      tours,
      getView: () => view,
      setView: (next) => {
        view = next;
      },
    });

    controller.start(definition.id);
    tours.getState().finish();

    expect(projects.getState().project).toBe(project);
    expect(tours.getState().completedTourIds).toEqual([definition.id]);
    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith([definition.id]);
  });

  it("returns a Start Center Tour to the no-Project session", () => {
    const projects = createProjectStore();
    const selections = createSelectionStore();
    const tours = createTourStore();
    const io = { saveWorkspace: vi.fn() };
    projects.setState({ io: io as never });
    let view: TestView = {
      fieldId: "blank-grid",
      inspectorOpen: false,
      inspectorTab: "elements",
      tool: "select",
    };
    const controller = createController({
      projects,
      selections,
      tours,
      getView: () => view,
      setView: (next) => {
        view = next;
      },
    });

    expect(controller.start(definition.id)).toBe(true);
    expect(projects.getState().project?.paths[0].display_name).toBe(
      "Tour practice",
    );
    expect(projects.getState().io).toBeNull();

    tours.getState().exit();
    expect(projects.getState().project).toBeNull();
    expect(projects.getState().activePathId).toBeNull();
    expect(projects.getState().io).toBe(io);
  });

  it("does not start across an active save or blocked editor interaction", () => {
    const projects = createProjectStore();
    const selections = createSelectionStore();
    const tours = createTourStore();
    const project = createProject({
      project_id: "project-3",
      display_name: "Project",
      paths: [
        {
          path_id: "path-3",
          display_name: "Path",
          file_name: "path.json",
          path: createPathModel(),
        },
      ],
    });
    projects.setState({
      project,
      activePathId: "path-3",
      projectSessionId: "busy-session",
      activeSave: {
        projectId: "project-3",
        projectSessionId: "busy-session",
        revision: 0,
        ioGeneration: 0,
      },
    });
    let blocked = false;
    const controller = createTourSessionController({
      projects,
      selections,
      tours,
      resolveTour: (id) => (id === definition.id ? definition : null),
      captureView: () => null,
      showPracticeView: () => {},
      restoreView: () => {},
      canStart: () => blocked === false,
    });

    expect(controller.start(definition.id)).toBe(false);
    projects.setState({ activeSave: null, status: "idle" });
    blocked = true;
    expect(controller.start(definition.id)).toBe(false);
    blocked = false;
    projects.setState({ status: "conflict" });
    expect(controller.start(definition.id)).toBe(false);
    projects.setState({ status: "damaged" });
    expect(controller.start(definition.id)).toBe(false);
    projects.setState({
      status: "idle",
      legacyMigrationProjectSessionId: "busy-session",
    });
    expect(controller.start(definition.id)).toBe(false);
    projects.setState({ legacyMigrationProjectSessionId: null });
    expect(projects.getState().project).toBe(project);
    expect(tours.getState().activeTourId).toBeNull();
  });
});

function createController({
  projects,
  selections,
  tours,
  getView,
  setView,
}: {
  projects: ReturnType<typeof createProjectStore>;
  selections: ReturnType<typeof createSelectionStore>;
  tours: ReturnType<typeof createTourStore>;
  getView(): TestView;
  setView(view: TestView): void;
}): TourSessionController {
  return createTourSessionController({
    projects,
    selections,
    tours,
    resolveTour: (id) => (id === definition.id ? definition : null),
    captureView: () => structuredClone(getView()),
    showPracticeView: () => {
      setView({
        ...getView(),
        fieldId: "blank-grid",
        inspectorOpen: true,
        tool: "select",
      });
    },
    restoreView: setView,
  });
}
