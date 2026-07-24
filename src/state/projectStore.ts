import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  CustomFieldImage,
  FieldGeometry,
} from "../core/field/fieldConfig";
import type {
  ProjectDocument,
  ProjectWorkspaceDocument,
} from "../core/io/projectSchema";
import type { PathModel } from "../core/model/path";
import {
  addLinkedTargetToWorkspace,
  createLinkedTargetId,
  deleteLinkedTargetFromWorkspace,
  linkPathElementToTargetInWorkspace,
  unlinkPathElementInWorkspace,
  updateLinkedTargetInWorkspace,
  type CreateLinkedTargetInput,
  type UpdateLinkedTargetInput,
} from "../core/linkedTargets";
import {
  activeProjectFromWorkspace,
  addPathsToGroupInWorkspace,
  addPathToWorkspace,
  createPathGroupInWorkspace,
  deletePathGroupFromWorkspace,
  deletePathsFromWorkspace,
  duplicatePathInWorkspace,
  ensureWorkspaceHasActivePath,
  renamePathInWorkspace,
  removePathsFromGroupInWorkspace,
  replaceActiveProjectInWorkspace,
  renamePathGroupInWorkspace,
  setActivePathGroupInWorkspace,
} from "../core/io/workspaceSerde";
import type {
  ProjectFolderExport,
  ProjectIoService,
} from "../platform/projectIo";
import type { WriteResult } from "../storage/adapter";
import {
  createHistoryStore,
  type HistoryCommand,
  type HistoryStore,
} from "./historyStore";

export type ProjectStatus =
  | "idle"
  | "loading"
  | "saving"
  | "error"
  | "conflict";

interface WorkspaceHistoryMetadata {
  createdPathId?: string;
}

interface WorkspaceSnapshotHistoryCommand extends HistoryCommand<ProjectWorkspaceDocument> {
  kind: "workspace-snapshot";
  createdPathId?: string;
  previousSnapshot: ProjectWorkspaceDocument;
  nextSnapshot: ProjectWorkspaceDocument;
}

