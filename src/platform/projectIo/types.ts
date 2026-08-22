import type { ProjectFolderExport } from "../../core/io/projectFolder";
import type { CustomFieldImage } from "../../core/field/fieldConfig";
import type { Project } from "../../core/model/project";
import type { ProjectFileDamage } from "../../core/io/projectFiles";
import type {
  LegacyProjectMigrationPreparation,
  ProjectWorkspaceSummary,
  WriteResult,
} from "../../storage";

export type {
  LegacyProjectMigrationPreparation,
  ProjectWorkspaceSummary,
  WriteResult,
} from "../../storage";

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

export interface ImportedLegacyFieldBackground {
  field: CustomFieldImage;
  bytes: Uint8Array;
}

export interface ProjectImportResult {
  project: Project;
  legacySelectedFieldId: string | null;
  legacyFieldBackgrounds: ImportedLegacyFieldBackground[];
}

/** Persistence locator owned by the Project store and interpreted by Project I/O. */
export interface ProjectIoWorkspaceHandle {
  readonly storageId: string;
}

export interface ProjectIoWorkspace {
  project: Project;
  handle: ProjectIoWorkspaceHandle;
  version: string | undefined;
  lastSavedAt: string | null;
  summary: ProjectWorkspaceSummary | null;
  persistenceDamage: ProjectFileDamage | null;
  legacyMigration: LegacyProjectViewMigration | null;
}

export interface ProjectIoWriteOutcome {
  result: WriteResult;
  workspace: ProjectIoWorkspace;
}

export interface ProjectIoMigrationPreparationOutcome {
  preparation: LegacyProjectMigrationPreparation;
  workspace: ProjectIoWorkspace;
}

export interface CommittedProjectImportResult extends ProjectImportResult {
  workspace: ProjectIoWorkspace;
}

export interface ProjectImportRollback {
  rollback(): Promise<void>;
}

export class ProjectImportOutcomeUncertainError extends Error {
  readonly projectError: unknown;
  readonly reconciliationError: unknown;

  constructor(projectError: unknown, reconciliationError?: unknown) {
    super(
      "Project import may have been committed, so its prepared User Data was retained",
    );
    this.name = "ProjectImportOutcomeUncertainError";
    this.projectError = projectError;
    this.reconciliationError = reconciliationError;
  }
}

export interface ProjectImportOptions {
  /** Prepares decoded legacy assets before Project persistence and reports how to undo mutations. */
  migrateLegacyFieldBackgrounds?(
    imported: ProjectImportResult,
  ): Promise<ProjectImportRollback>;
}

export interface DeleteWorkspaceResult {
  workspace: ProjectIoWorkspace | null;
  changedCurrent: boolean;
}

export interface LegacyProjectViewMigration {
  legacyProjectId: string;
  stableProjectId: string;
  pathIdByLegacyReference: Readonly<Record<string, string>>;
}

export interface ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  initialize(): Promise<ProjectIoWorkspace | null>;
  /**
   * Re-read the current project from its backing store *without* adopting it or
   * changing the tracked version. Used to diff on-disk state against unsaved edits
   * when resolving a save conflict.
   */
  peekWorkspace(handle: ProjectIoWorkspaceHandle): Promise<Project | null>;
  prepareLegacyProjectMigration(
    workspace: ProjectIoWorkspace,
    migration: LegacyProjectViewMigration,
  ): Promise<ProjectIoMigrationPreparationOutcome>;
  completeLegacyProjectMigration(
    workspace: ProjectIoWorkspace,
    migration: LegacyProjectViewMigration,
  ): Promise<ProjectIoWriteOutcome | null>;
  createWorkspace(
    input?: CreateWorkspaceInput,
    previous?: ProjectIoWorkspace,
  ): Promise<ProjectIoWorkspace>;
  openWorkspace(
    id?: string,
    previous?: ProjectIoWorkspace,
  ): Promise<ProjectIoWorkspace | null>;
  reloadWorkspace(
    handle: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace | null>;
  deleteWorkspace(
    current: ProjectIoWorkspace | null,
    id?: string,
    expectedVersion?: string,
  ): Promise<DeleteWorkspaceResult>;
  saveWorkspace(
    current: ProjectIoWorkspace,
    project: Project,
    expectedVersion?: string,
  ): Promise<ProjectIoWriteOutcome>;
  replaceDamagedProject(
    current: ProjectIoWorkspace,
    project: Project,
    expectedVersion?: string,
  ): Promise<ProjectIoWriteOutcome>;
  listWorkspaces(): Promise<ProjectWorkspaceSummary[]>;
  switchWorkspace(
    id: string,
    previous?: ProjectIoWorkspace,
  ): Promise<ProjectIoWorkspace | null>;
  importPath(project: Project, file: File): Promise<Project>;
  exportPath(project: Project, pathId: string): Promise<Blob>;
  importConfig(project: Project, file: File): Promise<Project>;
  exportConfig(project: Project): Promise<Blob>;
  importProjectFolder(
    workspace: ProjectIoWorkspace,
    files: readonly File[],
    options?: ProjectImportOptions,
  ): Promise<CommittedProjectImportResult>;
  exportProjectFolder(project: Project): Promise<ProjectFolderExport>;
  importProjectArchive(
    workspace: ProjectIoWorkspace,
    file: File,
    options?: ProjectImportOptions,
  ): Promise<CommittedProjectImportResult>;
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
