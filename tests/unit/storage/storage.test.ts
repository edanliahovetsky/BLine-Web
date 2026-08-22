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
import { serializeProjectWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
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

  it("migrates a one-path record through the guarded Field Background lifecycle", async () => {
    const memory = new MemoryStorage();
    const legacyField = {
      selected_field_id: "custom:legacy-practice",
      custom_fields: [
        {
          id: "custom:legacy-practice",
          name: "Legacy Practice Field",
          asset_id: "legacy-practice.png",
          file_name: "legacy-practice.png",
          mime_type: "image/png",
          size_bytes: 3,
          created_at: "2026-04-23T15:37:00.000Z",
          geometry: {
            length_meters: 8,
            width_meters: 4,
            coordinate_offset_meters: 0,
          },
        },
      ],
    };
    const legacyProject = createProjectDocument({
      project_id: "legacy-project",
      display_name: "Legacy Path",
      path_file_name: "legacy.json",
      path: createPathModel(),
      config: { gui: { field: legacyField } },
    });
    const legacyJson = JSON.stringify(
      createStoredProjectRecord(
        legacyProject,
        "legacy-version",
        "2026-04-23T15:37:00.000Z",
      ),
    );
    memory.setItem("bline-web:project:legacy-project", legacyJson);
    memory.setItem("bline-web:current-workspace", "legacy-project");
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
    expect(storage.getCurrentProjectDamage()).toBeNull();
    expect(workspace.config.gui.field).toMatchObject(legacyField);
    expect(storage.getLegacyProjectMigrationSourceId()).toBe("legacy-project");
    expect(memory.getItem("bline-web:project:legacy-project")).toBe(legacyJson);
    expect(memory.getItem("bline-web:workspace:legacy-project")).toBeNull();

    const prepared = await storage.prepareLegacyProjectMigration(
      workspace,
      "legacy-version",
      "legacy-project",
    );

    expect(prepared).not.toBeNull();
    expect(memory.getItem("bline-web:project:legacy-project")).toBeNull();
    const preparedJson =
      memory.getItem("bline-web:workspace:legacy-project") ?? "null";
    const preparedRecord = JSON.parse(preparedJson) as Record<string, unknown>;
    expect(preparedRecord).toMatchObject({ legacySourceRecord: legacyJson });

    const damagedPreparedJson = JSON.stringify({
      ...preparedRecord,
      futureEnvelope: true,
    });
    memory.setItem("bline-web:workspace:legacy-project", damagedPreparedJson);
    const damagedPrepared = new BrowserStorage({ storage: memory });
    await damagedPrepared.readProject("legacy-project");
    await expect(
      damagedPrepared.deleteLegacyProjectFiles(
        prepared!.version,
        "legacy-project",
        "legacy-project",
      ),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(memory.getItem("bline-web:workspace:legacy-project")).toBe(
      damagedPreparedJson,
    );

    memory.setItem("bline-web:workspace:legacy-project", preparedJson);
    const resumedStorage = new BrowserStorage({ storage: memory });
    const resumed = await resumedStorage.readProject("legacy-project");
    expect(resumed.config.gui.field).toEqual(workspace.config.gui.field);
    await expect(
      resumedStorage.writeProject(resumed, prepared!.version),
    ).rejects.toThrow("migration must finish");

    await expect(
      resumedStorage.deleteLegacyProjectFiles(
        prepared!.version,
        "legacy-project",
        "legacy-project",
      ),
    ).resolves.not.toBeNull();
    expect(resumedStorage.getLegacyProjectMigrationSourceId()).toBeNull();
  });

  it("preserves unsupported one-path browser records", async () => {
    const memory = new MemoryStorage();
    const record = createStoredProjectRecord(
      createProjectDocument({
        project_id: "legacy-project",
        display_name: "Legacy Path",
        path_file_name: "legacy.json",
        path: createPathModel(),
      }),
      "legacy-version",
      "2026-04-23T15:37:00.000Z",
    );
    const legacyJson = JSON.stringify({
      ...record,
      document: { ...record.document, schema_version: 2 },
    });
    memory.setItem("bline-web:project:legacy-project", legacyJson);
    const storage = new BrowserStorage({ storage: memory });

    await expect(storage.initialize()).resolves.toBeUndefined();
    await expect(storage.listWorkspaces()).resolves.toContainEqual(
      expect.objectContaining({
        id: "legacy-project",
        displayName: "Legacy Path",
      }),
    );
    await storage.setCurrentWorkspaceId("legacy-project");
    const recovered = await storage.readProject("legacy-project");
    expect(recovered.paths).toHaveLength(1);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: "legacy Project metadata",
      rawText: legacyJson,
    });
    await expect(
      storage.writeProject(recovered, "legacy-version"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    await expect(
      storage.replaceDamagedProject(recovered, "legacy-version"),
    ).resolves.toEqual(
      expect.objectContaining({ version: expect.any(String) }),
    );
    expect(memory.getItem("bline-web:project:legacy-project")).toBeNull();
    expect(memory.getItem("bline-web:workspace:legacy-project")).not.toBeNull();
  });

  it("keeps an unsupported one-path source unchanged until replacement", async () => {
    const memory = new MemoryStorage();
    const record = createStoredProjectRecord(
      createProjectDocument({
        project_id: "legacy-project",
        display_name: "Legacy Path",
        path_file_name: "legacy.json",
        path: createPathModel(),
      }),
      "legacy-version",
      "2026-04-23T15:37:00.000Z",
    );
    const legacyJson = JSON.stringify({
      ...record,
      document: { ...record.document, future_data: true },
    });
    memory.setItem("bline-web:project:legacy-project", legacyJson);
    const storage = new BrowserStorage({ storage: memory });

    await storage.initialize();
    await storage.setCurrentWorkspaceId("legacy-project");
    const recovered = await storage.readProject("legacy-project");

    expect(storage.getCurrentProjectDamage()).not.toBeNull();
    await expect(
      storage.writeProject(recovered, "legacy-version"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(memory.getItem("bline-web:project:legacy-project")).toBe(legacyJson);
    expect(memory.getItem("bline-web:workspace:legacy-project")).toBeNull();
  });

  it("preserves an old browser record when its canonical target is different", async () => {
    const memory = new MemoryStorage();
    const legacyProject = createProjectDocument({
      project_id: "shared-project-id",
      display_name: "Legacy Path",
      path_file_name: "legacy.json",
      path: createPathModel(),
    });
    const legacyJson = JSON.stringify(
      createStoredProjectRecord(
        legacyProject,
        "legacy-version",
        "2026-04-23T15:37:00.000Z",
      ),
    );
    const canonicalJson = JSON.stringify({
      files: serializeProjectFiles(
        exampleWorkspace("shared-project-id", "Newer Project", ["One"]),
      ),
      version: "canonical-version",
      updatedAt: "2026-04-24T15:37:00.000Z",
    });
    memory.setItem("bline-web:project:legacy-locator", legacyJson);
    memory.setItem("bline-web:workspace:shared-project-id", canonicalJson);
    const storage = new BrowserStorage({ storage: memory });

    await storage.initialize();

    await storage.setCurrentWorkspaceId("legacy-locator");
    const legacy = await storage.readProject("legacy-locator");
    await expect(
      storage.replaceDamagedProject(legacy, "legacy-version"),
    ).rejects.toBeInstanceOf(StorageConflictError);

    expect(memory.getItem("bline-web:project:legacy-locator")).toBe(legacyJson);
    expect(memory.getItem("bline-web:workspace:shared-project-id")).toBe(
      canonicalJson,
    );
  });

  it("prefers a canonical Project over an old recovery record with the same ID", async () => {
    const memory = new MemoryStorage();
    const legacyJson = JSON.stringify(
      createStoredProjectRecord(
        createProjectDocument({
          project_id: "shared-project-id",
          display_name: "Old Project",
          path_file_name: "old.json",
          path: createPathModel(),
        }),
        "legacy-version",
        "2026-04-23T15:37:00.000Z",
      ),
    );
    const canonicalJson = JSON.stringify({
      files: serializeProjectFiles(
        exampleWorkspace("shared-project-id", "Canonical Project", ["One"]),
      ),
      version: "canonical-version",
      updatedAt: "2026-04-24T15:37:00.000Z",
    });
    memory.setItem("bline-web:project:shared-project-id", legacyJson);
    memory.setItem("bline-web:workspace:shared-project-id", canonicalJson);
    const storage = new BrowserStorage({ storage: memory });

    await storage.initialize();
    await storage.setCurrentWorkspaceId("shared-project-id");
    const restored = await storage.readProject("shared-project-id");

    expect(restored.display_name).toBe("Canonical Project");
    expect(storage.getCurrentProjectDamage()).toBeNull();
    expect(memory.getItem("bline-web:project:shared-project-id")).toBe(
      legacyJson,
    );
    expect(memory.getItem("bline-web:workspace:shared-project-id")).toBe(
      canonicalJson,
    );
  });

  it("preserves legacy workspace metadata until migration is confirmed", async () => {
    const memory = new MemoryStorage();
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const legacyDocument = serializeProjectWorkspaceDocument(workspace);
    const legacyJson = JSON.stringify({
      document: legacyDocument,
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

    const preparedJson =
      memory.getItem("bline-web:workspace:workspace-a") ?? "null";
    const preparedRecord = JSON.parse(preparedJson) as Record<string, unknown>;
    memory.setItem(
      "bline-web:workspace:workspace-a",
      JSON.stringify({
        ...preparedRecord,
        legacySourceRecord: JSON.stringify({
          document: { ...legacyDocument, display_name: "Tampered source" },
          version: "legacy-version",
          updatedAt: "2026-04-23T15:38:00.000Z",
        }),
      }),
    );
    await expect(
      storage.deleteLegacyProjectFiles(
        prepared!.version,
        "legacy-locator",
        "workspace-a",
      ),
    ).rejects.toThrow("provenance no longer matches");
    memory.setItem("bline-web:workspace:workspace-a", preparedJson);

    const reformattedLegacyJson = JSON.stringify(
      {
        document: legacyDocument,
        version: "legacy-version",
        updatedAt: "2026-04-23T15:38:00.000Z",
      },
      null,
      2,
    );
    memory.setItem("bline-web:workspace:legacy-locator", reformattedLegacyJson);
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const reformattedSource = new BrowserStorage({ storage: memory });
    const reformattedProject =
      await reformattedSource.readProject("legacy-locator");
    await expect(
      reformattedSource.prepareLegacyProjectMigration(
        reformattedProject,
        "legacy-version",
        "legacy-locator",
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBe(
      reformattedLegacyJson,
    );
    memory.removeItem("bline-web:workspace:legacy-locator");

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
      document: {
        ...legacyDocument,
        display_name: "Changed after prepare",
      },
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

  it("accepts a historical sparse custom Field config for migration", async () => {
    const memory = new MemoryStorage();
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const legacyDocument = serializeProjectWorkspaceDocument(workspace);
    memory.setItem(
      "bline-web:workspace:workspace-a",
      JSON.stringify({
        document: {
          ...legacyDocument,
          config: {
            gui: {
              field: {
                selected_field_id: "custom:legacy-practice",
                custom_fields: [
                  {
                    id: "custom:legacy-practice",
                    name: "Legacy Practice Field",
                    asset_id: "legacy-practice.png",
                    file_name: "legacy-practice.png",
                    mime_type: "image/png",
                    size_bytes: 3,
                    created_at: "2026-08-21T12:00:00.000Z",
                    geometry: {
                      length_meters: 8,
                      width_meters: 4,
                      coordinate_offset_meters: 0,
                    },
                  },
                ],
              },
            },
          },
        },
        version: "legacy-version",
        updatedAt: "2026-04-23T15:38:00.000Z",
      }),
    );
    const storage = new BrowserStorage({ storage: memory });

    await storage.initialize();
    await storage.setCurrentWorkspaceId("workspace-a");
    const restored = await storage.readProject("workspace-a");

    expect(storage.getCurrentProjectDamage()).toBeNull();
    expect(restored.config.gui.field.custom_fields[0]?.name).toBe(
      "Legacy Practice Field",
    );
    const prepared = await storage.prepareLegacyProjectMigration(
      restored,
      "legacy-version",
      "workspace-a",
    );
    await expect(
      storage.deleteLegacyProjectFiles(
        prepared!.version,
        "workspace-a",
        "workspace-a",
      ),
    ).resolves.not.toBeNull();
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

  it("blocks unknown browser record and file data until explicit replacement", async () => {
    const cases = [
      {
        name: "outer field",
        mutate: (record: Record<string, unknown>) => ({
          ...record,
          futureEnvelope: true,
        }),
      },
      {
        name: "file metadata",
        mutate: (record: Record<string, unknown>) => ({
          ...record,
          files: (record.files as Array<Record<string, unknown>>).map(
            (file, index) =>
              index === 0 ? { ...file, futureFileMetadata: true } : file,
          ),
        }),
      },
      {
        name: "unmanaged file",
        mutate: (record: Record<string, unknown>) => ({
          ...record,
          files: [
            ...(record.files as Array<Record<string, unknown>>),
            { relativePath: "notes.txt", text: "do not discard" },
          ],
        }),
      },
      {
        name: "incomplete migration provenance",
        mutate: (record: Record<string, unknown>) => ({
          ...record,
          legacySourceRecord: JSON.stringify({
            document: {},
            version: "legacy-v1",
            updatedAt: "2026-04-23T15:38:00.000Z",
          }),
        }),
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const id = `workspace-${index}`;
      const memory = new MemoryStorage();
      const rawText = JSON.stringify(
        testCase.mutate({
          files: serializeProjectFiles(exampleWorkspace(id, id, ["One"])),
          version: "damaged-v1",
          updatedAt: "2026-04-23T15:39:00.000Z",
        }),
      );
      memory.setItem(`bline-web:workspace:${id}`, rawText);
      memory.setItem("bline-web:current-workspace", id);
      const storage = new BrowserStorage({ storage: memory });

      const recovered = await storage.readProject(id);

      expect(storage.getCurrentProjectDamage(), testCase.name).toMatchObject({
        sourcePath: "browser Project record",
        rawText,
      });
      await expect(
        storage.writeProject(recovered, "damaged-v1"),
      ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
      expect(memory.getItem(`bline-web:workspace:${id}`)).toBe(rawText);

      await storage.replaceDamagedProject(recovered, "damaged-v1");
      expect(storage.getCurrentProjectDamage()).toBeNull();
      expect(memory.getItem(`bline-web:workspace:${id}`)).not.toBe(rawText);
    }
  });

  it("replaces a damaged combined source by locator without overwriting its target", async () => {
    const memory = new MemoryStorage();
    const project = exampleWorkspace("stable-project", "Alpha", ["One"]);
    const damagedSource = JSON.stringify({
      document: serializeProjectWorkspaceDocument(project),
      version: "damaged-v1",
      updatedAt: "2026-04-23T15:39:00.000Z",
      futureEnvelope: true,
    });
    const unrelatedTarget = JSON.stringify({
      files: serializeProjectFiles(
        exampleWorkspace("stable-project", "Unrelated", ["Other"]),
      ),
      version: "unrelated-v1",
      updatedAt: "2026-04-23T15:40:00.000Z",
    });
    memory.setItem("bline-web:workspace:legacy-locator", damagedSource);
    memory.setItem("bline-web:workspace:stable-project", unrelatedTarget);
    memory.setItem("bline-web:current-workspace", "legacy-locator");
    const storage = new BrowserStorage({ storage: memory });
    const recovered = await storage.readProject("legacy-locator");

    await expect(
      storage.replaceDamagedProject(recovered, "damaged-v1"),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBe(
      damagedSource,
    );
    expect(memory.getItem("bline-web:workspace:stable-project")).toBe(
      unrelatedTarget,
    );

    memory.removeItem("bline-web:workspace:stable-project");
    await storage.replaceDamagedProject(recovered, "damaged-v1");

    expect(memory.getItem("bline-web:workspace:legacy-locator")).toBeNull();
    expect(memory.getItem("bline-web:workspace:stable-project")).not.toBeNull();
    expect(await storage.getCurrentWorkspaceId()).toBe("stable-project");
  });

  it("opens recoverable legacy browser content but blocks destructive migration when its metadata is unsupported", async () => {
    const memory = new MemoryStorage();
    const workspace = exampleWorkspace("workspace-a", "Alpha", ["One"]);
    const legacyJson = JSON.stringify({
      document: {
        ...serializeProjectWorkspaceDocument(workspace),
        schema_version: 2,
      },
      version: "future-v1",
      updatedAt: "2026-08-21T12:00:00.000Z",
    });
    memory.setItem("bline-web:workspace:workspace-a", legacyJson);
    memory.setItem("bline-web:current-workspace", "workspace-a");
    const storage = new BrowserStorage({ storage: memory });

    const recovered = await storage.readProject("workspace-a");

    expect(recovered.paths).toHaveLength(1);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: "legacy Project metadata",
      rawText: expect.stringContaining('"schema_version":2'),
    });
    await expect(
      storage.writeProject(recovered, "future-v1"),
    ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
    expect(memory.getItem("bline-web:workspace:workspace-a")).toBe(legacyJson);
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

  it("opens runtime files but blocks writes around malformed or unsupported legacy metadata", async () => {
    const project = exampleWorkspace("discarded", "Autos", ["One"]);
    const runtimeFiles = serializeProjectFiles(project)
      .filter((file) => file.relativePath !== "project.json")
      .map((file) => ({
        relativePath: file.relativePath,
        contents: file.text,
      }));
    const legacyDocuments = [
      "{<<<<<<< HEAD\n",
      JSON.stringify({
        schema_version: 2,
        editor_config: { gui: {}, kinematic_constraints: {} },
        paths: {},
      }),
    ];

    for (const contents of legacyDocuments) {
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
                  contents,
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
        rawText: contents,
      });
      await expect(
        storage.writeProject(recovered, "damaged-v1"),
      ).rejects.toBeInstanceOf(ProjectPersistenceDamageError);
      expect(calls).toEqual(["storage_read_project_files"]);
    }
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
    const calls: string[] = [];
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        calls.push(command);
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
        if (command === "storage_delete_legacy_project_files") {
          return {
            directoryLocator: "/tmp/autos",
            version: "clean-v3",
            updatedAt: "2026-04-23T15:42:00.000Z",
          } as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });

    const resumed = await storage.readProject("/tmp/autos");

    expect(resumed.project_id).toBe("stable-project");
    expect(resumed.config.gui.field).toEqual(legacyField);
    expect(storage.getCurrentProjectDamage()).toBeNull();
    expect(storage.getLegacyProjectMigrationSourceId()).toBe("/tmp/autos");
    await expect(
      storage.deleteLegacyProjectFiles(
        "canonical-with-legacy-v2",
        "/tmp/autos",
        "stable-project",
      ),
    ).resolves.toMatchObject({ version: "clean-v3" });
    expect(calls).toEqual([
      "storage_read_project_files",
      "storage_delete_legacy_project_files",
    ]);
  });

  it("blocks legacy cleanup when an existing canonical snapshot disagrees with the effective legacy folder", async () => {
    const project = exampleWorkspace("stable-project", "Autos", ["One"]);
    const canonical = {
      ...project,
      path_groups: [
        {
          group_id: "canonical-only",
          display_name: "Canonical Only",
          path_ids: [project.paths[0]!.path_id],
        },
      ],
    };
    const calls: string[] = [];
    const storage = new TauriStorage({
      invoke: async <T>(command: string) => {
        calls.push(command);
        if (command === "storage_read_project_files") {
          return {
            directoryLocator: "/tmp/autos",
            files: serializeProjectFiles(canonical).map((file) => ({
              relativePath: file.relativePath,
              contents: file.text,
            })),
            legacyFiles: [
              {
                relativePath: "pathgroups.json",
                contents: '{"schema_version":1,"groups":[]}',
              },
            ],
            version: "canonical-with-legacy-v2",
            updatedAt: "2026-04-23T15:41:00.000Z",
          } as T;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });

    const recovered = await storage.readProject("/tmp/autos");

    expect(recovered.path_groups).toEqual(canonical.path_groups);
    expect(storage.getCurrentProjectDamage()).toMatchObject({
      sourcePath: "project.json",
    });
    await expect(
      storage.deleteLegacyProjectFiles(
        "canonical-with-legacy-v2",
        "/tmp/autos",
        "stable-project",
      ),
    ).resolves.toBeNull();
    expect(calls).toEqual(["storage_read_project_files"]);
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
    expect(storage.getLegacyProjectMigrationSourceId()).toBeNull();
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

    expect(storage.getLegacyProjectMigrationSourceId()).toBeNull();
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
