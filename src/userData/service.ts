import type {
  UserDataAdapter,
  UserDataStorage,
  VersionedUserData,
} from "./adapters";
import {
  InvalidUserDataRecordError,
  UnsupportedUserDataVersionError,
  cloneUserData,
  defaultUserData,
  isSafeFieldBackgroundId,
  isUserDataRecord,
  migrateUserData,
  type FieldBackgroundEntry,
  type FieldAssetStagingEntry,
  type ProjectViewPreferences,
  type UserData,
} from "./model";
import type { FieldGeometry } from "../core/field/fieldConfig";

export interface UserDataServiceOptions {
  legacyStorage?: UserDataStorage;
  idFactory?: () => string;
  assetIdFactory?: () => string;
  sessionId?: string;
  stagingLeaseMs?: number;
  clock?: () => Date;
  /** Only for an explicitly non-durable in-memory runtime fallback. */
  assumeEmptyDurableSource?: boolean;
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

export interface SaveFieldBackgroundSettingsInput {
  projectId: string;
  selectedFieldId: string | null;
  fieldBackgrounds: readonly FieldBackgroundEntry[];
  imageUpdates: readonly { entryId: string; bytes: Uint8Array }[];
}

export interface LegacyFieldBackgroundMigration {
  entry: FieldBackgroundEntry;
  created: boolean;
}

export type UserDataAvailability =
  | "uninitialized"
  | "initializing"
  | "ready"
  | "unavailable"
  | "read-only";

export interface UserDataStatus {
  availability: UserDataAvailability;
  error: Error | null;
  hasUnsavedChanges: boolean;
}

export class UserDataInitializationError extends Error {
  constructor(
    readonly availability: "unavailable" | "read-only",
    readonly initializationError: unknown,
  ) {
    super(
      initializationError instanceof Error
        ? initializationError.message
        : "User Data could not be initialized",
      { cause: initializationError },
    );
    this.name = "UserDataInitializationError";
  }
}

export class UserDataReadOnlyError extends Error {
  constructor(readonly availability: UserDataAvailability = "read-only") {
    super(
      availability === "unavailable"
        ? "User Data is unavailable because its durable source could not be loaded"
        : availability === "initializing" || availability === "uninitialized"
          ? "User Data is unavailable until initialization completes"
          : "User Data is read-only because its durable source was not safe to load",
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

export class FieldBackgroundAssetDeletionError extends Error {
  constructor(entryId: string) {
    super(`Field Background bytes for ${entryId} were not deleted`);
    this.name = "FieldBackgroundAssetDeletionError";
  }
}

export class UserDataVerificationError extends Error {
  constructor() {
    super("User Data did not round-trip exactly after it was written");
    this.name = "UserDataVerificationError";
  }
}

class UserDataWriteOutcomeUnknownError extends Error {
  constructor(readonly writeError: unknown) {
    super(
      writeError instanceof Error
        ? writeError.message
        : "User Data write outcome is unknown",
      { cause: writeError },
    );
    this.name = "UserDataWriteOutcomeUnknownError";
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
  private durableSnapshot = cloneUserData(defaultUserData);
  private storageRevision = 0;
  private pendingWrite: Promise<void> = Promise.resolve();
  private snapshotRevision = 0;
  private durableRevision = 0;
  private readonly writeFailures = new Map<number, unknown>();
  private availability: UserDataAvailability = "uninitialized";
  private availabilityError: Error | null = null;
  private initialization: Promise<UserData> | null = null;
  private readonly issuedEntryIds = new Set<string>();
  private readonly issuedAssetIds = new Set<string>();
  private readonly sessionId: string;

  constructor(
    private readonly adapter: UserDataAdapter,
    private readonly options: UserDataServiceOptions = {},
  ) {
    this.sessionId =
      options.sessionId ??
      `session-${
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      }`;
    if (!isSafeFieldBackgroundId(this.sessionId)) {
      throw new Error("Invalid User Data session ID");
    }
    if (options.assumeEmptyDurableSource) {
      this.availability = "ready";
    }
  }

  async initialize(): Promise<UserData> {
    if (this.availability === "ready") {
      return this.getSnapshot();
    }
    if (this.initialization) {
      return this.initialization;
    }

    const initialization = this.initializeAttempt();
    this.initialization = initialization;
    try {
      return await initialization;
    } finally {
      if (this.initialization === initialization) {
        this.initialization = null;
      }
    }
  }

  private async initializeAttempt(): Promise<UserData> {
    this.availability = "initializing";
    this.availabilityError = null;
    this.resetVolatileState();

    let document: VersionedUserData | null;
    try {
      document = await this.adapter.read();
    } catch (error) {
      throw this.failInitialization(
        error instanceof SyntaxError ? "read-only" : "unavailable",
        error,
      );
    }
    const persisted = document?.data ?? null;
    if (persisted !== null && !isUserDataRecord(persisted)) {
      throw this.failInitialization(
        "read-only",
        new InvalidUserDataRecordError(),
      );
    }

    let migrated: UserData;
    try {
      migrated = migrateUserData(persisted, this.options.legacyStorage);
    } catch (error) {
      if (
        error instanceof UnsupportedUserDataVersionError ||
        error instanceof InvalidUserDataRecordError
      ) {
        throw this.failInitialization("read-only", error);
      }
      throw this.failInitialization("unavailable", error);
    }

    this.snapshot = migrated;
    this.storageRevision = document?.revision ?? 0;
    this.durableSnapshot = cloneUserData(this.snapshot);
    const requiresNormalizationWrite = !sameUserData(persisted, this.snapshot);
    for (const entry of this.snapshot.field_backgrounds) {
      this.issuedEntryIds.add(entry.id);
      this.issuedAssetIds.add(entry.asset_id);
    }
    for (const assetId of this.snapshot.field_asset_cleanup_ids) {
      this.issuedAssetIds.add(assetId);
    }
    for (const staging of this.snapshot.field_asset_staging) {
      this.issuedAssetIds.add(staging.asset_id);
    }
    if (requiresNormalizationWrite) {
      try {
        const durable = await this.persistWithRetry(this.snapshot);
        this.acceptDurableSnapshot(this.snapshot, durable);
      } catch (error) {
        throw this.failInitialization("unavailable", error);
      }
    }
    this.durableRevision = this.snapshotRevision;
    this.availability = "ready";
    try {
      await this.reapExpiredFieldAssetStaging();
      await this.completePendingFieldAssetCleanup();
    } catch (error) {
      // Cleanup ownership is durable. Keep the editor available and surface
      // the retryable failure through status/flush instead of losing the queue.
      this.availabilityError = toError(error);
    }
    return this.getSnapshot();
  }

  getStatus(): UserDataStatus {
    const failure = [...this.writeFailures.entries()]
      .filter(([revision]) => revision > this.durableRevision)
      .sort(([left], [right]) => right - left)[0]?.[1];
    return {
      availability: this.availability,
      error:
        this.availabilityError ??
        (failure === undefined ? null : toError(failure)),
      hasUnsavedChanges:
        this.snapshotRevision > this.durableRevision ||
        this.snapshot.field_asset_cleanup_ids.length > 0,
    };
  }

  getSnapshot(): UserData {
    return cloneUserData(this.snapshot);
  }

  update(update: (current: UserData) => UserData): UserData {
    this.assertWritable();
    const current = this.getSnapshot();
    this.snapshot = migrateUserData({
      ...update(current),
      // Asset metadata only enters through the verified async operations.
      field_backgrounds: current.field_backgrounds,
      field_asset_cleanup_ids: current.field_asset_cleanup_ids,
      field_asset_staging: current.field_asset_staging,
    });
    this.snapshotRevision += 1;
    this.queueWrite();
    return this.getSnapshot();
  }

  async flush(): Promise<void> {
    while (true) {
      const pendingWrite = this.pendingWrite;
      await pendingWrite;
      if (pendingWrite !== this.pendingWrite) {
        continue;
      }
      if (this.snapshot.field_asset_cleanup_ids.length > 0) {
        this.assertWritable();
        await this.enqueue(() => this.completePendingFieldAssetCleanup());
        continue;
      }
      if (this.hasExpiredFieldAssetStaging()) {
        this.assertWritable();
        await this.enqueue(() => this.reapExpiredFieldAssetStaging());
        continue;
      }
      const targetRevision = this.snapshotRevision;
      if (this.durableRevision >= targetRevision) {
        return;
      }
      this.assertWritable();
      const failure = [...this.writeFailures.entries()]
        .filter(
          ([revision]) =>
            revision > this.durableRevision && revision <= targetRevision,
        )
        .sort(([left], [right]) => right - left)[0]?.[1];
      // Keep a transient fire-and-forget failure visible to this flush while
      // also making the latest unsaved snapshot retryable by a later flush.
      // queueWrite() captures the snapshot only when its turn begins, so edits
      // arriving around this failure are included in the CAS retry.
      this.queueWrite();
      throw failure ?? new UserDataVerificationError();
    }
  }

  async verifyDurableSnapshot(): Promise<void> {
    await this.flush();
    const document = await this.adapter.read();
    const persisted = migrateUserData(document?.data ?? null);
    if ((document?.revision ?? 0) < this.storageRevision) {
      throw new UserDataVerificationError();
    }
    if (!sameUserData(persisted, this.durableSnapshot)) {
      this.snapshot = mergeConcurrentUserData(
        this.durableSnapshot,
        this.snapshot,
        persisted,
      );
      this.durableSnapshot = persisted;
      this.storageRevision = document?.revision ?? 0;
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
      const durableStaged = await this.writeVerifiedSnapshot(staged);
      this.acceptDurableSnapshot(staged, durableStaged);
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
      const durableCleaned = await this.writeVerifiedSnapshot(cleaned);
      this.acceptDurableSnapshot(cleaned, durableCleaned);
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
    return this.enqueue(
      async () =>
        (await this.commitNewField(entryId, input, bytes, false)).entry,
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
        const readback = await this.adapter.readFieldAsset(existing.asset_id);
        if (readback && !bytesEqual(bytes, readback)) {
          throw new FieldBackgroundAssetVerificationError(entryId);
        }
        if (!readback) {
          await this.writeVerifiedAsset(existing.asset_id, bytes);
        }
        await this.verifyDurableEntry(existing);
        return { entry: structuredClone(existing), created: false };
      }

      if (this.issuedEntryIds.has(entryId)) {
        throw new Error("Duplicate legacy Field Background ID");
      }
      this.issuedEntryIds.add(entryId);
      return this.commitNewField(entryId, input, bytes, true);
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
      const bytes = await this.adapter.readFieldAsset(existing.asset_id);
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
      const durable = await this.persistWithRetry(next);
      this.acceptDurableSnapshot(next, durable);
      const durableEntry = durable.field_backgrounds.find(
        (entry) => entry.id === entryId,
      );
      if (!durableEntry) {
        throw new UserDataVerificationError();
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
    const entry = this.snapshot.field_backgrounds.find(
      (candidate) => candidate.id === entryId,
    );
    const bytes = entry
      ? await this.adapter.readFieldAsset(entry.asset_id)
      : null;
    return bytes ? new Uint8Array(bytes) : null;
  }

  async deleteFieldBackground(entryId: string): Promise<void> {
    this.assertWritable();
    return this.enqueue(async () => {
      await this.reapExpiredFieldAssetStaging();
      await this.completePendingFieldAssetCleanup();
      if (
        !this.snapshot.field_backgrounds.some((entry) => entry.id === entryId)
      ) {
        return;
      }
      const writtenRevision = this.snapshotRevision;
      const entryIds = new Set([entryId]);
      const assetIds = new Set(
        this.snapshot.field_backgrounds
          .filter((entry) => entryIds.has(entry.id))
          .map((entry) => entry.asset_id),
      );
      const next = addFieldAssetCleanup(
        removeFieldEntries(this.snapshot, entryIds),
        assetIds,
      );
      const persisted = await this.persistWithRetry(next);
      if (!fieldEntriesAreRemoved(persisted, entryIds)) {
        throw new UserDataVerificationError();
      }
      this.acceptDurableSnapshot(next, persisted);
      this.snapshot = addFieldAssetCleanup(
        removeFieldEntries(this.snapshot, entryIds),
        assetIds,
      );
      this.recordDurableWrite(writtenRevision);
      this.issuedEntryIds.delete(entryId);
      await this.completePendingFieldAssetCleanup();
    });
  }

  async saveFieldBackgroundSettings(
    input: SaveFieldBackgroundSettingsInput,
  ): Promise<FieldBackgroundEntry[]> {
    this.assertWritable();
    return this.enqueue(async () => {
      await this.reapExpiredFieldAssetStaging();
      await this.completePendingFieldAssetCleanup();
      let desiredEntries = input.fieldBackgrounds.map((entry) =>
        this.normalizedEntry(structuredClone(entry)),
      );
      const desiredIds = new Set(desiredEntries.map((entry) => entry.id));
      if (desiredIds.size !== desiredEntries.length) {
        throw new Error("Field Background IDs must be unique");
      }

      const imageUpdates = new Map<string, Uint8Array>();
      for (const update of input.imageUpdates) {
        if (
          !desiredIds.has(update.entryId) ||
          imageUpdates.has(update.entryId)
        ) {
          throw new Error(
            `Invalid Field Background image update ${update.entryId}`,
          );
        }
        imageUpdates.set(update.entryId, new Uint8Array(update.bytes));
      }

      const before = this.getSnapshot();
      const beforeById = new Map(
        before.field_backgrounds.map((entry) => [entry.id, entry]),
      );
      const writtenAssetIds: string[] = [];
      const replacedAssetIds = new Set<string>();
      for (const [entryId] of imageUpdates) {
        const assetId = this.allocateAssetId();
        desiredEntries = desiredEntries.map((entry) =>
          entry.id === entryId ? { ...entry, asset_id: assetId } : entry,
        );
        writtenAssetIds.push(assetId);
      }
      await this.stageFieldAssets(writtenAssetIds);
      const stagedBase = this.getSnapshot();
      try {
        for (const [entryId, bytes] of imageUpdates) {
          const previousEntry = beforeById.get(entryId);
          if (
            previousEntry &&
            !(await this.adapter.readFieldAsset(previousEntry.asset_id))
          ) {
            throw new FieldBackgroundAssetVerificationError(entryId);
          }
          const assetId = desiredEntries.find(
            (entry) => entry.id === entryId,
          )!.asset_id;
          await this.writeVerifiedAsset(assetId, bytes);
          if (previousEntry) {
            replacedAssetIds.add(previousEntry.asset_id);
          }
        }
      } catch (error) {
        await this.discardStagedAssetsBestEffort(writtenAssetIds);
        throw error;
      }

      const removedIds = new Set(
        before.field_backgrounds
          .map((entry) => entry.id)
          .filter((entryId) => !desiredIds.has(entryId)),
      );
      const retiredAssetIds = new Set([
        ...replacedAssetIds,
        ...before.field_backgrounds
          .filter((entry) => removedIds.has(entry.id))
          .map((entry) => entry.asset_id),
      ]);
      const writtenRevision = this.snapshotRevision;
      let next = removeFieldEntries(stagedBase, removedIds);
      next = migrateUserData({
        ...next,
        field_backgrounds: desiredEntries,
        field_asset_cleanup_ids: [
          ...new Set([
            ...next.field_asset_cleanup_ids,
            ...retiredAssetIds,
          ]),
        ],
        field_asset_staging: next.field_asset_staging.filter(
          (staging) => !writtenAssetIds.includes(staging.asset_id),
        ),
        project_views: withSelectedFieldBackground(
          next.project_views,
          input.projectId,
          input.selectedFieldId,
        ),
      });

      let durable: UserData;
      try {
        durable = await this.persistWithRetry(next);
      } catch (error) {
        if (!(error instanceof UserDataWriteOutcomeUnknownError)) {
          await this.discardStagedAssetsBestEffort(writtenAssetIds);
        }
        throw error;
      }
      const missingDesiredIds = desiredEntries.some(
        (desired) =>
          !durable.field_backgrounds.some((entry) => entry.id === desired.id),
      );
      const missingStagedGeneration = writtenAssetIds.some(
        (assetId) =>
          !durable.field_backgrounds.some(
            (entry) => entry.asset_id === assetId,
          ),
      );
      if (
        missingDesiredIds ||
        missingStagedGeneration ||
        !fieldEntriesAreRemoved(durable, removedIds)
      ) {
        const referencedAssetIds = new Set(
          durable.field_backgrounds.map((entry) => entry.asset_id),
        );
        await this.discardStagedAssetsBestEffort(
          writtenAssetIds.filter(
            (assetId) => !referencedAssetIds.has(assetId),
          ),
        );
        throw new UserDataVerificationError();
      }

      const volatileSnapshot = this.getSnapshot();
      this.acceptDurableSnapshot(next, durable);
      this.snapshot = mergeConcurrentUserData(
        stagedBase,
        mergeConcurrentUserData(stagedBase, next, volatileSnapshot),
        durable,
      );
      this.recordDurableWrite(writtenRevision);
      for (const entryId of removedIds) {
        this.issuedEntryIds.delete(entryId);
      }
      await this.completePendingFieldAssetCleanup();
      return structuredClone(durable.field_backgrounds);
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
      await this.completePendingFieldAssetCleanup();
      const writtenRevision = this.snapshotRevision;
      const ownedAssetIds = new Set(
        this.snapshot.field_backgrounds
          .filter((entry) => ownedEntryIds.has(entry.id))
          .map((entry) => entry.asset_id),
      );
      const next = addFieldAssetCleanup(
        rollbackImportedFields(
          this.snapshot,
          ownedEntryIds,
          projectId,
          ownedSelection,
          priorSelection,
        ),
        ownedAssetIds,
      );
      const durable = await this.writeVerifiedSnapshot(next);
      this.acceptDurableSnapshot(next, durable);
      this.snapshot = addFieldAssetCleanup(
        rollbackImportedFields(
          this.snapshot,
          ownedEntryIds,
          projectId,
          ownedSelection,
          priorSelection,
        ),
        ownedAssetIds,
      );
      this.recordDurableWrite(writtenRevision);
      for (const entryId of ownedEntryIds) {
        this.issuedEntryIds.delete(entryId);
      }
      await this.completePendingFieldAssetCleanup();
    });
  }

  private queueWrite(): void {
    const write = this.pendingWrite.then(async () => {
      const snapshot = this.getSnapshot();
      const revision = this.snapshotRevision;
      try {
        const durable = await this.writeQueuedSnapshot(snapshot);
        this.acceptDurableSnapshot(snapshot, durable);
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
  ): Promise<LegacyFieldBackgroundMigration> {
    await this.reapExpiredFieldAssetStaging();
    await this.completePendingFieldAssetCleanup();
    const operationBase = this.getSnapshot();
    const assetId = this.allocateAssetId();
    const entry = this.normalizedEntry({
      id: entryId,
      asset_id: assetId,
      name: input.name,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: bytes.byteLength,
      created_at: this.now().toISOString(),
      geometry: structuredClone(input.geometry),
    });
    await this.stageFieldAssets([assetId]);
    const concurrentExisting = this.snapshot.field_backgrounds.find(
      (candidate) => candidate.id === entryId,
    );
    if (concurrentExisting) {
      await this.discardStagedAssetsBestEffort([assetId]);
      if (!releaseReservationForDeterministicRetry) {
        throw new Error(`Duplicate Field Background ID ${entryId}`);
      }
      const existingBytes = await this.adapter.readFieldAsset(
        concurrentExisting.asset_id,
      );
      if (!existingBytes || !bytesEqual(existingBytes, bytes)) {
        throw new FieldBackgroundAssetVerificationError(entryId);
      }
      await this.verifyDurableEntry(concurrentExisting);
      return { entry: structuredClone(concurrentExisting), created: false };
    }
    try {
      await this.writeVerifiedAsset(assetId, bytes);
    } catch (error) {
      await this.discardStagedAssetsBestEffort([assetId]);
      this.issuedEntryIds.delete(entryId);
      throw error;
    }

    const next = removeFieldAssetStaging(
      this.withFieldEntries([...this.snapshot.field_backgrounds, entry]),
      new Set([assetId]),
    );
    const writtenRevision = this.snapshotRevision;
    let durable: UserData;
    try {
      durable = await this.persistWithRetry(next);
    } catch (error) {
      if (!(error instanceof UserDataWriteOutcomeUnknownError)) {
        try {
          const document = await this.adapter.read();
          const persisted = migrateUserData(document?.data ?? null);
          if (
            !persisted.field_backgrounds.some(
              (candidate) => candidate.id === entryId,
            )
          ) {
            await this.discardStagedAssetsBestEffort([assetId]);
            this.issuedEntryIds.delete(entryId);
          }
        } catch {
          // Keep possibly referenced bytes when the metadata outcome is unknown.
        }
      }
      // The asset may already be referenced durably. Deterministic imports can
      // safely reclaim the same identity and bytes; ordinary creates retain
      // their reservation so a random collision cannot replace it.
      if (releaseReservationForDeterministicRetry) {
        this.issuedEntryIds.delete(entryId);
      }
      throw error;
    }
    const volatileSnapshot = this.getSnapshot();
    this.acceptDurableSnapshot(next, durable);
    this.snapshot = mergeConcurrentUserData(
      operationBase,
      volatileSnapshot,
      durable,
    );
    const durableEntry = durable.field_backgrounds.find(
      (candidate) => candidate.id === entryId,
    );
    if (!durableEntry) {
      await this.discardStagedAssetsBestEffort([assetId]);
      throw new UserDataVerificationError();
    }
    if (!sameUserData(durableEntry, entry)) {
      if (!releaseReservationForDeterministicRetry) {
        throw new Error(`Duplicate Field Background ID ${entryId}`);
      }
      await this.discardStagedAssetsBestEffort([assetId]);
      this.recordDurableWrite(writtenRevision);
      await this.verifyDurableEntry(durableEntry);
      return { entry: structuredClone(durableEntry), created: false };
    }
    this.snapshot = removeFieldAssetStaging(
      this.snapshot,
      new Set([assetId]),
    );
    this.recordDurableWrite(writtenRevision);
    await this.verifyDurableEntry(durableEntry);
    return { entry: structuredClone(durableEntry), created: true };
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
    const document = await this.adapter.read();
    const persisted = migrateUserData(document?.data ?? null);
    const durableEntry = persisted.field_backgrounds.find(
      (candidate) => candidate.id === entry.id,
    );
    if (!durableEntry || !sameUserData(durableEntry, entry)) {
      throw new UserDataVerificationError();
    }
  }

  private async writeVerifiedSnapshot(snapshot: UserData): Promise<UserData> {
    return this.persistWithRetry(snapshot);
  }

  private async writeQueuedSnapshot(snapshot: UserData): Promise<UserData> {
    return this.persistWithRetry(migrateUserData(snapshot));
  }

  private async persistWithRetry(initial: UserData): Promise<UserData> {
    let base = this.durableSnapshot;
    let desired = migrateUserData(initial);
    let expectedRevision = this.storageRevision;
    let lastError: unknown;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const result = await this.adapter.compareAndSwap(
          expectedRevision,
          desired,
        );
        if (result.status === "written") {
          this.storageRevision = result.revision;
          this.durableSnapshot = cloneUserData(desired);
          return desired;
        }
        const remote = migrateUserData(result.document.data);
        expectedRevision = result.document.revision;
        desired = mergeConcurrentUserData(base, desired, remote);
        base = remote;
        continue;
      } catch (error) {
        lastError = error;
        let document: VersionedUserData | null;
        try {
          document = await this.adapter.read();
        } catch {
          throw new UserDataWriteOutcomeUnknownError(error);
        }
        if (!document || document.revision <= expectedRevision) {
          throw error;
        }
        const remote = migrateUserData(document.data);
        if (
          sameUserData(mergeConcurrentUserData(base, desired, remote), remote)
        ) {
          this.storageRevision = document.revision;
          this.durableSnapshot = cloneUserData(remote);
          return remote;
        }
        expectedRevision = document.revision;
        desired = mergeConcurrentUserData(base, desired, remote);
        base = remote;
      }
    }
    throw lastError ?? new UserDataVerificationError();
  }

  private acceptDurableSnapshot(desired: UserData, durable: UserData): void {
    this.snapshot = mergeConcurrentUserData(desired, this.snapshot, durable);
    this.durableSnapshot = cloneUserData(durable);
    for (const entry of durable.field_backgrounds) {
      this.issuedEntryIds.add(entry.id);
      this.issuedAssetIds.add(entry.asset_id);
    }
    for (const assetId of durable.field_asset_cleanup_ids) {
      this.issuedAssetIds.add(assetId);
    }
    for (const staging of durable.field_asset_staging) {
      this.issuedAssetIds.add(staging.asset_id);
    }
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
    if (this.availability !== "ready") {
      throw new UserDataReadOnlyError(this.availability);
    }
  }

  private failInitialization(
    availability: "unavailable" | "read-only",
    error: unknown,
  ): UserDataInitializationError {
    const failure = new UserDataInitializationError(availability, error);
    this.availability = availability;
    this.availabilityError = failure;
    return failure;
  }

  private resetVolatileState(): void {
    this.snapshot = cloneUserData(defaultUserData);
    this.durableSnapshot = cloneUserData(defaultUserData);
    this.storageRevision = 0;
    this.pendingWrite = Promise.resolve();
    this.snapshotRevision = 0;
    this.durableRevision = 0;
    this.writeFailures.clear();
    this.issuedEntryIds.clear();
    this.issuedAssetIds.clear();
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

  private allocateAssetId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const supplied = this.options.assetIdFactory?.();
      const random =
        supplied ??
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const candidate = supplied ?? `asset-${random}`;
      if (
        isSafeFieldBackgroundId(candidate) &&
        !this.issuedAssetIds.has(candidate)
      ) {
        this.issuedAssetIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("Could not allocate a unique Field Background asset ID");
  }

  private async stageFieldAssets(assetIds: readonly string[]): Promise<void> {
    if (assetIds.length === 0) return;
    const writtenRevision = this.snapshotRevision;
    const leaseMs = this.options.stagingLeaseMs ?? 60 * 60 * 1000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("Invalid Field asset staging lease");
    }
    const expiresAt = this.now().getTime() + leaseMs;
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
      throw new Error("Invalid Field asset staging lease");
    }
    const records = assetIds.map((assetId) => ({
      asset_id: assetId,
      owner_id: this.sessionId,
      expires_at_ms: expiresAt,
    }));
    const next = addFieldAssetStaging(this.snapshot, records);
    const durable = await this.persistWithRetry(next);
    this.acceptDurableSnapshot(next, durable);
    this.snapshot = addFieldAssetStaging(this.snapshot, records);
    this.recordDurableWrite(writtenRevision);
  }

  private hasExpiredFieldAssetStaging(): boolean {
    const now = this.now().getTime();
    return this.snapshot.field_asset_staging.some(
      (entry) => entry.expires_at_ms <= now,
    );
  }

  private async reapExpiredFieldAssetStaging(): Promise<void> {
    const now = this.now().getTime();
    const expiredIds = new Set(
      this.snapshot.field_asset_staging
        .filter((entry) => entry.expires_at_ms <= now)
        .map((entry) => entry.asset_id),
    );
    if (expiredIds.size === 0) return;
    const writtenRevision = this.snapshotRevision;
    const next = addFieldAssetCleanup(
      removeFieldAssetStaging(this.snapshot, expiredIds),
      expiredIds,
    );
    const durable = await this.persistWithRetry(next);
    this.acceptDurableSnapshot(next, durable);
    this.snapshot = addFieldAssetCleanup(
      removeFieldAssetStaging(this.snapshot, expiredIds),
      expiredIds,
    );
    this.recordDurableWrite(writtenRevision);
    await this.completePendingFieldAssetCleanup();
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

  private async discardStagedAssetsBestEffort(
    assetIds: readonly string[],
  ): Promise<void> {
    const deletedIds = new Set<string>();
    for (const assetId of assetIds) {
      try {
        await this.adapter.deleteFieldAsset(assetId);
        if ((await this.adapter.readFieldAsset(assetId)) === null) {
          deletedIds.add(assetId);
        }
      } catch {
        // The durable staging lease keeps failed compensation discoverable.
      }
    }
    if (deletedIds.size === 0) return;
    try {
      const writtenRevision = this.snapshotRevision;
      const next = removeFieldAssetStaging(this.snapshot, deletedIds);
      const durable = await this.persistWithRetry(next);
      this.acceptDurableSnapshot(next, durable);
      this.snapshot = removeFieldAssetStaging(this.snapshot, deletedIds);
      this.recordDurableWrite(writtenRevision);
      for (const assetId of deletedIds) {
        if (
          !this.snapshot.field_backgrounds.some(
            (entry) => entry.asset_id === assetId,
          ) &&
          !this.snapshot.field_asset_cleanup_ids.includes(assetId) &&
          !this.snapshot.field_asset_staging.some(
            (entry) => entry.asset_id === assetId,
          )
        ) {
          this.issuedAssetIds.delete(assetId);
        }
      }
    } catch {
      // Missing bytes plus a durable lease are safe and retryable on expiry.
    }
  }

  private async completePendingFieldAssetCleanup(): Promise<void> {
    const ownedIds = [...this.snapshot.field_asset_cleanup_ids];
    if (ownedIds.length === 0) {
      return;
    }
    for (const entryId of ownedIds) {
      await this.adapter.deleteFieldAsset(entryId);
      if ((await this.adapter.readFieldAsset(entryId)) !== null) {
        throw new FieldBackgroundAssetDeletionError(entryId);
      }
    }

    const writtenRevision = this.snapshotRevision;
    const ownedIdSet = new Set(ownedIds);
    const next = removeFieldAssetCleanup(this.snapshot, ownedIdSet);
    const durable = await this.persistWithRetry(next);
    this.acceptDurableSnapshot(next, durable);
    this.snapshot = removeFieldAssetCleanup(this.snapshot, ownedIdSet);
    this.recordDurableWrite(writtenRevision);
    for (const assetId of ownedIds) {
      if (
        !this.snapshot.field_backgrounds.some(
          (entry) => entry.asset_id === assetId,
        ) &&
        !this.snapshot.field_asset_cleanup_ids.includes(assetId) &&
        !this.snapshot.field_asset_staging.some(
          (entry) => entry.asset_id === assetId,
        )
      ) {
        this.issuedAssetIds.delete(assetId);
      }
    }
    this.availabilityError = null;
  }
}

function withSelectedFieldBackground(
  projectViews: UserData["project_views"],
  projectId: string,
  selectedFieldId: string | null,
): UserData["project_views"] {
  const nextViews = structuredClone(projectViews);
  const nextView: ProjectViewPreferences = { ...(nextViews[projectId] ?? {}) };
  if (selectedFieldId) {
    nextView.selected_field_background_id = selectedFieldId;
  } else {
    delete nextView.selected_field_background_id;
  }
  if (Object.keys(nextView).length > 0) {
    nextViews[projectId] = nextView;
  } else {
    delete nextViews[projectId];
  }
  return nextViews;
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

function addFieldAssetCleanup(
  snapshot: UserData,
  entryIds: Iterable<string>,
): UserData {
  return migrateUserData({
    ...snapshot,
    field_asset_cleanup_ids: [
      ...new Set([...snapshot.field_asset_cleanup_ids, ...entryIds]),
    ],
  });
}

function removeFieldAssetCleanup(
  snapshot: UserData,
  entryIds: ReadonlySet<string>,
): UserData {
  return migrateUserData({
    ...snapshot,
    field_asset_cleanup_ids: snapshot.field_asset_cleanup_ids.filter(
      (entryId) => !entryIds.has(entryId),
    ),
  });
}

function addFieldAssetStaging(
  snapshot: UserData,
  records: readonly FieldAssetStagingEntry[],
): UserData {
  const byAssetId = new Map(
    snapshot.field_asset_staging.map((entry) => [entry.asset_id, entry]),
  );
  for (const record of records) {
    byAssetId.set(record.asset_id, structuredClone(record));
  }
  return migrateUserData({
    ...snapshot,
    field_asset_staging: [...byAssetId.values()],
  });
}

function removeFieldAssetStaging(
  snapshot: UserData,
  assetIds: ReadonlySet<string>,
): UserData {
  return migrateUserData({
    ...snapshot,
    field_asset_staging: snapshot.field_asset_staging.filter(
      (entry) => !assetIds.has(entry.asset_id),
    ),
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

function mergeConcurrentUserData(
  base: UserData,
  local: UserData,
  remote: UserData,
): UserData {
  const fieldBackgrounds = mergeFieldBackgrounds(
    base.field_backgrounds,
    local.field_backgrounds,
    remote.field_backgrounds,
  );
  const referencedAssetIds = new Set(
    fieldBackgrounds.map((entry) => entry.asset_id),
  );
  const displacedAssetIds = new Set(
    [...local.field_backgrounds, ...remote.field_backgrounds]
      .map((entry) => entry.asset_id)
      .filter((assetId) => !referencedAssetIds.has(assetId)),
  );
  const fieldAssetStaging = mergeFieldAssetStaging(
    base.field_asset_staging,
    local.field_asset_staging,
    remote.field_asset_staging,
  ).filter(
    (entry) =>
      !referencedAssetIds.has(entry.asset_id) &&
      !displacedAssetIds.has(entry.asset_id),
  );
  const stagedAssetIds = new Set(
    fieldAssetStaging.map((entry) => entry.asset_id),
  );
  const fieldAssetCleanupIds = [
    ...new Set([
      ...mergeCleanupIds(
    base.field_asset_cleanup_ids,
    local.field_asset_cleanup_ids,
    remote.field_asset_cleanup_ids,
      ),
      ...displacedAssetIds,
    ]),
  ].filter(
    (assetId) =>
      !referencedAssetIds.has(assetId) && !stagedAssetIds.has(assetId),
  );
  const deletedFieldIds = new Set(
    base.field_backgrounds
      .map((entry) => entry.id)
      .filter(
        (entryId) =>
          !local.field_backgrounds.some((entry) => entry.id === entryId) ||
          !remote.field_backgrounds.some((entry) => entry.id === entryId),
      ),
  );
  const projectViews = mergeRecord(
    base.project_views,
    local.project_views,
    remote.project_views,
    (baseView, localView, remoteView) =>
      mergeOptionalRecord(baseView, localView, remoteView),
  );
  for (const [projectId, view] of Object.entries(projectViews)) {
    if (
      view.selected_field_background_id &&
      deletedFieldIds.has(view.selected_field_background_id)
    ) {
      const cleaned = { ...view };
      delete cleaned.selected_field_background_id;
      if (Object.keys(cleaned).length === 0) {
        delete projectViews[projectId];
      } else {
        projectViews[projectId] = cleaned;
      }
    }
  }

  return migrateUserData({
    ...remote,
    editor_layout: {
      inspector_tab: mergeValue(
        base.editor_layout.inspector_tab,
        local.editor_layout.inspector_tab,
        remote.editor_layout.inspector_tab,
      ),
      inspector_width: mergeValue(
        base.editor_layout.inspector_width,
        local.editor_layout.inspector_width,
        remote.editor_layout.inspector_width,
      ),
      show_ghost_paths: mergeValue(
        base.editor_layout.show_ghost_paths,
        local.editor_layout.show_ghost_paths,
        remote.editor_layout.show_ghost_paths,
      ),
    },
    // Tour completion is monotonic; concurrent tabs completing different tours
    // should retain both accomplishments.
    completed_tour_ids: [
      ...new Set([...remote.completed_tour_ids, ...local.completed_tour_ids]),
    ],
    automatic_generation: {
      keep_in_sync: mergeValue(
        base.automatic_generation.keep_in_sync,
        local.automatic_generation.keep_in_sync,
        remote.automatic_generation.keep_in_sync,
      ),
    },
    project_views: projectViews,
    field_backgrounds: fieldBackgrounds,
    field_asset_cleanup_ids: fieldAssetCleanupIds,
    field_asset_staging: fieldAssetStaging,
  });
}

function mergeFieldAssetStaging(
  baseEntries: readonly FieldAssetStagingEntry[],
  localEntries: readonly FieldAssetStagingEntry[],
  remoteEntries: readonly FieldAssetStagingEntry[],
): FieldAssetStagingEntry[] {
  const base = new Map(baseEntries.map((entry) => [entry.asset_id, entry]));
  const local = new Map(localEntries.map((entry) => [entry.asset_id, entry]));
  const remote = new Map(remoteEntries.map((entry) => [entry.asset_id, entry]));
  const merged: FieldAssetStagingEntry[] = [];
  for (const assetId of new Set([
    ...base.keys(),
    ...local.keys(),
    ...remote.keys(),
  ])) {
    const baseEntry = base.get(assetId);
    const localEntry = local.get(assetId);
    const remoteEntry = remote.get(assetId);
    if (baseEntry && (!localEntry || !remoteEntry)) continue;
    const selected = localEntry ?? remoteEntry;
    if (selected) merged.push(structuredClone(selected));
  }
  return merged;
}

function mergeCleanupIds(
  baseIds: readonly string[],
  localIds: readonly string[],
  remoteIds: readonly string[],
): string[] {
  const base = new Set(baseIds);
  const local = new Set(localIds);
  const remote = new Set(remoteIds);
  const merged: string[] = [];
  for (const entryId of new Set([...base, ...local, ...remote])) {
    if (base.has(entryId)) {
      // Either cleanup owner may verify deletion and clear the tombstone.
      if (local.has(entryId) && remote.has(entryId)) merged.push(entryId);
      continue;
    }
    if (local.has(entryId) || remote.has(entryId)) merged.push(entryId);
  }
  return merged;
}

function mergeFieldBackgrounds(
  baseEntries: readonly FieldBackgroundEntry[],
  localEntries: readonly FieldBackgroundEntry[],
  remoteEntries: readonly FieldBackgroundEntry[],
): FieldBackgroundEntry[] {
  const base = new Map(baseEntries.map((entry) => [entry.id, entry]));
  const local = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remote = new Map(remoteEntries.map((entry) => [entry.id, entry]));
  const merged = new Map<string, FieldBackgroundEntry>();
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);

  for (const id of ids) {
    const baseEntry = base.get(id);
    const localEntry = local.get(id);
    const remoteEntry = remote.get(id);
    if (baseEntry && (!localEntry || !remoteEntry)) {
      // Once either owner deletes durable metadata, a stale full-document write
      // must not resurrect it (or its Project selection).
      continue;
    }
    if (!localEntry) {
      if (remoteEntry) merged.set(id, remoteEntry);
      continue;
    }
    if (!remoteEntry) {
      merged.set(id, localEntry);
      continue;
    }
    if (!baseEntry) {
      // The remote CAS winner owns a concurrently allocated identity. Equal
      // deterministic imports converge; a divergent random-ID collision is
      // surfaced by the caller rather than replacing the winner's metadata.
      merged.set(id, remoteEntry);
      continue;
    }
    merged.set(
      id,
      mergeFieldBackgroundEntry(baseEntry, localEntry, remoteEntry),
    );
  }
  return [...merged.values()].map((entry) => structuredClone(entry));
}

function mergeFieldBackgroundEntry(
  base: FieldBackgroundEntry,
  local: FieldBackgroundEntry,
  remote: FieldBackgroundEntry,
): FieldBackgroundEntry {
  if (!sameUserData(base.asset_id, local.asset_id)) {
    return structuredClone(local);
  }
  if (!sameUserData(base.asset_id, remote.asset_id)) {
    return structuredClone(remote);
  }
  return {
    id: base.id,
    asset_id: base.asset_id,
    name: mergeValue(base.name, local.name, remote.name),
    file_name: mergeValue(base.file_name, local.file_name, remote.file_name),
    mime_type: mergeValue(base.mime_type, local.mime_type, remote.mime_type),
    size_bytes: mergeValue(
      base.size_bytes,
      local.size_bytes,
      remote.size_bytes,
    ),
    created_at: mergeValue(
      base.created_at,
      local.created_at,
      remote.created_at,
    ),
    geometry: {
      length_meters: mergeValue(
        base.geometry.length_meters,
        local.geometry.length_meters,
        remote.geometry.length_meters,
      ),
      width_meters: mergeValue(
        base.geometry.width_meters,
        local.geometry.width_meters,
        remote.geometry.width_meters,
      ),
      coordinate_offset_meters: mergeValue(
        base.geometry.coordinate_offset_meters,
        local.geometry.coordinate_offset_meters,
        remote.geometry.coordinate_offset_meters,
      ),
      coordinate_offset_x_meters: mergeValue(
        base.geometry.coordinate_offset_x_meters,
        local.geometry.coordinate_offset_x_meters,
        remote.geometry.coordinate_offset_x_meters,
      ),
      coordinate_offset_y_meters: mergeValue(
        base.geometry.coordinate_offset_y_meters,
        local.geometry.coordinate_offset_y_meters,
        remote.geometry.coordinate_offset_y_meters,
      ),
    },
  };
}

function mergeOptionalRecord<T extends object>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
): T | undefined {
  const result: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local ?? {}),
    ...Object.keys(remote ?? {}),
  ]);
  for (const key of keys) {
    const baseRecord = base as Record<string, unknown> | undefined;
    const localRecord = local as Record<string, unknown> | undefined;
    const remoteRecord = remote as Record<string, unknown> | undefined;
    const baseHas = baseRecord ? Object.hasOwn(baseRecord, key) : false;
    const localHas = localRecord ? Object.hasOwn(localRecord, key) : false;
    const remoteHas = remoteRecord ? Object.hasOwn(remoteRecord, key) : false;
    if (baseHas && (!localHas || !remoteHas)) continue;
    if (!localHas) {
      if (remoteHas) result[key] = remoteRecord?.[key];
      continue;
    }
    if (!remoteHas) {
      result[key] = localRecord?.[key];
      continue;
    }
    result[key] = mergeValue(
      baseRecord?.[key],
      localRecord?.[key],
      remoteRecord?.[key],
    );
  }
  return Object.keys(result).length > 0 ? (result as T) : undefined;
}

function mergeRecord<T extends object>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
  mergeEntry: (
    baseEntry: T | undefined,
    localEntry: T | undefined,
    remoteEntry: T | undefined,
  ) => T | undefined,
): Record<string, T> {
  const result: Record<string, T> = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    const entry = mergeEntry(base[key], local[key], remote[key]);
    if (entry) result[key] = entry;
  }
  return result;
}

function mergeValue<T>(base: T, local: T, remote: T): T {
  return sameUserData(base, local)
    ? structuredClone(remote)
    : structuredClone(local);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
