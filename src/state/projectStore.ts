import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  CustomFieldImage,
  FieldGeometry,
} from "../core/field/fieldConfig";
import type { ProjectWorkspaceDocument } from "../core/io/projectSchema";
import {
  activeProjectPath,
  legacyWorkspaceForPersistence,
  normalizeEditorNavigation,
  openProjectFromLegacyWorkspace,
  type EditorNavigation,
} from "../core/io/legacyWorkspace";
import {
  cloneProject,
  type Project,
  type ProjectConfig,
  type ProjectPath,
} from "../core/model/project";
import {
  addPathsToGroupInProject,
  addPathToProject,
  createPathGroupInProject,
  deletePathGroupFromProject,
  deletePathsFromProject,
  duplicatePathInProject,
  removePathsFromGroupInProject,
  renamePathGroupInProject,
  renamePathInProject,
} from "../core/model/projectOperations";
import type { PathModel } from "../core/model/path";
import {
  addLinkedTargetToProject,
  createLinkedTargetId,
  deleteLinkedTargetFromProject,
  linkPathElementToTargetInProject,
  unlinkPathElementInProject,
  updateLinkedTargetInProject,
  type CreateLinkedTargetInput,
  type UpdateLinkedTargetInput,
} from "../core/linkedTargets";
import type {
  ProjectFolderExport,
  ProjectIoService,
} from "../platform/projectIo";
import type { WriteResult } from "../storage/adapter";
import {
  activePathForProject as locallyRememberedActivePath,
  rememberActivePath,
} from "../userData";
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
  focusPathId?: string;
}

interface ProjectSnapshotHistoryCommand extends HistoryCommand<Project> {
  kind: "project-snapshot";
  createdPathId?: string;
  focusPathId?: string;
  previousSnapshot: Project;
  nextSnapshot: Project;
  previousNavigation: EditorNavigation;
  nextNavigation: EditorNavigation;
}

interface ProjectPathHistoryCommand extends HistoryCommand<Project> {
  kind: "path-command";
  pathId: string;
}

interface ProjectConfigHistoryCommand extends HistoryCommand<Project> {
  kind: "config-command";
}

