import type { UserDataAdapter, UserDataStorage } from "./adapters";
import {
  InvalidUserDataRecordError,
  UnsupportedUserDataVersionError,
  cloneUserData,
  defaultUserData,
  isSafeFieldBackgroundId,
  isUserDataRecord,
  migrateUserData,
  type FieldBackgroundEntry,
  type ProjectViewPreferences,
  type UserData,
} from "./model";
import type { FieldGeometry } from "../core/field/fieldConfig";

export interface UserDataServiceOptions {
  legacyStorage?: UserDataStorage;
  idFactory?: () => string;
  clock?: () => Date;
}

export interface CreateFieldBackgroundInput {
  name: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  geometry: FieldGeometry;
}

export interface FieldBackgroundMetadataUpdate {
  name?: string;
  geometry?: FieldGeometry;
}

export interface LegacyFieldBackgroundMigration {
  entry: FieldBackgroundEntry;
  created: boolean;
}

export class UserDataReadOnlyError extends Error {
  constructor() {
    super(
      "User Data is read-only because its durable source was not safe to load",
    );
    this.name = "UserDataReadOnlyError";
  }
}

export class FieldBackgroundAssetVerificationError extends Error {
  constructor(entryId: string) {
    super(`Field Background bytes for ${entryId} did not round-trip exactly`);
    this.name = "FieldBackgroundAssetVerificationError";
  }
}

export class UserDataVerificationError extends Error {
  constructor() {
    super("User Data did not round-trip exactly after it was written");
    this.name = "UserDataVerificationError";
  }
}

export class ProjectViewMigrationError extends Error {
  constructor(legacyPathReference: string) {
    super(
      `Could not map legacy active Path reference ${legacyPathReference} to a stable Path ID`,
    );
    this.name = "ProjectViewMigrationError";
  }
}

export class UserDataService {
  private snapshot = cloneUserData(defaultUserData);
  private pendingWrite: Promise<void> = Promise.resolve();
  private snapshotRevision = 0;
  private durableRevision = -1;
  private readonly writeFailures = new Map<number, unknown>();
  private initialized = false;
  private writable = true;
  private readonly issuedEntryIds = new Set<string>();

  constructor(
    private readonly adapter: UserDataAdapter,
    private readonly options: UserDataServiceOptions = {},
  ) {}

  async initialize(): Promise<UserData> {
    if (this.initialized) {
      return this.getSnapshot();
    }

    let persisted: unknown | null;
    try {
      persisted = await this.adapter.read();
    } catch {
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }
    if (persisted !== null && !isUserDataRecord(persisted)) {
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }

    try {
      this.snapshot = migrateUserData(persisted, this.options.legacyStorage);
    } catch (error) {
      if (
        !(error instanceof UnsupportedUserDataVersionError) &&
        !(error instanceof InvalidUserDataRecordError)
      ) {
        throw error;
      }
      this.snapshot = cloneUserData(defaultUserData);
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }

    this.initialized = true;
    const requiresNormalizationWrite = !sameUserData(persisted, this.snapshot);
    if (!requiresNormalizationWrite) {
      this.durableRevision = this.snapshotRevision;
    }
    for (const entry of this.snapshot.field_backgrounds) {
      this.issuedEntryIds.add(entry.id);
    }
    if (requiresNormalizationWrite) {
      this.queueWrite();
    }
    return this.getSnapshot();
  }

  getSnapshot(): UserData {
    return cloneUserData(this.snapshot);
  }

  update(update: (current: UserData) => UserData): UserData {
    const current = this.getSnapshot();
    this.snapshot = migrateUserData({
      ...update(current),
      // Asset metadata only enters through the verified async operations.
      field_backgrounds: current.field_backgrounds,
    });
    this.snapshotRevision += 1;
    this.queueWrite();
    return this.getSnapshot();
  }

  async flush(): Promise<void> {
    if (!this.writable) {
      throw new UserDataReadOnlyError();
    }
    const pendingWrite = this.pendingWrite;
    const targetRevision = this.snapshotRevision;
    await pendingWrite;
    if (this.durableRevision >= targetRevision) {
      return;
    }
    const failure = [...this.writeFailures.entries()]
      .filter(
        ([revision]) =>
          revision > this.durableRevision && revision <= targetRevision,
      )
      .sort(([left], [right]) => right - left)[0]?.[1];
    throw failure ?? new UserDataVerificationError();
  }

