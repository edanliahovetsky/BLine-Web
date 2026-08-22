import { afterEach, describe, expect, it, vi } from "vitest";
import { autoRadiiCapSolveInput } from "../../../src/core/constraints/autoConstraintGeneration";
import {
  autoVelocityGenerationOptions,
  autoVelocitySettingsForPath,
} from "../../../src/core/constraints/autoVelocityApply";
import {
  generateAutoVelocityProfile,
  type AutoVelocityProfile,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  requestAutoRadiiAndCaps,
  resetAutoVelocityRunner,
  supersededAutoVelocityProfile,
} from "../../../src/platform/autoVelocityRunner";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import { openProjectFromLegacyWorkspace } from "../../../src/core/io/legacyWorkspace";
import { projectDocumentToWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
} from "../../../src/core/model/path";
import { generateAutomaticConstraints } from "../../../src/state/automaticConstraints";
import { createAutoVelocityStore } from "../../../src/state/autoVelocityStore";
import {
  activePathForProjectStore,
  createProjectStore,
} from "../../../src/state/projectStore";

afterEach(() => resetAutoVelocityRunner());

describe("manual auto constraint generation", () => {
  it("applies the cached worker result as one undoable command", async () => {
    const project = testProject();
    const projects = projectStoreFor(project);
    const status = createAutoVelocityStore();
    const settings = autoVelocitySettingsForPath(project.path, project.config);
    let workerProfile: AutoVelocityProfile | null = null;
    const request = async (
      ...args: Parameters<typeof requestAutoRadiiAndCaps>
    ) => {
      const run = await requestAutoRadiiAndCaps(...args);
      if (run !== supersededAutoVelocityProfile) {
        workerProfile = run.profile;
      }
      return run;
    };

    await generateAutomaticConstraints(settings, {
      projects,
      request,
      status,
    });

    expect(status.getState().phase).toBe("idle");
    expect(status.getState().runSource).toBeNull();
    expect(
      activePathForProjectStore(
        projects.getState(),
      )?.path.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(true);
    const generatedPath = activePathForProjectStore(projects.getState())?.path;
    expect(generatedPath).toBeDefined();
    expect(getHandoffRadiusSource(generatedPath!.path_elements[1])).toBe(
      "auto",
    );
    expect(generatedPath!.path_elements[2]).toMatchObject({
      translation_target: {
        intermediate_handoff_radius_meters: 0.2,
      },
    });
    expect(getHandoffRadiusSource(generatedPath!.path_elements[2])).toBeNull();
    // The runner primes this exact solve for the cap-application step; a cache
    // miss would replace it with a newly computed profile object.
    expect(
      generateAutoVelocityProfile(
        generatedPath!,
        project.config,
        autoVelocityGenerationOptions(settings),
      ),
    ).toBe(workerProfile);
    expect(projects.getState().history.getState().undoStack).toHaveLength(1);
    const generatedProject = structuredClone(projects.getState().project);

    projects.getState().undo();
    expect(activePathForProjectStore(projects.getState())?.path).toEqual(
      project.path,
    );
    projects.getState().redo();
    expect(projects.getState().project).toEqual(generatedProject);
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

    const pending = generateAutomaticConstraints(settings, {
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
    projects.getState().applyPathCommand({
      description: "Move anchor",
      apply: () => moved.path,
      revert: (path) => path,
    });
    resolveRequest({
      radii: solved.radii,
      profile: solved.profile,
      stats: solved.stats,
      status: solved.status,
      elapsedMs: 12,
    });
    await pending;

    expect(request).toHaveBeenCalledOnce();
    expect(activePathForProjectStore(projects.getState())?.path).toEqual(
      moved.path,
    );
    expect(projects.getState().history.getState().undoStack).toHaveLength(1);
    expect(status.getState().phase).toBe("idle");
  });

  it("discards a completed worker result after a merge-tolerance edit", async () => {
    const project = testProject();
    const projects = projectStoreFor(project);
    const status = createAutoVelocityStore();
    const settings = autoVelocitySettingsForPath(project.path, project.config);
    const solved = autoRadiiCapSolveInput(
      project.path,
      project.config,
      settings,
    );
    let resolveRequest!: (run: {
      radii: typeof solved.radii;
      profile: typeof solved.profile;
      stats: typeof solved.stats;
      status: typeof solved.status;
      elapsedMs: number;
    }) => void;
    const request = vi.fn(
      () =>
        new Promise<Parameters<typeof resolveRequest>[0]>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const pending = generateAutomaticConstraints(settings, {
      projects,
      request,
      status,
    });
    const previousConfig = structuredClone(project.config);
    projects.getState().applyConfigCommand({
      description: "Change merge tolerance",
      apply: (config) => ({
        ...config,
        kinematic_constraints: {
          ...config.kinematic_constraints,
          default_auto_velocity_merge_tolerance_meters_per_sec: 0.41,
        },
      }),
      revert: () => previousConfig,
    });
    resolveRequest({
      radii: solved.radii,
      profile: solved.profile,
      stats: solved.stats,
      status: solved.status,
      elapsedMs: 12,
    });
    await pending;

    expect(
      activePathForProjectStore(projects.getState())?.path.ranged_constraints,
    ).toEqual([]);
    expect(projects.getState().history.getState().undoStack).toHaveLength(1);
    expect(status.getState().lastError).toBeNull();
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
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 1,
            y_meters: 1,
            intermediate_handoff_radius_meters: 0.2,
          }),
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
      ],
    }),
  });
}

function projectStoreFor(project: ReturnType<typeof testProject>) {
  const projects = createProjectStore();
  const opened = openProjectFromLegacyWorkspace(
    projectDocumentToWorkspaceDocument(project),
  );
  projects.setState({
    project: opened.project,
    activePathId: opened.navigation.activePathId,
    activePathGroupId: opened.navigation.activePathGroupId,
    projectSessionId: "manual-generation-test-session",
  });
  return projects;
}