export interface ProjectStoreState {
  project: Project | null;
  activePathId: string | null;
  activePathGroupId: string | null;
  io: ProjectIoService | null;
  version: string | undefined;
  dirty: boolean;
  status: ProjectStatus;
  error: string | null;
  lastSavedAt: string | null;
  history: HistoryStore<Project>;
  setProjectIoService(io: ProjectIoService | null): void;
  initializeWorkspace(fallback?: Project): Promise<Project | null>;
  createWorkspace(project: Project): Promise<Project>;
  openWorkspace(id?: string): Promise<Project | null>;
  deleteWorkspace(id?: string): Promise<Project | null>;
  switchWorkspace(id: string): Promise<Project | null>;
  saveWorkspace(): Promise<WriteResult | null>;
  reloadFromDisk(): Promise<Project | null>;
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
  importPath(file: File): Promise<Project>;
  exportPath(pathId?: string): Promise<Blob | null>;
  importConfig(file: File): Promise<Project>;
  exportConfig(): Promise<Blob | null>;
  importProjectFolder(files: readonly File[]): Promise<Project>;
  exportProjectFolder(): Promise<ProjectFolderExport | null>;
  importProjectArchive(file: File): Promise<Project>;
  exportProjectArchive(): Promise<Blob | null>;
  writeFieldImageAsset(input: {
    file: File;
    name?: string;
    geometry?: Partial<FieldGeometry>;
  }): Promise<CustomFieldImage>;
  readFieldImageAsset(field: CustomFieldImage): Promise<Blob | null>;
  deleteFieldImageAsset(field: CustomFieldImage): Promise<void>;
  applyPathCommand(command: HistoryCommand<PathModel>, pathId?: string): void;
  applyConfigCommand(command: HistoryCommand<ProjectConfig>): void;
  /**
   * Applies a change that the editor derived from the document rather than one
   * the user made, so it never lands on the undo stack. Undo must step back
   * through the edit that triggered the derivation, not the derivation itself.
   */
  applyDerivedPathCommand(
    command: HistoryCommand<PathModel>,
    pathId?: string,
  ): void;
  undo(): void;
  redo(): void;
  markSaved(result: WriteResult): void;
  markSaveError(error: unknown): void;
  reset(): void;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

export function createProjectStore(
  history = createHistoryStore<Project>(),
): ProjectStore {
  const store = createStore<ProjectStoreState>((set, get) => ({
    project: null,
    activePathId: null,
    activePathGroupId: null,
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
          workspace = await io.createWorkspace({
            workspace: legacyWorkspaceForPersistence(fallback),
          });
        }

        if (!workspace) {
          set({
            status: "idle",
            error: null,
          });
          return null;
        }

        return adoptWorkspace(set, history, io, workspace, false);
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async createWorkspace(project) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        const created = await io.createWorkspace({
          workspace: legacyWorkspaceForPersistence(project),
        });
        return adoptWorkspace(set, history, io, created, false);
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
          return adoptWorkspace(set, history, io, workspace, false);
        } else {
          set({ status: "idle" });
        }
        return null;
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
          return adoptWorkspace(set, history, io, workspace, false);
        } else {
          history.getState().clear();
          set({
            project: null,
            activePathId: null,
            activePathGroupId: null,
            version: undefined,
            dirty: false,
            status: "idle",
            error: null,
            lastSavedAt: null,
          });
        }
        return null;
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
          return adoptWorkspace(set, history, io, workspace, false);
        }
        return null;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async saveWorkspace() {
      const { project, io, version } = get();
      if (!project) {
        return null;
      }

      const service = requireProjectIo(io);
      set({ status: "saving", error: null });

      try {
        const result = await service.saveWorkspace(
          legacyWorkspaceForPersistence(project),
          version,
        );
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
      const project = get().project;
      if (!project) {
        return null;
      }
      set({ status: "loading", error: null });

      try {
        const reloaded = await io.switchWorkspace(project.project_id);
        if (reloaded) {
          return adoptWorkspace(set, history, io, reloaded, false);
        }
        return null;
      } catch (error) {
        set({ status: "error", error: errorMessage(error) });
        throw error;
      }
    },
    async overwriteConflict() {
      // Conflict recovery: force the in-memory workspace onto disk, bypassing the
      // version check, then adopt the fresh version returned by the write.
      const { project, io } = get();
      if (!project) {
        return null;
      }
      const service = requireProjectIo(io);
      set({ status: "saving", error: null });

      try {
        const result = await service.saveWorkspace(
          legacyWorkspaceForPersistence(project),
        );
        get().markSaved(result);
        return result;
      } catch (error) {
        get().markSaveError(error);
        throw error;
      }
    },
    setActivePath(pathId) {
      const project = requireProject(get().project);
      const navigation = normalizeEditorNavigation(project, {
        activePathId: pathId,
        activePathGroupId: get().activePathGroupId,
      });
      set({ activePathId: navigation.activePathId });
    },
    setActivePathGroup(groupId) {
      const state = get();
      const project = requireProject(state.project);
      set(navigationForActiveGroup(project, currentNavigation(state), groupId));
    },
    createPath(input) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const added = addPathToProject(project, {
        display_name: input.displayName,
        file_name: input.fileName,
        path: input.path,
        addToGroupId: input.addToGroupId,
      });
      applyProjectTransition(
        set,
        history,
        project,
        added.project,
        navigation,
        { ...navigation, activePathId: added.createdPathId },
        "Create path",
        true,
        {},
        { createdPathId: added.createdPathId },
      );
    },
    renamePath(pathId, name) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        renamePathInProject(project, pathId, name),
        navigation,
        navigation,
        "Rename path",
        true,
        {},
        { focusPathId: pathId },
      );
    },
    duplicatePath(pathId, name, options) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const duplicated = duplicatePathInProject(
        project,
        pathId,
        name,
        options?.addToGroupId,
      );
      const nextNavigation = duplicated.createdPathId
        ? { ...navigation, activePathId: duplicated.createdPathId }
        : navigation;
      applyProjectTransition(
        set,
        history,
        project,
        duplicated.project,
        navigation,
        nextNavigation,
        "Duplicate path",
        true,
        {},
        { createdPathId: duplicated.createdPathId ?? undefined },
      );
    },
    createPathGroup(input) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const grouped = createPathGroupInProject(project, {
        display_name: input.displayName,
        path_ids: input.pathIds,
      });
      const activePathGroupId =
        input.makeActive === false
          ? navigation.activePathGroupId
          : grouped.createdGroupId;
      const activeGroup = grouped.project.path_groups.find(
        (group) => group.group_id === activePathGroupId,
      );
      const activePathId =
        input.activePathId &&
        grouped.project.paths.some(
          (path) => path.path_id === input.activePathId,
        ) &&
        (!activeGroup || activeGroup.path_ids.includes(input.activePathId))
          ? input.activePathId
          : navigation.activePathId;
      applyProjectTransition(
        set,
        history,
        project,
        grouped.project,
        navigation,
        { activePathId, activePathGroupId },
        "Create path collection",
      );
    },
    renamePathGroup(groupId, name) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        renamePathGroupInProject(project, groupId, name),
        navigation,
        navigation,
        "Rename path collection",
      );
    },
    deletePathGroup(groupId, options) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = deletePathGroupFromProject(project, groupId, options);
      const nextNavigation = normalizeEditorNavigation(nextProject, {
        activePathId: navigation.activePathId,
        activePathGroupId:
          navigation.activePathGroupId === groupId
            ? null
            : navigation.activePathGroupId,
      });
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        nextNavigation,
        "Delete path collection",
      );
    },
    addPathsToGroup(groupId, pathIds) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = addPathsToGroupInProject(project, groupId, pathIds);
      if (
        mergeCreatedPathMembershipTransition(
          set,
          history,
          nextProject,
          navigation,
          pathIds,
        )
      ) {
        return;
      }

      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        navigation,
        "Add paths to collection",
      );
    },
    removePathsFromGroup(groupId, pathIds) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = removePathsFromGroupInProject(
        project,
        groupId,
        pathIds,
      );
      const nextNavigation =
        navigation.activePathGroupId === groupId
          ? navigationForActiveGroup(nextProject, navigation, groupId)
          : navigation;
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        nextNavigation,
        "Remove paths from collection",
      );
    },
    createLinkedTarget(input) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const targetId = input.target_id ?? createLinkedTargetId();
      applyProjectTransition(
        set,
        history,
        project,
        addLinkedTargetToProject(project, {
          ...input,
          target_id: targetId,
        }),
        navigation,
        navigation,
        `Create linked ${
          input.kind === "waypoint" ? "waypoint" : "translation"
        }`,
      );
      return targetId;
    },
    updateLinkedTarget(targetId, update) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        updateLinkedTargetInProject(project, targetId, update),
        navigation,
        navigation,
        "Update linked element",
      );
    },
    deleteLinkedTarget(targetId) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        deleteLinkedTargetFromProject(project, targetId),
        navigation,
        navigation,
        "Delete linked element",
      );
    },
    linkPathElementToTarget(pathId, elementIndex, targetId) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        linkPathElementToTargetInProject(
          project,
          pathId,
          elementIndex,
          targetId,
        ),
        navigation,
        navigation,
        "Link path element",
        true,
        {},
        { focusPathId: pathId },
      );
    },
    unlinkPathElement(pathId, elementIndex) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      applyProjectTransition(
        set,
        history,
        project,
        unlinkPathElementInProject(project, pathId, elementIndex),
        navigation,
        navigation,
        "Unlink path element",
        true,
        {},
        { focusPathId: pathId },
      );
    },
    deletePaths(pathIds) {
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = deletePathsFromProject(project, pathIds);
      const nextNavigation = normalizeEditorNavigation(nextProject, navigation);
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        nextNavigation,
        "Delete paths",
      );
    },
    async importPath(file) {
      const io = requireProjectIo(get().io);
      const previousProject = requireProject(get().project);
      const previousNavigation = currentNavigation(get());
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importPath(file);
      const imported = openProjectFromLegacyWorkspace(workspace);
      applyProjectTransition(
        set,
        history,
        previousProject,
        imported.project,
        previousNavigation,
        imported.navigation,
        "Import path",
        false,
        {
          version: io.getCurrentVersion(),
          lastSavedAt: io.getLastSavedAt(),
        },
        {
          createdPathId: createdPathIdFromTransition(
            previousProject,
            imported.project,
          ),
        },
      );
      return requireProject(get().project);
    },
    async exportPath(pathId) {
      const project = get().project;
      const io = requireProjectIo(get().io);
      if (!project) {
        return null;
      }
      if (get().dirty) {
        await get().saveWorkspace();
      }
      return io.exportPath(pathId ?? get().activePathId ?? "");
    },
    async importConfig(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importConfig(file);
      return adoptWorkspace(set, history, io, workspace, false);
    },
    async exportConfig() {
      const io = requireProjectIo(get().io);
      if (!get().project) {
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
      return adoptWorkspace(set, history, io, workspace, false);
    },
    async exportProjectFolder() {
      const io = requireProjectIo(get().io);
      if (!get().project) {
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
      return adoptWorkspace(set, history, io, workspace, false);
    },
    async exportProjectArchive() {
      const io = requireProjectIo(get().io);
      if (!get().project) {
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
    applyPathCommand(command, requestedPathId) {
      const project = requireProject(get().project);
      const pathId = requestedPathId ?? requireActivePathId(get());
      const nextProject = history
        .getState()
        .execute(cloneProject(project), projectPathCommand(command, pathId));

      setProject(set, nextProject, currentNavigation(get()), true);
    },
    applyConfigCommand(command) {
      const project = requireProject(get().project);
      const nextProject = history
        .getState()
        .execute(cloneProject(project), projectConfigCommand(command));

      setProject(set, nextProject, currentNavigation(get()), true);
    },
    applyDerivedPathCommand(command, requestedPathId) {
      const project = get().project;
      if (!project) {
        return;
      }

      const pathId = requestedPathId ?? get().activePathId;
      if (!pathId) {
        return;
      }
      const nextProject = projectPathCommand(command, pathId).apply(
        cloneProject(project),
      );

      setProject(set, nextProject, currentNavigation(get()), true);
    },
    undo() {
      const project = get().project;
      if (!project) {
        return;
      }

      const transition = history.getState().undo(cloneProject(project));

      if (transition.command) {
        setProject(
          set,
          transition.value,
          navigationForHistory(transition.command, "undo", get()),
          true,
        );
      }
    },
    redo() {
      const project = get().project;
      if (!project) {
        return;
      }

      const transition = history.getState().redo(cloneProject(project));

      if (transition.command) {
        setProject(
          set,
          transition.value,
          navigationForHistory(transition.command, "redo", get()),
          true,
        );
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
        project: null,
        activePathId: null,
        activePathGroupId: null,
        version: undefined,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: null,
      });
    },
  }));

  let rememberedProjectId: string | null = null;
  let rememberedPathId: string | null = null;
  store.subscribe((state) => {
    const projectId = state.project?.project_id ?? null;
    const pathId = state.activePathId;
    if (
      !projectId ||
      (projectId === rememberedProjectId && pathId === rememberedPathId)
    ) {
      return;
    }
    rememberedProjectId = projectId;
    rememberedPathId = pathId;
    rememberActivePath(projectId, pathId);
  });

  return store;
}

