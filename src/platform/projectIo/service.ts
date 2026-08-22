import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import {
  defaultProjectFieldConfig,
  type CustomFieldImage,
} from "../../core/field/fieldConfig";
import {
  createBLineProjectArchive,
  deserializeProjectConfig,
  fieldAssetsFromBLineProjectArchive,
  serializeBLineRuntimeConfig,
} from "../../core/io/blineProject";
import { stringifyBLineJson } from "../../core/io/blineJson";
import {
  deserializeBLineProjectFolder,
  serializeBLineProjectFolder,
} from "../../core/io/projectFolder";
import type { ProjectFolderExport } from "../../core/io/projectFolder";
import { openProjectFromLegacyWorkspace } from "../../core/io/legacyWorkspace";
import {
  cloneProject,
  createProject,
  type Project,
} from "../../core/model/project";
import { addPathToProject } from "../../core/model/projectOperations";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import { ensureJsonFileName } from "../../core/io/workspaceSerde";
import {
  decodeWorkspaceArchive,
  isDamageAwareStorageAdapter,
  isLegacyProjectMetadataAdapter,
  isCurrentWorkspaceAdapter,
  isProjectFolderAdapter,
  StorageConflictError,
  type ProjectWorkspaceSummary,
  type LegacyProjectMigrationPreparation,
  type StorageAdapter,
  type WriteResult,
} from "../../storage";
import type {
  CreateWorkspaceInput,
  ImportedLegacyFieldBackground,
  ProjectImportResult,
  ProjectImportOptions,
  ProjectIoCapabilities,
  ProjectIoService,
  LegacyProjectViewMigration,
} from "./types";

interface ProjectOwnershipSnapshot {
  project: Project | null;
  storageId: string | null;
  version: string | undefined;
  lastSavedAt: string | null;
  summary: ProjectWorkspaceSummary | null;
  projectEpoch: number;
}

