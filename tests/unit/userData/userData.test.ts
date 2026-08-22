import { describe, expect, it } from "vitest";
import type { CustomFieldImage } from "../../../src/core/field/fieldConfig";
import { createProject } from "../../../src/core/model/project";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../../src/env/capabilities";
import {
  activePathForProject,
  flushUserData,
  importFieldBackgroundFromBytes,
  initializeUserData,
  migrateProjectViewIdentity,
  readEditorLayoutPreferences,
  readUserData,
  rememberActivePath,
  rememberAutomaticGenerationKeepInSync,
  rememberCompletedTourIds,
  rememberEditorLayoutPreferences,
  rememberSelectedFieldBackground,
  selectedFieldBackgroundForProject,
} from "../../../src/userData";
import {
  BROWSER_USER_DATA_KEY,
  BrowserUserDataAdapter,
  TauriUserDataAdapter,
  type UserDataAdapter,
  type UserDataStorage,
} from "../../../src/userData/adapters";
import { defaultUserData, type UserData } from "../../../src/userData/model";
import {
  FieldBackgroundAssetVerificationError,
  ProjectViewMigrationError,
  UserDataReadOnlyError,
  UserDataService,
  type CreateFieldBackgroundInput,
} from "../../../src/userData/service";
import {
  migrateImportedLegacyFieldBackgrounds,
  migrateLegacyProjectFieldBackgrounds,
} from "../../../src/userData/legacyFieldMigration";
import type { ProjectIoService } from "../../../src/platform/projectIo";

