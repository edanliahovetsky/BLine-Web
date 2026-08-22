import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../core/model/project";
import {
  openProjectFiles,
  serializeProjectFiles,
  type ProjectFileDamage,
  type ProjectTextFile,
} from "../core/io/projectFiles";
import { openProjectFromLegacyWorkspace } from "../core/io/legacyWorkspace";
import { deserializeBLineProjectFolder } from "../core/io/projectFolder";
import {
  createBLineWorkspaceArchive,
  importWorkspaceArchive,
  type FieldAssetPayload,
  type ProjectFolderAdapter,
  type ProjectWorkspaceSummary,
  type WorkspaceImportResult,
  type WriteResult,
  ProjectPersistenceDamageError,
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
  private currentDirectoryLocator: string | null = null;
  private readonly fileSetMetadata = new Map<
    string,
    Pick<ProjectWorkspaceSummary, "version" | "updatedAt">
  >();
  private readonly damageByLocator = new Map<string, ProjectFileDamage>();
  private readonly legacyFilesByLocator = new Map<string, string[]>();
  private readonly canonicalLocators = new Set<string>();

  constructor(options: TauriStorageOptions = {}) {
    this.invoke = options.invoke ?? invoke;
    this.now = options.now ?? (() => new Date());
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return this.listRecentWorkspaces();
  }

  async readProject(id?: string): Promise<Project> {
    const result = await this.invoke<ProjectFileSetPayload>(
      "storage_read_project_files",
      { directoryLocator: id ?? this.currentDirectoryLocator },
    );
    this.rememberFileSet(result);
    this.legacyFilesByLocator.set(
      result.directoryLocator,
      (result.legacyFiles ?? []).map((file) => file.relativePath),
    );
    if (result.files.some((file) => file.relativePath === "project.json")) {
      this.canonicalLocators.add(result.directoryLocator);
    } else {
      this.canonicalLocators.delete(result.directoryLocator);
    }
    const displayName = displayNameFromDirectory(result.directoryLocator);
    const { project, damage } = result.files.some(
      (file) => file.relativePath === "project.json",
    )
      ? openProjectFiles(toProjectTextFiles(result.files), {
          fallbackDisplayName: displayName,
        })
      : await openLegacyOrRuntimeProject(result, displayName);
    if (damage) {
      this.damageByLocator.set(result.directoryLocator, damage);
    } else {
      this.damageByLocator.delete(result.directoryLocator);
    }
    return project;
  }

  async writeProject(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const damage = this.getCurrentProjectDamage();
    if (damage) {
      throw new ProjectPersistenceDamageError(damage);
    }
    return this.writeProjectFileSet(project, expectedVersion);
  }

  getCurrentProjectDamage(): ProjectFileDamage | null {
    return this.currentDirectoryLocator
      ? (this.damageByLocator.get(this.currentDirectoryLocator) ?? null)
      : null;
  }

  async replaceDamagedProject(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const result = await this.writeProjectFileSet(project, expectedVersion);
    if (this.currentDirectoryLocator) {
      this.damageByLocator.delete(this.currentDirectoryLocator);
    }
    return result;
  }

  private async writeProjectFileSet(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    const result = await this.invoke<ProjectFileSetWritePayload>(
      "storage_write_project_files",
      {
        directoryLocator: this.currentDirectoryLocator,
        files: serializeProjectFiles(project).map((file) => ({
          relativePath: file.relativePath,
          contents: file.text,
        })),
        expected: expectedVersion ?? null,
      },
    );
    this.rememberFileSet(result);
    this.canonicalLocators.add(result.directoryLocator);
    return { version: result.version, updatedAt: result.updatedAt };
  }

  async deleteLegacyProjectFiles(
    expectedVersion: string,
  ): Promise<WriteResult | null> {
    const locator = this.currentDirectoryLocator;
    if (
      !locator ||
      !this.canonicalLocators.has(locator) ||
      (this.legacyFilesByLocator.get(locator)?.length ?? 0) === 0
    ) {
      return null;
    }
    const result = await this.invoke<ProjectFileSetWritePayload>(
      "storage_delete_legacy_project_files",
      {
        directoryLocator: locator,
        expected: expectedVersion,
      },
    );
    this.rememberFileSet(result);
    this.legacyFilesByLocator.delete(locator);
    return { version: result.version, updatedAt: result.updatedAt };
  }

  async exportWorkspaceArchive(id?: string): Promise<Blob> {
    const project = id ? await this.readProject(id) : await this.readProject();
    return createBLineWorkspaceArchive(
      { readProject: async () => project },
      project.project_id,
      this.now().toISOString(),
    );
  }

  async importWorkspaceArchive(archive: Blob): Promise<WorkspaceImportResult> {
    return importWorkspaceArchive(this, archive);
  }

  async readFieldAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<FieldAssetPayload | null> {
    const payload = await this.invoke<{
      fileName: string;
      mimeType: string;
      bytes: number[];
    } | null>("storage_read_field_asset", {
      workspaceId: this.currentDirectoryLocator ?? workspaceId,
      assetId,
    });

    return payload
      ? {
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          bytes: new Uint8Array(payload.bytes),
        }
      : null;
  }

  async deleteFieldAsset(workspaceId: string, assetId: string): Promise<void> {
    await this.invoke("storage_delete_field_asset", {
      workspaceId: this.currentDirectoryLocator ?? workspaceId,
      assetId,
    });
  }

  async getCurrentWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    const summary = await this.invoke<ProjectWorkspaceSummary | null>(
      "storage_get_current_workspace",
    );
    return this.rememberSummaryLocator(summary);
  }

  async listRecentWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    const summaries = await this.invoke<ProjectWorkspaceSummary[]>(
      "storage_list_recent_workspaces",
    );
    return summaries.map((summary) => ({
      ...summary,
      ...(this.fileSetMetadata.get(summary.id) ?? {}),
    }));
  }

  async openWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    const summary = await this.invoke<ProjectWorkspaceSummary | null>(
      "storage_open_workspace_dialog",
    );
    return this.rememberSummaryLocator(summary);
  }

  async createWorkspace(): Promise<ProjectWorkspaceSummary | null> {
    const summary = await this.invoke<ProjectWorkspaceSummary | null>(
      "storage_create_workspace_dialog",
    );
    return this.rememberSummaryLocator(summary);
  }

  async switchWorkspace(id: string): Promise<ProjectWorkspaceSummary | null> {
    const summary = await this.invoke<ProjectWorkspaceSummary | null>(
      "storage_switch_workspace",
      {
        id,
      },
    );
    return this.rememberSummaryLocator(summary);
  }

  private rememberSummaryLocator(
    summary: ProjectWorkspaceSummary | null,
  ): ProjectWorkspaceSummary | null {
    if (summary) {
      this.currentDirectoryLocator = summary.id;
    }
    return summary;
  }

  private rememberFileSet(
    payload: ProjectFileSetPayload | ProjectFileSetWritePayload,
  ): void {
    this.currentDirectoryLocator = payload.directoryLocator;
    this.fileSetMetadata.set(payload.directoryLocator, {
      version: payload.version,
      updatedAt: payload.updatedAt,
    });
  }
}