  async verifyDurableSnapshot(): Promise<void> {
    await this.flush();
    const persisted = migrateUserData(await this.adapter.read());
    if (!sameUserData(persisted, this.snapshot)) {
      throw new UserDataVerificationError();
    }
  }

  async migrateProjectViewIdentity(
    legacyProjectId: string,
    stableProjectId: string,
    pathIdByLegacyReference: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (
      !legacyProjectId ||
      !stableProjectId ||
      legacyProjectId === stableProjectId
    ) {
      return;
    }
    this.assertWritable();
    return this.enqueue(async () => {
      const legacyView = this.snapshot.project_views[legacyProjectId];
      if (!legacyView) {
        return;
      }

      const staged = migrateProjectViewSnapshot(
        this.snapshot,
        legacyProjectId,
        stableProjectId,
        pathIdByLegacyReference,
        false,
      );

      // First make the stable key durable without removing the legacy key.
      // A crash or failed verification can therefore retry without losing the
      // only copy of the user's last-open Path or Field Background selection.
      await this.writeVerifiedSnapshot(staged);
      this.snapshot = migrateProjectViewSnapshot(
        this.snapshot,
        legacyProjectId,
        stableProjectId,
        pathIdByLegacyReference,
        false,
      );

      const cleanedRevision = this.snapshotRevision;
      const cleaned = migrateProjectViewSnapshot(
        this.snapshot,
        legacyProjectId,
        stableProjectId,
        pathIdByLegacyReference,
        true,
      );
      await this.writeVerifiedSnapshot(cleaned);
      this.snapshot = migrateProjectViewSnapshot(
        this.snapshot,
        legacyProjectId,
        stableProjectId,
        pathIdByLegacyReference,
        true,
      );
      this.recordDurableWrite(cleanedRevision);
    });
  }

  async createFieldBackgroundFromBytes(
    input: CreateFieldBackgroundInput,
  ): Promise<FieldBackgroundEntry> {
    this.assertWritable();
    const entryId = this.allocateEntryId();
    const bytes = new Uint8Array(input.bytes);
    return this.enqueue(() =>
      this.commitNewField(entryId, input, bytes, false),
    );
  }

  async migrateLegacyFieldBackgroundFromBytes(
    input: CreateFieldBackgroundInput,
    legacyKey: string,
  ): Promise<FieldBackgroundEntry> {
    return (
      await this.migrateLegacyFieldBackgroundFromBytesWithOwnership(
        input,
        legacyKey,
      )
    ).entry;
  }

  async migrateLegacyFieldBackgroundFromBytesWithOwnership(
    input: CreateFieldBackgroundInput,
    legacyKey: string,
  ): Promise<LegacyFieldBackgroundMigration> {
    this.assertWritable();
    const entryId = legacyFieldBackgroundId(legacyKey);
    const bytes = new Uint8Array(input.bytes);
    return this.enqueue(async () => {
      const existing = this.snapshot.field_backgrounds.find(
        (entry) => entry.id === entryId,
      );
      if (existing) {
        const readback = await this.adapter.readFieldAsset(entryId);
        if (readback && !bytesEqual(bytes, readback)) {
          throw new FieldBackgroundAssetVerificationError(entryId);
        }
        if (!readback) {
          await this.writeVerifiedAsset(entryId, bytes);
        }
        await this.verifyDurableEntry(existing);
        return { entry: structuredClone(existing), created: false };
      }

      if (this.issuedEntryIds.has(entryId)) {
        throw new Error("Duplicate legacy Field Background ID");
      }
      this.issuedEntryIds.add(entryId);
      return {
        entry: await this.commitNewField(entryId, input, bytes, true),
        created: true,
      };
    });
  }

  async findVerifiedLegacyFieldBackground(
    legacyKey: string,
  ): Promise<FieldBackgroundEntry | null> {
    this.assertWritable();
    const entryId = legacyFieldBackgroundId(legacyKey);
    return this.enqueue(async () => {
      const existing = this.snapshot.field_backgrounds.find(
        (entry) => entry.id === entryId,
      );
      if (!existing) {
        return null;
      }
      const bytes = await this.adapter.readFieldAsset(entryId);
      if (!bytes || bytes.byteLength !== existing.size_bytes) {
        throw new FieldBackgroundAssetVerificationError(entryId);
      }
      await this.verifyDurableEntry(existing);
      return structuredClone(existing);
    });
  }

