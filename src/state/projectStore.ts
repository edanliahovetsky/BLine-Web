import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ProjectDocument,
  ProjectWorkspaceDocument,
} from "../core/io/projectSchema";
import type { PathModel } from "../core/model/path";
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

export type ProjectStatus = "idle" | "loading" | "saving" | "error";

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
  setActivePath(pathId: string): void;
  setActivePathGroup(groupId: string | null): void;
  createPath(input: {
    displayName: string;
    fileName?: string;
    path?: PathModel;
    addToGroupId?: string | null;
  }): void;
  renamePath(pathId: string, name: string): void;
  duplicatePath(pathId: string, name: string): void;
  deletePaths(pathIds: readonly string[]): void;
  createPathGroup(input: {
    displayName: string;
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
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    renamePath(pathId, name) {
      const workspace = requireWorkspace(get().workspace);
      setWorkspace(set, renamePathInWorkspace(workspace, pathId, name), true);
    },
    duplicatePath(pathId, name) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = duplicatePathInWorkspace(workspace, pathId, name);
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    createPathGroup(input) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = createPathGroupInWorkspace(workspace, {
        display_name: input.displayName,
        path_ids: input.pathIds,
        makeActive: input.makeActive,
      });
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    renamePathGroup(groupId, name) {
      const workspace = requireWorkspace(get().workspace);
      setWorkspace(
        set,
        renamePathGroupInWorkspace(workspace, groupId, name),
        true,
      );
    },
    deletePathGroup(groupId, options) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = deletePathGroupFromWorkspace(
        workspace,
        groupId,
        options,
      );
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    addPathsToGroup(groupId, pathIds) {
      const workspace = requireWorkspace(get().workspace);
      setWorkspace(
        set,
        addPathsToGroupInWorkspace(workspace, groupId, pathIds),
        true,
      );
    },
    removePathsFromGroup(groupId, pathIds) {
      const workspace = requireWorkspace(get().workspace);
      setWorkspace(
        set,
        removePathsFromGroupInWorkspace(workspace, groupId, pathIds),
        true,
      );
    },
    deletePaths(pathIds) {
      const workspace = requireWorkspace(get().workspace);
      const nextWorkspace = deletePathsFromWorkspace(workspace, pathIds);
      history.getState().clear();
      setWorkspace(set, nextWorkspace, true);
    },
    async importPath(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importPath(file);
      adoptWorkspace(set, history, io, workspace, false);
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
        status: "error",
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
): void {
  const normalized = ensureWorkspaceHasActivePath(workspace);
  set({
    workspace: cloneWorkspace(normalized),
    project: activeProjectFromWorkspace(normalized),
    dirty,
    status: "idle",
    error: null,
  });
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