interface ProjectFileSetPayload extends ProjectFileSetWritePayload {
  files: Array<{ relativePath: string; contents: string }>;
  legacyFiles?: Array<{ relativePath: string; contents: string }>;
}

interface ProjectFileSetWritePayload {
  directoryLocator: string;
  version: string;
  updatedAt: string;
}

function toProjectTextFiles(
  files: ProjectFileSetPayload["files"],
): ProjectTextFile[] {
  return files.map((file) => ({
    relativePath: file.relativePath,
    text: file.contents,
  }));
}

function displayNameFromDirectory(directoryLocator: string): string {
  const segments = directoryLocator.replaceAll("\\", "/").split("/");
  return (
    [...segments].reverse().find((segment) => segment.trim()) ??
    "Imported Project"
  );
}

async function openLegacyOrRuntimeProject(
  result: ProjectFileSetPayload,
  displayName: string,
) {
  try {
    return {
      project: {
        ...openProjectFromLegacyWorkspace(
          await deserializeBLineProjectFolder(
            [...result.files, ...(result.legacyFiles ?? [])].map((file) => ({
              name: file.relativePath.split("/").at(-1) ?? file.relativePath,
              webkitRelativePath: `autos/${file.relativePath}`,
              text: async () => file.contents,
            })),
          ),
        ).project,
        display_name: displayName,
      },
      damage: null,
    };
  } catch (error) {
    const runtime = openProjectFiles(toProjectTextFiles(result.files), {
      fallbackDisplayName: displayName,
    });
    const malformed = firstMalformedLegacyFile(result.legacyFiles ?? []);
    return {
      project: runtime.project,
      damage: {
        sourcePath: malformed?.relativePath ?? "legacy Project metadata",
        message: error instanceof Error ? error.message : String(error),
        rawText: malformed?.contents ?? "",
      },
    };
  }
}

function firstMalformedLegacyFile(files: ProjectFileSetPayload["legacyFiles"]) {
  return files?.find((file) => {
    try {
      JSON.parse(file.contents);
      return false;
    } catch {
      return true;
    }
  });
}
