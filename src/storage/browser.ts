import { deserializeProjectDocument } from "../core/io/projectSerde";
import { openProjectFromLegacyWorkspace } from "../core/io/legacyWorkspace";
import { cloneProject, type Project } from "../core/model/project";
import {
  deserializeProjectWorkspaceDocument,
  projectDocumentToWorkspaceDocument,
} from "../core/io/workspaceSerde";
import {
  assertLegacyProjectDocument,
  assertLegacyProjectWorkspaceDocument,
} from "../core/io/legacyMigrationValidation";
import {
  openProjectFiles,
  serializeProjectFiles,
  type ProjectFileDamage,
  type ProjectTextFile,
} from "../core/io/projectFiles";
import {
  ProjectPersistenceDamageError,
  ProjectNotFoundError,
  StorageConflictError,
  compareWorkspaceSummaries,
  createBLineWorkspaceArchive,
  type FieldAssetPayload,
  type CurrentWorkspaceAdapter,
  type ProjectWorkspaceSummary,
  type StoredProjectRecord,
  type LegacyStoredWorkspaceRecord,
  type LegacyProjectMigrationPreparation,
  type WriteResult,
} from "./adapter";

export interface BrowserStorageOptions {
  storage?: StorageLike;
  keyPrefix?: string;
  currentWorkspaceKey?: string;
  legacyProjectKeyPrefix?: string;
  now?: () => Date;
  fieldAssetDbName?: string;
}

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultKeyPrefix = "bline-web:workspace:";
const defaultCurrentWorkspaceKey = "bline-web:current-workspace";
const defaultLegacyProjectKeyPrefix = "bline-web:project:";
const defaultFieldAssetDbName = "bline-web-field-assets";
const fieldAssetStoreName = "field-assets";

export class BrowserStorage implements CurrentWorkspaceAdapter {
  private readonly storage: StorageLike;
  private readonly keyPrefix: string;
  private readonly currentWorkspaceKey: string;
  private readonly legacyProjectKeyPrefix: string;
  private readonly now: () => Date;
  private readonly fieldAssetDbName: string;
  private fieldAssetDbPromise: Promise<IDBDatabase> | null = null;
  private readonly damageById = new Map<string, ProjectFileDamage>();
  private readonly pendingLegacyProjects = new Map<string, Project>();

  constructor(options: BrowserStorageOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyPrefix = options.keyPrefix ?? defaultKeyPrefix;
    this.currentWorkspaceKey =
      options.currentWorkspaceKey ?? defaultCurrentWorkspaceKey;
    this.legacyProjectKeyPrefix =
      options.legacyProjectKeyPrefix ?? defaultLegacyProjectKeyPrefix;
    this.now = options.now ?? (() => new Date());
    this.fieldAssetDbName = options.fieldAssetDbName ?? defaultFieldAssetDbName;
  }

  async initialize(): Promise<void> {
    // Legacy data is migrated explicitly after its Project has been opened.
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return this.listSummaries().sort(compareWorkspaceSummaries);
  }

