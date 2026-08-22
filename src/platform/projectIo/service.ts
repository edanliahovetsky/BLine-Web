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
  ProjectIoCapabilities,
  ProjectIoService,
  LegacyProjectViewMigration,
} from "./types";

export class StorageProjectIoService implements ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  private readonly storage: StorageAdapter;
  private currentProject: Project | null = null;
  private currentStorageId: string | null = null;
  private currentVersion: string | undefined;
  private lastSavedAt: string | null = null;
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
      return this.readAndAdopt(summary.id);
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
    return summary ? this.readAndAdopt(summary.id) : null;
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

  getPersistenceDamage() {
    return isDamageAwareStorageAdapter(this.storage)
      ? this.storage.getCurrentProjectDamage()
      : null;
  }

  getLegacyProjectViewMigration() {
    const project = this.currentProject;
    const legacyProjectId = isLegacyProjectMetadataAdapter(this.storage)
      ? this.storage.getLegacyProjectMigrationSourceId()
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
        ? await this.storage.getCurrentWorkspaceId()
        : storageId;
      if (!this.stillOwnsMigration(migration, projectEpoch, storageId)) {
        return result;
      }
      this.currentVersion = result.version;
      this.lastSavedAt = result.updatedAt;
      this.currentStorageId = preparedStorageId;
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
    }
    return result;
  }

  async createWorkspace(input: CreateWorkspaceInput = {}): Promise<Project> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.createWorkspace();
      if (!summary) {
        throw new Error("No desktop project folder was selected");
      }
      this.currentStorageId = summary.id;

      const project = input.project
        ? cloneProject(input.project)
        : await this.storage.readProject(summary.id);

      await this.saveWorkspace(project);
      return cloneProject(project);
    }

    const project =
      input.project ??
      createProject({
        project_id: cryptoId("project"),
        display_name: "Untitled Project",
      });
    this.currentStorageId = project.project_id;
    await this.saveWorkspace(project);
    return cloneProject(project);
  }

  async openWorkspace(id?: string): Promise<Project | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = id
        ? await this.storage.switchWorkspace(id)
        : await this.storage.openWorkspace();
      return summary ? this.readAndAdopt(summary.id) : null;
    }

    if (!id) {
      const [summary] = await this.storage.listWorkspaces();
      return summary ? this.readAndAdopt(summary.id) : null;
    }

    return this.readAndAdopt(id);
  }

  async reloadCurrentProject(): Promise<Project | null> {
    const storageId = this.currentStorageId ?? this.currentProject?.project_id;
    return storageId ? this.readAndAdopt(storageId) : null;
  }

  async deleteWorkspace(id?: string): Promise<Project | null> {
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
    await this.storage.deleteWorkspace(
      targetId,
      deletingCurrent ? this.currentVersion : undefined,
    );

    if (!deletingCurrent) {
      return this.getWorkspace();
    }

    const [nextSummary] = await this.listWorkspaces();
    if (nextSummary) {
      return this.readAndAdopt(nextSummary.id);
    }

    this.currentProject = null;
    this.currentStorageId = null;
    this.currentVersion = undefined;
    this.lastSavedAt = null;
    this.projectEpoch += 1;
    return null;
  }

  async saveWorkspace(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.currentStorageId ??= project.project_id;
    const result = await this.storage.writeProject(project, expectedVersion);
    this.currentProject = cloneProject(project);
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
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
    );
    this.currentProject = cloneProject(project);
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
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
      return summary ? this.readAndAdopt(summary.id) : null;
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
      await this.saveWorkspace(nextProject, this.currentVersion);
      return {
        project: nextProject,
        legacySelectedFieldId,
        legacyFieldBackgrounds,
      };
    }

    await this.saveImportedBrowserProject(portableProject);
    return {
      project: portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
    };
  }

  async exportProjectFolder(project: Project): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(project);
  }

  async importProjectArchive(file: File): Promise<ProjectImportResult> {
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
      await this.saveWorkspace(nextProject, this.currentVersion);
      return {
        project: nextProject,
        legacySelectedFieldId,
        legacyFieldBackgrounds,
      };
    }

    await this.saveImportedBrowserProject(portableProject);
    return {
      project: portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
    };
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

  private async readAndAdopt(id: string): Promise<Project> {
    const project = await this.storage.readProject(id);
    this.projectEpoch += 1;
    this.currentProject = cloneProject(project);
    this.currentStorageId = id;
    await this.syncVersion(id);
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
    this.projectEpoch += 1;
  }

  private ownsLegacyMigration(migration: LegacyProjectViewMigration): boolean {
    return (
      this.currentProject?.project_id === migration.stableProjectId &&
      isLegacyProjectMetadataAdapter(this.storage) &&
      this.storage.getLegacyProjectMigrationSourceId() ===
        migration.legacyProjectId
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

  private async syncVersion(id: string): Promise<void> {
    const summaries = await this.listWorkspaces();
    const summary = summaries.find((candidate) => candidate.id === id);
    this.currentVersion = summary?.version;
    this.lastSavedAt = summary?.updatedAt ?? null;
  }

  private requireProject(): Project {
    if (!this.currentProject) {
      throw new Error("No project workspace is open");
    }

    return cloneProject(this.currentProject);
  }
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
  return project.config.gui.field.custom_fields.flatMap((field) => {
    const bytes = bytesByAssetId.get(field.asset_id);
    return bytes ? [{ field, bytes }] : [];
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
      continue;
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
