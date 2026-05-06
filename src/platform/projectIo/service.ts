import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import {
  deserializeProjectConfig,
  serializeProjectConfig,
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
  deletePathsFromWorkspace,
  deserializeProjectWorkspaceDocument,
  duplicatePathInWorkspace,
  ensureJsonFileName,
  ensureWorkspaceHasActivePath,
  renamePathInWorkspace,
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
  CreatePathInput,
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
    return this.capabilities.supportsProjectFolders
      ? null
      : this.createWorkspace();
  }

  async saveWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const normalized = ensureWorkspaceHasActivePath(workspace);
    const result = await this.storage.writeWorkspace(
      normalized,
      expectedVersion,
    );
    this.currentWorkspace = structuredClone(normalized);
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

  async setActivePath(pathId: string): Promise<ProjectWorkspaceDocument> {
    const workspace = this.requireWorkspace();
    const nextWorkspace = ensureWorkspaceHasActivePath({
      ...workspace,
      active_path_id: pathId,
    });
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async createPath(input: CreatePathInput): Promise<ProjectWorkspaceDocument> {
    const nextWorkspace = addPathToWorkspace(this.requireWorkspace(), {
      display_name: input.displayName,
      file_name: input.fileName,
      makeActive: true,
    });
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async renamePath(
    pathId: string,
    name: string,
  ): Promise<ProjectWorkspaceDocument> {
    const nextWorkspace = renamePathInWorkspace(
      this.requireWorkspace(),
      pathId,
      name,
    );
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async duplicatePath(
    pathId: string,
    name: string,
  ): Promise<ProjectWorkspaceDocument> {
    const nextWorkspace = duplicatePathInWorkspace(
      this.requireWorkspace(),
      pathId,
      name,
    );
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
  }

  async deletePaths(
    pathIds: readonly string[],
  ): Promise<ProjectWorkspaceDocument> {
    const nextWorkspace = deletePathsFromWorkspace(
      this.requireWorkspace(),
      pathIds,
    );
    await this.saveWorkspace(nextWorkspace, this.currentVersion);
    return nextWorkspace;
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
    return jsonBlob(serializeProjectConfig(this.requireWorkspace().config));
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
      return nextWorkspace;
    }

    await this.saveWorkspace(imported);
    return imported;
  }

  async exportProjectFolder(): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(this.requireWorkspace());
  }

  async importProjectArchive(file: File): Promise<ProjectWorkspaceDocument> {
    const imported = await decodeWorkspaceArchive(file);

    if (this.capabilities.supportsProjectFolders) {
      const current = this.requireWorkspace();
      const nextWorkspace = {
        ...imported,
        project_id: current.project_id,
        display_name: current.display_name,
      };
      await this.saveWorkspace(nextWorkspace, this.currentVersion);
      return nextWorkspace;
    }

    await this.saveWorkspace(imported);
    return imported;
  }

  async exportProjectArchive(): Promise<Blob> {
    const workspace = this.requireWorkspace();
    if (this.storage.exportWorkspaceArchive) {
      return this.storage.exportWorkspaceArchive(workspace.project_id);
    }

    return jsonBlob(workspace);
  }

  private async readAndAdopt(id: string): Promise<ProjectWorkspaceDocument> {
    const workspace = ensureWorkspaceHasActivePath(
      await this.storage.readWorkspace(id),
    );
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