  async readProject(id?: string): Promise<Project> {
    const workspaceId =
      id ?? (await this.getCurrentWorkspaceId()) ?? this.listSummaries()[0]?.id;
    if (!workspaceId) {
      throw new ProjectNotFoundError("workspace");
    }

    const canonicalRecord = this.readRecord(workspaceId);
    const legacySource = canonicalRecord
      ? null
      : this.readLegacyMigrationSource(workspaceId);
    if (legacySource) {
      const legacy = legacySource.record;
      let damage: ProjectFileDamage | null = null;
      try {
        assertLegacyEnvelope(legacy);
        assertLegacyMigrationDocument(legacy);
      } catch (error) {
        damage = legacyDamage(error, legacy.rawText);
      }
      const project = projectFromLegacyMigrationRecord(legacy);
      this.pendingLegacyProjects.set(workspaceId, project);
      if (damage) this.damageById.set(workspaceId, damage);
      else this.damageById.delete(workspaceId);
      return project;
    }

    const record = canonicalRecord ?? this.requireRecord(workspaceId);
    const opened = openProjectFiles(record.files, {
      fallbackProjectId: workspaceId,
    });
    let project = opened.project;
    let damage = record.persistenceDamage ?? opened.damage;
    if (!damage && record.legacyDocument) {
      try {
        if (record.legacySourceRecord) {
          const provenance = parseLegacyMigrationRecord(
            record.legacySourceRecord,
          );
          if (!provenance) {
            throw new Error("Legacy Project migration provenance is malformed");
          }
          assertLegacyEnvelope(provenance);
          if (
            provenance.version !== record.legacySourceVersion ||
            !sameJsonDocument(provenance.document, record.legacyDocument)
          ) {
            throw new Error(
              "Legacy Project migration provenance no longer matches",
            );
          }
        }
        const legacyRecord = parseLegacyMigrationRecord(
          record.legacySourceRecord ??
            JSON.stringify({
              document: record.legacyDocument,
              version: record.legacySourceVersion ?? record.version,
              updatedAt: record.updatedAt,
            }),
        );
        if (!legacyRecord) {
          throw new Error("Legacy Project migration provenance is malformed");
        }
        assertLegacyMigrationDocument(legacyRecord);
        const legacyProject = projectFromLegacyMigrationRecord(legacyRecord);
        project = {
          ...project,
          config: {
            ...project.config,
            gui: {
              ...project.config.gui,
              field: structuredClone(legacyProject.config.gui.field),
            },
          },
        };
        this.pendingLegacyProjects.set(workspaceId, project);
      } catch (error) {
        damage = {
          sourcePath: "legacy Project metadata",
          message: error instanceof Error ? error.message : String(error),
          rawText:
            record.legacySourceRecord ?? JSON.stringify(record.legacyDocument),
        };
      }
    }
    if (damage) {
      this.damageById.set(workspaceId, damage);
    } else {
      this.damageById.delete(workspaceId);
    }
    return project;
  }

  async writeProject(
    project: Project,
    expectedVersion?: string,
    requestedStorageId?: string,
  ): Promise<WriteResult> {
    const storageId =
      requestedStorageId ??
      (await this.getCurrentWorkspaceId()) ??
      project.project_id;
    const damage = this.damageById.get(storageId);
    if (damage) {
      throw new ProjectPersistenceDamageError(damage);
    }
    const storedDamage = this.readRecord(storageId)?.persistenceDamage;
    if (storedDamage) {
      throw new ProjectPersistenceDamageError(storedDamage);
    }
    const pendingLegacyProject = this.pendingLegacyProjects.get(storageId);
    if (pendingLegacyProject?.project_id === project.project_id) {
      throw new Error(
        "Legacy Project migration must finish before this Project can be saved",
      );
    }
    return this.writeProjectFilesRecord(project, expectedVersion, storageId);
  }

  async writeNewProject(project: Project): Promise<WriteResult> {
    const previousCurrentId = await this.getCurrentWorkspaceId();
    const targetKey = this.storageKey(project.project_id);
    const legacyTargetKey = this.legacyProjectKey(project.project_id);
    const existing = this.readVersionedRecord(project.project_id);
    if (
      this.storage.getItem(targetKey) !== null ||
      this.storage.getItem(legacyTargetKey) !== null
    ) {
      throw new StorageConflictError(
        `A saved Project already uses ID ${project.project_id}`,
        undefined,
        existing?.version,
      );
    }

    try {
      return await this.writeProjectFilesRecord(project);
    } catch (error) {
      // The target was proven absent, so removing it is a safe rollback if the
      // current-Project pointer fails after the new record is written.
      this.storage.removeItem(targetKey);
      try {
        await this.setCurrentWorkspaceId(previousCurrentId);
      } catch {
        // Preserve the original import failure when storage itself is unwritable.
      }
      throw error;
    }
  }

  getCurrentProjectDamage(storageId?: string): ProjectFileDamage | null {
    const id = storageId ?? this.storage.getItem(this.currentWorkspaceKey);
    return id ? (this.damageById.get(id) ?? null) : null;
  }

