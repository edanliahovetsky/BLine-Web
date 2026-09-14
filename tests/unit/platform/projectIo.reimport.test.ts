import { describe, expect, it, vi } from "vitest";
import {
  createProjectIoService,
  isProjectIoConflict,
} from "../../../src/platform/projectIo";
import { browserWebCapabilities } from "../../../src/env/capabilities";
import { createBLineProjectArchive } from "../../../src/core/io/blineProject";
import { BrowserStorage } from "../../../src/storage";
import { MemoryStorage } from "../support/browserStorageFakes";
import {
  exampleWorkspace,
  projectArchiveFile,
} from "../support/projectIoFixtures";

function setup(memory = new MemoryStorage()) {
  const storage = new BrowserStorage({ storage: memory });
  const io = createProjectIoService(browserWebCapabilities, { storage });
  return { io, storage, memory };
}

describe("browser project reimport", () => {
  it.each(["archive", "folder"] as const)(
    "replaces a confirmed %s with its edited version and preserves its identity",
    async (kind) => {
      const { io } = setup();
      const saved = await io.createWorkspace({
        project: exampleWorkspace("robot", "Robot", ["Before"]),
      });
      const edited = structuredClone(saved.project);
      edited.paths[0].display_name = "After";
      const choose = vi.fn(async () => "replace" as const);
      let result;
      if (kind === "archive") {
        result = await io.importProjectArchive(
          saved,
          projectArchiveFile(
            createBLineProjectArchive(edited, "2026-09-14T00:00:00Z"),
          ),
          { resolveExistingProject: choose },
        );
      } else {
        const folder = await io.exportProjectFolder(edited);
        const files = folder.files.map((entry) => {
          const file = new File(
            [entry.blob],
            entry.relativePath.split("/").at(-1)!,
          );
          Object.defineProperty(file, "webkitRelativePath", {
            value: "autos/" + entry.relativePath,
          });
          return file;
        });
        result = await io.importProjectFolder(saved, files, {
          resolveExistingProject: choose,
        });
      }
      expect(choose).toHaveBeenCalledWith(
        expect.objectContaining({ id: "robot", version: saved.version }),
      );
      expect(result.project.project_id).toBe("robot");
      expect(result.project.paths[0].display_name).toBe("After");
      expect(
        (await io.reloadWorkspace(saved.handle))?.project.paths[0].display_name,
      ).toBe("After");
      expect(await io.listWorkspaces()).toHaveLength(1);
    },
  );

  it("imports a separate copy without changing the existing project", async () => {
    const { io } = setup();
    const saved = await io.createWorkspace({
      project: exampleWorkspace("robot", "Robot", ["Before"]),
    });
    const before = await io.peekWorkspace(saved.handle);
    const edited = structuredClone(saved.project);
    edited.paths[0].display_name = "After";
    const result = await io.importProjectArchive(
      saved,
      projectArchiveFile(
        createBLineProjectArchive(edited, "2026-09-14T00:00:00Z"),
      ),
      {
        resolveExistingProject: async () => "copy",
      },
    );
    expect(result.project.project_id).not.toBe("robot");
    expect(result.project.display_name).toBe("Robot (copy)");
    expect(result.project.paths[0].display_name).toBe("After");
    expect(await io.peekWorkspace(saved.handle)).toEqual(before);
    expect(await io.listWorkspaces()).toHaveLength(2);
  });

  it("cancels without modifying the project or preparing assets", async () => {
    const { io, memory } = setup();
    const saved = await io.createWorkspace({
      project: exampleWorkspace("robot", "Robot", ["Before"]),
    });
    const before = memory.getItem("bline-web:workspace:robot");
    const prepare = vi.fn();
    await expect(
      io.importProjectArchive(
        saved,
        projectArchiveFile(
          createBLineProjectArchive(saved.project, "2026-09-14T00:00:00Z"),
        ),
        {
          resolveExistingProject: async () => "cancel",
          migrateLegacyFieldBackgrounds: prepare,
        },
      ),
    ).rejects.toMatchObject({ name: "ProjectImportCancelledError" });
    expect(memory.getItem("bline-web:workspace:robot")).toBe(before);
    expect(prepare).not.toHaveBeenCalled();
    expect(await io.listWorkspaces()).toHaveLength(1);
  });

  it("preserves a newer save from another tab made while the choice is open", async () => {
    const { io, storage } = setup();
    const other = createProjectIoService(browserWebCapabilities, { storage });
    const saved = await io.createWorkspace({
      project: exampleWorkspace("robot", "Robot", ["Before"]),
    });
    const imported = structuredClone(saved.project);
    imported.paths[0].display_name = "Imported edit";
    const newer = structuredClone(saved.project);
    newer.paths[0].display_name = "Other tab edit";
    const error = await io
      .importProjectArchive(
        saved,
        projectArchiveFile(
          createBLineProjectArchive(imported, "2026-09-14T00:00:00Z"),
        ),
        {
          resolveExistingProject: async () => {
            await other.saveWorkspace(saved, newer, saved.version);
            return "replace";
          },
        },
      )
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      name: "ProjectImportValidationError",
      message: expect.stringContaining("changed in another tab"),
    });
    expect(isProjectIoConflict(error)).toBe(false);
    expect((await io.peekWorkspace(saved.handle))?.paths[0].display_name).toBe(
      "Other tab edit",
    );
  });

  it("restores the old record and rolls back preparation if activation fails after replacement", async () => {
    class FailPointerOnce extends MemoryStorage {
      fail = false;
      override setItem(key: string, value: string) {
        if (this.fail && key === "bline-web:current-workspace") {
          this.fail = false;
          throw new Error("Pointer write failed");
        }
        super.setItem(key, value);
      }
    }
    const memory = new FailPointerOnce();
    const { io, storage } = setup(memory);
    const saved = await io.createWorkspace({
      project: exampleWorkspace("robot", "Robot", ["Before"]),
    });
    await io.createWorkspace({
      project: exampleWorkspace("other", "Other", ["Keep"]),
    });
    const before = memory.getItem("bline-web:workspace:robot");
    const edited = structuredClone(saved.project);
    edited.paths[0].display_name = "After";
    const rollback = vi.fn(async () => {});
    memory.fail = true;
    await expect(
      storage.replaceProjectWithPreparation(
        edited,
        saved.version!,
        async () => ({ rollback }),
      ),
    ).rejects.toThrow("Pointer write failed");
    expect(memory.getItem("bline-web:workspace:robot")).toBe(before);
    expect(await storage.getCurrentWorkspaceId()).toBe("other");
    expect(rollback).toHaveBeenCalledOnce();
  });
});