export class StorageProjectIoService implements ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  private readonly storage: StorageAdapter;
  private currentProject: Project | null = null;
  private currentStorageId: string | null = null;
  private currentVersion: string | undefined;
  private lastSavedAt: string | null = null;
  private currentSummary: ProjectWorkspaceSummary | null = null;
  private projectEpoch = 0;

  constructor(storage: StorageAdapter, capabilities: ProjectIoCapabilities) {
    this.storage = storage;
    this.capabilities = capabilities;
  }

  async initialize(): Promise<Project | null> {
    await this.storage.initialize?.();

    if (isProjectFolderAdapter(this.storage)) {
      let summary = await this.storage.getCurrentWorkspace();
      if (!summary) {
        summary = await this.storage.openWorkspace();
      }
      if (!summary) {
        return null;
      }
      return this.readAndAdopt(summary.id, summary);
    }

    if (isCurrentWorkspaceAdapter(this.storage)) {
      const currentId = await this.storage.getCurrentWorkspaceId();
      if (currentId) {
        try {
          return await this.readAndAdopt(currentId);
        } catch {
          await this.storage.setCurrentWorkspaceId(null);
        }
      }
    }

    const [summary] = await this.storage.listWorkspaces();
    return summary ? this.readAndAdopt(summary.id, summary) : null;
  }

  async getWorkspace(): Promise<Project | null> {
    return this.currentProject ? cloneProject(this.currentProject) : null;
  }

  async peekWorkspace(): Promise<Project | null> {
    if (!this.currentProject) {
      return null;
    }
    return this.storage.readProject(
      this.currentStorageId ?? this.currentProject.project_id,
    );
  }

  getCurrentVersion(): string | undefined {
    return this.currentVersion;
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt;
  }

  getCurrentWorkspaceSummary(): ProjectWorkspaceSummary | null {
    return this.currentSummary ? { ...this.currentSummary } : null;
  }

  getPersistenceDamage() {
    return isDamageAwareStorageAdapter(this.storage)
      ? this.storage.getCurrentProjectDamage(this.currentStorageId ?? undefined)
      : null;
  }

  getLegacyProjectViewMigration() {
    const project = this.currentProject;
    const legacyProjectId = isLegacyProjectMetadataAdapter(this.storage)
      ? this.storage.getLegacyProjectMigrationSourceId(
          this.currentStorageId ?? undefined,
        )
      : this.currentStorageId;
    if (this.getPersistenceDamage() || !project || !legacyProjectId) {
      return null;
    }
    return {
      legacyProjectId,
      stableProjectId: project.project_id,
      pathIdByLegacyReference: Object.fromEntries(
        project.paths.flatMap((path) => [
          [path.path_id, path.path_id],
          [path.file_name, path.path_id],
        ]),
      ),
    };
  }

  async prepareLegacyProjectMigration(
    migration: LegacyProjectViewMigration,
  ): Promise<LegacyProjectMigrationPreparation> {
    if (
      !this.ownsLegacyMigration(migration) ||
      this.getPersistenceDamage() ||
      !this.currentVersion ||
      !isLegacyProjectMetadataAdapter(this.storage)
    ) {
      return { status: "rejected" } as const;
    }
    const projectEpoch = this.projectEpoch;
    const storageId = this.currentStorageId;
    const result = await this.storage.prepareLegacyProjectMigration(
      this.requireProject(),
      this.currentVersion,
      migration.legacyProjectId,
    );
    if (
      result.status !== "rejected" &&
      this.stillOwnsMigration(migration, projectEpoch, storageId)
    ) {
      const preparedStorageId = isCurrentWorkspaceAdapter(this.storage)
        ? (this.currentProject?.project_id ?? storageId)
        : storageId;
      if (!this.stillOwnsMigration(migration, projectEpoch, storageId)) {
        return result;
      }
      this.currentVersion = result.version;
      this.lastSavedAt = result.updatedAt;
      this.currentStorageId = preparedStorageId;
      if (preparedStorageId && this.currentProject) {
        this.currentSummary = summaryAfterWrite(
          this.currentSummary,
          preparedStorageId,
          this.currentProject,
          result,
        );
      }
    }
    return result;
  }

  async completeLegacyProjectMigration(
    migration: LegacyProjectViewMigration,
  ): Promise<WriteResult | null> {
    if (
      !this.ownsLegacyMigration(migration) ||
      !this.currentVersion ||
      this.getPersistenceDamage() ||
      !isLegacyProjectMetadataAdapter(this.storage)
    ) {
      return null;
    }
    const projectEpoch = this.projectEpoch;
    const storageId = this.currentStorageId;
    const result = await this.storage.deleteLegacyProjectFiles(
      this.currentVersion,
      migration.legacyProjectId,
      migration.stableProjectId,
    );
    if (result && this.stillOwnsMigration(migration, projectEpoch, storageId)) {
      this.currentVersion = result.version;
      this.lastSavedAt = result.updatedAt;
      if (this.currentStorageId && this.currentProject) {
        this.currentSummary = summaryAfterWrite(
          this.currentSummary,
          this.currentStorageId,
          this.currentProject,
          result,
        );
      }
    }
    return result;
  }

  async createWorkspace(input: CreateWorkspaceInput = {}): Promise<Project> {
    const previous = this.captureOwnership();
    const project = input.project
      ? cloneProject(input.project)
      : createProject({
          project_id: cryptoId("project"),
          display_name: "Untitled Project",
        });

    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.createWorkspace();
      if (!summary) {
        throw new Error("No desktop project folder was selected");
      }
      try {
        const result = await this.storage.writeProject(
          project,
          undefined,
          summary.id,
        );
        const activated = await this.storage.switchWorkspace(summary.id);
        if (!activated) {
          throw new Error(
            "The new desktop Project folder could not be activated",
          );
        }
        this.adoptWrittenProject(project, summary.id, result, activated);
        return cloneProject(project);
      } catch (error) {
        await this.restoreStorageOwnership(previous);
        this.restoreOwnership(previous);
        throw error;
      }
    }

    try {
      const result = this.storage.writeNewProject
        ? await this.storage.writeNewProject(project)
        : await this.storage.writeProject(
            project,
            undefined,
            project.project_id,
          );
      if (
        isCurrentWorkspaceAdapter(this.storage) &&
        !this.storage.writeNewProject
      ) {
        await this.storage.setCurrentWorkspaceId(project.project_id);
      }
      this.adoptWrittenProject(project, project.project_id, result);
      return cloneProject(project);
    } catch (error) {
      await this.restoreStorageOwnership(previous);
      this.restoreOwnership(previous);
      throw error;
    }
  }

  async openWorkspace(id?: string): Promise<Project | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = id
        ? await this.storage.switchWorkspace(id)
        : await this.storage.openWorkspace();
      return summary ? this.readAndAdopt(summary.id, summary) : null;
    }

    if (!id) {
      const [summary] = await this.storage.listWorkspaces();
      return summary ? this.readAndAdopt(summary.id, summary) : null;
    }

    return this.readAndAdopt(id);
  }

  async reloadCurrentProject(): Promise<Project | null> {
    const storageId = this.currentStorageId ?? this.currentProject?.project_id;
    return storageId ? this.readAndAdopt(storageId) : null;
  }

  async deleteWorkspace(
    id?: string,
    knownVersion?: string,
  ): Promise<Project | null> {
    if (!this.storage.deleteWorkspace) {
      throw new Error(
        "Deleting projects is not supported by this storage adapter",
      );
    }

    const targetId =
      id ?? this.currentStorageId ?? this.requireProject().project_id;
    const deletingCurrent =
      this.currentStorageId === targetId ||
      (this.currentStorageId === null &&
        this.currentProject?.project_id === targetId);
    const expectedVersion =
      knownVersion ??
      (deletingCurrent
        ? this.currentVersion
        : (await this.listWorkspaces()).find(
            (summary) => summary.id === targetId,
          )?.version);
    if (!expectedVersion) {
      throw new Error(
        `Cannot safely delete Project without a version: ${targetId}`,
      );
    }
    await this.storage.deleteWorkspace(targetId, expectedVersion);

    if (!deletingCurrent) {
      return this.getWorkspace();
    }

    const [nextSummary] = await this.listWorkspaces();
    if (nextSummary) {
      return this.readAndAdopt(nextSummary.id, nextSummary);
    }

    this.currentProject = null;
    this.currentStorageId = null;
    this.currentVersion = undefined;
    this.lastSavedAt = null;
    this.currentSummary = null;
    this.projectEpoch += 1;
    return null;
  }

  async saveWorkspace(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.currentStorageId ??= project.project_id;
    const storageId = this.currentStorageId ?? project.project_id;
    const result = await this.storage.writeProject(
      project,
      expectedVersion,
      storageId,
    );
    this.currentProject = cloneProject(project);
    this.currentStorageId = storageId;
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
    this.currentSummary = summaryAfterWrite(
      this.currentSummary,
      storageId,
      project,
      result,
    );
    return result;
  }

  async replaceDamagedProject(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    if (!isDamageAwareStorageAdapter(this.storage)) {
      throw new Error("The current storage adapter has no damaged metadata");
    }
    const result = await this.storage.replaceDamagedProject(
      project,
      expectedVersion,
      this.currentStorageId ?? project.project_id,
    );
    const resultingStorageId = isCurrentWorkspaceAdapter(this.storage)
      ? project.project_id
      : (this.currentStorageId ?? project.project_id);
    this.currentProject = cloneProject(project);
    this.currentStorageId = resultingStorageId;
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
    this.currentSummary = summaryAfterWrite(
      this.currentSummary,
      resultingStorageId,
      project,
      result,
    );
    return result;
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return isProjectFolderAdapter(this.storage)
      ? this.storage.listRecentWorkspaces()
      : this.storage.listWorkspaces();
  }

  async switchWorkspace(id: string): Promise<Project | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.switchWorkspace(id);
      return summary ? this.readAndAdopt(summary.id, summary) : null;
    }

    return this.readAndAdopt(id);
  }

  async importPath(file: File): Promise<Project> {
    const project = this.requireProject();
    const parsed = JSON.parse(await file.text()) as unknown;
    const parsedObject = isJsonObject(parsed) ? parsed : null;
    const lookupConfig = deserializeProjectConfig(
      parsedObject?.config ?? project.config,
    );
    const path = deserializePath(
      parsedObject?.path ?? parsed,
      projectConfigDefaultLookup(lookupConfig),
    );
    const fileName = ensureJsonFileName(
      typeof parsedObject?.path_file_name === "string"
        ? parsedObject.path_file_name
        : file.name || "imported-path.json",
    );
    const displayName =
      typeof parsedObject?.display_name === "string" &&
      parsedObject.display_name.trim()
        ? parsedObject.display_name
        : fileName.replace(/\.json$/i, "").replace(/[-_]+/g, " ");

    const { project: nextProject } = addPathToProject(project, {
      display_name: displayName,
      file_name: fileName,
      path,
    });
    await this.saveWorkspace(nextProject, this.currentVersion);
    return nextProject;
  }

  async exportPath(project: Project, pathId: string): Promise<Blob> {
    const path = project.paths.find(
      (candidate) => candidate.path_id === pathId,
    );
    if (!path) {
      throw new Error(`Path not found: ${pathId}`);
    }

    return jsonBlob(serializePath(path.path));
  }

  async importConfig(file: File): Promise<Project> {
    const config = deserializeProjectConfig(
      JSON.parse(await file.text()) as unknown,
    );
    const nextProject = {
      ...this.requireProject(),
      config,
    };
    await this.saveWorkspace(nextProject, this.currentVersion);
    return nextProject;
  }

  async exportConfig(project: Project): Promise<Blob> {
    return jsonBlob(serializeBLineRuntimeConfig(project.config));
  }

  async importProjectFolder(
    files: readonly File[],
    options: ProjectImportOptions = {},
  ): Promise<ProjectImportResult> {
    const imported = openProjectFromLegacyWorkspace(
      await deserializeBLineProjectFolder(files),
    ).project;
    const legacyFieldBackgrounds = await importedFieldBackgroundsFromFolder(
      files,
      imported,
    );
    const legacySelectedFieldId =
      imported.config.gui.field.custom_fields.length > 0
        ? imported.config.gui.field.selected_field_id
        : null;
    const portableProject = withoutLegacyProjectFields(imported);

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireProject();
      const nextProject = {
        ...portableProject,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      const result = importedProjectResult(
        nextProject,
        legacySelectedFieldId,
        legacyFieldBackgrounds,
      );
      await migrateImportedFieldsBeforeCommit(result, options);
      await this.saveWorkspace(nextProject, this.currentVersion);
      return result;
    }

    const result = importedProjectResult(
      portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
    );
    await migrateImportedFieldsBeforeCommit(result, options);
    await this.saveImportedBrowserProject(portableProject);
    return result;
  }

  async exportProjectFolder(project: Project): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(project);
  }

  async importProjectArchive(
    file: File,
    options: ProjectImportOptions = {},
  ): Promise<ProjectImportResult> {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as unknown;
    const imported = await decodeWorkspaceArchive(
      new Blob([raw], { type: file.type || "application/json" }),
    );
    const legacySelectedFieldId =
      imported.config.gui.field.custom_fields.length > 0
        ? imported.config.gui.field.selected_field_id
        : null;
    const legacyFieldBackgrounds = importedFieldBackgroundsFromArchive(
      parsed,
      imported,
    );
    const portableProject = withoutLegacyProjectFields(imported);

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireProject();
      const nextProject = {
        ...portableProject,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      const result = importedProjectResult(
        nextProject,
        legacySelectedFieldId,
        legacyFieldBackgrounds,
      );
      await migrateImportedFieldsBeforeCommit(result, options);
      await this.saveWorkspace(nextProject, this.currentVersion);
      return result;
    }

    const result = importedProjectResult(
      portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
    );
    await migrateImportedFieldsBeforeCommit(result, options);
    await this.saveImportedBrowserProject(portableProject);
    return result;
  }

  async exportProjectArchive(project: Project): Promise<Blob> {
    return jsonBlob(
      createBLineProjectArchive(project, new Date().toISOString()),
    );
  }

  async readLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<Blob | null> {
    if (!this.storage.readFieldAsset) {
      return null;
    }

    const payload = await this.storage.readFieldAsset(
      projectId,
      field.asset_id,
    );
    return payload
      ? new Blob([bytesToArrayBuffer(payload.bytes)], {
          type: payload.mimeType || field.mime_type,
        })
      : null;
  }

  async deleteLegacyFieldImageAsset(
    projectId: string,
    field: CustomFieldImage,
  ): Promise<void> {
    await this.storage.deleteFieldAsset?.(projectId, field.asset_id);
  }

  private async readAndAdopt(
    id: string,
    knownSummary?: ProjectWorkspaceSummary,
  ): Promise<Project> {
    const project = await this.storage.readProject(id);
    const listedSummary = (await this.listWorkspaces()).find(
      (candidate) => candidate.id === id,
    );
    const summary = listedSummary ?? knownSummary;
    if (isCurrentWorkspaceAdapter(this.storage)) {
      await this.storage.setCurrentWorkspaceId(id);
    }
    this.projectEpoch += 1;
    this.currentProject = cloneProject(project);
    this.currentStorageId = id;
    this.currentVersion = summary?.version;
    this.lastSavedAt = summary?.updatedAt ?? null;
    this.currentSummary = summary ? { ...summary } : null;
    return project;
  }

  private async saveImportedBrowserProject(project: Project): Promise<void> {
    const collision = (await this.storage.listWorkspaces()).find(
      (summary) => summary.id === project.project_id,
    );
    if (collision) {
      throw new StorageConflictError(
        `A saved Project already uses ID ${project.project_id}`,
        undefined,
        collision.version,
      );
    }

    if (!this.storage.writeNewProject) {
      throw new Error(
        "This storage adapter cannot safely create an imported Project",
      );
    }
    const result = await this.storage.writeNewProject(project);
    this.currentProject = cloneProject(project);
    this.currentStorageId = project.project_id;
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
    this.currentSummary = summaryAfterWrite(
      null,
      project.project_id,
      project,
      result,
    );
    this.projectEpoch += 1;
  }

  private captureOwnership(): ProjectOwnershipSnapshot {
    return {
      project: this.currentProject ? cloneProject(this.currentProject) : null,
      storageId: this.currentStorageId,
      version: this.currentVersion,
      lastSavedAt: this.lastSavedAt,
      summary: this.currentSummary ? { ...this.currentSummary } : null,
      projectEpoch: this.projectEpoch,
    };
  }

  private restoreOwnership(previous: ProjectOwnershipSnapshot) {
    this.currentProject = previous.project;
    this.currentStorageId = previous.storageId;
    this.currentVersion = previous.version;
    this.lastSavedAt = previous.lastSavedAt;
    this.currentSummary = previous.summary;
    this.projectEpoch = previous.projectEpoch;
  }

  private async restoreStorageOwnership(
    previous: ProjectOwnershipSnapshot,
  ): Promise<void> {
    try {
      if (isProjectFolderAdapter(this.storage) && previous.storageId) {
        await this.storage.switchWorkspace(previous.storageId);
      } else if (isCurrentWorkspaceAdapter(this.storage)) {
        await this.storage.setCurrentWorkspaceId(previous.storageId);
      }
    } catch {
      // Preserve the creation failure; service ownership is restored separately.
    }
  }

  private adoptWrittenProject(
    project: Project,
    storageId: string,
    result: WriteResult,
    summary: ProjectWorkspaceSummary | null = null,
  ): void {
    this.currentProject = cloneProject(project);
    this.currentStorageId = storageId;
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
    this.currentSummary = summaryAfterWrite(
      summary,
      storageId,
      project,
      result,
    );
    this.projectEpoch += 1;
  }

  private ownsLegacyMigration(migration: LegacyProjectViewMigration): boolean {
    return (
      this.currentProject?.project_id === migration.stableProjectId &&
      isLegacyProjectMetadataAdapter(this.storage) &&
      this.storage.getLegacyProjectMigrationSourceId(
        this.currentStorageId ?? undefined,
      ) === migration.legacyProjectId
    );
  }

  private stillOwnsMigration(
    migration: LegacyProjectViewMigration,
    projectEpoch: number,
    storageId: string | null,
  ): boolean {
    return (
      this.projectEpoch === projectEpoch &&
      this.currentStorageId === storageId &&
      this.currentProject?.project_id === migration.stableProjectId
    );
  }

  private requireProject(): Project {
    if (!this.currentProject) {
      throw new Error("No project workspace is open");
    }

    return cloneProject(this.currentProject);
  }
}