  async replaceDamagedProject(
    project: Project,
    expectedVersion?: string,
    requestedStorageId?: string,
  ): Promise<WriteResult> {
    const storageId =
      requestedStorageId ??
      (await this.getCurrentWorkspaceId()) ??
      project.project_id;
    const canonicalSource = this.readRecord(storageId);
    const legacySource = canonicalSource
      ? null
      : this.readLegacyMigrationSource(storageId);
    const source = canonicalSource ?? legacySource?.record ?? null;
    assertExpectedVersion(source, expectedVersion);

    const sourceKey = legacySource
      ? this.legacyMigrationSourceKey(legacySource)
      : this.storageKey(storageId);
    const workspaceTargetKey = this.storageKey(project.project_id);
    const legacyProjectTargetKey = this.legacyProjectKey(project.project_id);
    const workspaceTargetExists =
      workspaceTargetKey !== sourceKey &&
      this.storage.getItem(workspaceTargetKey) !== null;
    const legacyProjectTargetExists =
      legacyProjectTargetKey !== sourceKey &&
      this.storage.getItem(legacyProjectTargetKey) !== null;
    if (workspaceTargetExists || legacyProjectTargetExists) {
      const target = workspaceTargetExists
        ? (this.readRecord(project.project_id) ??
          this.readLegacyWorkspaceRecord(project.project_id))
        : this.readLegacyProjectRecord(project.project_id);
      throw new StorageConflictError(
        `A different Project already uses ID ${project.project_id}`,
        expectedVersion,
        target?.version,
      );
    }
    const result = await this.writeProjectFilesRecord(
      project,
      expectedVersion,
      storageId,
    );
    if (legacySource?.kind === "project") {
      this.storage.removeItem(this.legacyProjectKey(storageId));
    }
    this.damageById.delete(project.project_id);
    this.damageById.delete(storageId);
    this.pendingLegacyProjects.delete(storageId);
    return result;
  }

  private async writeProjectFilesRecord(
    project: Project,
    expectedVersion?: string,
    sourceStorageId = project.project_id,
  ): Promise<WriteResult> {
    const existing = this.readVersionedRecord(sourceStorageId);
    assertExpectedVersion(existing, expectedVersion);
    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const record: StoredProjectFilesRecord = {
      files: serializeProjectFiles(project),
      version,
      updatedAt,
    };

    this.storage.setItem(
      this.storageKey(project.project_id),
      JSON.stringify(record),
    );
    if (sourceStorageId !== project.project_id) {
      this.storage.removeItem(this.storageKey(sourceStorageId));
    }
    await this.setCurrentWorkspaceId(project.project_id);
    this.pendingLegacyProjects.delete(project.project_id);
    this.pendingLegacyProjects.delete(sourceStorageId);

    return { version, updatedAt };
  }

  async deleteWorkspace(id: string, expectedVersion?: string): Promise<void> {
    const existing = this.readVersionedRecord(id);
    assertExpectedVersion(existing, expectedVersion);
    this.storage.removeItem(this.storageKey(id));
    const legacySource = this.readLegacyProjectRecord(id);
    if (legacySource) {
      this.storage.removeItem(this.legacyProjectKey(id));
    }

    if ((await this.getCurrentWorkspaceId()) === id) {
      const nextId = this.listSummaries()[0]?.id ?? null;
      await this.setCurrentWorkspaceId(nextId);
    }
    this.damageById.delete(id);
    this.pendingLegacyProjects.delete(id);
  }

  async deleteLegacyProjectFiles(
    expectedVersion: string,
    sourceStorageId: string,
    stableProjectId: string,
  ): Promise<WriteResult | null> {
    const record = this.readRecord(stableProjectId);
    if (
      !record?.legacyDocument ||
      (record.legacySourceStorageId ?? stableProjectId) !== sourceStorageId
    ) {
      return null;
    }
    if (record.persistenceDamage) {
      throw new ProjectPersistenceDamageError(record.persistenceDamage);
    }
    const legacy = parseLegacyMigrationRecord(record.legacySourceRecord);
    if (!legacy) {
      throw new Error("Legacy Project migration provenance is missing");
    }
    assertLegacyEnvelope(legacy);
    assertLegacyMigrationDocument(legacy);
    const sourceProject = projectFromLegacyMigrationRecord(legacy);
    if (
      legacy.version !== record.legacySourceVersion ||
      !sameJsonDocument(record.legacyDocument, legacy.document) ||
      !sameProjectFiles(record.files, serializeProjectFiles(sourceProject))
    ) {
      throw new Error("Legacy Project migration provenance no longer matches");
    }
    assertExpectedVersion(record, expectedVersion);
    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const cleaned: StoredProjectFilesRecord = {
      files: record.files,
      version,
      updatedAt,
    };
    this.storage.setItem(
      this.storageKey(stableProjectId),
      JSON.stringify(cleaned),
    );
    this.pendingLegacyProjects.delete(stableProjectId);
    return { version, updatedAt };
  }