export const projectStore = createProjectStore();

export function activePathForProjectStore(
  state: Pick<ProjectStoreState, "project" | "activePathId">,
): ProjectPath | null {
  return activeProjectPath(state.project, state.activePathId);
}

function setProject(
  set: StoreApi<ProjectStoreState>["setState"],
  project: Project,
  navigation: EditorNavigation,
  dirty: boolean,
  metadata: Partial<Pick<ProjectStoreState, "lastSavedAt" | "version">> = {},
): void {
  const normalized = normalizeEditorNavigation(project, navigation);
  set({
    project: cloneProject(project),
    activePathId: normalized.activePathId,
    activePathGroupId: normalized.activePathGroupId,
    dirty,
    status: "idle",
    error: null,
    ...metadata,
  });
}

function applyProjectTransition(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<Project>,
  previousProject: Project,
  nextProject: Project,
  previousNavigation: EditorNavigation,
  nextNavigation: EditorNavigation,
  description: string,
  dirty = true,
  metadata: Partial<Pick<ProjectStoreState, "lastSavedAt" | "version">> = {},
  historyMetadata: WorkspaceHistoryMetadata = {},
): void {
  const command = projectSnapshotCommand(
    description,
    previousProject,
    nextProject,
    previousNavigation,
    nextNavigation,
    historyMetadata,
  );
  const appliedProject = history
    .getState()
    .execute(cloneProject(previousProject), command);

  setProject(set, appliedProject, nextNavigation, dirty, metadata);
}

