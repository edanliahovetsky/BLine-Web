import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/model/project";
import { tauriCapabilities } from "../../../src/env/capabilities";
import { createProjectIoService } from "../../../src/platform/projectIo";
import {
  ensureCurrentWorkspaceSummary,
  formatStorageLabel,
} from "../../../src/ui/app/projectStoragePresentation";

describe("AppShell desktop storage presentation", () => {
  it("uses the canonical folder locator without synthesizing a Project-ID recent", () => {
    const project = createProject({
      project_id: "stable-project-id",
      display_name: "Robot Project",
    });
    const current = {
      id: "/repo/robot/src/main/deploy/autos",
      displayName: "autos",
      directoryPath: "/repo/robot/src/main/deploy/autos",
      version: "v2",
      updatedAt: "2026-08-22T12:00:00.000Z",
    };
    const service = createProjectIoService(tauriCapabilities);

    expect(
      ensureCurrentWorkspaceSummary(
        [current],
        project,
        current,
        current.version,
        current.updatedAt,
      ),
    ).toEqual([current]);
    expect(formatStorageLabel(current, service.capabilities)).toBe(
      "Autosave: /repo/robot/src/main/deploy/autos",
    );
  });
});
