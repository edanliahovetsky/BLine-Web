import { describe, expect, it } from "vitest";
import { createPathModel, createTranslationTarget } from "../../../src/core/model/path";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import { serializeProjectDocument } from "../../../src/core/io/projectSerde";
import {
  BrowserStorage,
  StorageConflictError,
  createStorageAdapter,
  type StorageLike,
  type TauriInvoke,
  TauriStorage
} from "../../../src/storage";
import { browserWebCapabilities, tauriCapabilities } from "../../../src/env/capabilities";

describe("BrowserStorage", () => {
  it("writes, lists, reads, and deletes projects", async () => {
    const storage = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:30:00.000Z")
    });
    const project = exampleProject("project-a", "Alpha");

    const write = await storage.writeProject(project);
    const summaries = await storage.listProjects();
    const restored = await storage.readProject("project-a");

    expect(write.updatedAt).toBe("2026-04-23T15:30:00.000Z");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: "project-a",
      displayName: "Alpha",
      updatedAt: "2026-04-23T15:30:00.000Z"
    });
    expect(restored).toMatchObject({
      project_id: "project-a",
      display_name: "Alpha"
    });

    await storage.deleteProject("project-a", write.version);

    await expect(storage.listProjects()).resolves.toEqual([]);
  });

  it("enforces expected versions on writes and deletes", async () => {
    const storage = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:31:00.000Z")
    });

    const write = await storage.writeProject(exampleProject("project-a", "Alpha"));

    await expect(
      storage.writeProject(exampleProject("project-a", "Alpha 2"), "wrong-version")
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(
      storage.deleteProject("project-a", "wrong-version")
    ).rejects.toBeInstanceOf(StorageConflictError);

    await expect(
      storage.writeProject(exampleProject("project-a", "Alpha 2"), write.version)
    ).resolves.toMatchObject({
      updatedAt: "2026-04-23T15:31:00.000Z"
    });
  });

  it("exports and imports project bundles", async () => {
    const source = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:32:00.000Z")
    });
    const target = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:33:00.000Z")
    });

    await source.writeProject(exampleProject("project-a", "Alpha"));
    await source.writeProject(exampleProject("project-b", "Beta"));

    const bundle = await source.exportBundle(["project-b", "project-a"]);
    const imported = await target.importBundle(bundle);

    expect(bundle.type).toBe("application/json");
    expect(imported.imported.map((project) => project.id).sort()).toEqual([
      "project-a",
      "project-b"
    ]);
    await expect(target.readProject("project-b")).resolves.toMatchObject({
      project_id: "project-b",
      display_name: "Beta"
    });
  });
});

describe("TauriStorage", () => {
  it("serializes project documents through invoke commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const project = exampleProject("project-a", "Alpha");
    const serialized = serializeProjectDocument(project);
    const invoke: TauriInvoke = async (command, args) => {
      calls.push({ command, args });

      if (command === "storage_write_project") {
        return { version: "v1", updatedAt: "2026-04-23T15:34:00.000Z" };
      }

      if (command === "storage_read_project") {
        return serialized;
      }

      if (command === "storage_list_projects") {
        return [
          {
            id: "project-a",
            displayName: "Alpha",
            updatedAt: "2026-04-23T15:34:00.000Z",
            version: "v1"
          }
        ];
      }

      return undefined;
    };
    const storage = new TauriStorage({ invoke });

    await expect(storage.writeProject(project, "v0")).resolves.toEqual({
      version: "v1",
      updatedAt: "2026-04-23T15:34:00.000Z"
    });
    await expect(storage.readProject("project-a")).resolves.toMatchObject({
      project_id: "project-a",
      display_name: "Alpha"
    });
    await expect(storage.listProjects()).resolves.toHaveLength(1);

    expect(calls[0]).toEqual({
      command: "storage_write_project",
      args: {
        project: serialized,
        expected: "v0"
      }
    });
  });
});

describe("createStorageAdapter", () => {
  it("selects storage based on shell capabilities", () => {
    expect(
      createStorageAdapter(browserWebCapabilities, {
        browser: { storage: new MemoryStorage() }
      })
    ).toBeInstanceOf(BrowserStorage);
    expect(createStorageAdapter(tauriCapabilities)).toBeInstanceOf(TauriStorage);
  });
});

function exampleProject(project_id: string, display_name: string) {
  return createProjectDocument({
    project_id,
    display_name,
    path: createPathModel({
      path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })]
    })
  });
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