  async prepareLegacyProjectMigration(
    project: Project,
    expectedVersion: string,
    sourceStorageId: string,
  ): Promise<LegacyProjectMigrationPreparation> {
    const legacy = this.readLegacyMigrationSource(sourceStorageId);
    if (!legacy) {
      const preparedTarget = this.readRecord(project.project_id);
      const openedTarget = preparedTarget
        ? openProjectFiles(preparedTarget.files, {
            fallbackProjectId: project.project_id,
          })
        : null;
      if (
        preparedTarget?.legacyDocument &&
        preparedTarget.legacySourceStorageId === sourceStorageId &&
        !preparedTarget.persistenceDamage &&
        !openedTarget?.damage &&
        openedTarget?.project.project_id === project.project_id
      ) {
        return {
          status: "already-prepared",
          version: preparedTarget.version,
          updatedAt: preparedTarget.updatedAt,
        };
      }
      return { status: "rejected" };
    }
    assertLegacyEnvelope(legacy.record);
    assertLegacyMigrationDocument(legacy.record);
    assertExpectedVersion(legacy.record, expectedVersion);

    const targetKey = this.storageKey(project.project_id);
    const sourceKey = this.legacyMigrationSourceKey(legacy);
    const legacyProjectTargetKey = this.legacyProjectKey(project.project_id);
    if (
      legacyProjectTargetKey !== sourceKey &&
      this.storage.getItem(legacyProjectTargetKey) !== null
    ) {
      throw new StorageConflictError(
        `A different Project already uses ID ${project.project_id}`,
        expectedVersion,
        this.readLegacyProjectRecord(project.project_id)?.version,
      );
    }
    if (sourceKey !== targetKey) {
      const preparedTarget = this.readRecord(project.project_id);
      const openedTarget = preparedTarget
        ? openProjectFiles(preparedTarget.files, {
            fallbackProjectId: project.project_id,
          })
        : null;
      if (
        preparedTarget?.legacyDocument &&
        preparedTarget.legacySourceStorageId === sourceStorageId &&
        preparedTarget.legacySourceVersion === legacy.record.version &&
        preparedTarget.legacySourceRecord === legacy.record.rawText &&
        sameProjectFiles(
          preparedTarget.files,
          serializeProjectFiles(project),
        ) &&
        sameJsonDocument(
          preparedTarget.legacyDocument,
          legacy.record.document,
        ) &&
        !preparedTarget.persistenceDamage &&
        !openedTarget?.damage &&
        openedTarget?.project.project_id === project.project_id
      ) {
        this.removeLegacyMigrationSource(legacy);
        await this.setCurrentWorkspaceId(project.project_id);
        this.pendingLegacyProjects.delete(sourceStorageId);
        this.pendingLegacyProjects.set(
          project.project_id,
          cloneProject(project),
        );
        return {
          status: "already-prepared",
          version: preparedTarget.version,
          updatedAt: preparedTarget.updatedAt,
        };
      }
      const collision = this.readRecord(project.project_id);
      if (collision || this.storage.getItem(targetKey)) {
        throw new StorageConflictError(
          `A different Project already uses ID ${project.project_id}`,
          expectedVersion,
          collision?.version,
        );
      }
    }

    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const prepared: StoredProjectFilesRecord = {
      files: serializeProjectFiles(project),
      version,
      updatedAt,
      legacyDocument: structuredClone(legacy.record.document),
      legacySourceStorageId: sourceStorageId,
      legacySourceVersion: legacy.record.version,
      legacySourceRecord: legacy.record.rawText,
    };
    this.storage.setItem(
      this.storageKey(project.project_id),
      JSON.stringify(prepared),
    );
    if (
      this.legacyMigrationSourceKey(legacy) !==
      this.storageKey(project.project_id)
    ) {
      this.removeLegacyMigrationSource(legacy);
    }
    await this.setCurrentWorkspaceId(project.project_id);
    this.pendingLegacyProjects.delete(sourceStorageId);
    this.pendingLegacyProjects.set(project.project_id, cloneProject(project));
    return { status: "prepared", version, updatedAt };
  }

