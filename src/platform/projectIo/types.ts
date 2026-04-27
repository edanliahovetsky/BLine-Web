import type { ProjectFolderExport } from "../../core/io/projectFolder";
import type { ProjectWorkspaceDocument } from "../../core/io/projectSchema";
import type { ProjectWorkspaceSummary, WriteResult } from "../../storage";

export type { ProjectFolderExport } from "../../core/io/projectFolder";

export type ProjectIoAction =
  | "new-project"
  | "open-workspace"
  | "open-folder"
  | "new-path"
  | "import-project"
  | "export-project"
  | "save";

export interface ProjectIoCapabilities {
  shellLabel: string;
  autosaveTargetLabel: string;
  directFileAutosave: boolean;
  browserPersistentAutosave: boolean;
  supportsProjectFolders: boolean;
  supportsAutosFolderImportExport: boolean;
  supportsWorkspaceList: boolean;
  supportsPortableImportExport: boolean;
  supportsUrlSharing: boolean;
  supportsRemoteSync: boolean;
  primaryToolbarActions: ProjectIoAction[];
}

export interface CreateWorkspaceInput {
  workspace?: ProjectWorkspaceDocument;
}

export interface CreatePathInput {
  displayName: string;
  fileName?: string;
}

export interface ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  initialize(): Promise<ProjectWorkspaceDocument | null>;
  getWorkspace(): Promise<ProjectWorkspaceDocument | null>;
  getCurrentVersion(): string | undefined;
  getLastSavedAt(): string | null;
  createWorkspace(input?: CreateWorkspaceInput): Promise<ProjectWorkspaceDocument>;
  openWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  deleteWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  saveWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string
  ): Promise<WriteResult>;
  listWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  switchWorkspace(id: string): Promise<ProjectWorkspaceDocument | null>;
  setActivePath(pathId: string): Promise<ProjectWorkspaceDocument>;
  createPath(input: CreatePathInput): Promise<ProjectWorkspaceDocument>;
  renamePath(pathId: string, name: string): Promise<ProjectWorkspaceDocument>;
  duplicatePath(pathId: string, name: string): Promise<ProjectWorkspaceDocument>;
  deletePaths(pathIds: readonly string[]): Promise<ProjectWorkspaceDocument>;
  importPath(file: File): Promise<ProjectWorkspaceDocument>;
  exportPath(pathId: string): Promise<Blob>;
  importConfig(file: File): Promise<ProjectWorkspaceDocument>;
  exportConfig(): Promise<Blob>;
  importProjectFolder(files: readonly File[]): Promise<ProjectWorkspaceDocument>;
  exportProjectFolder(): Promise<ProjectFolderExport>;
  importProjectArchive(file: File): Promise<ProjectWorkspaceDocument>;
  exportProjectArchive(): Promise<Blob>;
}
