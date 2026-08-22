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
import { serializeProjectFiles } from "../../core/io/projectFiles";
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
import { normalizePathFileName } from "../../core/model/projectIdentity";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import {
  decodeWorkspaceArchive,
  isDamageAwareStorageAdapter,
  isLegacyProjectMetadataAdapter,
  isCurrentWorkspaceAdapter,
  isProjectFolderAdapter,
  StorageConflictError,
  type ProjectReadSnapshot,
  type ProjectWorkspaceSummary,
  type StorageAdapter,
  type WriteResult,
} from "../../storage";
import { ProjectImportOutcomeUncertainError } from "./types";
import { isProjectIoConflict } from "./errors";
import type {
  CommittedProjectImportResult,
  CreateWorkspaceInput,
  DeleteWorkspaceResult,
  ImportedLegacyFieldBackground,
  ProjectImportOptions,
  ProjectImportResult,
  ProjectImportRollback,
  ProjectIoCapabilities,
  ProjectIoMigrationPreparationOutcome,
  ProjectIoService,
  ProjectIoWorkspace,
  ProjectIoWorkspaceHandle,
  ProjectIoWriteOutcome,
  LegacyProjectViewMigration,
} from "./types";

interface StorageWorkspaceHandle extends ProjectIoWorkspaceHandle {
  readonly storageId: string;
  readonly summary: ProjectWorkspaceSummary | null;
}

export class StorageProjectIoService implements ProjectIoService {
  readonly capabilities: ProjectIoCapabilities;
  private readonly storage: StorageAdapter;

  constructor(storage: StorageAdapter, capabilities: ProjectIoCapabilities) {
    this.storage = storage;
    this.capabilities = capabilities;
  }

  async initialize(): Promise<ProjectIoWorkspace | null> {
    await this.storage.initialize?.();

    if (isProjectFolderAdapter(this.storage)) {
      const summary = await this.storage.getCurrentWorkspace();
      return summary
        ? this.readWorkspace(summary.id, summary)
        : this.openWorkspace();
    }

    if (isCurrentWorkspaceAdapter(this.storage)) {
      const currentId = await this.storage.getCurrentWorkspaceId();
      if (currentId) {
        try {
          return await this.readWorkspace(currentId);
        } catch {
          await this.storage.setCurrentWorkspaceId(null);
        }
      }
    }

    const [summary] = await this.storage.listWorkspaces();
    return summary ? this.readWorkspace(summary.id, summary) : null;
  }

  async peekWorkspace(handle: ProjectIoWorkspaceHandle): Promise<Project> {
    return this.storage.readProject(this.storageId(handle));
  }

  async prepareLegacyProjectMigration(
    workspace: ProjectIoWorkspace,
    migration: LegacyProjectViewMigration,
  ): Promise<ProjectIoMigrationPreparationOutcome> {
    if (
      !this.ownsLegacyMigration(workspace, migration) ||
      workspace.persistenceDamage ||
      !workspace.version ||
      !isLegacyProjectMetadataAdapter(this.storage)
    ) {
      return { preparation: { status: "rejected" }, workspace };
    }
    const result = await this.storage.prepareLegacyProjectMigration(
      workspace.project,
      workspace.version,
      migration.legacyProjectId,
    );
    const nextWorkspace =
      result.status === "rejected"
        ? workspace
        : this.workspaceAfterWrite(
            workspace.project,
            isCurrentWorkspaceAdapter(this.storage)
              ? workspace.project.project_id
              : this.storageId(workspace.handle),
            result,
            workspace.summary,
          );
    return { preparation: result, workspace: nextWorkspace };
  }

  async completeLegacyProjectMigration(
    workspace: ProjectIoWorkspace,
    migration: LegacyProjectViewMigration,
  ): Promise<ProjectIoWriteOutcome | null> {
    if (
      !this.ownsLegacyMigration(workspace, migration) ||
      !workspace.version ||
      workspace.persistenceDamage ||
      !isLegacyProjectMetadataAdapter(this.storage)
    ) {
      return null;
    }
    const result = await this.storage.deleteLegacyProjectFiles(
      workspace.version,
      migration.legacyProjectId,
      migration.stableProjectId,
    );
    return result
      ? {
          ...result,
          result,
          workspace: this.workspaceAfterWrite(
            workspace.project,
            this.storageId(workspace.handle),
            result,
            workspace.summary,
          ),
        }
      : null;
  }

