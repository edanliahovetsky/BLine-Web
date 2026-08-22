import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import type { CustomFieldImage } from "../../core/field/fieldConfig";
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
import {
  legacyWorkspaceForPersistence,
  openProjectFromLegacyWorkspace,
} from "../../core/io/legacyWorkspace";
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
  isCurrentWorkspaceAdapter,
  isProjectFolderAdapter,
  type ProjectWorkspaceSummary,
  type StorageAdapter,
  type WriteResult,
} from "../../storage";
import type {
  CreateWorkspaceInput,
  ProjectIoCapabilities,
  ProjectIoService,
} from "./types";

export class StorageProjectIoService implements ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  private readonly storage: StorageAdapter;
  private currentProject: Project | null = null;
  private currentStorageId: string | null = null;
  private currentVersion: string | undefined;
  private lastSavedAt: string | null = null;

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
    const onDisk = await this.storage.readWorkspace(
      this.currentStorageId ?? this.currentProject.project_id,
    );
    return openProjectFromLegacyWorkspace(onDisk).project;
  }

  getCurrentVersion(): string | undefined {
    return this.currentVersion;
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt;
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
        : openProjectFromLegacyWorkspace(
            await this.storage.readWorkspace(summary.id),
          ).project;

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
    return null;
  }

  async saveWorkspace(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.currentStorageId ??= project.project_id;
    const result = await this.storage.writeWorkspace(
      legacyWorkspaceForPersistence(project),
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

  async importProjectFolder(files: readonly File[]): Promise<Project> {
    const imported = openProjectFromLegacyWorkspace(
      await deserializeBLineProjectFolder(files),
    ).project;

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireProject();
      const nextProject = {
        ...imported,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      await this.saveWorkspace(nextProject, this.currentVersion);
      await this.importProjectFolderFieldAssets(files, nextProject);
      return nextProject;
    }

    await this.saveWorkspace(imported);
    await this.importProjectFolderFieldAssets(files, imported);
    return imported;
  }

  async exportProjectFolder(project: Project): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(project);
  }

  async importProjectArchive(file: File): Promise<Project> {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as unknown;
    const imported = openProjectFromLegacyWorkspace(
      await decodeWorkspaceArchive(
        new Blob([raw], { type: file.type || "application/json" }),
      ),
    ).project;

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireProject();
      const nextProject = {
        ...imported,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      await this.saveWorkspace(nextProject, this.currentVersion);
      await this.importArchiveFieldAssets(parsed, nextProject);
      return nextProject;
    }

    await this.saveWorkspace(imported);
    await this.importArchiveFieldAssets(parsed, imported);
    return imported;
  }

  async exportProjectArchive(project: Project): Promise<Blob> {
    return jsonBlob(
      createBLineProjectArchive(
        legacyWorkspaceForPersistence(project),
        new Date().toISOString(),
      ),
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
    const storedWorkspace = await this.storage.readWorkspace(id);
    const project = openProjectFromLegacyWorkspace(storedWorkspace).project;
    this.currentProject = cloneProject(project);
    this.currentStorageId = id;
    await this.syncVersion(id);
    return project;
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

  private async importArchiveFieldAssets(
    parsedArchive: unknown,
    project: Project,
  ): Promise<void> {
    if (!this.storage.writeFieldAsset) {
      return;
    }

    for (const asset of fieldAssetsFromBLineProjectArchive(parsedArchive)) {
      await this.storage.writeFieldAsset({
        workspaceId: project.project_id,
        assetId: asset.asset_id,
        fileName: asset.file_name,
        mimeType: asset.mime_type,
        bytes: base64ToBytes(asset.data_base64),
      });
    }
  }

  private async importProjectFolderFieldAssets(
    files: readonly File[],
    project: Project,
  ): Promise<void> {
    if (!this.storage.writeFieldAsset) {
      return;
    }

    const assets = new Map(
      project.config.gui.field.custom_fields.map((field) => [
        field.asset_id,
        field,
      ]),
    );
    for (const file of files) {
      const assetId = assetIdFromProjectFolderFile(file);
      if (!assetId || !assets.has(assetId)) {
        continue;
      }

      const field = assets.get(assetId);
      await this.storage.writeFieldAsset({
        workspaceId: project.project_id,
        assetId,
        fileName: field?.file_name ?? file.name,
        mimeType:
          field?.mime_type ?? file.type ?? mimeTypeFromFileName(file.name),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
  }
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

export function activePathFileName(
  project: Project,
  activePathId?: string | null,
): string {
  const activePath =
    project.paths.find((path) => path.path_id === activePathId) ??
    project.paths[0] ??
    null;
  return activePath?.file_name ?? "path.json";
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