function importedProjectResult(
  project: Project,
  legacySelectedFieldId: string | null,
  legacyFieldBackgrounds: ImportedLegacyFieldBackground[],
): ProjectImportResult {
  return { project, legacySelectedFieldId, legacyFieldBackgrounds };
}

async function migrateImportedFieldsBeforeCommit(
  imported: ProjectImportResult,
  options: ProjectImportOptions,
): Promise<void> {
  if (imported.legacyFieldBackgrounds.length === 0) {
    return;
  }
  if (!options.migrateLegacyFieldBackgrounds) {
    throw new Error(
      "Legacy Field Background migration is required before importing this Project",
    );
  }
  await options.migrateLegacyFieldBackgrounds(imported);
}

function summaryAfterWrite(
  previous: ProjectWorkspaceSummary | null,
  storageId: string,
  project: Project,
  result: WriteResult,
): ProjectWorkspaceSummary {
  return {
    ...previous,
    id: storageId,
    displayName: project.display_name,
    version: result.version,
    updatedAt: result.updatedAt,
  };
}

function withoutLegacyProjectFields(project: Project): Project {
  return {
    ...cloneProject(project),
    config: {
      ...structuredClone(project.config),
      gui: {
        ...structuredClone(project.config.gui),
        field: structuredClone(defaultProjectFieldConfig),
      },
    },
  };
}