describe("UserData", () => {
  it("migrates all legacy preferences into one record without deleting sources", async () => {
    const storage = new MemoryStorage({
      "bline-web:editor-user-data:v1": JSON.stringify({
        schemaVersion: 1,
        activePathByProjectId: {
          "project-a": "path-a",
          broken: 7,
        },
      }),
      "bline-web:ui-preferences:v1": JSON.stringify({
        version: 1,
        inspectorTab: "constraints",
        inspectorWidth: 418.4,
        navigatorPinned: true,
        showGhostPaths: false,
      }),
      "bline-web:tours:v1": JSON.stringify(["editor-basics", 7]),
      "bline.autoVelocity.autoSync": "off",
    });
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
      { legacyStorage: storage },
    );

    await service.initialize();

    expect(service.getSnapshot()).toEqual({
      ...defaultUserData,
      editor_layout: {
        inspector_tab: "constraints",
        inspector_width: 418,
        show_ghost_paths: false,
      },
      completed_tour_ids: ["editor-basics"],
      automatic_generation: { keep_in_sync: false },
      project_views: { "project-a": { active_path_id: "path-a" } },
    });
    expect(JSON.parse(storage.getItem(BROWSER_USER_DATA_KEY)!)).toEqual(
      service.getSnapshot(),
    );
    expect(storage.getItem("bline-web:editor-user-data:v1")).not.toBeNull();
    expect(storage.getItem("bline-web:ui-preferences:v1")).not.toBeNull();
    expect(storage.getItem("bline-web:tours:v1")).not.toBeNull();
    expect(storage.getItem("bline.autoVelocity.autoSync")).toBe("off");
  });

  it("preserves valid unified fields while repairing optional corruption independently", async () => {
    const storage = new MemoryStorage({
      [BROWSER_USER_DATA_KEY]: JSON.stringify({
        schema_version: 0,
        editor_layout: {
          inspector_tab: "constraints",
          inspector_width: "wide",
          show_ghost_paths: false,
        },
        completed_tour_ids: ["simulate-verify", null, "simulate-verify"],
        automatic_generation: { keep_in_sync: false },
        project_views: {
          "project-a": {
            active_path_id: "path-a",
            selected_field_id: "field-2026",
          },
          "project-b": { active_path_id: 12 },
          broken: "not-an-object",
        },
        recent_projects: [{ id: "must-not-be-copied" }],
      }),
    });
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
    );

    await service.initialize();

    expect(service.getSnapshot()).toEqual({
      ...defaultUserData,
      editor_layout: {
        inspector_tab: "constraints",
        inspector_width: 340,
        show_ghost_paths: false,
      },
      completed_tour_ids: ["simulate-verify"],
      automatic_generation: { keep_in_sync: false },
      project_views: {
        "project-a": {
          active_path_id: "path-a",
          selected_field_background_id: "field-2026",
        },
      },
    });
    expect(service.getSnapshot()).not.toHaveProperty("recent_projects");
  });

  it("refuses to overwrite a record from a future schema", async () => {
    const future = JSON.stringify({
      schema_version: 99,
      completed_tour_ids: ["future-tour"],
      future_preference: true,
    });
    const storage = new MemoryStorage({ [BROWSER_USER_DATA_KEY]: future });
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
    );

    await expect(service.initialize()).rejects.toMatchObject({
      availability: "read-only",
    });
    expect(() =>
      service.update((current) => ({
        ...current,
        completed_tour_ids: ["memory-only-change"],
      })),
    ).toThrow(UserDataReadOnlyError);
    await expect(service.flush()).resolves.toBeUndefined();

    expect(service.getStatus()).toMatchObject({
      availability: "read-only",
      hasUnsavedChanges: false,
    });
    expect(service.getSnapshot().completed_tour_ids).toEqual([]);
    expect(storage.getItem(BROWSER_USER_DATA_KEY)).toBe(future);
  });

  it("preserves malformed durable data instead of replacing it with defaults", async () => {
    const malformed = "{<<<<<<< HEAD";
    const storage = new MemoryStorage({
      [BROWSER_USER_DATA_KEY]: malformed,
    });
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
    );

    await expect(service.initialize()).rejects.toMatchObject({
      availability: "read-only",
    });
    expect(() =>
      service.update((current) => ({
        ...current,
        completed_tour_ids: ["memory-only-change"],
      })),
    ).toThrow(UserDataReadOnlyError);
    await expect(service.flush()).resolves.toBeUndefined();

    expect(service.getSnapshot().completed_tour_ids).toEqual([]);
    expect(storage.getItem(BROWSER_USER_DATA_KEY)).toBe(malformed);
  });

  it("preserves a current-schema record with damaged Field Background geometry", async () => {
    const damaged = JSON.stringify({
      ...defaultUserData,
      field_backgrounds: [
        {
          id: "field-damaged",
          name: "Damaged",
          file_name: "damaged.png",
          mime_type: "image/png",
          size_bytes: 3,
          created_at: "2026-08-21T12:00:00.000Z",
          geometry: {
            length_meters: 16.54,
            width_meters: "unknown",
            coordinate_offset_meters: 0,
          },
        },
      ],
    });
    const storage = new MemoryStorage({
      [BROWSER_USER_DATA_KEY]: damaged,
    });
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
    );

    await expect(service.initialize()).rejects.toMatchObject({
      availability: "read-only",
    });
    expect(() =>
      service.update((current) => ({
        ...current,
        completed_tour_ids: ["memory-only-change"],
      })),
    ).toThrow(UserDataReadOnlyError);

    await expect(service.flush()).resolves.toBeUndefined();
    expect(storage.getItem(BROWSER_USER_DATA_KEY)).toBe(damaged);
  });

  it("uses the dedicated Tauri read and write commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const adapter = new TauriUserDataAdapter(
      async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return (
          command === "storage_read_user_data"
            ? {
                revision: 7,
                data: {
                  ...defaultUserData,
                  completed_tour_ids: ["editor-basics"],
                },
              }
            : command === "storage_read_user_field_asset"
              ? [1, 2, 3]
              : undefined
        ) as T;
      },
    );

    await expect(adapter.read()).resolves.toMatchObject({
      revision: 7,
      data: { completed_tour_ids: ["editor-basics"] },
    });
    await adapter.compareAndSwap(7, defaultUserData);
    await adapter.writeFieldAsset("field-a", new Uint8Array([1, 2, 3]));
    await expect(adapter.readFieldAsset("field-a")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await adapter.deleteFieldAsset("field-a");

    expect(calls).toEqual([
      { command: "storage_read_user_data", args: undefined },
      {
        command: "storage_compare_and_swap_user_data",
        args: { expectedRevision: 7, data: defaultUserData },
      },
      {
        command: "storage_write_user_field_asset",
        args: { entryId: "field-a", bytes: [1, 2, 3] },
      },
      {
        command: "storage_read_user_field_asset",
        args: { entryId: "field-a" },
      },
      {
        command: "storage_delete_user_field_asset",
        args: { entryId: "field-a" },
      },
    ]);
  });

  it("does not rewrite already-current User Data during initialization", async () => {
    const writes: UserData[] = [];
    const service = new UserDataService({
      async read() {
        return { revision: 1, data: structuredClone(defaultUserData) };
      },
      async compareAndSwap(expectedRevision, data) {
        writes.push(structuredClone(data));
        return { status: "written", revision: expectedRevision + 1 };
      },
      async writeFieldAsset() {},
      async readFieldAsset() {
        return null;
      },
      async deleteFieldAsset() {},
    });

    await service.initialize();
    await service.flush();

    expect(writes).toEqual([]);
  });

  it("rejects mutations during initialization and recovers on a later retry", async () => {
    const firstRead = deferred<void>();
    let reads = 0;
    let failRead = true;
    const adapter: UserDataAdapter = {
      async read() {
        reads += 1;
        if (reads === 1) {
          await firstRead.promise;
        }
        if (failRead) {
          throw new Error("storage temporarily unavailable");
        }
        return { revision: 3, data: structuredClone(defaultUserData) };
      },
      async compareAndSwap(expectedRevision) {
        return { status: "written", revision: expectedRevision + 1 };
      },
      async writeFieldAsset() {},
      async readFieldAsset() {
        return null;
      },
      async deleteFieldAsset() {},
    };
    const service = new UserDataService(adapter);
    const initializing = service.initialize();

    expect(service.getStatus().availability).toBe("initializing");
    expect(() => service.update((current) => current)).toThrow(
      UserDataReadOnlyError,
    );
    await expect(
      service.createFieldBackgroundFromBytes(fieldInput()),
    ).rejects.toBeInstanceOf(UserDataReadOnlyError);
    firstRead.resolve();
    await expect(initializing).rejects.toMatchObject({
      availability: "unavailable",
    });
    await expect(service.flush()).resolves.toBeUndefined();

    failRead = false;
    await expect(service.initialize()).resolves.toEqual(defaultUserData);
    expect(service.getStatus()).toEqual({
      availability: "ready",
      error: null,
      hasUnsavedChanges: false,
    });
    expect(reads).toBe(2);
  });

  it("serializes queued writes against the latest owned snapshot", async () => {
    const firstUpdateStarted = deferred<void>();
    const firstUpdate = deferred<void>();
    const writeOrder: string[][] = [];
    let writeCount = 0;
    const adapter: UserDataAdapter = {
      async read() {
        return null;
      },
      async compareAndSwap(expectedRevision, data) {
        writeCount += 1;
        writeOrder.push([...data.completed_tour_ids]);
        if (writeCount === 2) {
          firstUpdateStarted.resolve();
          await firstUpdate.promise;
        }
        return { status: "written", revision: expectedRevision + 1 };
      },
      async writeFieldAsset() {},
      async readFieldAsset() {
        return null;
      },
      async deleteFieldAsset() {},
    };
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();

    service.update((current) => ({
      ...current,
      completed_tour_ids: ["older"],
    }));
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["newer"],
    }));
    await firstUpdateStarted.promise;

    expect(writeOrder).toEqual([[], ["newer"]]);
    firstUpdate.resolve();
    await service.flush();
    expect(writeOrder).toEqual([[], ["newer"], ["newer"]]);
  });

  it("drains a User Data mutation that arrives during flush", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();
    const blocked = adapter.pauseNextMetadataWrite();

    service.update((current) => ({
      ...current,
      completed_tour_ids: ["first"],
    }));
    await blocked.started;
    const flushing = service.flush();
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["first", "during-flush"],
    }));
    blocked.release();

    await flushing;
    expect((adapter.persisted as UserData).completed_tour_ids).toEqual([
      "first",
      "during-flush",
    ]);
  });

  it("merges stale cross-instance Field metadata and layout writes", async () => {
    const adapter = new AssetMemoryAdapter();
    const fields = new UserDataService(adapter, {
      idFactory: () => "field-shared",
    });
    const preferences = new UserDataService(adapter);
    await Promise.all([fields.initialize(), preferences.initialize()]);
    await Promise.all([fields.flush(), preferences.flush()]);

    const entry = await fields.createFieldBackgroundFromBytes(fieldInput());
    preferences.update((current) => ({
      ...current,
      editor_layout: {
        ...current.editor_layout,
        inspector_width: 456,
      },
    }));
    await preferences.flush();
    await fields.updateFieldBackgroundMetadata(entry.id, {
      name: "Shared Practice Field",
    });

    expect(adapter.persisted).toMatchObject({
      editor_layout: { inspector_width: 456 },
      field_backgrounds: [{ id: entry.id, name: "Shared Practice Field" }],
    });
    expect(fields.getSnapshot().editor_layout.inspector_width).toBe(456);
  });

  it("merges concurrent Field metadata and geometry edits property-by-property", async () => {
    const adapter = new AssetMemoryAdapter();
    const creator = new UserDataService(adapter, {
      idFactory: () => "field-property-merge",
    });
    await creator.initialize();
    const entry = await creator.createFieldBackgroundFromBytes(fieldInput());
    const renaming = new UserDataService(adapter);
    const resizingLength = new UserDataService(adapter);
    const resizingWidth = new UserDataService(adapter);
    await Promise.all([
      renaming.initialize(),
      resizingLength.initialize(),
      resizingWidth.initialize(),
    ]);

    await renaming.updateFieldBackgroundMetadata(entry.id, {
      name: "Renamed Field",
    });
    await resizingLength.updateFieldBackgroundMetadata(entry.id, {
      geometry: {
        ...entry.geometry,
        length_meters: 14.25,
      },
    });
    await resizingWidth.updateFieldBackgroundMetadata(entry.id, {
      geometry: {
        ...entry.geometry,
        width_meters: 7.5,
      },
    });

    expect((adapter.persisted as UserData).field_backgrounds).toEqual([
      {
        ...entry,
        name: "Renamed Field",
        geometry: {
          ...entry.geometry,
          length_meters: 14.25,
          width_meters: 7.5,
        },
      },
    ]);
  });

  it("keeps unrelated concurrent Project view properties when a selection is removed", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: {
        project: { selected_field_background_id: "field-selected" },
      },
    });
    const removingSelection = new UserDataService(adapter);
    const navigating = new UserDataService(adapter);
    await Promise.all([
      removingSelection.initialize(),
      navigating.initialize(),
    ]);

    removingSelection.update((current) => ({
      ...current,
      project_views: {},
    }));
    await removingSelection.flush();
    navigating.update((current) => ({
      ...current,
      project_views: {
        project: {
          ...current.project_views.project,
          active_path_id: "path-concurrent",
        },
      },
    }));
    await navigating.flush();

    expect((adapter.persisted as UserData).project_views).toEqual({
      project: { active_path_id: "path-concurrent" },
    });
  });

  it("unions monotonic tour completion across stale instances", async () => {
    const adapter = new AssetMemoryAdapter();
    const first = new UserDataService(adapter);
    const second = new UserDataService(adapter);
    await Promise.all([first.initialize(), second.initialize()]);
    await Promise.all([first.flush(), second.flush()]);

    first.update((current) => ({
      ...current,
      completed_tour_ids: ["editor-basics"],
    }));
    second.update((current) => ({
      ...current,
      completed_tour_ids: ["field-setup"],
    }));
    await Promise.all([first.flush(), second.flush()]);

    expect((adapter.persisted as UserData).completed_tour_ids.sort()).toEqual([
      "editor-basics",
      "field-setup",
    ]);
  });

  it("does not resurrect deleted Field metadata from a stale preference write", async () => {
    const adapter = new AssetMemoryAdapter();
    const deleting = new UserDataService(adapter, {
      idFactory: () => "field-delete-shared",
    });
    const stale = new UserDataService(adapter);
    await Promise.all([deleting.initialize(), stale.initialize()]);
    await Promise.all([deleting.flush(), stale.flush()]);

    const entry = await deleting.createFieldBackgroundFromBytes(fieldInput());
    stale.update((current) => ({
      ...current,
      project_views: {
        project: { selected_field_background_id: entry.id },
      },
    }));
    await stale.flush();
    await deleting.deleteFieldBackground(entry.id);

    stale.update((current) => ({
      ...current,
      completed_tour_ids: ["stale-owner-tour"],
    }));
    await stale.flush();

    expect(adapter.persisted).toMatchObject({
      completed_tour_ids: ["stale-owner-tour"],
      field_backgrounds: [],
    });
    expect((adapter.persisted as UserData).project_views).toEqual({});
    expect(stale.getSnapshot().field_backgrounds).toEqual([]);
  });

  it("keeps initialization usable and recovers after its normalization write fails", async () => {
    const adapter = new RejectingAdapter({
      schema_version: 0,
      completed_tour_ids: ["editor-basics"],
    });
    adapter.rejectWrites = true;
    const service = new UserDataService(adapter);

    await expect(service.initialize()).rejects.toMatchObject({
      availability: "unavailable",
    });
    expect(() => service.update((current) => current)).toThrow(
      UserDataReadOnlyError,
    );
    await expect(service.flush()).resolves.toBeUndefined();

    adapter.rejectWrites = false;
    await expect(service.initialize()).resolves.toMatchObject({
      completed_tour_ids: ["editor-basics"],
    });
    await expect(service.flush()).resolves.toBeUndefined();
    expect(adapter.persisted?.completed_tour_ids).toEqual(["editor-basics"]);
  });

  it("exports preference and per-Project navigation helpers", async () => {
    const storage = new MemoryStorage();
    await initializeUserData(browserWebCapabilities, {
      browserStorage: storage,
    });

    rememberEditorLayoutPreferences({
      inspector_tab: "constraints",
      inspector_width: 401,
      show_ghost_paths: false,
    });
    rememberCompletedTourIds(["editor-basics"]);
    rememberAutomaticGenerationKeepInSync(false);
    rememberActivePath("project-a", "path-a");
    rememberSelectedFieldBackground("project-a", "field-2026");

    expect(readEditorLayoutPreferences()).toEqual({
      inspector_tab: "constraints",
      inspector_width: 401,
      show_ghost_paths: false,
    });
    expect(readUserData().completed_tour_ids).toEqual(["editor-basics"]);
    expect(readUserData().automatic_generation.keep_in_sync).toBe(false);
    expect(activePathForProject("project-a", "fallback")).toBe("path-a");
    expect(activePathForProject("project-b", "fallback")).toBe("fallback");
    expect(selectedFieldBackgroundForProject("project-a", "fallback")).toBe(
      "field-2026",
    );
    await flushUserData();

    expect(JSON.parse(storage.getItem(BROWSER_USER_DATA_KEY)!)).toMatchObject({
      project_views: {
        "project-a": {
          active_path_id: "path-a",
          selected_field_background_id: "field-2026",
        },
      },
    });
  });

  it("durably re-keys a legacy Project view and translates its active Path", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: {
        "/autos/competition": {
          active_path_id: "three-piece.json",
          selected_field_background_id: "field-2026",
        },
      },
    });
    const service = new UserDataService(adapter);
    await service.initialize();
    adapter.events.length = 0;

    await service.migrateProjectViewIdentity(
      "/autos/competition",
      "project-stable",
      { "three-piece.json": "path-stable" },
    );

    expect(adapter.events).toEqual(["metadata-write", "metadata-write"]);
    expect(service.getSnapshot().project_views).toEqual({
      "project-stable": {
        active_path_id: "path-stable",
        selected_field_background_id: "field-2026",
      },
    });
    expect((adapter.persisted as UserData).project_views).toEqual(
      service.getSnapshot().project_views,
    );
  });

  it("merges a concurrent preference update into Project view identity migration", async () => {
    const firstMigrationWrite = deferred<void>();
    const releaseMigrationWrite = deferred<void>();
    let persisted: UserData = {
      ...defaultUserData,
      project_views: { legacy: { active_path_id: "old.json" } },
    };
    let metadataWriteCount = 0;
    const adapter: UserDataAdapter = {
      async read() {
        return {
          revision: metadataWriteCount,
          data: structuredClone(persisted),
        };
      },
      async compareAndSwap(expectedRevision, data) {
        metadataWriteCount += 1;
        if (metadataWriteCount === 2) {
          firstMigrationWrite.resolve();
          await releaseMigrationWrite.promise;
        }
        persisted = structuredClone(data);
        return { status: "written", revision: expectedRevision + 1 };
      },
      async writeFieldAsset() {},
      async readFieldAsset() {
        return null;
      },
      async deleteFieldAsset() {},
    };
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();

    const migration = service.migrateProjectViewIdentity("legacy", "stable", {
      "old.json": "path-stable",
    });
    await firstMigrationWrite.promise;
    service.update((current) => ({
      ...current,
      project_views: {
        ...current.project_views,
        unrelated: { active_path_id: "path-unrelated" },
      },
    }));
    releaseMigrationWrite.resolve();

    await migration;
    await service.flush();

    expect(service.getSnapshot().project_views).toEqual({
      stable: { active_path_id: "path-stable" },
      unrelated: { active_path_id: "path-unrelated" },
    });
    expect(persisted).toEqual(service.getSnapshot());
  });

  it("clears an obsolete preference failure after a verified full migration write", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: { legacy: { active_path_id: "old.json" } },
    });
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();

    adapter.failMetadataWrite = true;
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["editor-basics"],
    }));
    await expect(service.flush()).rejects.toThrow("metadata write failed");

    adapter.failMetadataWrite = false;
    await service.migrateProjectViewIdentity("legacy", "stable", {
      "old.json": "path-stable",
    });

    await expect(service.flush()).resolves.toBeUndefined();
    expect(adapter.persisted).toEqual(service.getSnapshot());
  });

  it("keeps an existing stable Project view when retrying identity migration", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: {
        legacy: {
          active_path_id: "old.json",
          selected_field_background_id: "field-old",
        },
        stable: {
          active_path_id: "path-new",
          selected_field_background_id: "field-new",
        },
      },
    });
    const service = new UserDataService(adapter);
    await service.initialize();

    await service.migrateProjectViewIdentity("legacy", "stable", {});

    expect(service.getSnapshot().project_views).toEqual({
      stable: {
        active_path_id: "path-new",
        selected_field_background_id: "field-new",
      },
    });
  });

  it("never deletes a legacy Project view before the stable copy is durable", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: {
        legacy: { active_path_id: "old.json" },
      },
    });
    const service = new UserDataService(adapter);
    await service.initialize();
    adapter.failMetadataWrite = true;

    await expect(
      service.migrateProjectViewIdentity("legacy", "stable", {
        "old.json": "path-stable",
      }),
    ).rejects.toThrow("metadata write failed");

    expect((adapter.persisted as UserData).project_views).toEqual({
      legacy: { active_path_id: "old.json" },
    });
    expect(service.getSnapshot().project_views).toEqual({
      legacy: { active_path_id: "old.json" },
    });

    adapter.failMetadataWrite = false;
    await service.migrateProjectViewIdentity("legacy", "stable", {
      "old.json": "path-stable",
    });
    expect(service.getSnapshot().project_views).toEqual({
      stable: { active_path_id: "path-stable" },
    });
  });

  it("retains an unmappable legacy active Path for a later migration", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: { legacy: { active_path_id: "missing.json" } },
    });
    const service = new UserDataService(adapter);
    await service.initialize();

    await expect(
      service.migrateProjectViewIdentity("legacy", "stable", {}),
    ).rejects.toBeInstanceOf(ProjectViewMigrationError);
    expect(service.getSnapshot().project_views).toEqual({
      legacy: { active_path_id: "missing.json" },
    });
    expect((adapter.persisted as UserData).project_views).toEqual(
      service.getSnapshot().project_views,
    );
  });

  it("excludes transient and session-only fields from durable User Data", async () => {
    const storage = new MemoryStorage();
    const service = new UserDataService(
      new BrowserUserDataAdapter({ storage }),
    );
    await service.initialize();

    service.update((current) => ({
      ...current,
      selection: { waypoint_id: "waypoint-a" },
      dialogs: { project_config: true },
      dirty: true,
      operation: "dragging",
      active_tour_id: "editor-basics",
      tour_step_index: 2,
      history: ["undo-entry"],
    }));
    await service.flush();

    const persisted = JSON.parse(storage.getItem(BROWSER_USER_DATA_KEY)!);
    expect(persisted).not.toHaveProperty("selection");
    expect(persisted).not.toHaveProperty("dialogs");
    expect(persisted).not.toHaveProperty("dirty");
    expect(persisted).not.toHaveProperty("operation");
    expect(persisted).not.toHaveProperty("active_tour_id");
    expect(persisted).not.toHaveProperty("tour_step_index");
    expect(persisted).not.toHaveProperty("history");
  });

  it("imports identical bytes as independent entries and supports metadata updates", async () => {
    const adapter = new AssetMemoryAdapter();
    const ids = ["field-a", "field-b"];
    const service = new UserDataService(adapter, {
      idFactory: () => ids.shift()!,
      clock: () => new Date("2026-08-21T12:00:00.000Z"),
    });
    await service.initialize();

    const first = await service.createFieldBackgroundFromBytes(fieldInput());
    const second = await service.createFieldBackgroundFromBytes(fieldInput());
    const updated = await service.updateFieldBackgroundMetadata(first.id, {
      name: "Renamed Field",
    });

    expect([first.id, second.id]).toEqual(["field-a", "field-b"]);
    expect(first).toMatchObject({
      id: "field-a",
      name: "Practice Field",
      file_name: "practice.png",
      mime_type: "image/png",
      size_bytes: 4,
      created_at: "2026-08-21T12:00:00.000Z",
    });
    expect(updated.name).toBe("Renamed Field");
    expect(adapter.assets.get("field-a")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(adapter.assets.get("field-b")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(service.getSnapshot().field_backgrounds).toHaveLength(2);
  });

  it("rebases a metadata update over concurrent preferences", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-update-race",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());
    const blocked = adapter.pauseNextMetadataWrite();

    const updating = service.updateFieldBackgroundMetadata(entry.id, {
      name: "Updated Field",
    });
    await blocked.started;
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["concurrent-tour"],
    }));
    blocked.release();

    await updating;
    await service.flush();
    expect(service.getSnapshot()).toMatchObject({
      completed_tour_ids: ["concurrent-tour"],
      field_backgrounds: [{ id: entry.id, name: "Updated Field" }],
    });
    expect(adapter.persisted).toEqual(service.getSnapshot());
  });

  it("rebases field creation over concurrent navigation preferences", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-create-race",
    });
    await service.initialize();
    await service.flush();
    const blocked = adapter.pauseNextMetadataWrite();

    const creating = service.createFieldBackgroundFromBytes(fieldInput());
    await blocked.started;
    service.update((current) => ({
      ...current,
      project_views: {
        ...current.project_views,
        concurrent: { active_path_id: "path-concurrent" },
      },
    }));
    blocked.release();

    const entry = await creating;
    await service.flush();
    expect(service.getSnapshot()).toMatchObject({
      project_views: {
        concurrent: { active_path_id: "path-concurrent" },
      },
      field_backgrounds: [{ id: entry.id }],
    });
    expect(adapter.persisted).toEqual(service.getSnapshot());
  });

  it("rebases field deletion over concurrent preferences without restoring its selection", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-delete-race",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());
    service.update((current) => ({
      ...current,
      project_views: {
        project: {
          active_path_id: "path-existing",
          selected_field_background_id: entry.id,
        },
      },
    }));
    await service.flush();
    const blocked = adapter.pauseNextMetadataWrite();

    const deleting = service.deleteFieldBackground(entry.id);
    await blocked.started;
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["concurrent-tour"],
    }));
    blocked.release();

    await deleting;
    await service.flush();
    expect(service.getSnapshot()).toMatchObject({
      completed_tour_ids: ["concurrent-tour"],
      project_views: { project: { active_path_id: "path-existing" } },
      field_backgrounds: [],
    });
    expect(adapter.persisted).toEqual(service.getSnapshot());
  });

  it.each(["asset-write", "readback", "metadata-write"] as const)(
    "%s failure leaves no Field Background metadata exposed",
    async (failure) => {
      const adapter = new AssetMemoryAdapter();
      const service = new UserDataService(adapter, {
        idFactory: () => `field-${failure}`,
      });
      await service.initialize();
      if (failure === "asset-write") {
        adapter.failAssetWrite = true;
      } else if (failure === "readback") {
        adapter.readbackOverride = new Uint8Array([9]);
      } else {
        adapter.failMetadataWrite = true;
      }

      await expect(
        service.createFieldBackgroundFromBytes(fieldInput()),
      ).rejects.toThrow();

      expect(service.getSnapshot().field_backgrounds).toEqual([]);
      expect(adapter.assets.size).toBe(0);
    },
  );

  it("adopts Field Background metadata when its write commits before throwing", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();
    adapter.installMetadataThenThrow = true;

    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "ambiguous-create",
    );

    expect(service.getSnapshot().field_backgrounds).toEqual([entry]);
    expect(adapter.persisted).toEqual(service.getSnapshot());
    expect(adapter.assets.get(entry.id)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(adapter.events.at(-1)).toBe("metadata-read");
  });

  it("preserves ambiguous Field Background bytes and permits deterministic recovery", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    await service.flush();
    adapter.failMetadataWrite = true;
    adapter.failMetadataReadAt = adapter.metadataReadCount + 1;

    await expect(
      service.migrateLegacyFieldBackgroundFromBytes(
        fieldInput(),
        "ambiguous-unreadable",
      ),
    ).rejects.toThrow("metadata write failed");
    expect(adapter.assets.size).toBe(1);

    adapter.failMetadataWrite = false;
    adapter.failMetadataReadAt = undefined;
    const recovered = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "ambiguous-unreadable",
    );

    expect(service.getSnapshot().field_backgrounds).toEqual([recovered]);
    expect(adapter.assets.get(recovered.id)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("retains an ambiguous ordinary create ID reservation", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-ambiguous-ordinary",
    });
    await service.initialize();
    await service.flush();
    adapter.failMetadataWrite = true;
    adapter.failMetadataReadAt = adapter.metadataReadCount + 1;

    await expect(
      service.createFieldBackgroundFromBytes(fieldInput()),
    ).rejects.toThrow("metadata write failed");
    adapter.failMetadataWrite = false;
    adapter.failMetadataReadAt = undefined;

    await expect(
      service.createFieldBackgroundFromBytes({
        ...fieldInput(),
        bytes: new Uint8Array([9, 9, 9, 9]),
      }),
    ).rejects.toThrow("Could not allocate a unique Field Background ID");
    expect(adapter.assets.get("field-ambiguous-ordinary")).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("reconciles ambiguous metadata update and deletion writes", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-ambiguous",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());

    adapter.installMetadataThenThrow = true;
    await expect(
      service.updateFieldBackgroundMetadata(entry.id, { name: "Committed" }),
    ).resolves.toMatchObject({ name: "Committed" });

    adapter.installMetadataThenThrow = true;
    await expect(
      service.deleteFieldBackground(entry.id),
    ).resolves.toBeUndefined();
    expect(service.getSnapshot().field_backgrounds).toEqual([]);
    expect(adapter.assets.has(entry.id)).toBe(false);
  });

  it("can retry a failed deterministic legacy import without duplicating it", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    adapter.readbackOverride = new Uint8Array([9]);

    await expect(
      service.migrateLegacyFieldBackgroundFromBytes(fieldInput(), "source-a"),
    ).rejects.toBeInstanceOf(FieldBackgroundAssetVerificationError);

    adapter.readbackOverride = undefined;
    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "source-a",
    );
    const retried = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "source-a",
    );

    expect(retried).toEqual(entry);
    expect(service.getSnapshot().field_backgrounds).toEqual([entry]);
  });

  it("converges stale deterministic imports on the CAS winner", async () => {
    const adapter = new AssetMemoryAdapter();
    const winner = new UserDataService(adapter, {
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
    });
    const stale = new UserDataService(adapter, {
      clock: () => new Date("2026-08-22T12:00:01.000Z"),
    });
    await Promise.all([winner.initialize(), stale.initialize()]);
    await Promise.all([winner.flush(), stale.flush()]);

    const first =
      await winner.migrateLegacyFieldBackgroundFromBytesWithOwnership(
        fieldInput(),
        "shared-source",
      );
    const second =
      await stale.migrateLegacyFieldBackgroundFromBytesWithOwnership(
        fieldInput(),
        "shared-source",
      );

    expect(first.created).toBe(true);
    expect(second).toEqual({ entry: first.entry, created: false });
    expect((adapter.persisted as UserData).field_backgrounds).toEqual([
      first.entry,
    ]);
  });

  it("repairs missing migrated bytes without creating another entry", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "source-a",
    );
    adapter.assets.delete(entry.id);

    const repaired = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "source-a",
    );

    expect(repaired).toEqual(entry);
    expect(adapter.assets.get(entry.id)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(service.getSnapshot().field_backgrounds).toEqual([entry]);
  });

  it("recognizes a durable deterministic migration after its legacy source is gone", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "source-a",
    );

    await expect(
      service.findVerifiedLegacyFieldBackground("source-a"),
    ).resolves.toEqual(entry);

    adapter.assets.delete(entry.id);
    await expect(
      service.findVerifiedLegacyFieldBackground("source-a"),
    ).rejects.toBeInstanceOf(FieldBackgroundAssetVerificationError);
  });

  it("preserves metadata when referenced image bytes are missing", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-missing",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());
    adapter.assets.delete(entry.id);

    await expect(
      service.readFieldBackgroundImage(entry.id),
    ).resolves.toBeNull();
    expect(service.getSnapshot().field_backgrounds).toEqual([entry]);
  });

  it("durably removes metadata and selections before deleting bytes", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "field-delete",
    );
    service.update((current) => ({
      ...current,
      project_views: {
        "project-a": {
          active_path_id: "path-a",
          selected_field_background_id: entry.id,
        },
        "project-b": { selected_field_background_id: entry.id },
      },
    }));
    await service.flush();
    adapter.events.length = 0;
    adapter.failAssetDelete = true;

    await expect(service.deleteFieldBackground(entry.id)).rejects.toThrow(
      "asset delete failed",
    );

    expect(adapter.events).toEqual(["metadata-write", "asset-delete"]);
    expect(service.getSnapshot().field_backgrounds).toEqual([]);
    expect(service.getSnapshot().project_views).toEqual({
      "project-a": { active_path_id: "path-a" },
    });
    expect(adapter.assets.has(entry.id)).toBe(true);

    adapter.failAssetDelete = false;
    const reimported = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "field-delete",
    );
    expect(reimported.id).toBe(entry.id);
    expect(adapter.assets.get(entry.id)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("releases a deleted deterministic Field Background ID for reimport", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter);
    await service.initialize();
    const entry = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "delete-reimport",
    );

    await service.deleteFieldBackground(entry.id);
    const reimported = await service.migrateLegacyFieldBackgroundFromBytes(
      fieldInput(),
      "delete-reimport",
    );

    expect(reimported.id).toBe(entry.id);
    expect(service.getSnapshot().field_backgrounds).toEqual([reimported]);
  });

  it("does not delete bytes when durable metadata removal fails", async () => {
    const adapter = new AssetMemoryAdapter();
    const service = new UserDataService(adapter, {
      idFactory: () => "field-retained",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());
    adapter.events.length = 0;
    adapter.failMetadataWrite = true;

    await expect(service.deleteFieldBackground(entry.id)).rejects.toThrow(
      "metadata write failed",
    );

    expect(adapter.events).toEqual(["metadata-write", "metadata-read"]);
    expect(service.getSnapshot().field_backgrounds).toEqual([entry]);
    expect(adapter.assets.has(entry.id)).toBe(true);
  });

  it("keeps future and unreadable stores read-only for asset operations", async () => {
    for (const adapter of [
      new AssetMemoryAdapter({ schema_version: 99 }),
      new UnreadableAssetAdapter(),
    ]) {
      const service = new UserDataService(adapter, {
        idFactory: () => "field-read-only",
      });
      await expect(service.initialize()).rejects.toBeDefined();

      await expect(
        service.createFieldBackgroundFromBytes(fieldInput()),
      ).rejects.toBeInstanceOf(UserDataReadOnlyError);
      expect(adapter.assets.size).toBe(0);
    }
  });

  it("migrates imported legacy calibrations directly into verified User Data", async () => {
    let persisted: UserData | null = null;
    let revision = 0;
    const assets = new Map<string, number[]>();
    let failNextAssetDelete = false;
    let assetWriteCount = 0;
    let failAssetWriteAt = -1;
    await initializeUserData(tauriCapabilities, {
      tauriInvoke: async <T>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T> => {
        if (command === "storage_read_user_data") {
          return (
            persisted === null
              ? null
              : { revision, data: structuredClone(persisted) }
          ) as T;
        }
        if (command === "storage_compare_and_swap_user_data") {
          if (args?.expectedRevision !== revision && persisted) {
            return {
              status: "conflict",
              document: { revision, data: structuredClone(persisted) },
            } as T;
          }
          persisted = structuredClone(args?.data as UserData);
          revision += 1;
          return { status: "written", revision } as T;
        }
        if (command === "storage_write_user_field_asset") {
          assetWriteCount += 1;
          if (assetWriteCount === failAssetWriteAt) {
            throw new Error("asset write failed");
          }
          assets.set(String(args?.entryId), [...(args?.bytes as number[])]);
          return undefined as T;
        }
        if (command === "storage_read_user_field_asset") {
          return (assets.get(String(args?.entryId)) ?? null) as T;
        }
        if (command === "storage_delete_user_field_asset") {
          if (failNextAssetDelete) {
            failNextAssetDelete = false;
            throw new Error("asset delete failed");
          }
          assets.delete(String(args?.entryId));
          return undefined as T;
        }
        throw new Error(`Unexpected User Data command: ${command}`);
      },
    });
    const bytes = bytesFromHex("1c28f8fefd4cb39e");
    const first = legacyField("wide-calibration", "shared-asset", 0.25);
    const second = legacyField("tight-calibration", "shared-asset", 0.75);

    const firstRun = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: second.id,
      entries: [
        { field: first, bytes },
        { field: second, bytes },
      ],
    });
    const firstSnapshot = readUserData();
    const secondRun = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: second.id,
      entries: [
        { field: first, bytes },
        { field: second, bytes },
      ],
    });

    expect(firstRun.errors).toEqual([]);
    expect(secondRun.errors).toEqual([]);
    expect(readUserData().field_backgrounds).toEqual(
      firstSnapshot.field_backgrounds,
    );
    expect(firstSnapshot.field_backgrounds).toHaveLength(2);
    expect(firstSnapshot.field_backgrounds[0]?.id).not.toBe(
      firstSnapshot.field_backgrounds[1]?.id,
    );
    expect(
      firstSnapshot.field_backgrounds.map((field) => field.geometry),
    ).toEqual(
      [first.geometry, second.geometry].map((geometry) => ({
        ...geometry,
        coordinate_offset_x_meters: geometry.coordinate_offset_meters,
        coordinate_offset_y_meters: geometry.coordinate_offset_meters,
      })),
    );
    expect(assets.size).toBe(2);
    expect(
      firstSnapshot.project_views["project-imported"]
        ?.selected_field_background_id,
    ).toBe(firstSnapshot.field_backgrounds[1]?.id);

    await secondRun.rollback();
    expect(readUserData().field_backgrounds).toEqual(
      firstSnapshot.field_backgrounds,
    );
    expect(assets.size).toBe(2);

    const replacement = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: second.id,
      entries: [
        { field: first, bytes: bytesFromHex("8696a25575595d14") },
        { field: second, bytes: bytesFromHex("8696a25575595d14") },
      ],
    });
    const replacementSnapshot = readUserData();

    expect(replacement.errors).toEqual([]);
    expect(replacementSnapshot.field_backgrounds).toHaveLength(4);
    expect(assets.size).toBe(4);
    expect(
      replacementSnapshot.project_views["project-imported"]
        ?.selected_field_background_id,
    ).toBe(replacementSnapshot.field_backgrounds[3]?.id);
    expect(replacementSnapshot.field_backgrounds[3]?.id).not.toBe(
      firstSnapshot.field_backgrounds[1]?.id,
    );

    const unrelated = await importFieldBackgroundFromBytes({
      ...fieldInput(),
      name: "Concurrent Field",
    });
    rememberCompletedTourIds(["concurrent-tour"]);
    await flushUserData();

    failNextAssetDelete = true;
    await expect(replacement.rollback()).rejects.toThrow("asset delete failed");
    const recoveredReplacement = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: second.id,
      entries: [
        { field: first, bytes: bytesFromHex("8696a25575595d14") },
        { field: second, bytes: bytesFromHex("8696a25575595d14") },
      ],
    });
    expect(recoveredReplacement.errors).toEqual([]);
    await recoveredReplacement.rollback();
    await recoveredReplacement.rollback();

    expect(readUserData()).toMatchObject({
      completed_tour_ids: ["concurrent-tour"],
      project_views: {
        "project-imported": {
          selected_field_background_id: firstSnapshot.field_backgrounds[1]?.id,
        },
      },
    });
    expect(readUserData().field_backgrounds).toEqual([
      ...firstSnapshot.field_backgrounds,
      unrelated,
    ]);
    expect(assets.size).toBe(3);

    const retriedReplacement = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: second.id,
      entries: [
        { field: first, bytes: bytesFromHex("8696a25575595d14") },
        { field: second, bytes: bytesFromHex("8696a25575595d14") },
      ],
    });
    rememberSelectedFieldBackground("project-imported", "blank-grid");
    await flushUserData();
    await retriedReplacement.rollback();

    expect(
      readUserData().project_views["project-imported"]
        ?.selected_field_background_id,
    ).toBe("blank-grid");
    expect(readUserData().field_backgrounds).toEqual([
      ...firstSnapshot.field_backgrounds,
      unrelated,
    ]);

    const partialFirst = legacyField("partial-first", "partial-a", 0.1);
    const partialSecond = legacyField("partial-second", "partial-b", 0.2);
    failAssetWriteAt = assetWriteCount + 2;
    const partial = await migrateImportedLegacyFieldBackgrounds({
      projectId: "project-imported",
      selectedFieldId: partialFirst.id,
      entries: [
        { field: partialFirst, bytes: new Uint8Array([20]) },
        { field: partialSecond, bytes: new Uint8Array([21]) },
      ],
    });

    expect(partial.errors).toHaveLength(1);
    expect(readUserData().field_backgrounds).toHaveLength(4);
    await partial.rollback();
    expect(readUserData().field_backgrounds).toEqual([
      ...firstSnapshot.field_backgrounds,
      unrelated,
    ]);
    expect(
      readUserData().project_views["project-imported"]
        ?.selected_field_background_id,
    ).toBe("blank-grid");
    expect(assets.size).toBe(3);

    expect(persisted).toEqual(readUserData());
  });

  it("remaps a copied Project-scoped field selection without replacing valid selections", async () => {
    let persisted: UserData | null = null;
    let revision = 0;
    const assets = new Map<string, number[]>();
    await initializeUserData(tauriCapabilities, {
      tauriInvoke: async <T>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T> => {
        if (command === "storage_read_user_data") {
          return (
            persisted === null
              ? null
              : { revision, data: structuredClone(persisted) }
          ) as T;
        }
        if (command === "storage_compare_and_swap_user_data") {
          if (args?.expectedRevision !== revision && persisted) {
            return {
              status: "conflict",
              document: { revision, data: structuredClone(persisted) },
            } as T;
          }
          persisted = structuredClone(args?.data as UserData);
          revision += 1;
          return { status: "written", revision } as T;
        }
        if (command === "storage_write_user_field_asset") {
          assets.set(String(args?.entryId), [...(args?.bytes as number[])]);
          return undefined as T;
        }
        if (command === "storage_read_user_field_asset") {
          return (assets.get(String(args?.entryId)) ?? null) as T;
        }
        if (command === "storage_delete_user_field_asset") {
          assets.delete(String(args?.entryId));
          return undefined as T;
        }
        throw new Error(`Unexpected User Data command: ${command}`);
      },
    });

    const field = legacyField("legacy-selection", "legacy-asset", 0.5);
    const bytes = new Uint8Array([4, 5, 6]);
    const project = createProject({
      project_id: "stable-project",
      display_name: "Stable",
      config: {
        gui: {
          field: {
            selected_field_id: field.id,
            custom_fields: [field],
          },
        },
      },
    });
    const projectIo = {
      readLegacyFieldImageAsset: async () =>
        new Blob([bytes], { type: "image/png" }),
      deleteLegacyFieldImageAsset: async () => {},
    } as unknown as ProjectIoService;

    rememberSelectedFieldBackground("legacy-project", field.id);
    await flushUserData();
    await migrateProjectViewIdentity("legacy-project", "stable-project", {});
    expect(selectedFieldBackgroundForProject("stable-project")).toBe(field.id);

    const migrated = await migrateLegacyProjectFieldBackgrounds(
      project,
      projectIo,
    );
    const migratedId = readUserData().field_backgrounds[0]?.id;
    expect(migrated.errors).toEqual([]);
    expect(migratedId).toBeTruthy();
    expect(selectedFieldBackgroundForProject("stable-project")).toBe(
      migratedId,
    );

    rememberSelectedFieldBackground("stable-project", "blank-grid");
    await flushUserData();
    await migrateLegacyProjectFieldBackgrounds(project, projectIo);
    expect(selectedFieldBackgroundForProject("stable-project")).toBe(
      "blank-grid",
    );

    rememberSelectedFieldBackground("stable-project", migratedId!);
    await flushUserData();
    await migrateLegacyProjectFieldBackgrounds(project, projectIo);
    expect(selectedFieldBackgroundForProject("stable-project")).toBe(
      migratedId,
    );
    expect(persisted).toEqual(readUserData());
  });
});

