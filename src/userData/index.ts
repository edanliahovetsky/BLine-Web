import type { EnvironmentCapabilities } from "../env/capabilities";
import {
  BrowserUserDataAdapter,
  TauriUserDataAdapter,
  type BrowserUserDataAdapterOptions,
  type UserDataAdapter,
  type UserDataInvoke,
  type UserDataStorage,
} from "./adapters";
import {
  cloneUserData,
  type EditorLayoutPreferences,
  type FieldBackgroundEntry,
  type UserData,
} from "./model";
import {
  UserDataService,
  type CreateFieldBackgroundInput,
  type FieldBackgroundMetadataUpdate,
  type LegacyFieldBackgroundMigration,
  type UserDataStatus,
} from "./service";

export {
  UserDataInitializationError,
  UserDataReadOnlyError,
  type UserDataAvailability,
  type UserDataStatus,
} from "./service";

class MemoryUserDataAdapter implements UserDataAdapter {
  private readonly assets = new Map<string, Uint8Array>();

  async read(): Promise<null> {
    return null;
  }

  async compareAndSwap(expectedRevision: number) {
    return { status: "written" as const, revision: expectedRevision + 1 };
  }

  async writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void> {
    this.assets.set(entryId, new Uint8Array(bytes));
  }

  async readFieldAsset(entryId: string): Promise<Uint8Array | null> {
    const bytes = this.assets.get(entryId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async deleteFieldAsset(entryId: string): Promise<void> {
    this.assets.delete(entryId);
  }
}

let runtimeUserData = new UserDataService(new MemoryUserDataAdapter(), {
  assumeEmptyDurableSource: true,
});

export async function initializeUserData(
  capabilities: EnvironmentCapabilities,
  options: {
    browserStorage?: UserDataStorage;
    browserAssetDbName?: BrowserUserDataAdapterOptions["assetDbName"];
    tauriInvoke?: UserDataInvoke;
    idFactory?: () => string;
    clock?: () => Date;
  } = {},
): Promise<UserData> {
  const legacyStorage =
    options.browserStorage ??
    (typeof window === "undefined" ? undefined : window.localStorage);
  const adapter =
    capabilities.shell === "tauri"
      ? new TauriUserDataAdapter(options.tauriInvoke)
      : new BrowserUserDataAdapter({
          ...(options.browserStorage === undefined
            ? {}
            : { storage: options.browserStorage }),
          assetDbName: options.browserAssetDbName,
        });
  runtimeUserData = new UserDataService(adapter, {
    legacyStorage,
    idFactory: options.idFactory,
    clock: options.clock,
  });
  return runtimeUserData.initialize();
}

export function readUserData(): UserData {
  return runtimeUserData.getSnapshot();
}

export function readUserDataStatus(): UserDataStatus {
  return runtimeUserData.getStatus();
}

function updateUserData(update: (current: UserData) => UserData): UserData {
  return runtimeUserData.update(update);
}

export function flushUserData(): Promise<void> {
  return runtimeUserData.flush();
}

export function verifyUserDataPersistence(): Promise<void> {
  return runtimeUserData.verifyDurableSnapshot();
}

export function migrateProjectViewIdentity(
  legacyProjectId: string,
  stableProjectId: string,
  pathIdByLegacyReference: Readonly<Record<string, string>>,
): Promise<void> {
  return runtimeUserData.migrateProjectViewIdentity(
    legacyProjectId,
    stableProjectId,
    pathIdByLegacyReference,
  );
}

export function listFieldBackgrounds(): FieldBackgroundEntry[] {
  return structuredClone(readUserData().field_backgrounds);
}

export function importFieldBackgroundFromBytes(
  input: CreateFieldBackgroundInput,
): Promise<FieldBackgroundEntry> {
  return runtimeUserData.createFieldBackgroundFromBytes(input);
}

export function migrateLegacyFieldBackgroundFromBytes(
  input: CreateFieldBackgroundInput,
  legacyKey: string,
): Promise<FieldBackgroundEntry> {
  return runtimeUserData.migrateLegacyFieldBackgroundFromBytes(
    input,
    legacyKey,
  );
}

export function migrateLegacyFieldBackgroundFromBytesWithOwnership(
  input: CreateFieldBackgroundInput,
  legacyKey: string,
): Promise<LegacyFieldBackgroundMigration> {
  return runtimeUserData.migrateLegacyFieldBackgroundFromBytesWithOwnership(
    input,
    legacyKey,
  );
}

export function findVerifiedLegacyFieldBackground(
  legacyKey: string,
): Promise<FieldBackgroundEntry | null> {
  return runtimeUserData.findVerifiedLegacyFieldBackground(legacyKey);
}

export function updateFieldBackgroundMetadata(
  entryId: string,
  update: FieldBackgroundMetadataUpdate,
): Promise<FieldBackgroundEntry> {
  return runtimeUserData.updateFieldBackgroundMetadata(entryId, update);
}

export async function readFieldBackgroundImage(
  entryId: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const bytes = await runtimeUserData.readFieldBackgroundImage(entryId);
  return bytes ? Uint8Array.from(bytes) : null;
}

export function deleteFieldBackground(entryId: string): Promise<void> {
  return runtimeUserData.deleteFieldBackground(entryId);
}

export function rollbackImportedFieldBackgrounds(
  entryIds: readonly string[],
  projectId: string,
  ownedSelection: string | undefined,
  priorSelection: string | null,
): Promise<void> {
  return runtimeUserData.rollbackImportedFieldBackgrounds(
    entryIds,
    projectId,
    ownedSelection,
    priorSelection,
  );
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

export function rememberCompletedTourIds(ids: readonly string[]): void {
  updateUserData((current) => ({
    ...current,
    completed_tour_ids: [...ids],
  }));
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