export interface ProjectStoreState {
  workspace: ProjectWorkspaceDocument | null;
  project: ProjectDocument | null;
  io: ProjectIoService | null;
  version: string | undefined;
  dirty: boolean;
  status: ProjectStatus;
  error: string | null;
  lastSavedAt: string | null;
  history: HistoryStore<ProjectWorkspaceDocument>;
  setProjectIoService(io: ProjectIoService | null): void;
  initializeWorkspace(
    fallback?: ProjectWorkspaceDocument,
  ): Promise<ProjectWorkspaceDocument | null>;
  createWorkspace(
    workspace: ProjectWorkspaceDocument,
  ): Promise<ProjectWorkspaceDocument>;
  openWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  deleteWorkspace(id?: string): Promise<ProjectWorkspaceDocument | null>;
  switchWorkspace(id: string): Promise<ProjectWorkspaceDocument | null>;
  saveWorkspace(): Promise<WriteResult | null>;
  reloadFromDisk(): Promise<ProjectWorkspaceDocument | null>;
  overwriteConflict(): Promise<WriteResult | null>;
  setActivePath(pathId: string): void;
  setActivePathGroup(groupId: string | null): void;
  createPath(input: {
    displayName: string;
    fileName?: string;
    path?: PathModel;
    addToGroupId?: string | null;
  }): void;
  renamePath(pathId: string, name: string): void;
  duplicatePath(
    pathId: string,
    name: string,
    options?: { addToGroupId?: string | null },
  ): void;
  deletePaths(pathIds: readonly string[]): void;
  createPathGroup(input: {
    displayName: string;
    activePathId?: string | null;
    pathIds?: readonly string[];
    makeActive?: boolean;
  }): void;
  renamePathGroup(groupId: string, name: string): void;
  deletePathGroup(
    groupId: string,
    options?: { deleteMemberPaths?: boolean },
  ): void;
  addPathsToGroup(groupId: string, pathIds: readonly string[]): void;
  removePathsFromGroup(groupId: string, pathIds: readonly string[]): void;
  createLinkedTarget(
    input: Omit<CreateLinkedTargetInput, "target_id"> & {
      target_id?: string;
    },
  ): string;
  updateLinkedTarget(targetId: string, update: UpdateLinkedTargetInput): void;
  deleteLinkedTarget(targetId: string): void;
  linkPathElementToTarget(
    pathId: string,
    elementIndex: number,
    targetId: string,
  ): void;
  unlinkPathElement(pathId: string, elementIndex: number): void;
  importPath(file: File): Promise<ProjectWorkspaceDocument>;
  exportPath(pathId?: string): Promise<Blob | null>;
  importConfig(file: File): Promise<ProjectWorkspaceDocument>;
  exportConfig(): Promise<Blob | null>;
  importProjectFolder(
    files: readonly File[],
  ): Promise<ProjectWorkspaceDocument>;
  exportProjectFolder(): Promise<ProjectFolderExport | null>;
  importProjectArchive(file: File): Promise<ProjectWorkspaceDocument>;
  exportProjectArchive(): Promise<Blob | null>;
  writeFieldImageAsset(input: {
    file: File;
    name?: string;
    geometry?: Partial<FieldGeometry>;
  }): Promise<CustomFieldImage>;
  readFieldImageAsset(field: CustomFieldImage): Promise<Blob | null>;
  deleteFieldImageAsset(field: CustomFieldImage): Promise<void>;
  applyCommand(command: HistoryCommand<ProjectDocument>): void;
  undo(): void;
  redo(): void;
  markSaved(result: WriteResult): void;
  markSaveError(error: unknown): void;
  reset(): void;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

export function createProjectStore(
  history = createHistoryStore<ProjectWorkspaceDocument>(),
): ProjectStore {
  return createStore<ProjectStoreState>((set, get) => ({
    workspace: null,
    project: null,
    io: null,
    version: undefined,
    dirty: false,
    status: "idle",
    error: null,
    lastSavedAt: null,
    history,
    setProjectIoService(io) {
      set({ io });
    },
    async initializeWorkspace(fallback) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        let workspace = await io.initialize();
        if (!workspace && fallback) {
          workspace = await io.createWorkspace({ workspace: fallback });
        }

        if (!workspace) {
          set({
            status: "idle",
            error: null,
          });
          return null;
        }

        adoptWorkspace(set, history, io, workspace, false);
        return workspace;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async createWorkspace(workspace) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        const created = await io.createWorkspace({ workspace });
        adoptWorkspace(set, history, io, created, false);
        return created;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async openWorkspace(id) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        const workspace = await io.openWorkspace(id);
        if (workspace) {
          adoptWorkspace(set, history, io, workspace, false);
        } else {
          set({ status: "idle" });
        }
        return workspace;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async deleteWorkspace(id) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      set({ status: "loading", error: null });

      try {
        const workspace = await io.deleteWorkspace(id);
        if (workspace) {
          adoptWorkspace(set, history, io, workspace, false);
        } else {
          history.getState().clear();
          set({
            workspace: null,
            project: null,
            version: undefined,
            dirty: false,
            status: "idle",
            error: null,
            lastSavedAt: null,
          });
        }
        return workspace;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async switchWorkspace(id) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        const workspace = await io.switchWorkspace(id);
        if (workspace) {
          adoptWorkspace(set, history, io, workspace, false);
        }
        return workspace;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async saveWorkspace() {
      const { workspace, io, version } = get();
      if (!workspace) {
        return null;
      }

      const service = requireProjectIo(io);
      set({ status: "saving", error: null });

      try {
        const result = await service.saveWorkspace(workspace, version);
        get().markSaved(result);
        return result;
      } catch (error) {
        get().markSaveError(error);
        throw error;
      }
    },
    async reloadFromDisk() {
      // Conflict recovery: discard the in-memory edits and re-read the project from
      // disk, refreshing the version token so autosave resumes cleanly.
      const io = requireProjectIo(get().io);
      const workspace = get().workspace;
      if (!workspace) {
        return null;
      }
      set({ status: "loading", error: null });

      try {
        const reloaded = await io.switchWorkspace(workspace.project_id);
        if (reloaded) {
          adoptWorkspace(set, history, io, reloaded, false);
        }
        return reloaded;
      } catch (error) {
        set({ status: "error", error: errorMessage(error) });
        throw error;
      }
    },
    async overwriteConflict() {
      // Conflict recovery: force the in-memory workspace onto disk, bypassing the
      // version check, then adopt the fresh version returned by the write.
      const { workspace, io } = get();
      if (!workspace) {
        return null;
      }
      const service = requireProjectIo(io);
      set({ status: "saving", error: null });

      try {
        const result = await service.saveWorkspace(workspace);
        get().markSaved(result);
        return result;
      } catch (error) {
        get().markSaveError(error);
        throw error;
      }
    },
    setActivePath(pathId) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = ensureWorkspaceHasActivePath({
        ...workspace,
        active_path_id: pathId,
      });
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    setActivePathGroup(groupId) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = setActivePathGroupInWorkspace(workspace, groupId);
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    createPath(input) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = addPathToWorkspace(workspace, {
        display_name: input.displayName,
        file_name: input.fileName,
        path: input.path,
        makeActive: true,
        addToGroupId: input.addToGroupId,
      });
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Create path",
        true,
        {},
        {
          createdPathId: createdPathIdFromTransition(workspace, nextWorkspace),
        },
      );
    },
    renamePath(pathId, name) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        renamePathInWorkspace(workspace, pathId, name),
        "Rename path",
      );
    },
    duplicatePath(pathId, name, options) {
      const workspace = requireWorkspace(get().workspace);
      const duplicatedWorkspace = duplicatePathInWorkspace(
        workspace,
        pathId,
        name,
      );
      const nextPathId = duplicatedWorkspace.active_path_id;
      const nextWorkspace =
        options?.addToGroupId && nextPathId
          ? addPathsToGroupInWorkspace(
              duplicatedWorkspace,
              options.addToGroupId,
              [nextPathId],
            )
          : duplicatedWorkspace;
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Duplicate path",
        true,
        {},
        {
          createdPathId: createdPathIdFromTransition(workspace, nextWorkspace),
        },
      );
    },
    createPathGroup(input) {
      const workspace = requireWorkspace(get().workspace);
      const groupedWorkspace = createPathGroupInWorkspace(workspace, {
        display_name: input.displayName,
        path_ids: input.pathIds,
        makeActive: input.makeActive,
      });
      const activeGroup =
        groupedWorkspace.path_groups.find(
          (group) => group.group_id === groupedWorkspace.active_path_group_id,
        ) ?? null;
      const nextWorkspace =
        input.activePathId &&
        groupedWorkspace.paths.some(
          (path) => path.path_id === input.activePathId,
        ) &&
        (!activeGroup || activeGroup.path_ids.includes(input.activePathId))
          ? ensureWorkspaceHasActivePath({
              ...groupedWorkspace,
              active_path_id: input.activePathId,
            })
          : groupedWorkspace;
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Create path collection",
      );
    },
    renamePathGroup(groupId, name) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        renamePathGroupInWorkspace(workspace, groupId, name),
        "Rename path collection",
      );
    },
    deletePathGroup(groupId, options) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = deletePathGroupFromWorkspace(
        workspace,
        groupId,
        options,
      );
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Delete path collection",
      );
    },
    addPathsToGroup(groupId, pathIds) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = addPathsToGroupInWorkspace(
        workspace,
        groupId,
        pathIds,
      );
      if (
        mergeCreatedPathMembershipTransition(
          set,
          history,
          nextWorkspace,
          pathIds,
        )
      ) {
        return;
      }

      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Add paths to collection",
      );
    },
    removePathsFromGroup(groupId, pathIds) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        removePathsFromGroupInWorkspace(workspace, groupId, pathIds),
        "Remove paths from collection",
      );
    },
    createLinkedTarget(input) {
      const workspace = requireWorkspace(get().workspace);
      const targetId = input.target_id ?? createLinkedTargetId();
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        addLinkedTargetToWorkspace(workspace, {
          ...input,
          target_id: targetId,
        }),
        `Create linked ${
          input.kind === "waypoint" ? "waypoint" : "translation"
        }`,
      );
      return targetId;
    },
    updateLinkedTarget(targetId, update) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        updateLinkedTargetInWorkspace(workspace, targetId, update),
        "Update linked element",
      );
    },
    deleteLinkedTarget(targetId) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        deleteLinkedTargetFromWorkspace(workspace, targetId),
        "Delete linked element",
      );
    },
    linkPathElementToTarget(pathId, elementIndex, targetId) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        linkPathElementToTargetInWorkspace(
          workspace,
          pathId,
          elementIndex,
          targetId,
        ),
        "Link path element",
      );
    },
    unlinkPathElement(pathId, elementIndex) {
      const workspace = requireWorkspace(get().workspace);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        unlinkPathElementInWorkspace(workspace, pathId, elementIndex),
        "Unlink path element",
      );
    },
    deletePaths(pathIds) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = deletePathsFromWorkspace(workspace, pathIds);
      applyWorkspaceTransition(
        set,
        history,
        workspace,
        nextWorkspace,
        "Delete paths",
      );
    },
    async importPath(file) {
      const io = requireProjectIo(get().io);
      const previousWorkspace = requireWorkspace(get().workspace);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importPath(file);
      applyWorkspaceTransition(
        set,
        history,
        previousWorkspace,
        workspace,
        "Import path",
        false,
        {
          version: io.getCurrentVersion(),
          lastSavedAt: io.getLastSavedAt(),
        },
        {
          createdPathId: createdPathIdFromTransition(
            previousWorkspace,
            workspace,
          ),
        },
      );
      return workspace;
    },
    async exportPath(pathId) {
      const workspace = get().workspace;
      const io = requireProjectIo(get().io);
      if (!workspace) {
        return null;
      }
      if (get().dirty) {
        await get().saveWorkspace();
      }
      return io.exportPath(pathId ?? workspace.active_path_id ?? "");
    },
    async importConfig(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importConfig(file);
      adoptWorkspace(set, history, io, workspace, false);
      return workspace;
    },
    async exportConfig() {
      const io = requireProjectIo(get().io);
      if (!get().workspace) {
        return null;
      }
      if (get().dirty) {
        await get().saveWorkspace();
      }
      return io.exportConfig();
    },
    async importProjectFolder(files) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importProjectFolder(files);
      adoptWorkspace(set, history, io, workspace, false);
      return workspace;
    },
    async exportProjectFolder() {
      const io = requireProjectIo(get().io);
      if (!get().workspace) {
        return null;
      }
      if (get().dirty) {
        await get().saveWorkspace();
      }
      return io.exportProjectFolder();
    },
    async importProjectArchive(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importProjectArchive(file);
      adoptWorkspace(set, history, io, workspace, false);
      return workspace;
    },
    async exportProjectArchive() {
      const io = requireProjectIo(get().io);
      if (!get().workspace) {
        return null;
      }
      if (get().dirty) {
        await get().saveWorkspace();
      }
      return io.exportProjectArchive();
    },
    async writeFieldImageAsset(input) {
      const io = requireProjectIo(get().io);
      return io.writeFieldImageAsset(input);
    },
    async readFieldImageAsset(field) {
      const io = requireProjectIo(get().io);
      return io.readFieldImageAsset(field);
    },
    async deleteFieldImageAsset(field) {
      const io = requireProjectIo(get().io);
      await io.deleteFieldImageAsset(field);
    },
    applyCommand(command) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = history
        .getState()
        .execute(cloneWorkspace(workspace), workspaceCommand(command));

      setWorkspace(set, nextWorkspace, true);
    },
    undo() {
      const workspace = get().workspace;
      if (!workspace) {
        return;
      }

      const transition = history.getState().undo(cloneWorkspace(workspace));

      if (transition.command) {
        setWorkspace(set, transition.value, true);
      }
    },
    redo() {
      const workspace = get().workspace;
      if (!workspace) {
        return;
      }

      const transition = history.getState().redo(cloneWorkspace(workspace));

      if (transition.command) {
        setWorkspace(set, transition.value, true);
      }
    },
    markSaved(result) {
      set({
        version: result.version,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: result.updatedAt,
      });
    },
    markSaveError(error) {
      set({
        status: isStorageConflict(error) ? "conflict" : "error",
        error: errorMessage(error),
      });
    },
    reset() {
      history.getState().clear();
      set({
        workspace: null,
        project: null,
        version: undefined,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: null,
      });
    },
  }));
}