function projectSnapshotCommand(
  description: string,
  previousProject: Project,
  nextProject: Project,
  previousNavigation: EditorNavigation,
  nextNavigation: EditorNavigation,
  metadata: WorkspaceHistoryMetadata = {},
): ProjectSnapshotHistoryCommand {
  const previousSnapshot = cloneProject(previousProject);
  const nextSnapshot = cloneProject(nextProject);

  return {
    kind: "project-snapshot",
    description,
    createdPathId: metadata.createdPathId,
    focusPathId: metadata.focusPathId,
    previousSnapshot,
    nextSnapshot,
    previousNavigation: structuredClone(previousNavigation),
    nextNavigation: structuredClone(nextNavigation),
    apply: () => cloneProject(nextSnapshot),
    revert: () => cloneProject(previousSnapshot),
  };
}

function isProjectSnapshotCommand(
  command: HistoryCommand<Project> | undefined,
): command is ProjectSnapshotHistoryCommand {
  return (
    Boolean(command) &&
    (command as ProjectSnapshotHistoryCommand).kind === "project-snapshot"
  );
}

function mergeCreatedPathMembershipTransition(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<Project>,
  nextProject: Project,
  nextNavigation: EditorNavigation,
  pathIds: readonly string[],
): boolean {
  if (pathIds.length !== 1) {
    return false;
  }

  const state = history.getState();
  const previousCommand = state.undoStack.at(-1);
  if (
    !isProjectSnapshotCommand(previousCommand) ||
    previousCommand.createdPathId !== pathIds[0]
  ) {
    return false;
  }

  const mergedCommand = projectSnapshotCommand(
    previousCommand.description,
    previousCommand.previousSnapshot,
    nextProject,
    previousCommand.previousNavigation,
    nextNavigation,
    { createdPathId: previousCommand.createdPathId },
  );
  const undoStack = [...state.undoStack.slice(0, -1), mergedCommand];

  history.setState({
    undoStack,
    redoStack: [],
    canUndo: undoStack.length > 0,
    canRedo: false,
  });
  setProject(set, nextProject, nextNavigation, true);
  return true;
}

