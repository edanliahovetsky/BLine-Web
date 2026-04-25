import { createProjectDocument } from "../../core/io/projectSchema";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint
} from "../../core/model/path";

interface InitialCanvasProjectOptions {
  projectId?: string;
  displayName?: string;
}

export function createInitialCanvasProject(options: InitialCanvasProjectOptions = {}) {
  return createProjectDocument({
    project_id: options.projectId ?? "phase-1-canvas-draft",
    display_name: options.displayName ?? "Phase 1 Canvas Draft",
    path: createPathModel({
      path_elements: [
        createTranslationTarget({
          x_meters: 1.2,
          y_meters: 1.1,
          intermediate_handoff_radius_meters: 0.6
        }),
        createRotationTarget({
          t_ratio: 0.42,
          rotation_radians: Math.PI / 5
        }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 5.1,
            y_meters: 3.2
          }),
          rotation_target: createRotationTarget({
            rotation_radians: Math.PI / 2
          })
        }),
        createEventTrigger({
          t_ratio: 0.58,
          lib_key: "intake"
        }),
        createTranslationTarget({
          x_meters: 9.8,
          y_meters: 2.0
        })
      ]
    })
  });
}

export function createNewCanvasProject(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);

  return createInitialCanvasProject({
    projectId: `phase-1-path-${stamp}-${random}`,
    displayName: `Untitled Path ${stamp}-${random}`
  });
}
