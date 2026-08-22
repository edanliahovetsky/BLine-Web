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
  importWorkspaceArchive,
  type FieldAssetPayload,
  type CurrentWorkspaceAdapter,
  type ProjectWorkspaceSummary,
  type StoredProjectRecord,
  type LegacyStoredWorkspaceRecord,
  type WorkspaceImportResult,
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
    this.migrateLegacyProjects();
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    this.migrateLegacyProjects();
    return this.listSummaries().sort(compareWorkspaceSummaries);
  }

  async readProject(id?: string): Promise<Project> {
    this.migrateLegacyProjects();
    const workspaceId =
      id ?? (await this.getCurrentWorkspaceId()) ?? this.listSummaries()[0]?.id;
    if (!workspaceId) {
      throw new ProjectNotFoundError("workspace");
    }

    const legacyRecord = this.readLegacyWorkspaceRecord(workspaceId);
    if (legacyRecord) {
      let damage: ProjectFileDamage | null = null;
      try {
        assertLegacyProjectWorkspaceDocument(legacyRecord.document);
      } catch (error) {
        damage = {
          sourcePath: "legacy Project metadata",
          message: error instanceof Error ? error.message : String(error),
          rawText: JSON.stringify(legacyRecord.document),
        };
      }
      const project = openProjectFromLegacyWorkspace(
        deserializeProjectWorkspaceDocument(legacyRecord.document),
      ).project;
      this.pendingLegacyProjects.set(workspaceId, project);
      if (damage) {
        this.damageById.set(workspaceId, damage);
      } else {
        this.damageById.delete(workspaceId);
      }
      return project;
    }

    const record = this.requireRecord(workspaceId);
    const opened = openProjectFiles(record.files, {
      fallbackProjectId: workspaceId,
    });
    let project = opened.project;
    let damage = opened.damage;
    if (
      !damage &&
      record.legacyDocument &&
      isLegacyWorkspaceDocument(record.legacyDocument)
    ) {
      try {
        assertLegacyProjectWorkspaceDocument(record.legacyDocument);
        const legacyProject = openProjectFromLegacyWorkspace(
          deserializeProjectWorkspaceDocument(record.legacyDocument),
        ).project;
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
          rawText: JSON.stringify(record.legacyDocument),
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
  ): Promise<WriteResult> {
    const currentStorageId = await this.getCurrentWorkspaceId();
    const damage = this.damageById.get(currentStorageId ?? project.project_id);
    if (damage) {
      throw new ProjectPersistenceDamageError(damage);
    }
    const pendingLegacyProject = currentStorageId
      ? this.pendingLegacyProjects.get(currentStorageId)
      : undefined;
    if (pendingLegacyProject?.project_id === project.project_id) {
      throw new Error(
        "Legacy Project migration must finish before this Project can be saved",
      );
    }
    return this.writeProjectFilesRecord(project, expectedVersion);
  }

  getCurrentProjectDamage(): ProjectFileDamage | null {
    const id = this.storage.getItem(this.currentWorkspaceKey);
    return id ? (this.damageById.get(id) ?? null) : null;
  }

  async replaceDamagedProject(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const result = await this.writeProjectFilesRecord(project, expectedVersion);
    this.damageById.delete(project.project_id);
    return result;
  }

  private async writeProjectFilesRecord(
    project: Project,
    expectedVersion?: string,
    sourceStorageId = project.project_id,
  ): Promise<WriteResult> {
    this.migrateLegacyProjects();
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
    this.migrateLegacyProjects();
    const existing = this.readVersionedRecord(id);
    assertExpectedVersion(existing, expectedVersion);
    this.storage.removeItem(this.storageKey(id));

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
  ): Promise<WriteResult | null> {
    const currentStorageId = await this.getCurrentWorkspaceId();
    if (
      currentStorageId !== sourceStorageId &&
      currentStorageId !== project.project_id
    ) {
      return null;
    }
    const legacy = this.readLegacyWorkspaceRecord(sourceStorageId);
    if (!legacy) {
      return null;
    }
    assertLegacyProjectWorkspaceDocument(legacy.document);
    assertExpectedVersion(legacy, expectedVersion);

    if (sourceStorageId !== project.project_id) {
      const preparedTarget = this.readRecord(project.project_id);
      const openedTarget = preparedTarget
        ? openProjectFiles(preparedTarget.files, {
            fallbackProjectId: project.project_id,
          })
        : null;
      if (
        preparedTarget?.legacyDocument &&
        preparedTarget.legacySourceStorageId === sourceStorageId &&
        preparedTarget.legacySourceVersion === legacy.version &&
        sameProjectFiles(
          preparedTarget.files,
          serializeProjectFiles(project),
        ) &&
        sameJsonDocument(preparedTarget.legacyDocument, legacy.document) &&
        !openedTarget?.damage &&
        openedTarget?.project.project_id === project.project_id
      ) {
        this.storage.removeItem(this.storageKey(sourceStorageId));
        if (currentStorageId === sourceStorageId) {
          await this.setCurrentWorkspaceId(project.project_id);
        }
        this.pendingLegacyProjects.delete(sourceStorageId);
        this.pendingLegacyProjects.set(
          project.project_id,
          cloneProject(project),
        );
        return {
          version: preparedTarget.version,
          updatedAt: preparedTarget.updatedAt,
        };
      }
      const collision = this.readVersionedRecord(project.project_id);
      if (collision) {
        throw new StorageConflictError(
          `A different Project already uses ID ${project.project_id}`,
          expectedVersion,
          collision.version,
        );
      }
    }

    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const prepared: StoredProjectFilesRecord = {
      files: serializeProjectFiles(project),
      version,
      updatedAt,
      legacyDocument: structuredClone(legacy.document),
      legacySourceStorageId: sourceStorageId,
      legacySourceVersion: legacy.version,
    };
    this.storage.setItem(
      this.storageKey(project.project_id),
      JSON.stringify(prepared),
    );
    if (sourceStorageId !== project.project_id) {
      this.storage.removeItem(this.storageKey(sourceStorageId));
    }
    if (currentStorageId === sourceStorageId) {
      await this.setCurrentWorkspaceId(project.project_id);
    }
    this.pendingLegacyProjects.delete(sourceStorageId);
    this.pendingLegacyProjects.set(project.project_id, cloneProject(project));
    return { version, updatedAt };
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

  async importWorkspaceArchive(archive: Blob): Promise<WorkspaceImportResult> {
    const result = await importWorkspaceArchive(this, archive);
    const imported = result.imported[0];
    if (imported) {
      await this.setCurrentWorkspaceId(imported.id);
    }
    return result;
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

  getLegacyProjectMigrationSourceId(): string | null {
    const storageId = this.storage.getItem(this.currentWorkspaceKey);
    if (!storageId) {
      return null;
    }
    const canonical = this.readRecord(storageId);
    if (
      canonical?.legacyDocument &&
      isLegacyWorkspaceDocument(canonical.legacyDocument)
    ) {
      return canonical.legacySourceStorageId ?? storageId;
    }
    return this.readLegacyWorkspaceRecord(storageId) ? storageId : null;
  }

  private listSummaries(): ProjectWorkspaceSummary[] {
    return this.storageKeys().flatMap((key) => {
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
  ): LegacyStoredWorkspaceRecord | null {
    const value = this.storage.getItem(this.storageKey(id));
    if (value === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return isLegacyStoredWorkspaceRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private readVersionedRecord(
    id: string,
  ): StoredProjectFilesRecord | LegacyStoredWorkspaceRecord | null {
    return this.readRecord(id) ?? this.readLegacyWorkspaceRecord(id);
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
      };
    } catch {
      return null;
    }
  }

  private migrateLegacyProjects(): void {
    const legacyKeys = this.storageKeys().filter((key) =>
      key.startsWith(this.legacyProjectKeyPrefix),
    );

    for (const key of legacyKeys) {
      const legacySourceRecord = this.storage.getItem(key);
      const legacyRecord = this.parseLegacyProjectRecord(legacySourceRecord);
      if (!legacyRecord) {
        continue;
      }

      assertLegacyProjectDocument(legacyRecord.document);
      const workspace = projectDocumentToWorkspaceDocument(
        deserializeProjectDocument(legacyRecord.document),
      );
      const projectKey = this.storageKey(workspace.project_id);
      const sourceStorageId = this.legacyProjectStorageId(key);
      const migratedFiles = serializeProjectFiles(workspace);
      const existingTarget = this.parseRecord(
        this.storage.getItem(projectKey),
        workspace.project_id,
      );

      if (!existingTarget && !this.storage.getItem(projectKey)) {
        this.storage.setItem(
          projectKey,
          JSON.stringify({
            files: migratedFiles,
            version: legacyRecord.version,
            updatedAt: legacyRecord.updatedAt,
            legacyDocument: legacyRecord.document,
            legacySourceStorageId: sourceStorageId,
            legacySourceVersion: legacyRecord.version,
            legacySourceRecord: legacySourceRecord ?? undefined,
          } satisfies StoredProjectFilesRecord),
        );
        this.storage.removeItem(key);
        continue;
      }

      if (
        existingTarget?.legacyDocument &&
        existingTarget.legacySourceStorageId === sourceStorageId &&
        existingTarget.legacySourceRecord === legacySourceRecord &&
        (existingTarget.legacySourceVersion ?? existingTarget.version) ===
          legacyRecord.version &&
        existingTarget.version === legacyRecord.version &&
        existingTarget.updatedAt === legacyRecord.updatedAt &&
        sameJsonDocument(
          existingTarget.legacyDocument,
          legacyRecord.document,
        ) &&
        sameProjectFiles(existingTarget.files, migratedFiles)
      ) {
        this.storage.removeItem(key);
      }
    }
  }

  private legacyProjectStorageId(key: string): string {
    const encodedId = key.slice(this.legacyProjectKeyPrefix.length);
    try {
      return decodeURIComponent(encodedId);
    } catch {
      return encodedId;
    }
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
    Object.keys(input).length === 3 &&
    Object.keys(input).every((key) =>
      ["document", "version", "updatedAt"].includes(key),
    ) &&
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