function createdPathIdFromTransition(
  previousProject: Project,
  nextProject: Project,
): string | undefined {
  const previousPathIds = new Set(
    previousProject.paths.map((path) => path.path_id),
  );
  const createdPathIds = nextProject.paths
    .map((path) => path.path_id)
    .filter((pathId) => !previousPathIds.has(pathId));

  return createdPathIds.length === 1 ? createdPathIds[0] : undefined;
}

function adoptWorkspace(
  set: StoreApi<ProjectStoreState>["setState"],
  history: HistoryStore<Project>,
  io: ProjectIoService,
  workspace: ProjectWorkspaceDocument,
  dirty: boolean,
): Project {
  history.getState().clear();
  const opened = openProjectFromLegacyWorkspace(workspace);
  const navigation = normalizeEditorNavigation(opened.project, {
    ...opened.navigation,
    activePathId: locallyRememberedActivePath(
      opened.project.project_id,
      opened.navigation.activePathId,
    ),
  });
  setProject(set, opened.project, navigation, dirty, {
    version: io.getCurrentVersion(),
    lastSavedAt: io.getLastSavedAt(),
  });
  return cloneProject(opened.project);
}

function projectPathCommand(
  command: HistoryCommand<PathModel>,
  pathId: string,
): ProjectPathHistoryCommand {
  return {
    kind: "path-command",
    pathId,
    description: command.description,
    apply: (project) => {
      return updateProjectPath(project, pathId, command.apply);
    },
    revert: (project) => {
      return updateProjectPath(project, pathId, command.revert);
    },
  };
}

