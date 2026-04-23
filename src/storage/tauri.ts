import { invoke } from "@tauri-apps/api/core";
import type { ProjectDocument, SerializedProjectDocument } from "../core/io/projectSchema";
import { deserializeProjectDocument, serializeProjectDocument } from "../core/io/projectSerde";
import {
  createProjectBundle,
  importProjectBundle,
  type ImportResult,
  type ProjectSummary,
  type StorageAdapter,
  type WriteResult
} from "./adapter";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriStorageOptions {
  invoke?: TauriInvoke;
  now?: () => Date;
}

export class TauriStorage implements StorageAdapter {
  private readonly invoke: TauriInvoke;
  private readonly now: () => Date;

  constructor(options: TauriStorageOptions = {}) {
    this.invoke = options.invoke ?? invoke;
    this.now = options.now ?? (() => new Date());
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.invoke<ProjectSummary[]>("storage_list_projects");
  }

  async readProject(id: string): Promise<ProjectDocument> {
    const project = await this.invoke<SerializedProjectDocument>("storage_read_project", {
      id
    });
    return deserializeProjectDocument(project);
  }

  async writeProject(
    project: ProjectDocument,
    expectedVersion?: string
  ): Promise<WriteResult> {
    return this.invoke<WriteResult>("storage_write_project", {
      project: serializeProjectDocument(project),
      expected: expectedVersion ?? null
    });
  }

  async deleteProject(id: string, expectedVersion?: string): Promise<void> {
    await this.invoke<void>("storage_delete_project", {
      id,
      expected: expectedVersion ?? null
    });
  }

  async exportBundle(ids: string[]): Promise<Blob> {
    return createProjectBundle(this, ids, this.now().toISOString());
  }

  async importBundle(bundle: Blob): Promise<ImportResult> {
    return importProjectBundle(this, bundle);
  }
}
