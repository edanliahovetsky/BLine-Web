import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectWorkspaceDocument,
  SerializedProjectWorkspaceDocument,
} from "../core/io/projectSchema";
import {
  deserializeProjectWorkspaceDocument,
  serializeProjectWorkspaceDocument,
} from "../core/io/workspaceSerde";
import {
  createBLineWorkspaceArchive,
  importWorkspaceArchive,
  type FieldAssetPayload,
  type FieldAssetWriteInput,
  type ProjectFolderAdapter,
  type ProjectWorkspaceSummary,
  type WorkspaceImportResult,
  type WriteResult,
} from "./adapter";

export type TauriInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface TauriStorageOptions {
  invoke?: TauriInvoke;
  now?: () => Date;
}

export class TauriStorage implements ProjectFolderAdapter {
  private readonly invoke: TauriInvoke;
  private readonly now: () => Date;

  constructor(options: TauriStorageOptions = {}) {
    this.invoke = options.invoke ?? invoke;
    this.now = options.now ?? (() => new Date());
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return this.listRecentWorkspaces();
  }

  async readWorkspace(id?: string): Promise<ProjectWorkspaceDocument> {
    const workspace = await this.invoke<SerializedProjectWorkspaceDocument>(
      "storage_read_workspace",
      { id: id ?? null },
    );
    return deserializeProjectWorkspaceDocument(workspace);
  }

  async writeWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    return this.invoke<WriteResult>("storage_write_workspace", {
      workspace: serializeProjectWorkspaceDocument({
        ...workspace,
        active_path_id: null,
        active_path_group_id: null,
      }),
      expected: expectedVersion ?? null,
    });
  }

  async exportWorkspaceArchive(id?: string): Promise<Blob> {
    const workspace = id
      ? await this.readWorkspace(id)
      : await this.readWorkspace();
    const memoryAdapter = {
      readWorkspace: async () => workspace,
    };
    return createBLineWorkspaceArchive(
      memoryAdapter,
      workspace.project_id,
      this.now().toISOString(),
    );
  }

  async importWorkspaceArchive(archive: Blob): Promise<WorkspaceImportResult> {
    return importWorkspaceArchive(this, archive);
  }

  async writeFieldAsset(input: FieldAssetWriteInput): Promise<void> {
    await this.invoke("storage_write_field_asset", {
      assetId: input.assetId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: Array.from(input.bytes),
    });
  }

  async readFieldAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<FieldAssetPayload | null> {
    const payload = await this.invoke<{
      fileName: string;
      mimeType: string;
      bytes: number[];
    } | null>("storage_read_field_asset", { workspaceId, assetId });

    return payload
      ? {
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          bytes: new Uint8Array(payload.bytes),
        }
      : null;
  }

  async deleteFieldAsset(workspaceId: string, assetId: string): Promise<void> {
    await this.invoke("storage_delete_field_asset", { workspaceId, assetId });
  }

  async getCurrentWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    return this.invoke<ProjectWorkspaceSummary | null>(
      "storage_get_current_workspace",
    );
  }

  async listRecentWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return this.invoke<ProjectWorkspaceSummary[]>(
      "storage_list_recent_workspaces",
    );
  }

  async openWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    return this.invoke<ProjectWorkspaceSummary | null>(
      "storage_open_workspace_dialog",
    );
  }

  async createWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    return this.invoke<ProjectWorkspaceSummary | null>(
      "storage_create_workspace_dialog",
    );
  }

  async switchWorkspace(id: string): Promise<ProjectWorkspaceSummary | null> {
    return this.invoke<ProjectWorkspaceSummary | null>(
      "storage_switch_workspace",
      {
        id,
      },
    );
  }
}
