import type { ProjectFolderExport } from "../../core/io/projectFolder";
import type { CustomFieldImage } from "../../core/field/fieldConfig";
import type { Project } from "../../core/model/project";
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
  project?: Project;
}

export interface ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  initialize(): Promise<Project | null>;
  getWorkspace(): Promise<Project | null>;
  /**
   * Re-read the current project from its backing store *without* adopting it or
   * changing the tracked version. Used to diff on-disk state against unsaved edits
   * when resolving a save conflict.
   */
  peekWorkspace(): Promise<Project | null>;
  getCurrentVersion(): string | undefined;
  getLastSavedAt(): string | null;
  createWorkspace(input?: CreateWorkspaceInput): Promise<Project>;
  openWorkspace(id?: string): Promise<Project | null>;
  deleteWorkspace(id?: string): Promise<Project | null>;
  saveWorkspace(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult>;
  listWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  switchWorkspace(id: string): Promise<Project | null>;
  importPath(file: File): Promise<Project>;
  exportPath(project: Project, pathId: string): Promise<Blob>;
  importConfig(file: File): Promise<Project>;
  exportConfig(project: Project): Promise<Blob>;
  importProjectFolder(files: readonly File[]): Promise<Project>;
  exportProjectFolder(project: Project): Promise<ProjectFolderExport>;
  importProjectArchive(file: File): Promise<Project>;
  exportProjectArchive(project: Project): Promise<Blob>;
  readLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<Blob | null>;
  deleteLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<void>;
}