function importedFieldBackgroundsFromArchive(
  parsedArchive: unknown,
  project: Project,
): ImportedLegacyFieldBackground[] {
  const bytesByAssetId = new Map(
    fieldAssetsFromBLineProjectArchive(parsedArchive).map((asset) => [
      asset.asset_id,
      base64ToBytes(asset.data_base64),
    ]),
  );
  return project.config.gui.field.custom_fields.map((field) => {
    const bytes = bytesByAssetId.get(field.asset_id);
    if (!bytes) {
      throw new Error(
        `Imported Project is missing Field Background asset ${field.asset_id} (${field.name})`,
      );
    }
    return { field, bytes };
  });
}

async function importedFieldBackgroundsFromFolder(
  files: readonly File[],
  project: Project,
): Promise<ImportedLegacyFieldBackground[]> {
  const filesByAssetId = new Map(
    files.flatMap((file) => {
      const assetId = assetIdFromProjectFolderFile(file);
      return assetId ? [[assetId, file] as const] : [];
    }),
  );
  const imported: ImportedLegacyFieldBackground[] = [];
  for (const field of project.config.gui.field.custom_fields) {
    const file = filesByAssetId.get(field.asset_id);
    if (!file) {
      throw new Error(
        `Imported Project folder is missing Field Background asset ${field.asset_id} (${field.name})`,
      );
    }
    imported.push({
      field: {
        ...field,
        file_name: field.file_name || file.name,
        mime_type:
          field.mime_type || file.type || mimeTypeFromFileName(file.name),
      },
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return imported;
}

export function createBrowserProjectIoCapabilities(): ProjectIoCapabilities {
  return {
    shellLabel: "Browser",
    autosaveTargetLabel: "Browser persistent storage",
    directFileAutosave: false,
    browserPersistentAutosave: true,
    supportsProjectFolders: false,
    supportsAutosFolderImportExport: true,
    supportsWorkspaceList: true,
    supportsPortableImportExport: true,
    supportsUrlSharing: false,
    supportsRemoteSync: false,
    primaryToolbarActions: [
      "open-workspace",
      "import-project",
      "export-project",
      "save",
    ],
  };
}

export function createDesktopProjectIoCapabilities(): ProjectIoCapabilities {
  return {
    shellLabel: "Desktop",
    autosaveTargetLabel: "Open autos folder",
    directFileAutosave: true,
    browserPersistentAutosave: false,
    supportsProjectFolders: true,
    supportsAutosFolderImportExport: true,
    supportsWorkspaceList: true,
    supportsPortableImportExport: true,
    supportsUrlSharing: false,
    supportsRemoteSync: false,
    primaryToolbarActions: ["open-folder", "new-path", "save"],
  };
}

function isJsonObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function jsonBlob(value: unknown): Blob {
  return new Blob([stringifyBLineJson(value)], {
    type: "application/json",
  });
}

function cryptoId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function safeImageExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension === "jpg" ||
    extension === "jpeg" ||
    extension === "webp" ||
    extension === "svg"
    ? extension
    : "png";
}

function mimeTypeFromFileName(fileName: string): string {
  switch (safeImageExtension(fileName)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assetIdFromProjectFolderFile(file: File): string | null {
  const rawPath = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
  const parts = rawPath.split("/").filter(Boolean);
  const fieldsIndex = parts.findIndex(
    (part, index) =>
      part.toLowerCase() === "fields" &&
      parts[index - 1]?.toLowerCase() === "assets",
  );
  return fieldsIndex >= 0 ? (parts[fieldsIndex + 1] ?? null) : null;
}
