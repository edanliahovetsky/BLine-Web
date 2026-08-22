import type { ProjectFolderExport } from "../../core/io/projectFolder";
import type { ProjectWorkspaceDocument } from "../../core/io/projectSchema";
import type { CustomFieldImage } from "../../core/field/fieldConfig";
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

export interface ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  initialize(): Promise<ProjectWorkspaceDocument | null>;
  getWorkspace(): Promise<ProjectWorkspaceDocument | null>;
  /**
   * Re-read the current project from its backing store *without* adopting it or
   * changing the tracked version. Used to diff on-disk state against unsaved edits
   * when resolving a save conflict.
   */
  peekWorkspace(): Promise<ProjectWorkspaceDocument | null>;
  getCurrentVersion(): string | undefined;
  getLastSavedAt(): string | null;
  createWorkspace(
    input?: CreateWorkspaceInput,
  ): Promise<ProjectWorkspaceDocument>;
  openWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  deleteWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  saveWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult>;
  listWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  switchWorkspace(id: string): Promise<ProjectWorkspaceDocument | null>;
  importPath(file: File): Promise<ProjectWorkspaceDocument>;
  exportPath(pathId: string): Promise<Blob>;
  importConfig(file: File): Promise<ProjectWorkspaceDocument>;
  exportConfig(): Promise<Blob>;
  importProjectFolder(
    files: readonly File[],
  ): Promise<ProjectWorkspaceDocument>;
  exportProjectFolder(): Promise<ProjectFolderExport>;
  importProjectArchive(file: File): Promise<ProjectWorkspaceDocument>;
  exportProjectArchive(): Promise<Blob>;
  readLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<Blob | null>;
  deleteLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<void>;
}
