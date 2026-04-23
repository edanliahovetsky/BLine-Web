import {
  ProjectNotFoundError,
  StorageConflictError,
  compareProjectSummaries,
  createProjectBundle,
  createStoredProjectRecord,
  importProjectBundle,
  projectFromRecord,
  summaryFromRecord,
  type ImportResult,
  type ProjectSummary,
  type StorageAdapter,
  type StoredProjectRecord,
  type WriteResult
} from "./adapter";
import type { ProjectDocument } from "../core/io/projectSchema";

export interface BrowserStorageOptions {
  storage?: StorageLike;
  keyPrefix?: string;
  now?: () => Date;
}

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultKeyPrefix = "bline-web:project:";

export class BrowserStorage implements StorageAdapter {
  private readonly storage: StorageLike;
  private readonly keyPrefix: string;
  private readonly now: () => Date;

  constructor(options: BrowserStorageOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyPrefix = options.keyPrefix ?? defaultKeyPrefix;
    this.now = options.now ?? (() => new Date());
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.listRecords()
      .map(summaryFromRecord)
      .sort(compareProjectSummaries);
  }

  async readProject(id: string): Promise<ProjectDocument> {
    return projectFromRecord(this.requireRecord(id));
  }

  async writeProject(
    project: ProjectDocument,
    expectedVersion?: string
  ): Promise<WriteResult> {
    const existing = this.readRecord(project.project_id);
    assertExpectedVersion(existing, expectedVersion);

    const updatedAt = this.now().toISOString();
    const version = createBrowserVersion(updatedAt);
    const record = createStoredProjectRecord(project, version, updatedAt);

    this.storage.setItem(this.storageKey(project.project_id), JSON.stringify(record));

    return { version, updatedAt };
  }

  async deleteProject(id: string, expectedVersion?: string): Promise<void> {
    const existing = this.readRecord(id);
    assertExpectedVersion(existing, expectedVersion);
    this.storage.removeItem(this.storageKey(id));
  }

  async exportBundle(ids: string[]): Promise<Blob> {
    return createProjectBundle(this, ids, this.now().toISOString());
  }

  async importBundle(bundle: Blob): Promise<ImportResult> {
    return importProjectBundle(this, bundle);
  }

  private listRecords(): StoredProjectRecord[] {
    const records: StoredProjectRecord[] = [];

    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (!key?.startsWith(this.keyPrefix)) {
        continue;
      }

      const record = this.parseRecord(this.storage.getItem(key));
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private requireRecord(id: string): StoredProjectRecord {
    const record = this.readRecord(id);
    if (!record) {
      throw new ProjectNotFoundError(id);
    }
    return record;
  }

  private readRecord(id: string): StoredProjectRecord | null {
    return this.parseRecord(this.storage.getItem(this.storageKey(id)));
  }

  private parseRecord(value: string | null): StoredProjectRecord | null {
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

  private storageKey(id: string): string {
    return `${this.keyPrefix}${encodeURIComponent(id)}`;
  }
}

function assertExpectedVersion(
  existing: StoredProjectRecord | null,
  expectedVersion?: string
): void {
  if (expectedVersion === undefined) {
    return;
  }

  if (existing?.version !== expectedVersion) {
    throw new StorageConflictError(
      "Project version does not match expected version",
      expectedVersion,
      existing?.version
    );
  }
}

function createBrowserVersion(updatedAt: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2);
  return `${updatedAt}:${random}`;
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
