import { afterEach, describe, expect, it, vi } from "vitest";
import { autoRadiiCapSolveInput } from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import { resetAutoVelocityRunner } from "../../../src/core/constraints/autoVelocityRunner";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import { projectDocumentToWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import { generateAutoConstraintsInWorker } from "../../../src/state/autoConstraintGeneration";
import { createAutoVelocityStore } from "../../../src/state/autoVelocityStore";
import { createProjectStore } from "../../../src/state/projectStore";

afterEach(() => resetAutoVelocityRunner());

describe("manual auto constraint generation", () => {
  it("applies a worker result as one undoable command and records diagnostics", async () => {
    const project = testProject();
    const projects = projectStoreFor(project);
    const status = createAutoVelocityStore();
    const settings = autoVelocitySettingsForPath(project.path, project.config);

    await generateAutoConstraintsInWorker(settings, { projects, status });

    expect(status.getState().phase).toBe("idle");
    expect(status.getState().runSource).toBeNull();
    expect(status.getState().lastRun).toMatchObject({
      status: "valid",
      stats: {
        evaluationBudget: 8_000,
        searchableBlocks: 2,
      },
    });
    expect(
      projects
        .getState()
        .project?.path.ranged_constraints.some(
          (constraint) => constraint.source === "auto_velocity",
        ),
    ).toBe(true);
    expect(projects.getState().history.getState().undoStack).toHaveLength(1);

    projects.getState().undo();
    expect(projects.getState().project?.path).toEqual(project.path);
  });

  it("discards a completed worker result when its path changed in flight", async () => {
    const project = testProject();
    const projects = projectStoreFor(project);
    const status = createAutoVelocityStore();
    const settings = autoVelocitySettingsForPath(project.path, project.config);
    const solved = autoRadiiCapSolveInput(
      project.path,
      project.config,
      settings,
    );
    type CompletedRun = {
      radii: typeof solved.radii;
      profile: typeof solved.profile;
      stats: typeof solved.stats;
      status: typeof solved.status;
      elapsedMs: number;
    };
    let resolveRequest!: (run: CompletedRun) => void;
    const request = vi.fn(
      () =>
        new Promise<CompletedRun>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const pending = generateAutoConstraintsInWorker(settings, {
      projects,
      request,
      status,
    });
    const moved = {
      ...project,
      path: {
        ...project.path,
        path_elements: project.path.path_elements.map((element, index) =>
          index === 1 && element.type === "translation"
            ? { ...element, x_meters: element.x_meters + 0.25 }
            : element,
        ),
      },
    };
    projects.setState({ project: moved });
    resolveRequest({
      radii: solved.radii,
      profile: solved.profile,
      stats: solved.stats,
      status: solved.status,
      elapsedMs: 12,
    });
    await pending;

    expect(request).toHaveBeenCalledOnce();
    expect(projects.getState().project?.path).toEqual(moved.path);
    expect(projects.getState().history.getState().undoStack).toHaveLength(0);
    expect(status.getState().phase).toBe("idle");
  });
});

function testProject() {
  return createProjectDocument({
    project_id: "manual-generate",
    display_name: "Manual Generate",
    path: createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
      ],
    }),
  });
}

function projectStoreFor(project: ReturnType<typeof testProject>) {
  const projects = createProjectStore();
  projects.setState({
    project,
    workspace: projectDocumentToWorkspaceDocument(project),
  });
  return projects;
}