  async createWorkspace(
    input: CreateWorkspaceInput = {},
    previous?: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace> {
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
        let activated: ProjectWorkspaceSummary | null = null;
        try {
          activated = await this.storage.switchWorkspace(
            summary.id,
            result.version,
          );
        } catch {
          // The canonical Project is already durable. Keep it open by its explicit
          // locator so the user can continue saving or reopen the chosen folder.
        }
        return this.workspaceAfterWrite(
          project,
          summary.id,
          result,
          activated ?? summary,
        );
      } catch (error) {
        await this.restoreStorageOwnership(previous);
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
      return this.workspaceAfterWrite(project, project.project_id, result);
    } catch (error) {
      await this.restoreStorageOwnership(previous);
      throw error;
    }
  }

  async openWorkspace(
    id?: string,
    previous?: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const candidate = id
        ? (await this.listWorkspaces()).find((summary) => summary.id === id)
        : await this.storage.openWorkspace();
      const candidateId = candidate?.id ?? id;
      return candidateId
        ? this.readAndActivate(candidateId, candidate ?? undefined, previous)
        : null;
    }

    if (!id) {
      const [summary] = await this.storage.listWorkspaces();
      return summary ? this.readWorkspace(summary.id, summary) : null;
    }

    return this.readWorkspace(id);
  }

  async reloadWorkspace(
    handle: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace> {
    return this.readWorkspace(this.storageId(handle));
  }

  async deleteWorkspace(
    current: ProjectIoWorkspace | null,
    id?: string,
    knownVersion?: string,
  ): Promise<DeleteWorkspaceResult> {
    if (!this.storage.deleteWorkspace) {
      throw new Error(
        "Deleting projects is not supported by this storage adapter",
      );
    }

    const currentStorageId = current
      ? this.storageId(current.handle)
      : undefined;
    const targetId = id ?? currentStorageId;
    if (!targetId) {
      throw new Error("No Project workspace is open");
    }
    const deletingCurrent = currentStorageId === targetId;
    const expectedVersion =
      knownVersion ??
      (deletingCurrent
        ? current?.version
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
      return { workspace: current, changedCurrent: false };
    }

    const [nextSummary] = await this.listWorkspaces();
    if (nextSummary) {
      return {
        workspace: await this.readWorkspace(nextSummary.id, nextSummary),
        changedCurrent: true,
      };
    }
    return { workspace: null, changedCurrent: true };
  }

  async saveWorkspace(
    handle: ProjectIoWorkspaceHandle,
    project: Project,
    expectedVersion?: string,
  ): Promise<ProjectIoWriteOutcome> {
    const storageId = this.storageId(handle);
    const result = await this.storage.writeProject(
      project,
      expectedVersion,
      storageId,
    );
    return {
      ...result,
      result,
      workspace: this.workspaceAfterWrite(
        project,
        storageId,
        result,
        this.handleSummary(handle),
      ),
    };
  }

  async replaceDamagedProject(
    handle: ProjectIoWorkspaceHandle,
    project: Project,
    expectedVersion?: string,
  ): Promise<ProjectIoWriteOutcome> {
    if (!isDamageAwareStorageAdapter(this.storage)) {
      throw new Error("The current storage adapter has no damaged metadata");
    }
    const result = await this.storage.replaceDamagedProject(
      project,
      expectedVersion,
      this.storageId(handle),
    );
    const resultingStorageId = isCurrentWorkspaceAdapter(this.storage)
      ? project.project_id
      : this.storageId(handle);
    return {
      ...result,
      result,
      workspace: this.workspaceAfterWrite(
        project,
        resultingStorageId,
        result,
        this.handleSummary(handle),
      ),
    };
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return isProjectFolderAdapter(this.storage)
      ? this.storage.listRecentWorkspaces()
      : this.storage.listWorkspaces();
  }

  async switchWorkspace(
    id: string,
    previous?: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace | null> {
    if (isProjectFolderAdapter(this.storage)) {
      const summary = (await this.listWorkspaces()).find(
        (candidate) => candidate.id === id,
      );
      return this.readAndActivate(id, summary, previous);
    }

    return this.readWorkspace(id);
  }

  async importPath(project: Project, file: File): Promise<Project> {
    const parsed = JSON.parse(await file.text()) as unknown;
    const parsedObject = isJsonObject(parsed) ? parsed : null;
    const lookupConfig = deserializeProjectConfig(
      parsedObject?.config ?? project.config,
    );
    const path = deserializePath(
      parsedObject?.path ?? parsed,
      projectConfigDefaultLookup(lookupConfig),
    );
    const fileName = normalizePathFileName(
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

  async importConfig(project: Project, file: File): Promise<Project> {
    const config = deserializeProjectConfig(
      JSON.parse(await file.text()) as unknown,
    );
    const nextProject = {
      ...cloneProject(project),
      config,
    };
    return nextProject;
  }

  async exportConfig(project: Project): Promise<Blob> {
    return jsonBlob(serializeBLineRuntimeConfig(project.config));
  }

  async importProjectFolder(
    workspace: ProjectIoWorkspace,
    files: readonly File[],
    options: ProjectImportOptions = {},
  ): Promise<CommittedProjectImportResult> {
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

    return this.commitImportedProject(
      workspace,
      portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
      options,
    );
  }

  async exportProjectFolder(project: Project): Promise<ProjectFolderExport> {
    return serializeBLineProjectFolder(project);
  }

  async importProjectArchive(
    workspace: ProjectIoWorkspace,
    file: File,
    options: ProjectImportOptions = {},
  ): Promise<CommittedProjectImportResult> {
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

    return this.commitImportedProject(
      workspace,
      portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
      options,
    );
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

  private async readWorkspace(
    id: string,
    knownSummary?: ProjectWorkspaceSummary,
  ): Promise<ProjectIoWorkspace> {
    if (isProjectFolderAdapter(this.storage)) {
      const snapshot = await this.storage.readProjectSnapshot(id);
      return this.workspaceFromSnapshot(snapshot, knownSummary);
    }
    const project = await this.storage.readProject(id);
    const listedSummary = (await this.listWorkspaces()).find(
      (candidate) => candidate.id === id,
    );
    const summary = listedSummary ?? knownSummary;
    if (isCurrentWorkspaceAdapter(this.storage)) {
      await this.storage.setCurrentWorkspaceId(id);
    }
    return this.workspaceFrom(project, id, summary);
  }

  private async readAndActivate(
    id: string,
    knownSummary?: ProjectWorkspaceSummary,
    previous?: ProjectIoWorkspaceHandle,
  ): Promise<ProjectIoWorkspace> {
    if (!isProjectFolderAdapter(this.storage)) {
      return this.readWorkspace(id, knownSummary);
    }
    try {
      const snapshot = await this.storage.readProjectSnapshot(id);
      const activated = await this.storage.switchWorkspace(
        id,
        snapshot.summary.version,
      );
      if (!activated) {
        throw new Error("The selected desktop Project could not be activated");
      }
      if (
        activated.id !== snapshot.summary.id ||
        activated.version !== snapshot.summary.version
      ) {
        throw new StorageConflictError(
          "The desktop Project changed while it was being activated",
          snapshot.summary.version,
          activated.version,
        );
      }
      return this.workspaceFromSnapshot(snapshot, knownSummary);
    } catch (error) {
      await this.restoreStorageOwnership(previous);
      throw error;
    }
  }

  private async commitImportedProject(
    workspace: ProjectIoWorkspace,
    portableProject: Project,
    legacySelectedFieldId: string | null,
    legacyFieldBackgrounds: ImportedLegacyFieldBackground[],
    options: ProjectImportOptions,
  ): Promise<CommittedProjectImportResult> {
    if (this.capabilities.supportsProjectFolders) {
      const current = workspace.project;
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
      const expectedVersion = await this.preflightDesktopImport(workspace);
      const rollback = await prepareImportedFields(result, options);
      const previousProject = current;
      let committedWorkspace: ProjectIoWorkspace;
      try {
        committedWorkspace = (
          await this.saveWorkspace(
            workspace.handle,
            nextProject,
            expectedVersion,
          )
        ).workspace;
      } catch (error) {
        committedWorkspace = await this.reconcileDesktopImportFailure({
          workspace,
          projectError: error,
          previousProject,
          intendedProject: nextProject,
          expectedVersion,
          rollback,
        });
      }
      return { ...result, workspace: committedWorkspace };
    }

    const result = importedProjectResult(
      portableProject,
      legacySelectedFieldId,
      legacyFieldBackgrounds,
    );
    await this.preflightBrowserImport(portableProject);
    const rollback = await prepareImportedFields(result, options);
    try {
      const committedWorkspace =
        await this.saveImportedBrowserProject(portableProject);
      return { ...result, workspace: committedWorkspace };
    } catch (error) {
      if (isProjectIoConflict(error)) {
        // A competing import can win after both callers prepared the same
        // deterministic Field Background. Its Project now relies on those
        // bytes, so the loser must retain the converged preparation.
        throw error;
      }
      return await rollbackPreparedImport(error, rollback);
    }
  }

  private async preflightBrowserImport(project: Project): Promise<void> {
    const collision = (await this.storage.listWorkspaces()).find(
      (summary) => summary.id === project.project_id,
    );
    if (collision) {
      throw projectImportCollision(project.project_id, collision.version);
    }
    if (!this.storage.writeNewProject) {
      throw new Error(
        "This storage adapter cannot safely create an imported Project",
      );
    }
  }

  private async preflightDesktopImport(
    workspace: ProjectIoWorkspace,
  ): Promise<string> {
    const storageId = this.storageId(workspace.handle);
    const expectedVersion = workspace.version;
    if (!storageId || !expectedVersion) {
      throw new Error(
        "The current desktop Project has no version to guard import",
      );
    }
    const actualVersion = this.storage.getWorkspaceVersion
      ? await this.storage.getWorkspaceVersion(storageId)
      : (await this.listWorkspaces()).find(
          (summary) => summary.id === storageId,
        )?.version;
    if (actualVersion !== expectedVersion) {
      throw new StorageConflictError(
        "The desktop Project changed before import preparation",
        expectedVersion,
        actualVersion,
      );
    }
    return expectedVersion;
  }

  private async reconcileDesktopImportFailure({
    workspace,
    projectError,
    previousProject,
    intendedProject,
    expectedVersion,
    rollback,
  }: {
    workspace: ProjectIoWorkspace;
    projectError: unknown;
    previousProject: Project;
    intendedProject: Project;
    expectedVersion: string;
    rollback: ProjectImportRollback | undefined;
  }): Promise<ProjectIoWorkspace> {
    const storageId = this.storageId(workspace.handle);
    if (!isProjectFolderAdapter(this.storage)) {
      throw new ProjectImportOutcomeUncertainError(projectError);
    }
    let snapshot: ProjectReadSnapshot;
    try {
      snapshot = await this.storage.readProjectSnapshot(storageId);
    } catch (reconciliationError) {
      throw new ProjectImportOutcomeUncertainError(
        projectError,
        reconciliationError,
      );
    }
    if (projectsMatch(snapshot.project, intendedProject)) {
      return this.workspaceFromSnapshot(snapshot);
    }
    if (
      snapshot.summary.version === expectedVersion &&
      projectsMatch(snapshot.project, previousProject)
    ) {
      await rollbackPreparedImport(projectError, rollback);
    }
    throw new ProjectImportOutcomeUncertainError(projectError);
  }

  private async saveImportedBrowserProject(
    project: Project,
  ): Promise<ProjectIoWorkspace> {
    const collision = (await this.storage.listWorkspaces()).find(
      (summary) => summary.id === project.project_id,
    );
    if (collision) {
      throw projectImportCollision(project.project_id, collision.version);
    }

    if (!this.storage.writeNewProject) {
      throw new Error(
        "This storage adapter cannot safely create an imported Project",
      );
    }
    const result = await this.storage.writeNewProject(project);
    return this.workspaceAfterWrite(project, project.project_id, result);
  }

  private async restoreStorageOwnership(
    previous?: ProjectIoWorkspaceHandle,
  ): Promise<void> {
    try {
      const previousStorageId = previous ? this.storageId(previous) : null;
      if (isProjectFolderAdapter(this.storage) && previousStorageId) {
        await this.storage.switchWorkspace(
          previousStorageId,
          previous ? this.handleSummary(previous)?.version : undefined,
        );
      } else if (isCurrentWorkspaceAdapter(this.storage)) {
        await this.storage.setCurrentWorkspaceId(previousStorageId);
      }
    } catch {
      // Preserve the original operation failure.
    }
  }

  private workspaceAfterWrite(
    project: Project,
    storageId: string,
    result: WriteResult,
    summary: ProjectWorkspaceSummary | null = null,
  ): ProjectIoWorkspace {
    return this.workspaceFrom(
      project,
      storageId,
      summaryAfterWrite(summary, storageId, project, result),
    );
  }

  private workspaceFromSnapshot(
    snapshot: ProjectReadSnapshot,
    knownSummary?: ProjectWorkspaceSummary,
  ): ProjectIoWorkspace {
    return this.workspaceFrom(snapshot.project, snapshot.summary.id, {
      ...(knownSummary ?? {}),
      ...snapshot.summary,
    });
  }

  private workspaceFrom(
    project: Project,
    storageId: string,
    summary: ProjectWorkspaceSummary | null | undefined,
  ): ProjectIoWorkspace {
    const normalizedSummary = summary ? { ...summary } : null;
    const persistenceDamage = isDamageAwareStorageAdapter(this.storage)
      ? this.storage.getCurrentProjectDamage(storageId)
      : null;
    const legacyProjectId = isLegacyProjectMetadataAdapter(this.storage)
      ? this.storage.getLegacyProjectMigrationSourceId(storageId)
      : storageId;
    const legacyMigration =
      persistenceDamage || !legacyProjectId
        ? null
        : {
            legacyProjectId,
            stableProjectId: project.project_id,
            pathIdByLegacyReference: Object.fromEntries(
              project.paths.flatMap((path) => [
                [path.path_id, path.path_id],
                [path.file_name, path.path_id],
              ]),
            ),
          };
    return {
      project: cloneProject(project),
      handle: { storageId, summary: normalizedSummary },
      version: normalizedSummary?.version,
      lastSavedAt: normalizedSummary?.updatedAt ?? null,
      summary: normalizedSummary,
      persistenceDamage,
      legacyMigration,
    };
  }

  private ownsLegacyMigration(
    workspace: ProjectIoWorkspace,
    migration: LegacyProjectViewMigration,
  ): boolean {
    return (
      workspace.project.project_id === migration.stableProjectId &&
      isLegacyProjectMetadataAdapter(this.storage) &&
      this.storage.getLegacyProjectMigrationSourceId(
        this.storageId(workspace.handle),
      ) === migration.legacyProjectId
    );
  }

  private storageId(handle: ProjectIoWorkspaceHandle): string {
    const storageId = (handle as Partial<StorageWorkspaceHandle>).storageId;
    if (!storageId) {
      throw new Error("Invalid Project I/O workspace handle");
    }
    return storageId;
  }

  private handleSummary(
    handle: ProjectIoWorkspaceHandle,
  ): ProjectWorkspaceSummary | null {
    return (handle as Partial<StorageWorkspaceHandle>).summary ?? null;
  }
}

function importedProjectResult(
  project: Project,
  legacySelectedFieldId: string | null,
  legacyFieldBackgrounds: ImportedLegacyFieldBackground[],
): ProjectImportResult {
  return { project, legacySelectedFieldId, legacyFieldBackgrounds };
}

async function prepareImportedFields(
  imported: ProjectImportResult,
  options: ProjectImportOptions,
): Promise<ProjectImportRollback | undefined> {
  if (imported.legacyFieldBackgrounds.length === 0) {
    return undefined;
  }
  if (!options.migrateLegacyFieldBackgrounds) {
    throw new Error(
      "Legacy Field Background migration is required before importing this Project",
    );
  }
  const rollback = await options.migrateLegacyFieldBackgrounds(imported);
  if (!rollback || typeof rollback.rollback !== "function") {
    throw new Error(
      "Legacy Field Background preparation must return a rollback handle",
    );
  }
  return rollback;
}

async function rollbackPreparedImport(
  projectError: unknown,
  rollback: ProjectImportRollback | undefined,
): Promise<never> {
  if (!rollback) {
    throw projectError;
  }
  try {
    await rollback.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
      [projectError, rollbackError],
      "Project import failed and its prepared User Data could not be rolled back",
    );
  }
  throw projectError;
}

function projectImportCollision(
  projectId: string,
  actualVersion: string,
): StorageConflictError {
  return new StorageConflictError(
    `A saved Project already uses ID ${projectId}`,
    undefined,
    actualVersion,
  );
}

function projectsMatch(left: Project, right: Project): boolean {
  return (
    JSON.stringify(serializeProjectFiles(left)) ===
    JSON.stringify(serializeProjectFiles(right))
  );
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
