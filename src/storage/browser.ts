import { deserializeProjectDocument } from "../core/io/projectSerde";
import type { ProjectWorkspaceDocument } from "../core/io/projectSchema";
import {
  deserializeProjectWorkspaceDocument,
  projectDocumentToWorkspaceDocument,
} from "../core/io/workspaceSerde";
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
  type FieldAssetWriteInput,
  type CurrentWorkspaceAdapter,
  type ProjectWorkspaceSummary,
  type StoredProjectRecord,
  type StoredWorkspaceRecord,
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
    this.migrateLegacyWorkspaces();
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    this.migrateLegacyProjects();
    this.migrateLegacyWorkspaces();
    return this.listRecords()
      .map(projectFilesSummaryFromRecord)
      .sort(compareWorkspaceSummaries);
  }

  async readWorkspace(id?: string): Promise<ProjectWorkspaceDocument> {
    this.migrateLegacyProjects();
    this.migrateLegacyWorkspaces();
    const workspaceId =
      id ??
      (await this.getCurrentWorkspaceId()) ??
      this.listRecords()[0]?.storageId;
    if (!workspaceId) {
      throw new ProjectNotFoundError("workspace");
    }

    const record = this.requireRecord(workspaceId);
    const opened = openProjectFiles(record.files, {
      fallbackProjectId: workspaceId,
    });
    if (opened.damage) {
      this.damageById.set(workspaceId, opened.damage);
    } else {
      this.damageById.delete(workspaceId);
    }
    return {
      ...opened.project,
      active_path_id: null,
      active_path_group_id: null,
    };
  }

  async writeWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const damage = this.damageById.get(workspace.project_id);
    if (damage) {
      throw new ProjectPersistenceDamageError(damage);
    }
    return this.writeProjectFilesRecord(workspace, expectedVersion);
  }

  getCurrentProjectDamage(): ProjectFileDamage | null {
    const id = this.storage.getItem(this.currentWorkspaceKey);
    return id ? (this.damageById.get(id) ?? null) : null;
  }

  async replaceDamagedWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const result = await this.writeProjectFilesRecord(
      workspace,
      expectedVersion,
    );
    this.damageById.delete(workspace.project_id);
    return result;
  }

  private async writeProjectFilesRecord(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.migrateLegacyProjects();
    this.migrateLegacyWorkspaces();
    const existing = this.readRecord(workspace.project_id);
    assertExpectedVersion(existing, expectedVersion);
    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const record: StoredProjectFilesRecord = {
      files: serializeProjectFiles(workspace),
      version,
      updatedAt,
    };

    this.storage.setItem(
      this.storageKey(workspace.project_id),
      JSON.stringify(record),
    );
    await this.setCurrentWorkspaceId(workspace.project_id);

    return { version, updatedAt };
  }

  async deleteWorkspace(id: string, expectedVersion?: string): Promise<void> {
    this.migrateLegacyProjects();
    this.migrateLegacyWorkspaces();
    const existing = this.readRecord(id);
    assertExpectedVersion(existing, expectedVersion);
    this.storage.removeItem(this.storageKey(id));

    if ((await this.getCurrentWorkspaceId()) === id) {
      const nextId = this.listRecords()[0]?.storageId ?? null;
      await this.setCurrentWorkspaceId(nextId);
    }
    this.damageById.delete(id);
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

  async writeFieldAsset(input: FieldAssetWriteInput): Promise<void> {
    const db = await this.openFieldAssetDb();
    const record: BrowserFieldAssetRecord = {
      key: fieldAssetKey(input.workspaceId, input.assetId),
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: bytesToArrayBuffer(input.bytes),
      updatedAt: this.now().toISOString(),
    };

    await runFieldAssetTransaction(db, "readwrite", (store) =>
      store.put(record),
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

  private listRecords(): ParsedProjectFilesRecord[] {
    const records: ParsedProjectFilesRecord[] = [];

    for (const key of this.storageKeys()) {
      if (!key.startsWith(this.keyPrefix)) {
        continue;
      }

      const storageId = decodeURIComponent(key.slice(this.keyPrefix.length));
      const record = this.parseRecord(this.storage.getItem(key), storageId);
      if (record) {
        records.push(record);
      }
    }

    return records;
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
      const legacyRecord = this.parseLegacyProjectRecord(
        this.storage.getItem(key),
      );
      if (!legacyRecord) {
        continue;
      }

      const project = deserializeProjectDocument(legacyRecord.document);
      const workspace = projectDocumentToWorkspaceDocument(project);
      const workspaceKey = this.storageKey(workspace.project_id);

      if (!this.storage.getItem(workspaceKey)) {
        this.storage.setItem(
          workspaceKey,
          JSON.stringify({
            files: serializeProjectFiles(workspace),
            version: legacyRecord.version,
            updatedAt: legacyRecord.updatedAt,
          } satisfies StoredProjectFilesRecord),
        );
      }

      this.storage.removeItem(key);
    }
  }

  private migrateLegacyWorkspaces(): void {
    for (const key of this.storageKeys()) {
      if (!key.startsWith(this.keyPrefix)) {
        continue;
      }
      const value = this.storage.getItem(key);
      if (value === null) {
        continue;
      }
      try {
        const parsed = JSON.parse(value) as unknown;
        if (!isStoredWorkspaceRecord(parsed)) {
          continue;
        }
        const project = deserializeProjectWorkspaceDocument(parsed.document);
        this.storage.setItem(
          key,
          JSON.stringify({
            files: serializeProjectFiles(project),
            version: parsed.version,
            updatedAt: parsed.updatedAt,
          } satisfies StoredProjectFilesRecord),
        );
      } catch {
        // Preserve malformed records verbatim for explicit recovery.
      }
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
}

interface ParsedProjectFilesRecord extends StoredProjectFilesRecord {
  storageId: string;
}

function assertExpectedVersion(
  existing: StoredProjectFilesRecord | null,
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

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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

function isStoredWorkspaceRecord(
  input: unknown,
): input is StoredWorkspaceRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<StoredWorkspaceRecord>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.document === "object" &&
    candidate.document !== null &&
    Array.isArray(candidate.document.paths)
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
    )
  );
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