export const projectStore = createProjectStore();

function setWorkspace(
  set: StoreApi<ProjectStoreState>["setState"],
  workspace: ProjectWorkspaceDocument,
  dirty: boolean,
  metadata: Partial<Pick<ProjectStoreState, "lastSavedAt" | "version">> = {},
): void {
  const normalized = ensureWorkspaceHasActivePath(workspace);
  set({
    workspace: cloneWorkspace(normalized),
    project: activeProjectFromWorkspace(normalized),
    dirty,
    status: "idle",
    error: null,
    ...metadata,
  });
}

function applyWorkspaceTransition(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<ProjectWorkspaceDocument>,
  previousWorkspace: ProjectWorkspaceDocument,
  nextWorkspace: ProjectWorkspaceDocument,
  description: string,
  dirty = true,
  metadata: Partial<Pick<ProjectStoreState, "lastSavedAt" | "version">> = {},
  historyMetadata: WorkspaceHistoryMetadata = {},
): void {
  const command = workspaceSnapshotCommand(
    description,
    previousWorkspace,
    nextWorkspace,
    historyMetadata,
  );
  const appliedWorkspace = history
    .getState()
    .execute(cloneWorkspace(previousWorkspace), command);

  setWorkspace(set, appliedWorkspace, dirty, metadata);
}