  async exportWorkspaceArchive(id?: string): Promise<Blob> {
    const workspaceId = id ?? (await this.getCurrentWorkspaceId());
    if (!workspaceId) {
      throw new ProjectNotFoundError("workspace");
    }

    return createBLineWorkspaceArchive(
      this,
      workspaceId,
      this.now().toISOString(),
    );
  }

  async readFieldAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<FieldAssetPayload | null> {
    const db = await this.openFieldAssetDb();
    const record =
      await runFieldAssetTransaction<BrowserFieldAssetRecord | null>(
        db,
        "readonly",
        (store) => store.get(fieldAssetKey(workspaceId, assetId)),
        (value) => (isBrowserFieldAssetRecord(value) ? value : null),
      );

    return record
      ? {
          fileName: record.fileName,
          mimeType: record.mimeType,
          bytes: new Uint8Array(record.bytes),
        }
      : null;
  }

  async deleteFieldAsset(workspaceId: string, assetId: string): Promise<void> {
    const db = await this.openFieldAssetDb();
    await runFieldAssetTransaction(db, "readwrite", (store) =>
      store.delete(fieldAssetKey(workspaceId, assetId)),
    );
  }

  async getCurrentWorkspaceId(): Promise<string | null> {
    return this.storage.getItem(this.currentWorkspaceKey);
  }

  async setCurrentWorkspaceId(id: string | null): Promise<void> {
    if (id) {
      this.storage.setItem(this.currentWorkspaceKey, id);
    } else {
      this.storage.removeItem(this.currentWorkspaceKey);
    }
  }

  getLegacyProjectMigrationSourceId(
    requestedStorageId?: string,
  ): string | null {
    const storageId =
      requestedStorageId ?? this.storage.getItem(this.currentWorkspaceKey);
    if (!storageId) {
      return null;
    }
    const canonical = this.readRecord(storageId);
    if (canonical?.legacyDocument) {
      return canonical.legacySourceStorageId ?? storageId;
    }
    return this.readLegacyMigrationSource(storageId) ? storageId : null;
  }

  private listSummaries(): ProjectWorkspaceSummary[] {
    const canonical = this.storageKeys().flatMap((key) => {
      if (!key.startsWith(this.keyPrefix)) {
        return [];
      }
      const storageId = decodeURIComponent(key.slice(this.keyPrefix.length));
      const canonical = this.parseRecord(this.storage.getItem(key), storageId);
      if (canonical) {
        return [projectFilesSummaryFromRecord(canonical)];
      }
      const legacy = this.readLegacyWorkspaceRecord(storageId);
      if (!legacy) {
        return [];
      }
      const project = openProjectFromLegacyWorkspace(
        deserializeProjectWorkspaceDocument(legacy.document),
      ).project;
      return [
        {
          id: storageId,
          displayName: project.display_name,
          updatedAt: legacy.updatedAt,
          version: legacy.version,
        },
      ];
    });
    const known = new Set(canonical.map((summary) => summary.id));
    const oldProjects = this.storageKeys().flatMap((key) => {
      if (!key.startsWith(this.legacyProjectKeyPrefix)) return [];
      const id = this.legacyProjectStorageId(key);
      if (known.has(id)) return [];
      const record = this.parseLegacyProjectRecord(this.storage.getItem(key));
      if (!record) return [];
      const document = record.document as unknown as Record<string, unknown>;
      return [
        {
          id,
          displayName:
            typeof document.display_name === "string" &&
            document.display_name.trim()
              ? document.display_name
              : `Recovery Project ${id}`,
          updatedAt: record.updatedAt,
          version: record.version,
        },
      ];
    });
    return [...canonical, ...oldProjects];
  }

