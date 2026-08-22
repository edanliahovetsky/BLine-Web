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
import { serializeProjectFiles } from "../../../src/core/io/projectFiles";
import {
  BrowserStorage,
  ProjectPersistenceDamageError,
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

    const write = await storage.writeProject(workspace);
    const summaries = await storage.listWorkspaces();
    const restored = await storage.readProject("workspace-a");

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
    expect(restored).not.toHaveProperty("active_path_id");
    expect(restored).not.toHaveProperty("active_path_group_id");
    const storedRecord = JSON.parse(
      memory.getItem("bline-web:workspace:workspace-a") ?? "null",
    ) as { files: Array<{ relativePath: string; text: string }> };
    expect(storedRecord.files.map((file) => file.relativePath)).toEqual([
      "config.json",
      "project.json",
      "paths/One.json",
    ]);
    expect(
      storedRecord.files.find((file) => file.relativePath === "project.json")
        ?.text,
    ).not.toContain("active_path");
    expect(memory.getItem("bline-web:editor-user-data:v1")).toBeNull();

    await storage.deleteWorkspace("workspace-a", write.version);

    await expect(storage.listWorkspaces()).resolves.toEqual([]);
  });

  it("enforces expected versions on writes and deletes", async () => {
    const storage = new BrowserStorage({
      storage: new MemoryStorage(),
      now: fixedClock("2026-04-23T15:31:00.000Z"),
    });

    const write = await storage.writeProject(
      exampleWorkspace("workspace-a", "Alpha", ["One"]),
    );

    await expect(
      storage.writeProject(
        exampleWorkspace("workspace-a", "Alpha 2", ["One"]),
        "wrong-version",
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(
      storage.deleteWorkspace("workspace-a", "wrong-version"),
    ).rejects.toBeInstanceOf(StorageConflictError);

    await expect(
      storage.writeProject(
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

    await source.writeProject(
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
      target.readProject(imported.imported[0].id),
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
    const workspace = await storage.readProject("legacy-project");

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

  it("preserves legacy workspace metadata until migration is confirmed", async () => {
    const memory = new MemoryStorage();
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const legacyJson = JSON.stringify({
      document: workspace,
      version: "legacy-version",
      updatedAt: "2026-04-23T15:38:00.000Z",
    });
    memory.setItem("bline-web:workspace:legacy-locator", legacyJson);
    const storage = new BrowserStorage({ storage: memory });

    await storage.initialize();
    await storage.setCurrentWorkspaceId("legacy-locator");
    const restored = await storage.readProject("legacy-locator");
    const preserved = JSON.parse(
      memory.getItem("bline-web:workspace:legacy-locator") ?? "null",
    ) as Record<string, unknown>;

    expect(restored).toMatchObject({
      project_id: "workspace-a",
      paths: [{ path_id: "path-1" }],
    });
    expect(preserved).toHaveProperty("document.config.gui.field");

    const prepared = await storage.prepareLegacyProjectMigration(
      restored,
      "legacy-version",
      "legacy-locator",
    );
    expect(prepared).not.toBeNull();
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBeNull();

    memory.setItem("bline-web:workspace:different-locator", legacyJson);
    memory.setItem("bline-web:current-workspace", "different-locator");
    const collision = new BrowserStorage({ storage: memory });
    const collidingProject = await collision.readProject("different-locator");
    await expect(
      collision.prepareLegacyProjectMigration(
        collidingProject,
        "legacy-version",
        "different-locator",
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(memory.getItem("bline-web:workspace:different-locator")).toBe(
      legacyJson,
    );
    memory.removeItem("bline-web:workspace:different-locator");

    // Simulate a browser closing after the stable record was written but before
    // the legacy locator was removed. Preparing again must adopt the verified
    // target instead of overwriting or changing its version.
    memory.setItem("bline-web:workspace:legacy-locator", legacyJson);
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const interrupted = new BrowserStorage({ storage: memory });
    const interruptedProject = await interrupted.readProject("legacy-locator");
    await expect(
      interrupted.prepareLegacyProjectMigration(
        interruptedProject,
        "legacy-version",
        "legacy-locator",
      ),
    ).resolves.toEqual(prepared);
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBeNull();

    const changedLegacyJson = JSON.stringify({
      document: { ...workspace, display_name: "Changed after prepare" },
      version: "newer-legacy-version",
      updatedAt: "2026-04-23T15:39:00.000Z",
    });
    memory.setItem("bline-web:workspace:legacy-locator", changedLegacyJson);
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const changedSource = new BrowserStorage({ storage: memory });
    const changedProject = await changedSource.readProject("legacy-locator");
    await expect(
      changedSource.prepareLegacyProjectMigration(
        changedProject,
        "newer-legacy-version",
        "legacy-locator",
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBe(
      changedLegacyJson,
    );
    memory.removeItem("bline-web:workspace:legacy-locator");
    memory.setItem("bline-web:current-workspace", "workspace-a");

    const restarted = new BrowserStorage({ storage: memory });
    const resumed = await restarted.readProject("workspace-a");
    expect(resumed.config.gui.field).toEqual(restored.config.gui.field);
    expect(restarted.getLegacyProjectMigrationSourceId()).toBe(
      "legacy-locator",
    );
    await expect(
      restarted.writeProject(resumed, prepared!.version),
    ).rejects.toThrow("migration must finish");

    const result = await restarted.deleteLegacyProjectFiles(
      prepared!.version,
      "legacy-locator",
      "workspace-a",
    );
    const migrated = JSON.parse(
      memory.getItem("bline-web:workspace:workspace-a") ?? "null",
    ) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(migrated).toHaveProperty("files");
    expect(migrated).not.toHaveProperty("legacyDocument");
  });

  it("preserves damaged browser metadata until an explicit replacement", async () => {
    const memory = new MemoryStorage();
    const project = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const files = serializeProjectFiles(project).map((file) =>
      file.relativePath === "project.json"
        ? { ...file, text: "{<<<<<<< HEAD\n" }
        : file,
    );
    memory.setItem(
      "bline-web:workspace:workspace-a",
      JSON.stringify({
        files,
        version: "damaged-v1",
        updatedAt: "2026-04-23T15:39:00.000Z",
      }),
    );
    memory.setItem("bline-web:current-workspace", "workspace-a");
    const storage = new BrowserStorage({ storage: memory });

    const recovered = await storage.readProject("workspace-a");
    expect(recovered.paths).toHaveLength(1);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: "project.json",
      rawText: "{<<<<<<< HEAD\n",
    });
    await expect(
      storage.writeProject(recovered, "damaged-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(memory.getItem("bline-web:workspace:workspace-a")).toContain(
      "{<<<<<<< HEAD",
    );

    await storage.replaceDamagedProject(recovered, "damaged-v1");
    expect(storage.getCurrentProjectDamage()).toBeNull();
    expect(memory.getItem("bline-web:workspace:workspace-a")).not.toContain(
      "{<<<<<<< HEAD",
    );
  });

  it("blocks writes when Project metadata references a missing path file", async () => {
    const memory = new MemoryStorage();
    const project = exampleWorkspace("workspace-a", "Alpha", ["One", "Two"]);
    const files = serializeProjectFiles(project).filter(
      (file) => file.relativePath !== "paths/Two.json",
    );
    memory.setItem(
      "bline-web:workspace:workspace-a",
      JSON.stringify({
        files,
        version: "damaged-v1",
        updatedAt: "2026-04-23T15:40:00.000Z",
      }),
    );
    memory.setItem("bline-web:current-workspace", "workspace-a");
    const storage = new BrowserStorage({ storage: memory });
    const damagedRecord = memory.getItem("bline-web:workspace:workspace-a");

    const recovered = await storage.readProject("workspace-a");

    expect(recovered.paths.map((path) => path.file_name)).toEqual(["One.json"]);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: "project.json",
      message: expect.stringContaining("paths/Two.json"),
    });
    await expect(
      storage.writeProject(recovered, "damaged-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(memory.getItem("bline-web:workspace:workspace-a")).toBe(
      damagedRecord,
    );
  });
});

describe("TauriStorage", () => {
  it("passes canonical Project text files through the desktop shell", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const files = serializeProjectFiles(workspace);
    const invoke = (
      command: string,
      args: Record<string, unknown> | undefined,
    ) => {
      calls.push({ command, args });

      if (command === "storage_write_project_files") {
        return {
          directoryLocator: "/tmp/autos",
          version: "v1",
          updatedAt: "2026-04-23T15:34:00.000Z",
        };
      }

      if (command === "storage_read_project_files") {
        return {
          directoryLocator: "/tmp/autos",
          files: files.map((file) => ({
            relativePath: file.relativePath,
            contents: file.text,
          })),
          version: "v1",
          updatedAt: "2026-04-23T15:34:00.000Z",
        };
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

    await expect(storage.writeProject(workspace, "v0")).resolves.toEqual({
      version: "v1",
      updatedAt: "2026-04-23T15:34:00.000Z",
    });
    await expect(storage.readProject("workspace-a")).resolves.toMatchObject({
      project_id: "workspace-a",
      display_name: "Alpha",
      paths: [{ display_name: "One" }],
    });
    await expect(storage.listWorkspaces()).resolves.toHaveLength(1);

    expect(calls[0]).toEqual({
      command: "storage_write_project_files",
      args: {
        directoryLocator: null,
        files: files.map((file) => ({
          relativePath: file.relativePath,
          contents: file.text,
        })),
        expected: "v0",
      },
    });
    expect(calls[1]).toEqual({
      command: "storage_read_project_files",
      args: { directoryLocator: "workspace-a" },
    });
  });

  it("opens runtime files but blocks writes around malformed legacy metadata", async () => {
    const project = exampleWorkspace("discarded", "Autos", ["One"]);
    const runtimeFiles = serializeProjectFiles(project)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents: file.text,
      }));
    const calls: string[] = [];
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        calls.push(command);
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: "/tmp/autos",
            files: runtimeFiles,
            legacyFiles: [
              {
                relativePath: ".bline-web/state.json",
                contents: "{<<<<<<< HEAD\n",
              },
            ],
            version: "damaged-v1",
            updatedAt: "2026-04-23T15:40:00.000Z",
          } as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });

    const recovered = await storage.readProject("/tmp/autos");
    expect(recovered.paths).toHaveLength(1);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: ".bline-web/state.json",
      rawText: "{<<<<<<< HEAD\n",
    });
    await expect(
      storage.writeProject(recovered, "damaged-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(calls).toEqual(["storage_read_project_files"]);
  });

  it("resumes legacy Field Background migration after a canonical desktop save", async () => {
    const project = exampleWorkspace("stable-project", "Autos", ["One"]);
    const canonicalFiles = serializeProjectFiles(project).map((file) => ({
      relativePath: file.relativePath,
      contents: file.text,
    }));
    const legacyField = {
      selected_field_id: "legacy-field",
      custom_fields: [
        {
          id: "legacy-field",
          name: "Legacy Field",
          asset_id: "legacy-asset",
          file_name: "legacy.png",
          mime_type: "image/png",
          size_bytes: 3,
          created_at: "2026-04-23T15:40:00.000Z",
          geometry: {
            length_meters: 16.54,
            width_meters: 8.21,
            coordinate_offset_meters: 0,
            coordinate_offset_x_meters: 0,
            coordinate_offset_y_meters: 0,
          },
        },
      ],
    };
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: "/tmp/autos",
            files: canonicalFiles,
            legacyFiles: [
              {
                relativePath: ".bline-web/state.json",
                contents: JSON.stringify({
                  schema_version: 1,
                  editor_config: {
                    gui: { ...project.config.gui, field: legacyField },
                    kinematic_constraints: {},
                  },
                  active_path_file_name: "One.json",
                  active_path_group_id: null,
                  path_groups: [],
                  linked_targets: [],
                  paths: {},
                }),
              },
            ],
            version: "canonical-with-legacy-v2",
            updatedAt: "2026-04-23T15:41:00.000Z",
          } as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });

    const resumed = await storage.readProject("/tmp/autos");

    expect(resumed.project_id).toBe("stable-project");
    expect(resumed.config.gui.field).toEqual(legacyField);
    expect(storage.getCurrentProjectDamage()).toBeNull();
  });

  it("keeps delayed legacy prepare and cleanup bound to their source folder", async () => {
    const source = exampleWorkspace("discarded", "Project A", ["One"]);
    const runtimeFiles = serializeProjectFiles(source)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents: file.text,
      }));
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    let resolvePrepare!: (payload: unknown) => void;
    let resolveCleanup!: (payload: unknown) => void;
    const storage = new TauriStorage({
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: "/repo/project-a/autos",
            files: runtimeFiles,
            legacyFiles: [
              {
                relativePath: "pathgroups.json",
                contents: '{"schema_version":1,"groups":[]}',
              },
            ],
            version: "legacy-a-v1",
            updatedAt: "2026-08-21T12:00:00.000Z",
          } as T;
        }
        if (command === "storage_switch_workspace") {
          const id = String(args?.id);
          return {
            id,
            displayName: id.endsWith("project-b/autos")
              ? "Project B"
              : "Project A",
            directoryPath: id,
            version: id.endsWith("project-b/autos") ? "b-v1" : "legacy-a-v1",
            updatedAt: "2026-08-21T12:01:00.000Z",
          } as T;
        }
        if (command === "storage_prepare_legacy_project_files") {
          return new Promise<T>((resolve) => {
            resolvePrepare = (payload) => resolve(payload as T);
          });
        }
        if (command === "storage_delete_legacy_project_files") {
          return new Promise<T>((resolve) => {
            resolveCleanup = (payload) => resolve(payload as T);
          });
        }
        if (command === "storage_read_field_asset") {
          return null as T;
        }
        if (command === "storage_delete_field_asset") {
          return undefined as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });

    const project = await storage.readProject("/repo/project-a/autos");
    const preparing = storage.prepareLegacyProjectMigration(
      project,
      "legacy-a-v1",
      "/repo/project-a/autos",
    );
    await Promise.resolve();
    await storage.switchWorkspace("/repo/project-b/autos");
    resolvePrepare({
      directoryLocator: "/repo/project-a/autos",
      version: "canonical-a-v2",
      updatedAt: "2026-08-21T12:02:00.000Z",
    });
    await preparing;
    expect(storage.getLegacyProjectMigrationSourceId()).toBe(
      "/repo/project-b/autos",
    );
    await storage.readFieldAsset("/repo/project-a/autos", "legacy-asset");
    await storage.deleteFieldAsset("/repo/project-a/autos", "legacy-asset");

    await storage.switchWorkspace("/repo/project-a/autos");
    const cleaning = storage.deleteLegacyProjectFiles(
      "canonical-a-v2",
      "/repo/project-a/autos",
      project.project_id,
    );
    await Promise.resolve();
    await storage.switchWorkspace("/repo/project-b/autos");
    resolveCleanup({
      directoryLocator: "/repo/project-a/autos",
      version: "clean-a-v3",
      updatedAt: "2026-08-21T12:03:00.000Z",
    });
    await cleaning;

    expect(storage.getLegacyProjectMigrationSourceId()).toBe(
      "/repo/project-b/autos",
    );
    expect(
      calls.find(
        (call) => call.command === "storage_prepare_legacy_project_files",
      )?.args,
    ).toMatchObject({
      directoryLocator: "/repo/project-a/autos",
      expected: "legacy-a-v1",
    });
    expect(
      calls.find(
        (call) => call.command === "storage_delete_legacy_project_files",
      )?.args,
    ).toEqual({
      directoryLocator: "/repo/project-a/autos",
      expected: "canonical-a-v2",
    });
    expect(
      calls
        .filter((call) => call.command.endsWith("field_asset"))
        .map((call) => call.args?.workspaceId),
    ).toEqual(["/repo/project-a/autos", "/repo/project-a/autos"]);
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