  async updateFieldBackgroundMetadata(
    entryId: string,
    update: FieldBackgroundMetadataUpdate,
  ): Promise<FieldBackgroundEntry> {
    this.assertWritable();
    return this.enqueue(async () => {
      const existing = this.snapshot.field_backgrounds.find(
        (entry) => entry.id === entryId,
      );
      if (!existing) {
        throw new Error(`Unknown Field Background ${entryId}`);
      }
      const updated = this.normalizedEntry({
        ...existing,
        ...(update.name === undefined ? {} : { name: update.name }),
        ...(update.geometry === undefined
          ? {}
          : { geometry: structuredClone(update.geometry) }),
      });
      const writtenRevision = this.snapshotRevision;
      const next = updateFieldEntry(this.snapshot, entryId, updated);
      try {
        await this.adapter.write(next);
      } catch (error) {
        let persisted: UserData;
        try {
          persisted = migrateUserData(await this.adapter.read());
        } catch {
          throw error;
        }
        const durableEntry = persisted.field_backgrounds.find(
          (entry) => entry.id === entryId,
        );
        if (!durableEntry || !sameUserData(durableEntry, updated)) {
          throw error;
        }
      }
      this.snapshot = updateFieldEntry(this.snapshot, entryId, updated);
      this.recordDurableWrite(writtenRevision);
      return structuredClone(updated);
    });
  }

