import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import {
  createProjectDocument,
  createProjectPathDocument,
  createProjectWorkspaceDocument,
  type ProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { serializeProjectWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import {
  BrowserStorage,
  StorageConflictError,
  createStorageAdapter,
  createStoredProjectRecord,
  type StorageLike,
  TauriStorage,
} from "../../../src/storage";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";

describe("BrowserStorage", () => {
  it("writes, lists, reads, and deletes workspaces", async () => {
    const memory = new MemoryStorage();
    const storage = new BrowserStorage({
      storage: memory,
      now: fixedClock("2026-04-23T15:30:00.000Z"),
    });
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);

    const write = await storage.writeWorkspace(workspace);
    const summaries = await storage.listWorkspaces();
    const restored = await storage.readWorkspace("workspace-a");

    expect(write.updatedAt).toBe("2026-04-23T15:30:00.000Z");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: "workspace-a",
      displayName: "Alpha",
      updatedAt: "2026-04-23T15:30:00.000Z",
    });
    expect(restored).toMatchObject({
      project_id: "workspace-a",
      display_name: "Alpha",
      paths: [{ display_name: "One" }],
    });
    const storedRecord = JSON.parse(
      memory.getItem("bline-web:workspace:workspace-a") ?? "null",
    ) as { document: { active_path_id: string | null } };
    expect(storedRecord.document.active_path_id).toBeNull();
    expect(memory.getItem("bline-web:editor-user-data:v1")).toBeNull();

    await storage.deleteWorkspace("workspace-a", write.version);

    await expect(storage.listWorkspaces()).resolves.toEqual([]);
  });

  it("enforces expected versions on writes and deletes", async () => {
    const storage = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:31:00.000Z"),
    });

    const write = await storage.writeWorkspace(
      exampleWorkspace("workspace-a", "Alpha", ["One"]),
    );

    await expect(
      storage.writeWorkspace(
        exampleWorkspace("workspace-a", "Alpha 2", ["One"]),
        "wrong-version",
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(
      storage.deleteWorkspace("workspace-a", "wrong-version"),
    ).rejects.toBeInstanceOf(StorageConflictError);

    await expect(
      storage.writeWorkspace(
        exampleWorkspace("workspace-a", "Alpha 2", ["One"]),
        write.version,
      ),
    ).resolves.toMatchObject({
      updatedAt: "2026-04-23T15:31:00.000Z",
    });
  });

  it("exports and imports BLine project archives with shared config and multiple paths", async () => {
    const source = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:35:00.000Z"),
    });
    const target = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:36:00.000Z"),
    });

    await source.writeWorkspace(
      exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]),
    );

    const archive = await source.exportWorkspaceArchive("workspace-a");
    const rawArchive = JSON.parse(await archive.text()) as {
      bline_project_schema_version: number;
      paths: Array<{ file_name: string }>;
    };
    const imported = await target.importWorkspaceArchive(
      new Blob([JSON.stringify(rawArchive)], { type: "application/json" }),
    );

    expect(rawArchive.bline_project_schema_version).toBe(1);
    expect(rawArchive.paths.map((path) => path.file_name).sort()).toEqual([
      "One.json",
      "Two.json",
    ]);
    expect(imported.imported).toHaveLength(1);
    await expect(
      target.readWorkspace(imported.imported[0].id),
    ).resolves.toMatchObject({
      paths: [{ file_name: "One.json" }, { file_name: "Two.json" }],
    });
  });

  it("migrates legacy one-path browser records into workspaces", async () => {
    const memory = new MemoryStorage();
    const legacyProject = createProjectDocument({
      project_id: "legacy-project",
      display_name: "Legacy Path",
      path_file_name: "legacy.json",
      path: createPathModel(),
    });
    memory.setItem(
      "bline-web:project:legacy-project",
      JSON.stringify(
        createStoredProjectRecord(
          legacyProject,
          "legacy-version",
          "2026-04-23T15:37:00.000Z",
        ),
      ),
    );
    const storage = new BrowserStorage({ storage: memory });

    const summaries = await storage.listWorkspaces();
    const workspace = await storage.readWorkspace("legacy-project");

    expect(summaries[0]).toMatchObject({
      id: "legacy-project",
      version: "legacy-version",
    });
    expect(workspace.paths[0]).toMatchObject({
      path_id: "legacy-project",
      file_name: "legacy.json",
    });
    expect(memory.getItem("bline-web:project:legacy-project")).toBeNull();
  });
});

describe("TauriStorage", () => {
  it("serializes workspace documents through invoke commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const serialized = serializeProjectWorkspaceDocument(workspace);
    const persisted = serializeProjectWorkspaceDocument({
      ...workspace,
      active_path_id: null,
      active_path_group_id: null,
    });
    const invoke = (
      command: string,
      args: Record<string, unknown> | undefined,
    ) => {
      calls.push({ command, args });

      if (command === "storage_write_workspace") {
        return { version: "v1", updatedAt: "2026-04-23T15:34:00.000Z" };
      }

      if (command === "storage_read_workspace") {
        return serialized;
      }

      if (command === "storage_list_recent_workspaces") {
        return [
          {
            id: "workspace-a",
            displayName: "Alpha",
            directoryPath: "/tmp/autos",
            updatedAt: "2026-04-23T15:34:00.000Z",
            version: "v1",
          },
        ];
      }

      return undefined;
    };
    const storage = new TauriStorage({
      invoke: async <T>(
        command: string,
        args: Record<string, unknown> | undefined,
      ) => invoke(command, args) as T,
    });

    await expect(storage.writeWorkspace(workspace, "v0")).resolves.toEqual({
      version: "v1",
      updatedAt: "2026-04-23T15:34:00.000Z",
    });
    await expect(storage.readWorkspace("workspace-a")).resolves.toMatchObject({
      project_id: "workspace-a",
      display_name: "Alpha",
      paths: [{ display_name: "One" }],
    });
    await expect(storage.listWorkspaces()).resolves.toHaveLength(1);

    expect(calls[0]).toEqual({
      command: "storage_write_workspace",
      args: {
        workspace: persisted,
        expected: "v0",
      },
    });
  });
});

describe("createStorageAdapter", () => {
  it("selects storage based on shell capabilities", () => {
    expect(
      createStorageAdapter(browserWebCapabilities, {
        browser: { storage: new MemoryStorage() },
      }),
    ).toBeInstanceOf(BrowserStorage);
    expect(createStorageAdapter(tauriCapabilities)).toBeInstanceOf(
      TauriStorage,
    );
  });
});

function exampleWorkspace(
  project_id: string,
  display_name: string,
  pathNames: string[],
): ProjectWorkspaceDocument {
  const paths = pathNames.map((name, index) =>
    createProjectPathDocument({
      path_id: `path-${index + 1}`,
      display_name: name,
      file_name: `${name}.json`,
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: index + 1, y_meters: index + 2 }),
        ],
      }),
    }),
  );

  return createProjectWorkspaceDocument({
    project_id,
    display_name,
    config: {
      kinematic_constraints: {
        default_intermediate_handoff_radius_meters: 0.42,
      },
    },
    paths,
    active_path_id: paths[0]?.path_id ?? null,
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
