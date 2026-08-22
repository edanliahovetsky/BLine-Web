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
import type { ProjectWorkspaceDocument } from "../../core/io/projectSchema";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import {
  activePathFromWorkspace,
  addPathToWorkspace,
  deserializeProjectWorkspaceDocument,
  ensureJsonFileName,
  ensureWorkspaceHasActivePath,
} from "../../core/io/workspaceSerde";
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
  private currentWorkspace: ProjectWorkspaceDocument | null = null;
  private currentVersion: string | undefined;
  private lastSavedAt: string | null = null;

  constructor(storage: StorageAdapter, capabilities: ProjectIoCapabilities) {
    this.storage = storage;
    this.capabilities = capabilities;
  }

  async initialize(): Promise<ProjectWorkspaceDocument | null> {
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

  async getWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    return this.currentWorkspace
      ? structuredClone(this.currentWorkspace)
      : null;
  }

  async peekWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    if (!this.currentWorkspace) {
      return null;
    }
    const onDisk = await this.storage.readWorkspace(
      this.currentWorkspace.project_id,
    );
    return ensureWorkspaceHasActivePath(onDisk);
  }

  getCurrentVersion(): string | undefined {
    return this.currentVersion;
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt;
  }

  async createWorkspace(
    input: CreateWorkspaceInput = {},
  ): Promise<ProjectWorkspaceDocument> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.createWorkspace();
      if (!summary) {
        throw new Error("No desktop project folder was selected");
      }

      const workspace = input.workspace
        ? {
            ...input.workspace,
            project_id: summary.id,
            display_name: summary.displayName,
          }
        : await this.storage.readWorkspace(summary.id);

      const normalized = ensureWorkspaceHasActivePath(workspace);
      await this.saveWorkspace(normalized);
      return normalized;
    }

    const workspace = ensureWorkspaceHasActivePath(
      input.workspace ??
        deserializeProjectWorkspaceDocument({
          schema_version: 1,
          project_id: cryptoId("workspace"),
          display_name: "Untitled Project",
          config: undefined,
          paths: [],
        }),
    );
    await this.saveWorkspace(workspace);
    return workspace;
  }

  async openWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null> {
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

  async deleteWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null> {
    if (!this.storage.deleteWorkspace) {
      throw new Error(
        "Deleting projects is not supported by this storage adapter",
      );
    }

    const targetId = id ?? this.requireWorkspace().project_id;
    const deletingCurrent = this.currentWorkspace?.project_id === targetId;
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

    this.currentWorkspace = null;
    this.currentVersion = undefined;
    this.lastSavedAt = null;
    return null;
  }

  async saveWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const result = await this.storage.writeWorkspace(
      {
        ...structuredClone(workspace),
        active_path_id: null,
        active_path_group_id: null,
      },
      expectedVersion,
    );
    this.currentWorkspace = ensureWorkspaceHasActivePath(workspace);
    this.currentVersion = result.version;
    this.lastSavedAt = result.updatedAt;
    return result;
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return isProjectFolderAdapter(this.storage)
      ? this.storage.listRecentWorkspaces()
      : this.storage.listWorkspaces();
  }

  async switchWorkspace(id: string): Promise<ProjectWorkspaceDocument | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.switchWorkspace(id);
      return summary ? this.readAndAdopt(summary.id) : null;
    }

    return this.readAndAdopt(id);
  }

  async importPath(file: File): Promise<ProjectWorkspaceDocument> {
    const workspace = this.requireWorkspace();
    const parsed = JSON.parse(await file.text()) as unknown;
    const parsedObject = isJsonObject(parsed) ? parsed : null;
    const lookupConfig = deserializeProjectConfig(
      parsedObject?.config ?? workspace.config,
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

    const nextWorkspace = addPathToWorkspace(workspace, {
      display_name: displayName,
      file_name: fileName,
      path,
      makeActive: true,
    });
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async exportPath(pathId: string): Promise<Blob> {
    const path = this.requireWorkspace().paths.find(
      (candidate) => candidate.path_id === pathId,
    );
    if (!path) {
      throw new Error(`Path not found: ${pathId}`);
    }

    return jsonBlob(serializePath(path.path));
  }

  async importConfig(file: File): Promise<ProjectWorkspaceDocument> {
    const config = deserializeProjectConfig(
      JSON.parse(await file.text()) as unknown,
    );
    const nextWorkspace = {
      ...this.requireWorkspace(),
      config,
    };
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async exportConfig(): Promise<Blob> {
    return jsonBlob(
      serializeBLineRuntimeConfig(this.requireWorkspace().config),
    );
  }

  async importProjectFolder(
    files: readonly File[],
  ): Promise<ProjectWorkspaceDocument> {
    const imported = await deserializeBLineProjectFolder(files);

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireWorkspace();
      const nextWorkspace = {
        ...imported,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      await this.saveWorkspace(nextWorkspace, this.currentVersion);
      await this.importProjectFolderFieldAssets(files, nextWorkspace);
      return nextWorkspace;
    }

    await this.saveWorkspace(imported);
    await this.importProjectFolderFieldAssets(files, imported);
    return imported;
  }

  async exportProjectFolder(): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(this.requireWorkspace());
  }

  async importProjectArchive(file: File): Promise<ProjectWorkspaceDocument> {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as unknown;
    const imported = await decodeWorkspaceArchive(
      new Blob([raw], { type: file.type || "application/json" }),
    );

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireWorkspace();
      const nextWorkspace = {
        ...imported,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      await this.saveWorkspace(nextWorkspace, this.currentVersion);
      await this.importArchiveFieldAssets(parsed, nextWorkspace);
      return nextWorkspace;
    }

    await this.saveWorkspace(imported);
    await this.importArchiveFieldAssets(parsed, imported);
    return imported;
  }

  async exportProjectArchive(): Promise<Blob> {
    return jsonBlob(
      createBLineProjectArchive(
        this.requireWorkspace(),
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

  private async readAndAdopt(id: string): Promise<ProjectWorkspaceDocument> {
    const storedWorkspace = await this.storage.readWorkspace(id);
    const workspace = ensureWorkspaceHasActivePath(storedWorkspace);
    this.currentWorkspace = structuredClone(workspace);
    await this.syncVersion(workspace.project_id);
    return workspace;
  }

  private async syncVersion(id: string): Promise<void> {
    const summaries = await this.listWorkspaces();
    const summary = summaries.find((candidate) => candidate.id === id);
    this.currentVersion = summary?.version;
    this.lastSavedAt = summary?.updatedAt ?? null;
  }

  private requireWorkspace(): ProjectWorkspaceDocument {
    if (!this.currentWorkspace) {
      throw new Error("No project workspace is open");
    }

    return structuredClone(this.currentWorkspace);
  }

  private async importArchiveFieldAssets(
    parsedArchive: unknown,
    workspace: ProjectWorkspaceDocument,
  ): Promise<void> {
    if (!this.storage.writeFieldAsset) {
      return;
    }

    for (const asset of fieldAssetsFromBLineProjectArchive(parsedArchive)) {
      await this.storage.writeFieldAsset({
        workspaceId: workspace.project_id,
        assetId: asset.asset_id,
        fileName: asset.file_name,
        mimeType: asset.mime_type,
        bytes: base64ToBytes(asset.data_base64),
      });
    }
  }

  private async importProjectFolderFieldAssets(
    files: readonly File[],
    workspace: ProjectWorkspaceDocument,
  ): Promise<void> {
    if (!this.storage.writeFieldAsset) {
      return;
    }

    const assets = new Map(
      workspace.config.gui.field.custom_fields.map((field) => [
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
        workspaceId: workspace.project_id,
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
  workspace: ProjectWorkspaceDocument,
): string {
  const activePath = activePathFromWorkspace(workspace);
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
