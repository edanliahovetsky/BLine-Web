import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deserializePath,
  serializePath,
} from "../../../src/core/io/projectSerde";
import { getPathElementLinkedTargetId } from "../../../src/core/linkedTargets";
import { createProject, type Project } from "../../../src/core/model/project";
import { isWaypoint } from "../../../src/core/model/path";
import { projectStore } from "../../../src/state/projectStore";
import { supplementalTours } from "../../../src/ui/tours/supplementalLessons";
import {
  createLinkedElementGroups,
  createLinkedElementPaths,
  createManagementGroups,
  createManagementPaths,
  createPathLinkingGroups,
  createPathLinkingPaths,
  createPathLinkingTargets,
  createTransferPaths,
  pickupHandoffId,
  scorePose,
  supplementalPathIds as ids,
} from "../../../src/ui/tours/supplementalScenarios";
import { practiceConfig } from "../../../src/ui/tours/tourScenario";
import { tourStore } from "../../../src/ui/tours/tourStore";

function seed(project: Project, lesson: string) {
  projectStore.setState({ project, activePathId: project.paths[0].path_id });
  tourStore.getState().start(lesson);
}

function practice(paths = createManagementPaths()) {
  return createProject({
    project_id: "practice",
    display_name: "Practice",
    paths,
    config: practiceConfig(),
  });
}

function check(lesson: string, step: string) {
  return supplementalTours
    .find((tour) => tour.id === lesson)!
    .steps.find((candidate) => candidate.title === step)!.check!().complete;
}

function recordAction(action: string) {
  tourStore.setState({
    actions: { ...tourStore.getState().actions, [action]: 1 },
  });
}

beforeEach(() => {
  projectStore.getState().reset();
  tourStore.getState().exit();
});

afterEach(() => {
  projectStore.getState().reset();
  tourStore.getState().exit();
});