function workspaceSnapshotCommand(
  description: string,
  previousWorkspace: ProjectWorkspaceDocument,
  nextWorkspace: ProjectWorkspaceDocument,
  metadata: WorkspaceHistoryMetadata = {},
): WorkspaceSnapshotHistoryCommand {
  const previousSnapshot = cloneWorkspace(previousWorkspace);
  const nextSnapshot = cloneWorkspace(nextWorkspace);

  return {
    kind: "workspace-snapshot",
    description,
    createdPathId: metadata.createdPathId,
    previousSnapshot,
    nextSnapshot,
    apply: () => cloneWorkspace(nextSnapshot),
    revert: () => cloneWorkspace(previousSnapshot),
  };
}

function isWorkspaceSnapshotCommand(
  command: HistoryCommand<ProjectWorkspaceDocument> | undefined,
): command is WorkspaceSnapshotHistoryCommand {
  return (
    Boolean(command) &&
    (command as WorkspaceSnapshotHistoryCommand).kind === "workspace-snapshot"
  );
}

function mergeCreatedPathMembershipTransition(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<ProjectWorkspaceDocument>,
  nextWorkspace: ProjectWorkspaceDocument,
  pathIds: readonly string[],
): boolean {
  if (pathIds.length !== 1) {
    return false;
  }

  const state = history.getState();
  const previousCommand = state.undoStack.at(-1);
  if (
    !isWorkspaceSnapshotCommand(previousCommand) ||
    previousCommand.createdPathId !== pathIds[0]
  ) {
    return false;
  }

  const mergedCommand = workspaceSnapshotCommand(
    previousCommand.description,
    previousCommand.previousSnapshot,
    nextWorkspace,
    { createdPathId: previousCommand.createdPathId },
  );
  const undoStack = [...state.undoStack.slice(0, -1), mergedCommand];

  history.setState({
    undoStack,
    redoStack: [],
    canUndo: undoStack.length > 0,
    canRedo: false,
  });
  setWorkspace(set, nextWorkspace, true);
  return true;
}