class MemoryStorage implements UserDataStorage {
  private readonly records = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.records.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.records.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.records.set(key, value);
  }
}

class RejectingAdapter implements UserDataAdapter {
  persisted: UserData | null = null;
  revision = 0;
  rejectWrites = false;

  constructor(private readonly initial: unknown | null = null) {}

  async read() {
    const data = this.persisted ?? this.initial;
    return data === null
      ? null
      : { revision: this.revision, data: structuredClone(data) };
  }

  async compareAndSwap(expectedRevision: number, data: UserData) {
    if (this.rejectWrites) {
      throw new Error("quota exceeded");
    }
    if (expectedRevision !== this.revision) {
      return {
        status: "conflict" as const,
        document: {
          revision: this.revision,
          data: structuredClone(this.persisted ?? this.initial),
        },
      };
    }
    this.persisted = structuredClone(data);
    this.revision += 1;
    return { status: "written" as const, revision: this.revision };
  }

  async writeFieldAsset(): Promise<void> {}

  async readFieldAsset(): Promise<null> {
    return null;
  }

  async deleteFieldAsset(): Promise<void> {}
}

class AssetMemoryAdapter implements UserDataAdapter {
  persisted: unknown | null;
  revision = 0;
  readonly assets = new Map<string, Uint8Array>();
  readonly events: string[] = [];
  failAssetWrite = false;
  failMetadataWrite = false;
  installMetadataThenThrow = false;
  failAssetDelete = false;
  readbackOverride: Uint8Array | null | undefined;
  metadataReadCount = 0;
  failMetadataReadAt: number | undefined;
  private metadataWritePause: {
    started: Deferred<void>;
    release: Deferred<void>;
  } | null = null;