describe("supplemental lessons", () => {
  it("provides four distinct lessons with actionable practice routes and valid groups", () => {
    expect(supplementalTours.map((tour) => [tour.id, tour.title])).toEqual([
      ["import-export", "Importing and Exporting"],
      ["path-management", "Path Management"],
      ["linked-elements", "Advanced — Linked Elements"],
      ["path-linking", "Advanced — Path Linking"],
    ]);
    const paths = createManagementPaths();
    expect(paths.map((path) => path.display_name)).toEqual([
      "Staging to Score",
      "Score to Pickup",
      "Pickup to Score",
    ]);
    for (const group of createManagementGroups()) {
      expect(
        group.path_ids.every((id) => paths.some((path) => path.path_id === id)),
      ).toBe(true);
    }
    const changed = createManagementPaths();
    changed[0].path.path_elements.pop();
    expect(createManagementPaths()[0].path.path_elements).toHaveLength(3);
    for (const lesson of supplementalTours) {
      expect(
        lesson.steps.filter((step) => step.check).length,
      ).toBeGreaterThanOrEqual(3);
      expect(lesson.steps.every((step) => !step.check || !!step.task)).toBe(
        true,
      );
    }
  });

  it("waits for an actual export and a separate imported path with matching runtime data", () => {
    seed(practice(createTransferPaths()), "import-export");
    expect(check("import-export", "Export one path")).toBe(false);
    recordAction("export");
    expect(check("import-export", "Export one path")).toBe(true);
    const original = projectStore.getState().project!.paths[0];
    const imported = deserializePath(serializePath(original.path));
    projectStore
      .getState()
      .createPath({ displayName: "Imported score", path: imported });
    expect(check("import-export", "Import the saved path")).toBe(false);
    recordAction("import");
    expect(check("import-export", "Import the saved path")).toBe(true);
    const state = projectStore.getState();
    const copy = state.project!.paths[1];
    const changedProject = structuredClone(state.project!);
    changedProject.paths[1].path.ranged_constraints[0].value = 1;
    projectStore.setState({ project: changedProject });
    expect(check("import-export", "Import the saved path")).toBe(false);
    projectStore.setState({
      project: state.project,
      activePathId: copy.path_id,
    });
    recordAction("play");
    expect(check("import-export", "Inspect the imported copy")).toBe(true);
  });

  it("requires a meaningful three-route combination and previews that group", () => {
    const initial = practice();
    initial.path_groups = createManagementGroups();
    seed(initial, "path-management");
    expect(check("path-management", "Make a complete cycle")).toBe(false);
    projectStore.getState().createPathGroup({ displayName: "Two-piece cycle" });
    const group = projectStore
      .getState()
      .project!.path_groups.find(
        (group) => group.display_name === "Two-piece cycle",
      )!;
    expect(check("path-management", "Make a complete cycle")).toBe(true);
    projectStore
      .getState()
      .addPathsToGroup(group.group_id, [ids.stagingScore, ids.scorePickup]);
    expect(check("path-management", "Connect its three paths")).toBe(false);
    projectStore.getState().addPathsToGroup(group.group_id, [ids.pickupScore]);
    expect(check("path-management", "Connect its three paths")).toBe(true);
    projectStore.getState().setActivePathGroup(group.group_id);
    expect(check("path-management", "Preview the combination")).toBe(true);
    expect(
      projectStore
        .getState()
        .project!.path_groups.find(
          (group) => group.display_name === "Pickup cycle",
        )!.path_ids,
    ).toEqual([ids.scorePickup, ids.pickupScore]);
  });

  it("requires linked waypoint identity and propagates edits made through real editor commands", () => {
    const initial = practice(createLinkedElementPaths());
    initial.path_groups = createLinkedElementGroups();
    seed(initial, "linked-elements");
    expect(check("linked-elements", "Create the shared score pose")).toBe(
      false,
    );
    const targetId = projectStore.getState().createLinkedTarget({
      display_name: "Score pose",
      kind: "waypoint",
      x_meters: scorePose.x_meters,
      y_meters: scorePose.y_meters,
      rotation_radians: 0,
      link: { pathId: ids.stagingScore, elementIndex: 2 },
    });
    expect(check("linked-elements", "Create the shared score pose")).toBe(true);
    expect(check("linked-elements", "Link the next path's Start")).toBe(false);
    projectStore
      .getState()
      .linkPathElementToTarget(ids.scorePickup, 0, targetId);
    expect(check("linked-elements", "Link the next path's Start")).toBe(true);
    const localConstraints = projectStore
      .getState()
      .project!.paths.map((path) =>
        structuredClone(path.path.ranged_constraints),
      );
    projectStore
      .getState()
      .applyPathElementEdit(
        {
          kind: "position",
          index: 0,
          position: { x_meters: 11.2, y_meters: 4.7 },
        },
        { pathId: ids.scorePickup },
      );
    expect(check("linked-elements", "Edit once, update both paths")).toBe(
      false,
    );
    projectStore
      .getState()
      .applyPathElementEdit(
        { kind: "rotation", index: 0, rotationRadians: Math.PI / 6 },
        { pathId: ids.scorePickup },
      );
    expect(check("linked-elements", "Edit once, update both paths")).toBe(true);
    const end = projectStore
      .getState()
      .project!.paths[0].path.path_elements.at(-1)!;
    expect(isWaypoint(end) && end.translation_target).toMatchObject({
      x_meters: 11.2,
      y_meters: 4.7,
    });
    expect(isWaypoint(end) && end.rotation_target.rotation_radians).toBeCloseTo(
      Math.PI / 6,
    );
    expect(
      projectStore
        .getState()
        .project!.paths.map((path) => path.path.ranged_constraints),
    ).toEqual(localConstraints);
    projectStore.getState().unlinkPathElement(ids.scorePickup, 0);
    expect(check("linked-elements", "Edit once, update both paths")).toBe(
      false,
    );
  });

  it("seeds a genuinely linked End/Start without adding an ordinary minimum velocity", () => {
    const paths = createPathLinkingPaths();
    expect(
      getPathElementLinkedTargetId(paths[0].path.path_elements.at(-1)),
    ).toBe(pickupHandoffId);
    expect(getPathElementLinkedTargetId(paths[1].path.path_elements[0])).toBe(
      pickupHandoffId,
    );
    expect(paths[0].path.path_elements.at(-1)).toEqual(
      paths[1].path.path_elements[0],
    );
    expect(createPathLinkingTargets()).toHaveLength(1);
    expect(createPathLinkingGroups()[0].path_ids).toEqual(
      paths.map((path) => path.path_id),
    );
    expect(
      paths.every(
        (path) =>
          !path.path.ranged_constraints.some(
            (constraint) => constraint.key === "min_velocity_meters_per_sec",
          ),
      ),
    ).toBe(true);
    const runtime = JSON.stringify(
      paths.map((path) => serializePath(path.path)),
    );
    expect(runtime).not.toContain("linked_target");
  });

  it("only accepts a small final-approach minimum below its actual maximum", () => {
    seed(practice(createPathLinkingPaths()), "path-linking");
    const title = "Try a small final-approach minimum";
    expect(check("path-linking", title)).toBe(false);
    const updateMinimum = (value: number, start = 3) => {
      const updated = structuredClone(projectStore.getState().project!);
      const path = updated.paths[0].path;
      path.ranged_constraints = path.ranged_constraints.filter(
        (constraint) => constraint.key !== "min_velocity_meters_per_sec",
      );
      path.ranged_constraints.push({
        key: "min_velocity_meters_per_sec",
        value,
        start_ordinal: start,
        end_ordinal: 3,
      });
      projectStore.setState({ project: updated });
    };
    updateMinimum(0.3, 1);
    expect(check("path-linking", title)).toBe(false);
    updateMinimum(1);
    expect(check("path-linking", title)).toBe(false);
    updateMinimum(0.3);
    expect(check("path-linking", title)).toBe(true);
    const capped = structuredClone(projectStore.getState().project!);
    capped.paths[0].path.ranged_constraints[0].value = 0.2;
    projectStore.setState({ project: capped });
    expect(check("path-linking", title)).toBe(false);
    const lessonCopy = supplementalTours
      .find((tour) => tour.id === "path-linking")!
      .steps.map((step) => step.body)
      .join(" ");
    expect(lessonCopy).toContain("Chain the commands in robot code");
    expect(lessonCopy).toContain("FollowPath sends zero speeds when it ends");
    expect(lessonCopy).toContain("does not guarantee continuous motion");
  });
});
