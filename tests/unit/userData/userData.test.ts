import { describe, expect, it } from "vitest";
import { browserWebCapabilities } from "../../../src/env/capabilities";
import {
  BROWSER_USER_DATA_KEY,
  BrowserUserDataAdapter,
  TauriUserDataAdapter,
  UserDataService,
  activePathForProject,
  automaticGenerationKeepInSync,
  defaultUserData,
  flushUserData,
  initializeUserData,
  readCompletedTourIds,
  readEditorLayoutPreferences,
  rememberActivePath,
  rememberAutomaticGenerationKeepInSync,
  rememberCompletedTourIds,
  rememberEditorLayoutPreferences,
  rememberSelectedFieldBackground,
  selectedFieldBackgroundForProject,
  type UserDataAdapter,
  type UserDataStorage,
} from "../../../src/userData";

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
            : undefined
        ) as T;
      },
    );

    await expect(adapter.read()).resolves.toMatchObject({
      completed_tour_ids: ["editor-basics"],
    });
    await adapter.write(defaultUserData);

    expect(calls).toEqual([
      { command: "storage_read_user_data", args: undefined },
      { command: "storage_write_user_data", args: { data: defaultUserData } },
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
    expect(readCompletedTourIds()).toEqual(["editor-basics"]);
    expect(automaticGenerationKeepInSync()).toBe(false);
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