  async readFieldBackgroundImage(entryId: string): Promise<Uint8Array | null> {
    if (
      !this.snapshot.field_backgrounds.some((entry) => entry.id === entryId)
    ) {
      return null;
    }
    const bytes = await this.adapter.readFieldAsset(entryId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async deleteFieldBackground(entryId: string): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      if (
        !this.snapshot.field_backgrounds.some((entry) => entry.id === entryId)
      ) {
        this.issuedEntryIds.delete(entryId);
        await this.adapter.deleteFieldAsset(entryId);
        return;
      }
      const writtenRevision = this.snapshotRevision;
      const entryIds = new Set([entryId]);
      const next = removeFieldEntries(this.snapshot, entryIds);
      let writeError: unknown;
      try {
        await this.adapter.write(next);
      } catch (error) {
        writeError = error;
      }
      let persisted: UserData;
      try {
        persisted = migrateUserData(await this.adapter.read());
      } catch (error) {
        throw writeError ?? error;
      }
      if (!fieldEntriesAreRemoved(persisted, entryIds)) {
        throw writeError ?? new UserDataVerificationError();
      }
      this.snapshot = removeFieldEntries(this.snapshot, entryIds);
      this.recordDurableWrite(writtenRevision);
      this.issuedEntryIds.delete(entryId);
      await this.adapter.deleteFieldAsset(entryId);
    });
  }

  async rollbackImportedFieldBackgrounds(
    entryIds: readonly string[],
    projectId: string,
    ownedSelection: string | undefined,
    priorSelection: string | null,
  ): Promise<void> {
    this.assertWritable();
    const ownedEntryIds = new Set(entryIds);
    return this.enqueue(async () => {
      const writtenRevision = this.snapshotRevision;
      const next = rollbackImportedFields(
        this.snapshot,
        ownedEntryIds,
        projectId,
        ownedSelection,
        priorSelection,
      );
      await this.writeVerifiedSnapshot(next);
      this.snapshot = rollbackImportedFields(
        this.snapshot,
        ownedEntryIds,
        projectId,
        ownedSelection,
        priorSelection,
      );
      this.recordDurableWrite(writtenRevision);

      for (const entryId of ownedEntryIds) {
        this.issuedEntryIds.delete(entryId);
      }
      for (const entryId of ownedEntryIds) {
        await this.adapter.deleteFieldAsset(entryId);
      }
    });
  }

  private queueWrite(): void {
    if (!this.writable) {
      return;
    }
    const write = this.pendingWrite.then(async () => {
      const snapshot = this.getSnapshot();
      const revision = this.snapshotRevision;
      try {
        await this.writeQueuedSnapshot(snapshot);
        this.recordDurableWrite(revision);
      } catch (error) {
        this.recordWriteFailure(revision, error);
        throw error;
      }
    });
    // Preference updates are intentionally fire-and-forget. Keep the serial
    // queue usable after recording a failure for an explicit flush.
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
  }

  private async commitNewField(
    entryId: string,
    input: CreateFieldBackgroundInput,
    bytes: Uint8Array,
    releaseReservationForDeterministicRetry: boolean,
  ): Promise<FieldBackgroundEntry> {
    const entry = this.normalizedEntry({
      id: entryId,
      name: input.name,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: bytes.byteLength,
      created_at: this.now().toISOString(),
      geometry: structuredClone(input.geometry),
    });
    try {
      await this.writeVerifiedAsset(entryId, bytes);
    } catch (error) {
      await this.deleteAssetBestEffort(entryId);
      this.issuedEntryIds.delete(entryId);
      throw error;
    }

    const next = this.withFieldEntries([
      ...this.snapshot.field_backgrounds,
      entry,
    ]);
    const writtenRevision = this.snapshotRevision;
    try {
      await this.adapter.write(next);
    } catch (error) {
      let persisted: UserData;
      try {
        persisted = migrateUserData(await this.adapter.read());
      } catch {
        // The asset may already be referenced durably. Deterministic imports
        // can safely reclaim the same identity and bytes; ordinary creates
        // retain their reservation so a random collision cannot replace it.
        if (releaseReservationForDeterministicRetry) {
          this.issuedEntryIds.delete(entryId);
        }
        throw error;
      }
      const durableEntry = persisted.field_backgrounds.find(
        (candidate) => candidate.id === entryId,
      );
      if (!durableEntry) {
        await this.deleteAssetBestEffort(entryId);
        this.issuedEntryIds.delete(entryId);
        throw error;
      }
      if (!sameUserData(durableEntry, entry)) {
        throw error;
      }
      this.snapshot = addFieldEntry(this.snapshot, entry);
      this.recordDurableWrite(writtenRevision);
      return structuredClone(entry);
    }

    this.snapshot = addFieldEntry(this.snapshot, entry);
    this.recordDurableWrite(writtenRevision);
    await this.verifyDurableEntry(entry);
    return structuredClone(entry);
  }

  private async writeVerifiedAsset(
    entryId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    await this.adapter.writeFieldAsset(entryId, bytes);
    const readback = await this.adapter.readFieldAsset(entryId);
    if (!readback || !bytesEqual(bytes, readback)) {
      throw new FieldBackgroundAssetVerificationError(entryId);
    }
  }

  private async verifyDurableEntry(entry: FieldBackgroundEntry): Promise<void> {
    const persisted = migrateUserData(await this.adapter.read());
    const durableEntry = persisted.field_backgrounds.find(
      (candidate) => candidate.id === entry.id,
    );
    if (!durableEntry || !sameUserData(durableEntry, entry)) {
      throw new UserDataVerificationError();
    }
  }

  private async writeVerifiedSnapshot(snapshot: UserData): Promise<void> {
    await this.adapter.write(snapshot);
    const persisted = migrateUserData(await this.adapter.read());
    if (!sameUserData(persisted, snapshot)) {
      throw new UserDataVerificationError();
    }
  }

  private async writeQueuedSnapshot(snapshot: UserData): Promise<void> {
    await this.adapter.write(migrateUserData(snapshot));
  }

  private recordDurableWrite(revision: number): void {
    this.durableRevision = Math.max(this.durableRevision, revision);
    for (const failedRevision of this.writeFailures.keys()) {
      if (failedRevision <= this.durableRevision) {
        this.writeFailures.delete(failedRevision);
      }
    }
  }

  private recordWriteFailure(revision: number, error: unknown): void {
    if (revision > this.durableRevision) {
      this.writeFailures.set(revision, error);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.then(operation, operation);
    this.pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertWritable(): void {
    if (!this.initialized || !this.writable) {
      throw new UserDataReadOnlyError();
    }
  }

  private allocateEntryId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = this.makeId();
      if (
        isSafeFieldBackgroundId(candidate) &&
        !this.issuedEntryIds.has(candidate)
      ) {
        this.issuedEntryIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("Could not allocate a unique Field Background ID");
  }

  private makeId(): string {
    const supplied = this.options.idFactory?.();
    if (supplied !== undefined) {
      return supplied;
    }
    const random =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `field-${random}`;
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private normalizedEntry(entry: FieldBackgroundEntry): FieldBackgroundEntry {
    const normalized = this.withFieldEntries([entry]).field_backgrounds[0];
    if (!normalized || normalized.id !== entry.id) {
      throw new Error("Invalid Field Background metadata");
    }
    return normalized;
  }

  private withFieldEntries(entries: FieldBackgroundEntry[]): UserData {
    return migrateUserData({ ...this.snapshot, field_backgrounds: entries });
  }

  private async deleteAssetBestEffort(entryId: string): Promise<void> {
    try {
      await this.adapter.deleteFieldAsset(entryId);
    } catch {
      // An unreferenced orphan is safer than exposing missing referenced bytes.
    }
  }
}

function migrateProjectViewSnapshot(
  snapshot: UserData,
  legacyProjectId: string,
  stableProjectId: string,
  pathIdByLegacyReference: Readonly<Record<string, string>>,
  removeLegacy: boolean,
): UserData {
  const legacyView = snapshot.project_views[legacyProjectId];
  if (!legacyView) {
    return snapshot;
  }
  const stableView = snapshot.project_views[stableProjectId] ?? {};
  const projectViews = {
    ...snapshot.project_views,
    [stableProjectId]: mergeProjectViews(
      legacyView,
      stableView,
      pathIdByLegacyReference,
    ),
  };
  if (removeLegacy) {
    delete projectViews[legacyProjectId];
  }
  return migrateUserData({ ...snapshot, project_views: projectViews });
}

function addFieldEntry(
  snapshot: UserData,
  entry: FieldBackgroundEntry,
): UserData {
  return migrateUserData({
    ...snapshot,
    field_backgrounds: [...snapshot.field_backgrounds, entry],
  });
}

function updateFieldEntry(
  snapshot: UserData,
  entryId: string,
  updated: FieldBackgroundEntry,
): UserData {
  return migrateUserData({
    ...snapshot,
    field_backgrounds: snapshot.field_backgrounds.map((entry) =>
      entry.id === entryId ? updated : entry,
    ),
  });
}

function removeFieldEntries(
  snapshot: UserData,
  entryIds: ReadonlySet<string>,
): UserData {
  const projectViews = Object.fromEntries(
    Object.entries(snapshot.project_views).flatMap(([projectId, view]) => {
      if (
        !view.selected_field_background_id ||
        !entryIds.has(view.selected_field_background_id)
      ) {
        return [[projectId, view]];
      }
      const nextView = { ...view };
      delete nextView.selected_field_background_id;
      return Object.keys(nextView).length > 0 ? [[projectId, nextView]] : [];
    }),
  );
  return migrateUserData({
    ...snapshot,
    field_backgrounds: snapshot.field_backgrounds.filter(
      (entry) => !entryIds.has(entry.id),
    ),
    project_views: projectViews,
  });
}

function fieldEntriesAreRemoved(
  snapshot: UserData,
  entryIds: ReadonlySet<string>,
): boolean {
  return (
    snapshot.field_backgrounds.every((entry) => !entryIds.has(entry.id)) &&
    Object.values(snapshot.project_views).every(
      (view) =>
        !view.selected_field_background_id ||
        !entryIds.has(view.selected_field_background_id),
    )
  );
}

function rollbackImportedFields(
  snapshot: UserData,
  entryIds: ReadonlySet<string>,
  projectId: string,
  ownedSelection: string | undefined,
  priorSelection: string | null,
): UserData {
  const restoreSelection =
    ownedSelection !== undefined &&
    snapshot.project_views[projectId]?.selected_field_background_id ===
      ownedSelection;
  const withoutEntries = removeFieldEntries(snapshot, entryIds);
  if (!restoreSelection) {
    return withoutEntries;
  }

  const projectViews = { ...withoutEntries.project_views };
  const projectView = { ...projectViews[projectId] };
  if (priorSelection) {
    projectView.selected_field_background_id = priorSelection;
  } else {
    delete projectView.selected_field_background_id;
  }
  if (Object.keys(projectView).length > 0) {
    projectViews[projectId] = projectView;
  } else {
    delete projectViews[projectId];
  }
  return migrateUserData({ ...withoutEntries, project_views: projectViews });
}

function mergeProjectViews(
  legacyView: ProjectViewPreferences,
  stableView: ProjectViewPreferences,
  pathIdByLegacyReference: Readonly<Record<string, string>>,
): ProjectViewPreferences {
  const merged: ProjectViewPreferences = { ...stableView };
  if (!merged.active_path_id && legacyView.active_path_id) {
    const stablePathId = pathIdByLegacyReference[legacyView.active_path_id];
    if (!stablePathId) {
      throw new ProjectViewMigrationError(legacyView.active_path_id);
    }
    merged.active_path_id = stablePathId;
  }
  if (
    !merged.selected_field_background_id &&
    legacyView.selected_field_background_id
  ) {
    merged.selected_field_background_id =
      legacyView.selected_field_background_id;
  }
  return merged;
}

function legacyFieldBackgroundId(legacyKey: string): string {
  if (/^imported-v2:[0-9a-f]{64}$/.test(legacyKey)) {
    return `imported-field-${legacyKey.slice("imported-v2:".length)}`;
  }
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(legacyKey)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-field-${(hash >>> 0).toString(36)}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function sameUserData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