function createdPathIdFromTransition(
  previousWorkspace: ProjectWorkspaceDocument,
  nextWorkspace: ProjectWorkspaceDocument,
): string | undefined {
  const previousPathIds = new Set(
    previousWorkspace.paths.map((path) => path.path_id),
  );
  const createdPathIds = nextWorkspace.paths
    .map((path) => path.path_id)
    .filter((pathId) => !previousPathIds.has(pathId));

  return createdPathIds.length === 1 ? createdPathIds[0] : undefined;
}

function adoptWorkspace(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<ProjectWorkspaceDocument>,
  io: ProjectIoService,
  workspace: ProjectWorkspaceDocument,
  dirty: boolean,
): void {
  history.getState().clear();
  const normalized = ensureWorkspaceHasActivePath(workspace);
  set({
    workspace: cloneWorkspace(normalized),
    project: activeProjectFromWorkspace(normalized),
    version: io.getCurrentVersion(),
    dirty,
    status: "idle",
    error: null,
    lastSavedAt: io.getLastSavedAt(),
  });
}

function workspaceCommand(
  command: HistoryCommand<ProjectDocument>,
): HistoryCommand<ProjectWorkspaceDocument> {
  return {
    description: command.description,
    apply: (workspace) => {
      const project = activeProjectFromWorkspace(workspace);
      if (!project) {
        return workspace;
      }
      return replaceActiveProjectInWorkspace(workspace, command.apply(project));
    },
    revert: (workspace) => {
      const project = activeProjectFromWorkspace(workspace);
      if (!project) {
        return workspace;
      }
      return replaceActiveProjectInWorkspace(
        workspace,
        command.revert(project),
      );
    },
  };
}

function requireProjectIo(io: ProjectIoService | null): ProjectIoService {
  if (!io) {
    throw new Error("Project IO service is not configured");
  }
  return io;
}

function requireWorkspace(
  workspace: ProjectWorkspaceDocument | null,
): ProjectWorkspaceDocument {
  if (!workspace) {
    throw new Error("No active project workspace");
  }
  return workspace;
}

function cloneWorkspace(
  workspace: ProjectWorkspaceDocument,
): ProjectWorkspaceDocument {
  return structuredClone(workspace);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A save conflict means the stored workspace changed out from under us (an
 * external edit, another tab/process, or a genuinely divergent version token).
 * It is recoverable via reload or overwrite, so it is surfaced distinctly from a
 * hard save error.
 *
 * The two storage backends signal conflicts differently: the desktop (Tauri)
 * backend rejects with a `"storage-conflict: …"` string, while the browser
 * adapter throws a `StorageConflictError` (name `"StorageConflictError"`, with a
 * plain-English message). Recognize both.
 */
export function isStorageConflict(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "StorageConflictError"
  ) {
    return true;
  }
  return errorMessage(error).includes("storage-conflict");
}