  private requireRecord(id: string): ParsedProjectFilesRecord {
    const record = this.readRecord(id);
    if (!record) {
      throw new ProjectNotFoundError(id);
    }
    return record;
  }

  private readRecord(id: string): ParsedProjectFilesRecord | null {
    return this.parseRecord(this.storage.getItem(this.storageKey(id)), id);
  }

  private readLegacyWorkspaceRecord(
    id: string,
  ): ParsedLegacyWorkspaceRecord | null {
    return parseLegacyWorkspaceRecord(
      this.storage.getItem(this.storageKey(id)),
    );
  }

  private readVersionedRecord(
    id: string,
  ):
    | StoredProjectFilesRecord
    | LegacyStoredWorkspaceRecord
    | StoredProjectRecord
    | null {
    return (
      this.readRecord(id) ??
      this.readLegacyWorkspaceRecord(id) ??
      this.readLegacyProjectRecord(id)
    );
  }

  private parseRecord(
    value: string | null,
    storageId: string,
  ): ParsedProjectFilesRecord | null {
    if (value === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!isStoredProjectFilesRecord(parsed)) {
        return null;
      }
      return {
        ...parsed,
        storageId,
        rawText: value,
        persistenceDamage: canonicalRecordDamage(parsed, value),
      };
    } catch {
      return null;
    }
  }

  private readLegacyMigrationSource(
    storageId: string,
  ): LegacyMigrationSource | null {
    const workspace = this.readLegacyWorkspaceRecord(storageId);
    if (workspace) return { kind: "workspace", storageId, record: workspace };
    const project = this.readLegacyProjectRecord(storageId);
    return project ? { kind: "project", storageId, record: project } : null;
  }

  private legacyMigrationSourceKey(source: LegacyMigrationSource): string {
    return source.kind === "workspace"
      ? this.storageKey(source.storageId)
      : this.legacyProjectKey(source.storageId);
  }

  private removeLegacyMigrationSource(source: LegacyMigrationSource): void {
    this.storage.removeItem(this.legacyMigrationSourceKey(source));
  }

  private legacyProjectStorageId(key: string): string {
    const encodedId = key.slice(this.legacyProjectKeyPrefix.length);
    try {
      return decodeURIComponent(encodedId);
    } catch {
      return encodedId;
    }
  }

  private legacyProjectKey(id: string): string {
    return `${this.legacyProjectKeyPrefix}${encodeURIComponent(id)}`;
  }

  private readLegacyProjectRecord(
    id: string,
  ): ParsedLegacyProjectRecord | null {
    const rawText = this.storage.getItem(this.legacyProjectKey(id));
    const record = this.parseLegacyProjectRecord(rawText);
    return record && rawText ? { ...record, rawText } : null;
  }

  private parseLegacyProjectRecord(
    value: string | null,
  ): StoredProjectRecord | null {
    if (value === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return isStoredProjectRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private storageKeys(): string[] {
    return Array.from({ length: this.storage.length }, (_, index) =>
      this.storage.key(index),
    ).filter((key): key is string => key !== null);
  }

  private storageKey(id: string): string {
    return `${this.keyPrefix}${encodeURIComponent(id)}`;
  }

  private openFieldAssetDb(): Promise<IDBDatabase> {
    if (!("indexedDB" in globalThis)) {
      throw new Error("Custom field image storage is unavailable");
    }

    this.fieldAssetDbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.fieldAssetDbName, 1);
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Failed to open field asset store"));
      });
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(fieldAssetStoreName)) {
          db.createObjectStore(fieldAssetStoreName, { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
    });

    return this.fieldAssetDbPromise;
  }
}

interface BrowserFieldAssetRecord {
  key: string;
  workspaceId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  updatedAt: string;
}

interface StoredProjectFilesRecord {
  files: ProjectTextFile[];
  version: string;
  updatedAt: string;
  legacyDocument?:
    | LegacyStoredWorkspaceRecord["document"]
    | StoredProjectRecord["document"];
  legacySourceStorageId?: string;
  legacySourceVersion?: string;
  legacySourceRecord?: string;
}

