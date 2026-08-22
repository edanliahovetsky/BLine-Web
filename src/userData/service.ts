import type { UserDataAdapter, UserDataStorage } from "./adapters";
import {
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

export class UserDataReadOnlyError extends Error {
  constructor() {
    super("User Data is read-only because its durable source was not readable");
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
  private latestPreferenceWrite: Promise<void> = Promise.resolve();
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
      if (!(error instanceof UnsupportedUserDataVersionError)) {
        throw error;
      }
      this.snapshot = cloneUserData(defaultUserData);
      this.writable = false;
      this.initialized = true;
      return this.getSnapshot();
    }

    this.initialized = true;
    for (const entry of this.snapshot.field_backgrounds) {
      this.issuedEntryIds.add(entry.id);
    }
    this.queueWrite();
    await this.flush();
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
    this.queueWrite();
    return this.getSnapshot();
  }

  async flush(): Promise<void> {
    const pendingWrite = this.pendingWrite;
    const latestPreferenceWrite = this.latestPreferenceWrite;
    await pendingWrite;
    await latestPreferenceWrite;
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

      const stableView = this.snapshot.project_views[stableProjectId] ?? {};
      const mergedView = mergeProjectViews(
        legacyView,
        stableView,
        pathIdByLegacyReference,
      );
      const staged = migrateUserData({
        ...this.snapshot,
        project_views: {
          ...this.snapshot.project_views,
          [stableProjectId]: mergedView,
        },
      });

      // First make the stable key durable without removing the legacy key.
      // A crash or failed verification can therefore retry without losing the
      // only copy of the user's last-open Path or Field Background selection.
      await this.writeVerifiedSnapshot(staged);
      this.snapshot = staged;

      const projectViews = { ...staged.project_views };
      delete projectViews[legacyProjectId];
      const cleaned = migrateUserData({
        ...staged,
        project_views: projectViews,
      });
      await this.writeVerifiedSnapshot(cleaned);
      this.snapshot = cleaned;
    });
  }

  async createFieldBackgroundFromBytes(
    input: CreateFieldBackgroundInput,
  ): Promise<FieldBackgroundEntry> {
    this.assertWritable();
    const entryId = this.allocateEntryId();
    const bytes = new Uint8Array(input.bytes);
    return this.enqueue(() => this.commitNewField(entryId, input, bytes));
  }

  async migrateLegacyFieldBackgroundFromBytes(
    input: CreateFieldBackgroundInput,
    legacyKey: string,
  ): Promise<FieldBackgroundEntry> {
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
        return structuredClone(existing);
      }

      if (this.issuedEntryIds.has(entryId)) {
        throw new Error("Duplicate legacy Field Background ID");
      }
      this.issuedEntryIds.add(entryId);
      return this.commitNewField(entryId, input, bytes);
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
      const next = this.withFieldEntries(
        this.snapshot.field_backgrounds.map((entry) =>
          entry.id === entryId ? updated : entry,
        ),
      );
      await this.adapter.write(next);
      this.snapshot = next;
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
        return;
      }
      const projectViews = Object.fromEntries(
        Object.entries(this.snapshot.project_views).flatMap(
          ([projectId, view]) => {
            if (view.selected_field_background_id !== entryId) {
              return [[projectId, view]];
            }
            const nextView = { ...view };
            delete nextView.selected_field_background_id;
            return Object.keys(nextView).length > 0
              ? [[projectId, nextView]]
              : [];
          },
        ),
      );
      const next = migrateUserData({
        ...this.snapshot,
        field_backgrounds: this.snapshot.field_backgrounds.filter(
          (entry) => entry.id !== entryId,
        ),
        project_views: projectViews,
      });
      await this.adapter.write(next);
      this.snapshot = next;
      await this.adapter.deleteFieldAsset(entryId);
    });
  }

  private queueWrite(): void {
    if (!this.writable) {
      return;
    }
    const queuedSnapshot = this.getSnapshot();
    const write = this.pendingWrite.then(() =>
      this.writeQueuedSnapshot(queuedSnapshot),
    );
    this.latestPreferenceWrite = write;
    // Preference updates are intentionally fire-and-forget. Keep the serial
    // queue usable after failure while retaining `write` for explicit flushes.
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
  }

  private async commitNewField(
    entryId: string,
    input: CreateFieldBackgroundInput,
    bytes: Uint8Array,
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
    let metadataCommitted = false;
    try {
      await this.writeVerifiedAsset(entryId, bytes);
      const next = this.withFieldEntries([
        ...this.snapshot.field_backgrounds,
        entry,
      ]);
      await this.adapter.write(next);
      this.snapshot = next;
      metadataCommitted = true;
      await this.verifyDurableEntry(entry);
      return structuredClone(entry);
    } catch (error) {
      if (!metadataCommitted) {
        await this.deleteAssetBestEffort(entryId);
        this.issuedEntryIds.delete(entryId);
      }
      throw error;
    }
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
    await this.adapter.write(
      migrateUserData({
        ...snapshot,
        // A later queued generic preference write must not erase a verified
        // asset entry committed by an earlier serial operation.
        field_backgrounds: this.snapshot.field_backgrounds,
      }),
    );
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
