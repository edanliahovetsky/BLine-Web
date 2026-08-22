import type { EnvironmentCapabilities } from "../env/capabilities";
import {
  BrowserUserDataAdapter,
  TauriUserDataAdapter,
  type UserDataAdapter,
  type UserDataInvoke,
  type UserDataStorage,
} from "./adapters";
import {
  cloneUserData,
  type EditorLayoutPreferences,
  type UserData,
} from "./model";
import { UserDataService } from "./service";

export * from "./adapters";
export * from "./model";
export * from "./service";

class MemoryUserDataAdapter implements UserDataAdapter {
  async read(): Promise<null> {
    return null;
  }

  async write(): Promise<void> {}
}

let runtimeUserData = new UserDataService(new MemoryUserDataAdapter());

export async function initializeUserData(
  capabilities: EnvironmentCapabilities,
  options: {
    browserStorage?: UserDataStorage;
    tauriInvoke?: UserDataInvoke;
  } = {},
): Promise<UserData> {
  const legacyStorage =
    options.browserStorage ??
    (typeof window === "undefined" ? undefined : window.localStorage);
  const adapter =
    capabilities.shell === "tauri"
      ? new TauriUserDataAdapter(options.tauriInvoke)
      : new BrowserUserDataAdapter({ storage: legacyStorage });
  runtimeUserData = new UserDataService(adapter, { legacyStorage });
  return runtimeUserData.initialize();
}

export function readUserData(): UserData {
  return runtimeUserData.getSnapshot();
}

export function updateUserData(
  update: (current: UserData) => UserData,
): UserData {
  return runtimeUserData.update(update);
}

export function flushUserData(): Promise<void> {
  return runtimeUserData.flush();
}

export function readEditorLayoutPreferences(): EditorLayoutPreferences {
  return cloneUserData(readUserData()).editor_layout;
}

export function rememberEditorLayoutPreferences(
  preferences: EditorLayoutPreferences,
): void {
  updateUserData((current) => ({
    ...current,
    editor_layout: { ...preferences },
  }));
}

export function readCompletedTourIds(): string[] {
  return [...readUserData().completed_tour_ids];
}

export function rememberCompletedTourIds(ids: readonly string[]): void {
  updateUserData((current) => ({
    ...current,
    completed_tour_ids: [...ids],
  }));
}

export function automaticGenerationKeepInSync(): boolean {
  return readUserData().automatic_generation.keep_in_sync;
}

export function rememberAutomaticGenerationKeepInSync(enabled: boolean): void {
  updateUserData((current) => ({
    ...current,
    automatic_generation: { keep_in_sync: enabled },
  }));
}

export function activePathForProject(
  projectId: string,
  fallback: string | null = null,
): string | null {
  return readUserData().project_views[projectId]?.active_path_id ?? fallback;
}

export function rememberActivePath(
  projectId: string,
  pathId: string | null,
): void {
  updateProjectView(projectId, "active_path_id", pathId);
}

export function selectedFieldBackgroundForProject(
  projectId: string,
  fallback: string | null = null,
): string | null {
  return (
    readUserData().project_views[projectId]?.selected_field_background_id ??
    fallback
  );
}

export function rememberSelectedFieldBackground(
  projectId: string,
  fieldBackgroundId: string | null,
): void {
  updateProjectView(
    projectId,
    "selected_field_background_id",
    fieldBackgroundId,
  );
}

function updateProjectView(
  projectId: string,
  key: "active_path_id" | "selected_field_background_id",
  value: string | null,
): void {
  if (!projectId) {
    return;
  }
  updateUserData((current) => {
    const nextView = { ...current.project_views[projectId] };
    if (value) {
      nextView[key] = value;
    } else {
      delete nextView[key];
    }
    const projectViews = { ...current.project_views };
    if (Object.keys(nextView).length > 0) {
      projectViews[projectId] = nextView;
    } else {
      delete projectViews[projectId];
    }
    return { ...current, project_views: projectViews };
  });
}