interface ParsedProjectFilesRecord extends StoredProjectFilesRecord {
  storageId: string;
  rawText: string;
  persistenceDamage: ProjectFileDamage | null;
}

interface ParsedLegacyWorkspaceRecord extends LegacyStoredWorkspaceRecord {
  rawText: string;
}

interface ParsedLegacyProjectRecord extends StoredProjectRecord {
  rawText: string;
}

type ParsedLegacyMigrationRecord =
  | ParsedLegacyWorkspaceRecord
  | ParsedLegacyProjectRecord;

interface LegacyMigrationSource {
  kind: "workspace" | "project";
  storageId: string;
  record: ParsedLegacyMigrationRecord;
}

function assertExpectedVersion(
  existing: { version: string } | null,
  expectedVersion?: string,
): void {
  if (expectedVersion === undefined) {
    return;
  }

  if (existing?.version !== expectedVersion) {
    throw new StorageConflictError(
      "Workspace version does not match expected version",
      expectedVersion,
      existing?.version,
    );
  }
}

function projectFilesSummaryFromRecord(
  record: ParsedProjectFilesRecord,
): ProjectWorkspaceSummary {
  const project = openProjectFiles(record.files, {
    fallbackProjectId: record.storageId,
  }).project;
  return {
    id: record.storageId,
    displayName: project.display_name,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

function createBrowserVersion(updatedAt: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${updatedAt}:${random}`;
}

function fieldAssetKey(workspaceId: string, assetId: string): string {
  return `${encodeURIComponent(workspaceId)}:${encodeURIComponent(assetId)}`;
}

function runFieldAssetTransaction<T = void>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  map: (value: unknown) => T = () => undefined as T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(fieldAssetStoreName, mode);
    const store = transaction.objectStore(fieldAssetStoreName);
    const request = run(store);
    let mappedValue: T = undefined as T;

    request.addEventListener("success", () => {
      mappedValue = map(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Field asset request failed"));
    });
    transaction.addEventListener("complete", () => resolve(mappedValue));
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("Field asset transaction failed"));
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("Field asset transaction aborted"));
    });
  });
}

function isLegacyStoredWorkspaceRecord(
  input: unknown,
): input is LegacyStoredWorkspaceRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<LegacyStoredWorkspaceRecord>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.document === "object" &&
    candidate.document !== null &&
    Array.isArray(candidate.document.paths)
  );
}

function parseLegacyWorkspaceRecord(
  value: string | null | undefined,
): ParsedLegacyWorkspaceRecord | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isLegacyStoredWorkspaceRecord(parsed)
      ? { ...parsed, rawText: value }
      : null;
  } catch {
    return null;
  }
}

function parseLegacyMigrationRecord(
  value: string | null | undefined,
): ParsedLegacyMigrationRecord | null {
  const workspace = parseLegacyWorkspaceRecord(value);
  if (workspace) return workspace;
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isStoredProjectRecord(parsed) ? { ...parsed, rawText: value } : null;
  } catch {
    return null;
  }
}

function assertLegacyEnvelope(input: object): void {
  const source =
    "rawText" in input && typeof input.rawText === "string"
      ? (JSON.parse(input.rawText) as unknown)
      : input;
  const keys =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? Object.keys(source).sort()
      : [];
  if (
    keys.length !== 3 ||
    keys[0] !== "document" ||
    keys[1] !== "updatedAt" ||
    keys[2] !== "version"
  ) {
    throw new Error("Legacy Project envelope contains unsupported data");
  }
}

function legacyDamage(error: unknown, rawText: string): ProjectFileDamage {
  return {
    sourcePath: "legacy Project metadata",
    message: error instanceof Error ? error.message : String(error),
    rawText,
  };
}

function assertLegacyMigrationDocument(
  record: ParsedLegacyMigrationRecord,
): void {
  if (isLegacyWorkspaceDocument(record.document)) {
    assertLegacyProjectWorkspaceDocument(record.document);
  } else {
    assertLegacyProjectDocument(record.document);
  }
}

function projectFromLegacyMigrationRecord(
  record: ParsedLegacyMigrationRecord,
): Project {
  const document = isLegacyWorkspaceDocument(record.document)
    ? deserializeProjectWorkspaceDocument(record.document)
    : projectDocumentToWorkspaceDocument(
        recoverLegacyProjectDocument(record.document),
      );
  return openProjectFromLegacyWorkspace(document).project;
}

function recoverLegacyProjectDocument(input: unknown) {
  try {
    return deserializeProjectDocument(input);
  } catch (error) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw error;
    }
    return deserializeProjectDocument({
      ...(input as Record<string, unknown>),
      schema_version: 1,
    });
  }
}

function isLegacyWorkspaceDocument(
  input: unknown,
): input is LegacyStoredWorkspaceRecord["document"] {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Array.isArray((input as { paths?: unknown }).paths)
  );
}

function isStoredProjectFilesRecord(
  input: unknown,
): input is StoredProjectFilesRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<StoredProjectFilesRecord>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        typeof file.relativePath === "string" &&
        typeof file.text === "string",
    ) &&
    (candidate.legacyDocument === undefined ||
      (typeof candidate.legacyDocument === "object" &&
        candidate.legacyDocument !== null)) &&
    (candidate.legacySourceStorageId === undefined ||
      typeof candidate.legacySourceStorageId === "string") &&
    (candidate.legacySourceVersion === undefined ||
      typeof candidate.legacySourceVersion === "string") &&
    (candidate.legacySourceRecord === undefined ||
      typeof candidate.legacySourceRecord === "string")
  );
}

function canonicalRecordDamage(
  input: StoredProjectFilesRecord,
  rawText: string,
): ProjectFileDamage | null {
  try {
    assertCanonicalRecordShape(input);
    return null;
  } catch (error) {
    return {
      sourcePath: "browser Project record",
      message: error instanceof Error ? error.message : String(error),
      rawText,
    };
  }
}

function assertCanonicalRecordShape(input: StoredProjectFilesRecord): void {
  const allowedRecordKeys = new Set([
    "files",
    "version",
    "updatedAt",
    "legacyDocument",
    "legacySourceStorageId",
    "legacySourceVersion",
    "legacySourceRecord",
  ]);
  const unknownRecordKey = Object.keys(input).find(
    (key) => !allowedRecordKeys.has(key),
  );
  if (unknownRecordKey) {
    throw new Error(
      `Browser Project record contains unsupported field ${unknownRecordKey}`,
    );
  }

  const legacyProvenance = [
    input.legacyDocument,
    input.legacySourceStorageId,
    input.legacySourceVersion,
    input.legacySourceRecord,
  ];
  const provenanceFieldCount = legacyProvenance.filter(
    (value) => value !== undefined,
  ).length;
  if (provenanceFieldCount !== 0 && provenanceFieldCount !== 4) {
    throw new Error(
      "Browser Project record contains incomplete legacy migration provenance",
    );
  }

  for (const file of input.files) {
    const keys = Object.keys(file).sort();
    if (keys.length !== 2 || keys[0] !== "relativePath" || keys[1] !== "text") {
      throw new Error(
        `Browser Project file ${file.relativePath} contains unsupported metadata`,
      );
    }
    if (!isManagedBrowserProjectPath(file.relativePath)) {
      throw new Error(
        `Browser Project record contains unmanaged file ${file.relativePath}`,
      );
    }
  }
}

function isManagedBrowserProjectPath(relativePath: string): boolean {
  return (
    relativePath === "config.json" ||
    relativePath === "project.json" ||
    /^paths\/[^/]+\.json$/.test(relativePath)
  );
}

function sameProjectFiles(
  left: readonly ProjectTextFile[],
  right: readonly ProjectTextFile[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.relativePath === right[index]?.relativePath &&
        file.text === right[index]?.text,
    )
  );
}

function sameJsonDocument(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStoredProjectRecord(input: unknown): input is StoredProjectRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<StoredProjectRecord>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.document === "object" &&
    candidate.document !== null
  );
}

function isBrowserFieldAssetRecord(
  input: unknown,
): input is BrowserFieldAssetRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<BrowserFieldAssetRecord>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.assetId === "string" &&
    typeof candidate.fileName === "string" &&
    typeof candidate.mimeType === "string" &&
    candidate.bytes instanceof ArrayBuffer
  );
}