function updateProjectPath(
  project: Project,
  pathId: string,
  update: (path: PathModel) => PathModel,
): Project {
  return {
    ...project,
    paths: project.paths.map((path) =>
      path.path_id === pathId
        ? { ...path, path: update(structuredClone(path.path)) }
        : path,
    ),
  };
}

function projectConfigCommand(
  command: HistoryCommand<ProjectConfig>,
): ProjectConfigHistoryCommand {
  return {
    kind: "config-command",
    description: command.description,
    apply: (project) => ({
      ...project,
      config: command.apply(structuredClone(project.config)),
    }),
    revert: (project) => ({
      ...project,
      config: command.revert(structuredClone(project.config)),
    }),
  };
}

function navigationForHistory(
  command: HistoryCommand<Project>,
  direction: "undo" | "redo",
  state: ProjectStoreState,
): EditorNavigation {
  if (isProjectSnapshotCommand(command)) {
    if (command.focusPathId) {
      return {
        activePathId: command.focusPathId,
        activePathGroupId: state.activePathGroupId,
      };
    }
    return direction === "undo"
      ? command.previousNavigation
      : command.nextNavigation;
  }
  if ((command as Partial<ProjectPathHistoryCommand>).kind === "path-command") {
    return {
      activePathId: (command as ProjectPathHistoryCommand).pathId,
      activePathGroupId: state.activePathGroupId,
    };
  }
  return currentNavigation(state);
}

function currentNavigation(
  state: Pick<ProjectStoreState, "activePathId" | "activePathGroupId">,
): EditorNavigation {
  return {
    activePathId: state.activePathId,
    activePathGroupId: state.activePathGroupId,
  };
}

function navigationForActiveGroup(
  project: Project,
  navigation: EditorNavigation,
  requestedGroupId: string | null,
): EditorNavigation {
  const group = requestedGroupId
    ? (project.path_groups.find(
        (candidate) => candidate.group_id === requestedGroupId,
      ) ?? null)
    : null;
  const activePathId =
    group && !group.path_ids.includes(navigation.activePathId ?? "")
      ? (group.path_ids.find((pathId) =>
          project.paths.some((path) => path.path_id === pathId),
        ) ?? navigation.activePathId)
      : navigation.activePathId;

  return normalizeEditorNavigation(project, {
    activePathId,
    activePathGroupId: group?.group_id ?? null,
  });
}

function requireActivePathId(
  state: Pick<ProjectStoreState, "activePathId">,
): string {
  const pathId = state.activePathId;
  if (!pathId) {
    throw new Error("No active path");
  }
  return pathId;
}

function requireProjectIo(io: ProjectIoService | null): ProjectIoService {
  if (!io) {
    throw new Error("Project IO service is not configured");
  }
  return io;
}

function requireProject(project: Project | null): Project {
  if (!project) {
    throw new Error("No active Project");
  }
  return project;
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
