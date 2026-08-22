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

    await service.initialize();
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["memory-only-change"],
    }));
    await service.flush();

    expect(service.getSnapshot().completed_tour_ids).toEqual([
      "memory-only-change",
    ]);
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

    await service.initialize();
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["memory-only-change"],
    }));
    await service.flush();

    expect(service.getSnapshot().completed_tour_ids).toEqual([
      "memory-only-change",
    ]);
    expect(storage.getItem(BROWSER_USER_DATA_KEY)).toBe(malformed);
  });

  it("uses the dedicated Tauri read and write commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const adapter = new TauriUserDataAdapter(
      async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return (
          command === "storage_read_user_data"
            ? { ...defaultUserData, completed_tour_ids: ["editor-basics"] }
            : command === "storage_read_user_field_asset"
              ? [1, 2, 3]
              : undefined
        ) as T;
      },
    );

    await expect(adapter.read()).resolves.toMatchObject({
      completed_tour_ids: ["editor-basics"],
    });
    await adapter.write(defaultUserData);
    await adapter.writeFieldAsset("field-a", new Uint8Array([1, 2, 3]));
    await expect(adapter.readFieldAsset("field-a")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await adapter.deleteFieldAsset("field-a");

    expect(calls).toEqual([
      { command: "storage_read_user_data", args: undefined },
      { command: "storage_write_user_data", args: { data: defaultUserData } },
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

  it("serializes writes so an older snapshot cannot finish last", async () => {
    const firstUpdate = deferred<void>();
    const writeOrder: string[][] = [];
    let writeCount = 0;
    const adapter: UserDataAdapter = {
      async read() {
        return null;
      },
      async write(data) {
        writeCount += 1;
        writeOrder.push([...data.completed_tour_ids]);
        if (writeCount === 2) {
          await firstUpdate.promise;
        }
      },
      async writeFieldAsset() {},
      async readFieldAsset() {
        return null;
      },
      async deleteFieldAsset() {},
    };
    const service = new UserDataService(adapter);
    await service.initialize();

    service.update((current) => ({
      ...current,
      completed_tour_ids: ["older"],
    }));
    service.update((current) => ({
      ...current,
      completed_tour_ids: ["newer"],
    }));
    await Promise.resolve();

    expect(writeOrder).toEqual([[], ["older"]]);
    firstUpdate.resolve();
    await service.flush();
    expect(writeOrder).toEqual([[], ["older"], ["newer"]]);
  });

  it("retains the in-memory snapshot after a durable write fails", async () => {
    const service = new UserDataService(new RejectingAdapter());
    await service.initialize();

    service.update((current) => ({
      ...current,
      completed_tour_ids: ["editor-basics"],
    }));

    await expect(service.flush()).resolves.toBeUndefined();
    expect(service.getSnapshot().completed_tour_ids).toEqual(["editor-basics"]);
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

    expect(adapter.events).toEqual([
      "metadata-write",
      "metadata-read",
      "metadata-write",
      "metadata-read",
    ]);
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

  it("never deletes a legacy Project view before the stable copy verifies", async () => {
    const adapter = new AssetMemoryAdapter({
      ...defaultUserData,
      project_views: {
        legacy: { active_path_id: "old.json" },
      },
    });
    const service = new UserDataService(adapter);
    await service.initialize();
    adapter.failMetadataReadAt = 2;

    await expect(
      service.migrateProjectViewIdentity("legacy", "stable", {
        "old.json": "path-stable",
      }),
    ).rejects.toThrow("metadata read failed");

    expect((adapter.persisted as UserData).project_views).toEqual({
      legacy: { active_path_id: "old.json" },
      stable: { active_path_id: "path-stable" },
    });
    expect(service.getSnapshot().project_views).toEqual({
      legacy: { active_path_id: "old.json" },
    });

    adapter.failMetadataReadAt = undefined;
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
    const service = new UserDataService(adapter, {
      idFactory: () => "field-delete",
    });
    await service.initialize();
    const entry = await service.createFieldBackgroundFromBytes(fieldInput());
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

    expect(adapter.events).toEqual(["metadata-write"]);
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
      await service.initialize();

      await expect(
        service.createFieldBackgroundFromBytes(fieldInput()),
      ).rejects.toBeInstanceOf(UserDataReadOnlyError);
      expect(adapter.assets.size).toBe(0);
    }
  });

  it("migrates imported legacy calibrations directly into verified User Data", async () => {
    let persisted: UserData | null = null;
    const assets = new Map<string, number[]>();
    await initializeUserData(tauriCapabilities, {
      tauriInvoke: async <T>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T> => {
        if (command === "storage_read_user_data") {
          return structuredClone(persisted) as T;
        }
        if (command === "storage_write_user_data") {
          persisted = structuredClone(args?.data as UserData);
          return undefined as T;
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
    const bytes = new Uint8Array([7, 8, 9]);
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
    ).toEqual([first.geometry, second.geometry]);
    expect(assets.size).toBe(2);
    expect(
      firstSnapshot.project_views["project-imported"]
        ?.selected_field_background_id,
    ).toBe(firstSnapshot.field_backgrounds[1]?.id);

    expect(persisted).toEqual(readUserData());
  });

  it("remaps a copied Project-scoped field selection without replacing valid selections", async () => {
    let persisted: UserData | null = null;
    const assets = new Map<string, number[]>();
    await initializeUserData(tauriCapabilities, {
      tauriInvoke: async <T>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T> => {
        if (command === "storage_read_user_data") {
          return structuredClone(persisted) as T;
        }
        if (command === "storage_write_user_data") {
          persisted = structuredClone(args?.data as UserData);
          return undefined as T;
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
  async read(): Promise<null> {
    return null;
  }

  async write(): Promise<void> {
    throw new Error("quota exceeded");
  }

  async writeFieldAsset(): Promise<void> {}

  async readFieldAsset(): Promise<null> {
    return null;
  }

  async deleteFieldAsset(): Promise<void> {}
}

class AssetMemoryAdapter implements UserDataAdapter {
  persisted: unknown | null;
  readonly assets = new Map<string, Uint8Array>();
  readonly events: string[] = [];
  failAssetWrite = false;
  failMetadataWrite = false;
  failAssetDelete = false;
  readbackOverride: Uint8Array | null | undefined;
  metadataReadCount = 0;
  failMetadataReadAt: number | undefined;

  constructor(persisted: unknown | null = null) {
    this.persisted = persisted;
  }

  async read(): Promise<unknown | null> {
    this.events.push("metadata-read");
    this.metadataReadCount += 1;
    if (this.metadataReadCount === this.failMetadataReadAt) {
      throw new Error("metadata read failed");
    }
    return structuredClone(this.persisted);
  }

  async write(data: UserData): Promise<void> {
    this.events.push("metadata-write");
    if (this.failMetadataWrite) {
      throw new Error("metadata write failed");
    }
    this.persisted = structuredClone(data);
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
