import { deserializeProjectDocument } from "../core/io/projectSerde";
import type { ProjectWorkspaceDocument } from "../core/io/projectSchema";
import { projectDocumentToWorkspaceDocument } from "../core/io/workspaceSerde";
import {
  ProjectNotFoundError,
  StorageConflictError,
  compareWorkspaceSummaries,
  createBLineWorkspaceArchive,
  createStoredWorkspaceRecord,
  importWorkspaceArchive,
  workspaceFromRecord,
  workspaceSummaryFromRecord,
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

export class BrowserStorage implements CurrentWorkspaceAdapter {
  private readonly storage: StorageLike;
  private readonly keyPrefix: string;
  private readonly currentWorkspaceKey: string;
  private readonly legacyProjectKeyPrefix: string;
  private readonly now: () => Date;

  constructor(options: BrowserStorageOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyPrefix = options.keyPrefix ?? defaultKeyPrefix;
    this.currentWorkspaceKey =
      options.currentWorkspaceKey ?? defaultCurrentWorkspaceKey;
    this.legacyProjectKeyPrefix =
      options.legacyProjectKeyPrefix ?? defaultLegacyProjectKeyPrefix;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    this.migrateLegacyProjects();
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    this.migrateLegacyProjects();
    return this.listRecords()
      .map(workspaceSummaryFromRecord)
      .sort(compareWorkspaceSummaries);
  }

  async readWorkspace(id?: string): Promise<ProjectWorkspaceDocument> {
    this.migrateLegacyProjects();
    const workspaceId =
      id ??
      (await this.getCurrentWorkspaceId()) ??
      this.listRecords()[0]?.document.project_id;
    if (!workspaceId) {
      throw new ProjectNotFoundError("workspace");
    }

    return workspaceFromRecord(this.requireRecord(workspaceId));
  }

  async writeWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.migrateLegacyProjects();
    const existing = this.readRecord(workspace.project_id);
    assertExpectedVersion(existing, expectedVersion);

    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const record = createStoredWorkspaceRecord(workspace, version, updatedAt);

    this.storage.setItem(
      this.storageKey(workspace.project_id),
      JSON.stringify(record),
    );
    await this.setCurrentWorkspaceId(workspace.project_id);

    return { version, updatedAt };
  }

  async deleteWorkspace(id: string, expectedVersion?: string): Promise<void> {
    this.migrateLegacyProjects();
    const existing = this.readRecord(id);
    assertExpectedVersion(existing, expectedVersion);
    this.storage.removeItem(this.storageKey(id));

    if ((await this.getCurrentWorkspaceId()) === id) {
      const nextId = this.listRecords()[0]?.document.project_id ?? null;
      await this.setCurrentWorkspaceId(nextId);
    }
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

  private listRecords(): StoredWorkspaceRecord[] {
    const records: StoredWorkspaceRecord[] = [];

    for (const key of this.storageKeys()) {
      if (!key.startsWith(this.keyPrefix)) {
        continue;
      }

      const record = this.parseRecord(this.storage.getItem(key));
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private requireRecord(id: string): StoredWorkspaceRecord {
    const record = this.readRecord(id);
    if (!record) {
      throw new ProjectNotFoundError(id);
    }
    return record;
  }

  private readRecord(id: string): StoredWorkspaceRecord | null {
    return this.parseRecord(this.storage.getItem(this.storageKey(id)));
  }

  private parseRecord(value: string | null): StoredWorkspaceRecord | null {
    if (value === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return isStoredWorkspaceRecord(parsed) ? parsed : null;
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
          JSON.stringify(
            createStoredWorkspaceRecord(
              workspace,
              legacyRecord.version,
              legacyRecord.updatedAt,
            ),
          ),
        );
      }

      this.storage.removeItem(key);
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
}

function assertExpectedVersion(
  existing: StoredWorkspaceRecord | null,
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

function createBrowserVersion(updatedAt: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${updatedAt}:${random}`;
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
