import type {
  ProjectDocument,
  ProjectWorkspaceDocument,
  SerializedProjectDocument,
  SerializedProjectWorkspaceDocument,
} from "../core/io/projectSchema";
import {
  deserializeBLineProjectArchive,
  isBLineProjectArchive,
  serializeBLineProjectArchive,
} from "../core/io/blineProject";
import {
  deserializeProjectDocument,
  serializeProjectDocument,
} from "../core/io/projectSerde";
import {
  deserializeProjectWorkspaceDocument,
  projectDocumentToWorkspaceDocument,
  serializeProjectWorkspaceDocument,
} from "../core/io/workspaceSerde";

export interface ProjectWorkspaceSummary {
  id: string;
  displayName: string;
  updatedAt: string;
  version: string;
  directoryPath?: string;
}

export interface WriteResult {
  version: string;
  updatedAt: string;
}

export interface FieldAssetWriteInput {
  workspaceId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface FieldAssetPayload {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface WorkspaceImportResult {
  imported: ProjectWorkspaceSummary[];
}

export interface StoredWorkspaceRecord {
  document: SerializedProjectWorkspaceDocument;
  version: string;
  updatedAt: string;
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

export interface WorkspaceBundle {
  bundle_schema_version: 2;
  exported_at: string;
  workspaces: SerializedProjectWorkspaceDocument[];
}

export interface StorageAdapter {
  initialize?(): Promise<void>;
  listWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  readWorkspace(id?: string): Promise<ProjectWorkspaceDocument>;
  writeWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult>;
  deleteWorkspace?(id: string, expectedVersion?: string): Promise<void>;
  exportWorkspaceArchive?(id?: string): Promise<Blob>;
  importWorkspaceArchive?(archive: Blob): Promise<WorkspaceImportResult>;
  writeFieldAsset?(input: FieldAssetWriteInput): Promise<void>;
  readFieldAsset?(
    workspaceId: string,
    assetId: string,
  ): Promise<FieldAssetPayload | null>;
  deleteFieldAsset?(workspaceId: string, assetId: string): Promise<void>;
}

export interface CurrentWorkspaceAdapter extends StorageAdapter {
  getCurrentWorkspaceId(): Promise<string | null>;
  setCurrentWorkspaceId(id: string | null): Promise<void>;
}

export interface ProjectFolderAdapter extends StorageAdapter {
  getCurrentWorkspace(): Promise<ProjectWorkspaceSummary | null>;
  listRecentWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  openWorkspace(): Promise<ProjectWorkspaceSummary | null>;
  createWorkspace(): Promise<ProjectWorkspaceSummary | null>;
  switchWorkspace(id: string): Promise<ProjectWorkspaceSummary | null>;
}

export class StorageConflictError extends Error {
  readonly expectedVersion: string | undefined;
  readonly actualVersion: string | undefined;

  constructor(
    message: string,
    expectedVersion?: string,
    actualVersion?: string,
  ) {
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

export function createStoredWorkspaceRecord(
  workspace: ProjectWorkspaceDocument,
  version: string,
  updatedAt: string,
): StoredWorkspaceRecord {
  return {
    document: serializeProjectWorkspaceDocument(workspace),
    version,
    updatedAt,
  };
}

export function workspaceSummaryFromRecord(
  record: StoredWorkspaceRecord,
): ProjectWorkspaceSummary {
  return {
    id: record.document.project_id,
    displayName: record.document.display_name,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

export function workspaceFromRecord(
  record: StoredWorkspaceRecord,
): ProjectWorkspaceDocument {
  return deserializeProjectWorkspaceDocument(record.document);
}

export async function createBLineWorkspaceArchive(
  adapter: Pick<StorageAdapter, "readWorkspace">,
  id: string,
  exportedAt: string,
): Promise<Blob> {
  return serializeBLineProjectArchive(
    await adapter.readWorkspace(id),
    exportedAt,
  );
}

export async function importWorkspaceArchive(
  adapter: Pick<StorageAdapter, "writeWorkspace" | "listWorkspaces">,
  archive: Blob,
): Promise<WorkspaceImportResult> {
  const workspace = await decodeWorkspaceArchive(archive);
  await adapter.writeWorkspace(workspace);
  const summaries = await adapter.listWorkspaces();

  return {
    imported: summaries.filter(
      (summary) => summary.id === workspace.project_id,
    ),
  };
}

export async function decodeWorkspaceArchive(
  archive: Blob,
): Promise<ProjectWorkspaceDocument> {
  const parsed = JSON.parse(await archive.text()) as unknown;

  if (isBLineProjectArchive(parsed)) {
    return deserializeBLineProjectArchive(parsed);
  }

  if (isWorkspaceBundle(parsed)) {
    const [workspace] = parsed.workspaces;
    if (!workspace) {
      throw new Error("Workspace bundle is empty");
    }
    return deserializeProjectWorkspaceDocument(workspace);
  }

  if (isProjectBundle(parsed)) {
    return legacyProjectBundleToWorkspace(parsed);
  }

  return deserializeProjectWorkspaceDocument(parsed);
}

export function compareWorkspaceSummaries(
  a: ProjectWorkspaceSummary,
  b: ProjectWorkspaceSummary,
): number {
  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.displayName.localeCompare(b.displayName) ||
    a.id.localeCompare(b.id)
  );
}

export function isCurrentWorkspaceAdapter(
  adapter: StorageAdapter,
): adapter is CurrentWorkspaceAdapter {
  const candidate = adapter as Partial<CurrentWorkspaceAdapter>;
  return (
    typeof candidate.getCurrentWorkspaceId === "function" &&
    typeof candidate.setCurrentWorkspaceId === "function"
  );
}

export function isProjectFolderAdapter(
  adapter: StorageAdapter,
): adapter is ProjectFolderAdapter {
  const candidate = adapter as Partial<ProjectFolderAdapter>;
  return (
    typeof candidate.getCurrentWorkspace === "function" &&
    typeof candidate.listRecentWorkspaces === "function" &&
    typeof candidate.openWorkspace === "function" &&
    typeof candidate.createWorkspace === "function" &&
    typeof candidate.switchWorkspace === "function"
  );
}

export function createStoredProjectRecord(
  project: ProjectDocument,
  version: string,
  updatedAt: string,
): StoredProjectRecord {
  return {
    document: serializeProjectDocument(project),
    version,
    updatedAt,
  };
}

function legacyProjectBundleToWorkspace(
  bundle: ProjectBundle,
): ProjectWorkspaceDocument {
  const projects = bundle.projects.map((project) =>
    deserializeProjectDocument(project),
  );
  const first = projects[0];

  if (!first) {
    throw new Error("Project bundle is empty");
  }

  return {
    ...projectDocumentToWorkspaceDocument(first, {
      fallbackProjectId: first.project_id,
      fallbackDisplayName: first.display_name,
    }),
    paths: projects.map((project) => ({
      path_id: project.project_id,
      display_name: project.display_name,
      file_name: project.path_file_name ?? `${project.project_id}.json`,
      path: project.path,
    })),
    active_path_id: first.project_id,
  };
}

function isWorkspaceBundle(input: unknown): input is WorkspaceBundle {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  return (
    "bundle_schema_version" in input &&
    (input as { bundle_schema_version: unknown }).bundle_schema_version === 2 &&
    "workspaces" in input &&
    Array.isArray((input as { workspaces: unknown }).workspaces)
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
