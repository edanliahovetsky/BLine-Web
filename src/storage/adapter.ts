import type {
  ProjectDocument,
  SerializedProjectDocument
} from "../core/io/projectSchema";
import {
  deserializeProjectDocument,
  serializeProjectDocument
} from "../core/io/projectSerde";

export interface ProjectSummary {
  id: string;
  displayName: string;
  updatedAt: string;
  version: string;
}

export interface WriteResult {
  version: string;
  updatedAt: string;
}

export interface ImportResult {
  imported: ProjectSummary[];
}

export interface StoredProjectRecord {
  document: SerializedProjectDocument;
  version: string;
  updatedAt: string;
}

export interface ProjectBundle {
  bundle_schema_version: 1;
  exported_at: string;
  projects: SerializedProjectDocument[];
}

export interface StorageAdapter {
  listProjects(): Promise<ProjectSummary[]>;
  readProject(id: string): Promise<ProjectDocument>;
  writeProject(project: ProjectDocument, expectedVersion?: string): Promise<WriteResult>;
  deleteProject(id: string, expectedVersion?: string): Promise<void>;
  exportBundle(ids: string[]): Promise<Blob>;
  importBundle(bundle: Blob): Promise<ImportResult>;
}

export class StorageConflictError extends Error {
  readonly expectedVersion: string | undefined;
  readonly actualVersion: string | undefined;

  constructor(message: string, expectedVersion?: string, actualVersion?: string) {
    super(message);
    this.name = "StorageConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export function createStoredProjectRecord(
  project: ProjectDocument,
  version: string,
  updatedAt: string
): StoredProjectRecord {
  return {
    document: serializeProjectDocument(project),
    version,
    updatedAt
  };
}

export function summaryFromRecord(record: StoredProjectRecord): ProjectSummary {
  return {
    id: record.document.project_id,
    displayName: record.document.display_name,
    updatedAt: record.updatedAt,
    version: record.version
  };
}

export function projectFromRecord(record: StoredProjectRecord): ProjectDocument {
  return deserializeProjectDocument(record.document);
}

export async function createProjectBundle(
  adapter: Pick<StorageAdapter, "readProject">,
  ids: readonly string[],
  exportedAt: string
): Promise<Blob> {
  const projects = await Promise.all(
    ids.map(async (id) => serializeProjectDocument(await adapter.readProject(id)))
  );

  const bundle: ProjectBundle = {
    bundle_schema_version: 1,
    exported_at: exportedAt,
    projects
  };

  return new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json"
  });
}

export async function importProjectBundle(
  adapter: Pick<StorageAdapter, "writeProject" | "listProjects">,
  bundle: Blob
): Promise<ImportResult> {
  const projects = await decodeProjectBundle(bundle);

  for (const project of projects) {
    await adapter.writeProject(project);
  }

  const summaries = await adapter.listProjects();
  const importedIds = new Set(projects.map((project) => project.project_id));

  return {
    imported: summaries.filter((summary) => importedIds.has(summary.id))
  };
}

export async function decodeProjectBundle(bundle: Blob): Promise<ProjectDocument[]> {
  const parsed = JSON.parse(await bundle.text()) as unknown;

  if (isProjectBundle(parsed)) {
    return parsed.projects.map((project) => deserializeProjectDocument(project));
  }

  return [deserializeProjectDocument(parsed)];
}

export function compareProjectSummaries(a: ProjectSummary, b: ProjectSummary): number {
  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.displayName.localeCompare(b.displayName) ||
    a.id.localeCompare(b.id)
  );
}

function isProjectBundle(input: unknown): input is ProjectBundle {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  return (
    "bundle_schema_version" in input &&
    "projects" in input &&
    Array.isArray((input as { projects: unknown }).projects)
  );
}