  constructor(persisted: unknown | null = null) {
    this.persisted = persisted;
  }

  async read() {
    this.events.push("metadata-read");
    this.metadataReadCount += 1;
    if (this.metadataReadCount === this.failMetadataReadAt) {
      throw new Error("metadata read failed");
    }
    return this.persisted === null
      ? null
      : { revision: this.revision, data: structuredClone(this.persisted) };
  }

  async compareAndSwap(expectedRevision: number, data: UserData) {
    this.events.push("metadata-write");
    const pause = this.metadataWritePause;
    if (pause) {
      this.metadataWritePause = null;
      pause.started.resolve();
      await pause.release.promise;
    }
    if (this.failMetadataWrite) {
      throw new Error("metadata write failed");
    }
    if (expectedRevision !== this.revision) {
      if (this.persisted === null) {
        throw new Error("missing conflict document");
      }
      return {
        status: "conflict" as const,
        document: {
          revision: this.revision,
          data: structuredClone(this.persisted),
        },
      };
    }
    this.persisted = structuredClone(data);
    this.revision += 1;
    if (this.installMetadataThenThrow) {
      this.installMetadataThenThrow = false;
      throw new Error("metadata write outcome unknown");
    }
    return { status: "written" as const, revision: this.revision };
  }

  pauseNextMetadataWrite(): {
    started: Promise<void>;
    release(): void;
  } {
    const started = deferred<void>();
    const release = deferred<void>();
    this.metadataWritePause = { started, release };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  async writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void> {
    this.events.push("asset-write");
    if (this.failAssetWrite) {
      throw new Error("asset write failed");
    }
    this.assets.set(entryId, new Uint8Array(bytes));
  }

  async readFieldAsset(entryId: string): Promise<Uint8Array | null> {
    this.events.push("asset-read");
    if (this.readbackOverride !== undefined) {
      return this.readbackOverride === null
        ? null
        : new Uint8Array(this.readbackOverride);
    }
    const bytes = this.assets.get(entryId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async deleteFieldAsset(entryId: string): Promise<void> {
    this.events.push("asset-delete");
    if (this.failAssetDelete) {
      throw new Error("asset delete failed");
    }
    this.assets.delete(entryId);
  }
}

class UnreadableAssetAdapter extends AssetMemoryAdapter {
  override async read(): Promise<never> {
    throw new Error("unreadable");
  }
}

function fieldInput(): CreateFieldBackgroundInput {
  return {
    name: "Practice Field",
    fileName: "practice.png",
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3, 4]),
    geometry: {
      length_meters: 16.54,
      width_meters: 8.21,
      coordinate_offset_meters: 0.5,
      coordinate_offset_x_meters: 0.25,
      coordinate_offset_y_meters: 0.5,
    },
  };
}

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function legacyField(
  id: string,
  assetId: string,
  coordinateOffset: number,
): CustomFieldImage {
  return {
    id,
    name: id,
    asset_id: assetId,
    file_name: "shared.png",
    mime_type: "image/png",
    size_bytes: 3,
    created_at: "2026-08-21T12:00:00.000Z",
    geometry: {
      length_meters: 16.54,
      width_meters: 8.21,
      coordinate_offset_meters: coordinateOffset,
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
