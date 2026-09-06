import { createStore, type StoreApi } from "zustand/vanilla";
import {
  activeProjectPath,
  normalizeEditorNavigation,
  type EditorNavigation,
} from "../core/model/editorNavigation";
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
  applyPathElementEdit,
  applyPathStructureEdit,
  type PathElementEdit,
  type PathElementEditResult,
  type PathStructureEdit,
  type PathStructureEditResult,
} from "../core/model/projectPathEdits";
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
  LegacyProjectViewMigration,
  ProjectFolderExport,
  ProjectImportResult,
  ProjectImportOptions,
  ProjectIoService,
  ProjectIoWorkspace,
  ProjectIoWorkspaceHandle,
  ProjectIoWriteOutcome,
  ProjectWorkspaceSummary,
  LegacyProjectMigrationPreparation,
  WriteResult,
} from "../platform/projectIo";
import { isProjectIoConflict } from "../platform/projectIo";
import type { ProjectFileDamage } from "../core/io/projectFiles";
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
  | "conflict"
  | "damaged";

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

export interface SaveOwnership {
  projectId: string;
  projectSessionId: string;
  revision: number;
  ioGeneration: number;
}

export interface ProjectMutationOwnership {
  projectId: string;
  projectSessionId: string;
  revision: number;
}

interface ProjectTransitionOwnership {
  ioGeneration: number;
  io: ProjectIoService | null;
  projectId: string | null;
  projectSessionId: string | null;
  revision: number;
}

export interface ProjectEditOwnership extends ProjectMutationOwnership {
  historyEntry: HistoryCommand<Project>;
  previousProject: Project;
}

export type DerivedPathCommandResult = "applied" | "noop" | "stale";

export interface ProjectStoreState {
  project: Project | null;
  activePathId: string | null;
  activePathGroupId: string | null;
  io: ProjectIoService | null;
  workspaceHandle: ProjectIoWorkspaceHandle | null;
  currentWorkspaceSummary: ProjectWorkspaceSummary | null;
  legacyProjectViewMigration: LegacyProjectViewMigration | null;
  version: string | undefined;
  dirty: boolean;
  status: ProjectStatus;
  error: string | null;
  lastSavedAt: string | null;
  persistenceDamage: ProjectFileDamage | null;
  projectSessionId: string | null;
  revision: number;
  activeSave: SaveOwnership | null;
  saveQueued: boolean;
  projectTransitionInProgress: boolean;
  legacyMigrationProjectSessionId: string | null;
  legacyMigrationPhase: "preparing" | "prepared" | null;
  legacyMigrationError: string | null;
  history: HistoryStore<Project>;
  setProjectIoService(io: ProjectIoService | null): void;
  initializeWorkspace(fallback?: Project): Promise<Project | null>;
  createWorkspace(project: Project): Promise<Project>;
  openWorkspace(id?: string): Promise<Project | null>;
  deleteWorkspace(
    id?: string,
    expectedVersion?: string,
  ): Promise<Project | null>;
  switchWorkspace(id: string): Promise<Project | null>;
  saveWorkspace(): Promise<WriteResult | null>;
  reloadFromDisk(): Promise<Project | null>;
  overwriteConflict(): Promise<WriteResult | null>;
  replaceDamagedProject(): Promise<WriteResult | null>;
  prepareLegacyProjectMigration(
    projectSessionId: string,
    migration: LegacyProjectViewMigration,
  ): Promise<LegacyProjectMigrationPreparation>;
  completeLegacyProjectMigration(
    projectSessionId: string,
    migration: LegacyProjectViewMigration,
  ): Promise<WriteResult | null>;
  setActivePath(pathId: string): void;
  setActivePathGroup(groupId: string | null): void;
  createPath(input: {
    displayName: string;
    path?: PathModel;
    addToGroupId?: string | null;
    makeActive?: boolean;
  }): void;
  renamePath(pathId: string, name: string): void;
  duplicatePath(
    pathId: string,
    name: string,
    options?: {
      addToGroupId?: string | null;
      copyMemberships?: boolean;
      makeActive?: boolean;
    },
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
  deletePathGroups(groupIds: readonly string[]): void;
  addPathsToGroup(groupId: string, pathIds: readonly string[]): void;
  removePathsFromGroup(
    groupId: string,
    pathIds: readonly string[],
    options?: { preserveActivePath?: boolean },
  ): void;
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
  importProjectFolder(
    files: readonly File[],
    options?: ProjectImportOptions,
  ): Promise<ProjectImportResult>;
  exportProjectFolder(): Promise<ProjectFolderExport | null>;
  importProjectArchive(
    file: File,
    options?: ProjectImportOptions,
  ): Promise<ProjectImportResult>;
  exportProjectArchive(): Promise<Blob | null>;
  applyPathCommand(command: HistoryCommand<PathModel>, pathId?: string): void;
  applyPathElementEdit(
    edit: PathElementEdit,
    options?: { pathId?: string },
  ): PathElementEditResult;
  applyPathStructureEdit(
    edit: PathStructureEdit,
    options?: {
      pathId?: string;
      selectedElementIndex?: number | null;
    },
  ): PathStructureEditResult;
  applyConfigCommand(command: HistoryCommand<ProjectConfig>): void;
  applyDerivedPathCommand(
    command: HistoryCommand<PathModel>,
    ownership: ProjectEditOwnership,
    pathId?: string,
  ): DerivedPathCommandResult;
  undo(): void;
  redo(): void;
  markSaveError(error: unknown): void;
  markLegacyMigrationError(error: unknown): void;
  reset(): void;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

export function createProjectStore(
  history = createHistoryStore<Project>(),
): ProjectStore {
  let nextProjectSessionId = 1;
  let ioGeneration = 0;
  let savePromise: Promise<ProjectIoWriteOutcome> | null = null;
  let activeProjectTransition: ProjectTransitionOwnership | null = null;
  const createProjectSessionId = () =>
    `project-session-${nextProjectSessionId++}`;

  const beginProjectTransition = async (
    set: StoreApi<ProjectStoreState>["setState"],
    get: StoreApi<ProjectStoreState>["getState"],
    persistCurrentProject = true,
  ): Promise<ProjectTransitionOwnership> => {
    if (activeProjectTransition) {
      throw new Error("Another Project change is already in progress");
    }

    // A save can admit another synchronous edit before its awaiting caller resumes.
    // Keep draining that work until transition ownership can be captured atomically.
    while (true) {
      if (persistCurrentProject) {
        await persistBeforeProjectTransition(get);
      }
      if (activeProjectTransition) {
        throw new Error("Another Project change is already in progress");
      }
      const state = get();
      if (persistCurrentProject && state.dirty) {
        continue;
      }
      const ownership: ProjectTransitionOwnership = {
        ioGeneration,
        io: state.io,
        projectId: state.project?.project_id ?? null,
        projectSessionId: state.projectSessionId,
        revision: state.revision,
      };
      activeProjectTransition = ownership;
      set({ projectTransitionInProgress: true });
      return ownership;
    }
  };

  const projectTransitionIsCurrent = (
    get: StoreApi<ProjectStoreState>["getState"],
    ownership: ProjectTransitionOwnership,
  ): boolean => {
    const state = get();
    return (
      activeProjectTransition === ownership &&
      ioGeneration === ownership.ioGeneration &&
      state.io === ownership.io &&
      (state.project?.project_id ?? null) === ownership.projectId &&
      state.projectSessionId === ownership.projectSessionId &&
      state.revision === ownership.revision
    );
  };

  const requireCurrentProjectTransition = (
    get: StoreApi<ProjectStoreState>["getState"],
    ownership: ProjectTransitionOwnership,
  ): void => {
    if (!projectTransitionIsCurrent(get, ownership)) {
      throw new Error(
        "The active Project changed before the operation finished",
      );
    }
  };

  const finishProjectTransition = (
    set: StoreApi<ProjectStoreState>["setState"],
    ownership: ProjectTransitionOwnership,
  ): void => {
    if (activeProjectTransition === ownership) {
      activeProjectTransition = null;
      set({ projectTransitionInProgress: false });
    }
  };

  const requireProjectMutationAllowed = (): void => {
    const state = store.getState();
    if (
      activeProjectTransition &&
      activeProjectTransition.projectId ===
        (state.project?.project_id ?? null) &&
      activeProjectTransition.projectSessionId === state.projectSessionId
    ) {
      throw new Error(
        "Project edits are temporarily unavailable while changing Projects",
      );
    }
  };

  const performProjectTransition = async <T>(
    set: StoreApi<ProjectStoreState>["setState"],
    get: StoreApi<ProjectStoreState>["getState"],
    operation: (ownership: ProjectTransitionOwnership) => Promise<T>,
    reportLoading = false,
    persistCurrentProject = true,
  ): Promise<T> => {
    const ownership = await beginProjectTransition(
      set,
      get,
      persistCurrentProject,
    );
    if (reportLoading) {
      set({ status: "loading", error: null });
    }
    try {
      return await operation(ownership);
    } catch (error) {
      if (reportLoading && projectTransitionIsCurrent(get, ownership)) {
        set({ status: "error", error: errorMessage(error) });
      }
      throw error;
    } finally {
      finishProjectTransition(set, ownership);
    }
  };

  const executeOwnedSave = async (
    set: StoreApi<ProjectStoreState>["setState"],
    get: StoreApi<ProjectStoreState>["getState"],
    project: Project,
    expectedVersion: string | undefined,
    force: boolean,
    replaceDamage = false,
  ): Promise<WriteResult> => {
    const state = get();
    const projectSessionId = state.projectSessionId;
    if (!projectSessionId) {
      throw new Error("No Project session is open");
    }
    const ownership: SaveOwnership = {
      projectId: project.project_id,
      projectSessionId,
      revision: state.revision,
      ioGeneration,
    };
    set({
      status: "saving",
      error: null,
      activeSave: ownership,
      saveQueued: false,
    });

    const service = requireProjectIo(state.io);
    const current = requireIoWorkspace(state);
    const ownedSavePromise = replaceDamage
      ? service.replaceDamagedProject(current, project, expectedVersion)
      : service.saveWorkspace(
          current,
          project,
          force ? undefined : expectedVersion,
        );
    savePromise = ownedSavePromise;

    try {
      const outcome = await ownedSavePromise;
      const { result, workspace } = outcome;
      const current = get();
      if (ownsProjectSession(current, ownership, ioGeneration)) {
        const savedCurrentRevision = current.revision === ownership.revision;
        set({
          ...persistenceStateFromWorkspace(workspace),
          dirty: savedCurrentRevision ? false : current.dirty,
          status: savedCurrentRevision ? "idle" : "saving",
          error: null,
          activeSave: null,
          saveQueued: savedCurrentRevision ? false : true,
        });
      }
      return result;
    } catch (error) {
      if (ownsProjectSession(get(), ownership, ioGeneration)) {
        set({ activeSave: null, saveQueued: false });
        get().markSaveError(error);
      }
      throw error;
    } finally {
      if (savePromise === ownedSavePromise) {
        savePromise = null;
      }
      const current = get();
      if (
        ownsProjectSession(current, ownership, ioGeneration) &&
        current.dirty &&
        current.saveQueued
      ) {
        void get()
          .saveWorkspace()
          .catch(() => {});
      }
    }
  };

  const store = createStore<ProjectStoreState>((set, get) => ({
    project: null,
    activePathId: null,
    activePathGroupId: null,
    io: null,
    workspaceHandle: null,
    currentWorkspaceSummary: null,
    legacyProjectViewMigration: null,
    version: undefined,
    dirty: false,
    status: "idle",
    error: null,
    lastSavedAt: null,
    persistenceDamage: null,
    projectTransitionInProgress: false,
    ...inactiveSaveState(),
    history,
    setProjectIoService(io) {
      ioGeneration += 1;
      savePromise = null;
      activeProjectTransition = null;
      set({
        io,
        activeSave: null,
        saveQueued: false,
        projectTransitionInProgress: false,
        legacyMigrationProjectSessionId: null,
        legacyMigrationPhase: null,
      });
    },
    async initializeWorkspace(fallback) {
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          let workspace = await io.initialize();
          if (!workspace && fallback) {
            workspace = await io.createWorkspace({ project: fallback });
          }
          requireCurrentProjectTransition(get, ownership);
          if (!workspace) {
            set({ status: "idle", error: null });
            return null;
          }
          return adoptWorkspace(
            set,
            history,
            io,
            workspace,
            false,
            createProjectSessionId(),
          );
        },
        true,
        false,
      );
    },
    async createWorkspace(project) {
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          const created = await io.createWorkspace(
            {
              project,
            },
            currentIoWorkspace(get()) ?? undefined,
          );
          requireCurrentProjectTransition(get, ownership);
          return adoptWorkspace(
            set,
            history,
            io,
            created,
            false,
            createProjectSessionId(),
          );
        },
        true,
      );
    },
    async openWorkspace(id) {
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          const workspace = await io.openWorkspace(
            id,
            currentIoWorkspace(get()) ?? undefined,
          );
          requireCurrentProjectTransition(get, ownership);
          if (workspace) {
            return adoptWorkspace(
              set,
              history,
              io,
              workspace,
              false,
              createProjectSessionId(),
            );
          } else {
            set({ status: "idle" });
          }
          return null;
        },
        true,
      );
    },
    async deleteWorkspace(id, expectedVersion) {
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          const result = await io.deleteWorkspace(
            currentIoWorkspace(get()),
            id,
            expectedVersion,
          );
          requireCurrentProjectTransition(get, ownership);
          if (!result.changedCurrent) {
            set({ status: "idle", error: null });
            return result.workspace?.project ?? null;
          }
          if (result.workspace) {
            return adoptWorkspace(
              set,
              history,
              io,
              result.workspace,
              false,
              createProjectSessionId(),
            );
          } else {
            history.getState().clear();
            set({
              project: null,
              workspaceHandle: null,
              currentWorkspaceSummary: null,
              legacyProjectViewMigration: null,
              activePathId: null,
              activePathGroupId: null,
              version: undefined,
              dirty: false,
              status: "idle",
              error: null,
              lastSavedAt: null,
              persistenceDamage: null,
              ...inactiveSaveState(),
            });
          }
          return null;
        },
        true,
      );
    },
    async switchWorkspace(id) {
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          const workspace = await io.switchWorkspace(
            id,
            currentIoWorkspace(get()) ?? undefined,
          );
          requireCurrentProjectTransition(get, ownership);
          if (workspace) {
            return adoptWorkspace(
              set,
              history,
              io,
              workspace,
              false,
              createProjectSessionId(),
            );
          }
          return null;
        },
        true,
      );
    },
    async saveWorkspace() {
      if (legacyProjectMigrationOwnsSession(get())) {
        return null;
      }
      if (savePromise) {
        set({ saveQueued: true });
        const outcome = await savePromise;
        return get().dirty ? get().saveWorkspace() : outcome.result;
      }

      const { project, projectSessionId, version } = get();
      if (!project || !projectSessionId || !get().dirty) {
        return null;
      }
      return executeOwnedSave(set, get, project, version, false);
    },
    async reloadFromDisk() {
      // Conflict recovery: discard the in-memory edits and re-read the project from
      // disk, refreshing the version token so autosave resumes cleanly.
      if (!get().project) {
        return null;
      }
      return performProjectTransition(
        set,
        get,
        async (ownership) => {
          const io = requireProjectIo(ownership.io);
          const reloaded = await io.reloadWorkspace(
            requireWorkspaceHandle(get().workspaceHandle),
          );
          requireCurrentProjectTransition(get, ownership);
          return reloaded
            ? adoptWorkspace(
                set,
                history,
                io,
                reloaded,
                false,
                createProjectSessionId(),
              )
            : null;
        },
        true,
        false,
      );
    },
    async overwriteConflict() {
      // Conflict recovery: force the in-memory workspace onto disk, bypassing the
      // version check, then adopt the fresh version returned by the write.
      if (savePromise) {
        await savePromise;
      }
      const { persistenceDamage, project, projectSessionId } = get();
      if (!project || !projectSessionId) {
        return null;
      }
      return executeOwnedSave(
        set,
        get,
        project,
        undefined,
        true,
        persistenceDamage !== null,
      );
    },
    async replaceDamagedProject() {
      if (savePromise) {
        await savePromise.catch(() => undefined);
      }
      const { project, version } = get();
      if (!project) {
        return null;
      }
      return executeOwnedSave(set, get, project, version, false, true);
    },
    async completeLegacyProjectMigration(expectedProjectSessionId, migration) {
      if (savePromise) {
        await savePromise;
      }
      const before = get();
      const projectSessionId = before.projectSessionId;
      if (
        !before.project ||
        !projectSessionId ||
        projectSessionId !== expectedProjectSessionId
      ) {
        return null;
      }
      if (
        before.legacyMigrationProjectSessionId !== projectSessionId ||
        before.legacyMigrationPhase !== "prepared"
      ) {
        throw new Error(
          "Legacy Project migration must be prepared before cleanup",
        );
      }
      const io = requireProjectIo(before.io);
      const outcome = await io.completeLegacyProjectMigration(
        requireIoWorkspace(before),
        migration,
      );
      if (!outcome) {
        throw new Error("Legacy Project cleanup could not be confirmed");
      }
      const { result, workspace } = outcome;
      const current = get();
      if (current.io !== io || current.projectSessionId !== projectSessionId) {
        return result;
      }
      set({
        ...persistenceStateFromWorkspace(workspace),
        legacyMigrationProjectSessionId: null,
        legacyMigrationPhase: null,
        legacyMigrationError: null,
        ...(current.status === "error" &&
        current.legacyMigrationError !== null &&
        current.error === current.legacyMigrationError
          ? { status: "idle" as const, error: null }
          : {}),
      });
      if (current.dirty) {
        void get()
          .saveWorkspace()
          .catch(() => {});
      }
      return result;
    },
    async prepareLegacyProjectMigration(expectedProjectSessionId, migration) {
      if (savePromise) {
        // Legacy records deliberately reject ordinary saves while migration
        // metadata remains. Let preparation establish the cleanup snapshot;
        // dirty changes are saved only after cleanup confirms that snapshot.
        await savePromise.catch(() => undefined);
      }
      const before = get();
      const projectSessionId = before.projectSessionId;
      if (
        !before.project ||
        !projectSessionId ||
        projectSessionId !== expectedProjectSessionId
      ) {
        return { status: "rejected" };
      }
      const io = requireProjectIo(before.io);
      set({
        legacyMigrationProjectSessionId: projectSessionId,
        legacyMigrationPhase: "preparing",
      });
      let outcome: Awaited<
        ReturnType<ProjectIoService["prepareLegacyProjectMigration"]>
      >;
      try {
        outcome = await io.prepareLegacyProjectMigration(
          requireIoWorkspace(before),
          migration,
        );
      } catch (error) {
        if (get().legacyMigrationProjectSessionId === projectSessionId) {
          set({
            legacyMigrationProjectSessionId: null,
            legacyMigrationPhase: null,
          });
        }
        throw error;
      }
      const { preparation: result, workspace: preparedWorkspace } = outcome;
      if (result.status === "rejected") {
        if (get().legacyMigrationProjectSessionId === projectSessionId) {
          set({
            legacyMigrationProjectSessionId: null,
            legacyMigrationPhase: null,
          });
        }
        return result;
      }
      const current = get();
      if (current.io !== io || current.projectSessionId !== projectSessionId) {
        return result;
      }
      set({
        ...persistenceStateFromWorkspace(preparedWorkspace),
        legacyMigrationPhase: "prepared",
      });
      return result;
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
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const added = addPathToProject(project, {
        display_name: input.displayName,
        path: input.path,
        addToGroupId: input.addToGroupId,
      });
      applyProjectTransition(
        set,
        history,
        project,
        added.project,
        navigation,
        input.makeActive === false
          ? navigation
          : { ...navigation, activePathId: added.createdPathId },
        "Create path",
        true,
        {},
        { createdPathId: added.createdPathId },
      );
    },
    renamePath(pathId, name) {
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const duplicated = duplicatePathInProject(
        project,
        pathId,
        name,
        options?.addToGroupId,
        options?.copyMemberships,
      );
      const nextNavigation =
        duplicated.createdPathId && options?.makeActive !== false
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
      requireProjectMutationAllowed();
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
        "Create Path Group",
      );
    },
    renamePathGroup(groupId, name) {
      requireProjectMutationAllowed();
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
        "Rename Path Group",
      );
    },
    deletePathGroup(groupId, options) {
      requireProjectMutationAllowed();
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
        "Delete Path Group",
      );
    },
    deletePathGroups(groupIds) {
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const ids = new Set(groupIds);
      const remainingGroups = project.path_groups.filter(
        (group) => !ids.has(group.group_id),
      );
      if (remainingGroups.length === project.path_groups.length) return;
      const navigation = currentNavigation(state);
      const nextProject = { ...project, path_groups: remainingGroups };
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        normalizeEditorNavigation(nextProject, navigation),
        ids.size === 1 ? "Delete Path Group" : "Delete Path Groups",
      );
    },
    addPathsToGroup(groupId, pathIds) {
      requireProjectMutationAllowed();
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
        "Add Paths to Path Group",
      );
    },
    removePathsFromGroup(groupId, pathIds, options) {
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = removePathsFromGroupInProject(
        project,
        groupId,
        pathIds,
      );
      const nextNavigation = options?.preserveActivePath
        ? {
            ...navigation,
            activePathGroupId:
              navigation.activePathGroupId === groupId &&
              navigation.activePathId !== null &&
              pathIds.includes(navigation.activePathId)
                ? null
                : navigation.activePathGroupId,
          }
        : navigation.activePathGroupId === groupId
          ? navigationForActiveGroup(nextProject, navigation, groupId)
          : navigation;
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        nextNavigation,
        "Remove Paths from Path Group",
      );
    },
    createLinkedTarget(input) {
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const navigation = currentNavigation(state);
      const nextProject = updateLinkedTargetInProject(
        project,
        targetId,
        update,
      );
      if (JSON.stringify(nextProject) === JSON.stringify(project)) {
        return;
      }
      applyProjectTransition(
        set,
        history,
        project,
        nextProject,
        navigation,
        navigation,
        "Update linked element",
      );
    },
    deleteLinkedTarget(targetId) {
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
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
      return performProjectTransition(set, get, async (ownership) => {
        const io = requireProjectIo(ownership.io);
        const previousProject = requireProject(get().project);
        const previousNavigation = currentNavigation(get());
        const imported = await io.importPath(previousProject, file);
        const saved = await io.saveWorkspace(
          requireIoWorkspace(get()),
          imported,
          get().version,
        );
        requireCurrentProjectTransition(get, ownership);
        const createdPathId = createdPathIdFromTransition(
          previousProject,
          imported,
        );
        applyProjectTransition(
          set,
          history,
          previousProject,
          imported,
          previousNavigation,
          normalizeEditorNavigation(imported, {
            ...previousNavigation,
            activePathId: createdPathId ?? previousNavigation.activePathId,
          }),
          "Import path",
          false,
          persistenceStateFromWorkspace(saved.workspace),
          {
            createdPathId,
          },
        );
        return requireProject(get().project);
      });
    },
    async exportPath(pathId) {
      const project = get().project;
      const io = requireProjectIo(get().io);
      if (!project) {
        return null;
      }
      return io.exportPath(project, pathId ?? get().activePathId ?? "");
    },
    async importConfig(file) {
      return performProjectTransition(set, get, async (ownership) => {
        const io = requireProjectIo(ownership.io);
        const state = get();
        const project = requireProject(state.project);
        const imported = await io.importConfig(project, file);
        const workspace = (
          await io.saveWorkspace(
            requireIoWorkspace(state),
            imported,
            state.version,
          )
        ).workspace;
        requireCurrentProjectTransition(get, ownership);
        return adoptWorkspace(
          set,
          history,
          io,
          workspace,
          false,
          createProjectSessionId(),
        );
      });
    },
    async exportConfig() {
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      return io.exportConfig(project);
    },
    async importProjectFolder(files, options) {
      return performProjectTransition(set, get, async (ownership) => {
        const io = requireProjectIo(ownership.io);
        const imported = await io.importProjectFolder(
          requireIoWorkspace(get()),
          files,
          options,
        );
        requireCurrentProjectTransition(get, ownership);
        const project = adoptWorkspace(
          set,
          history,
          io,
          imported.workspace,
          false,
          createProjectSessionId(),
        );
        return { ...imported, project };
      });
    },
    async exportProjectFolder() {
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      return io.exportProjectFolder(project);
    },
    async importProjectArchive(file, options) {
      return performProjectTransition(set, get, async (ownership) => {
        const io = requireProjectIo(ownership.io);
        const imported = await io.importProjectArchive(
          requireIoWorkspace(get()),
          file,
          options,
        );
        requireCurrentProjectTransition(get, ownership);
        const project = adoptWorkspace(
          set,
          history,
          io,
          imported.workspace,
          false,
          createProjectSessionId(),
        );
        return { ...imported, project };
      });
    },
    async exportProjectArchive() {
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      return io.exportProjectArchive(project);
    },
    applyPathCommand(command, requestedPathId) {
      requireProjectMutationAllowed();
      const project = requireProject(get().project);
      const pathId = requestedPathId ?? requireActivePathId(get());
      const nextProject = history
        .getState()
        .execute(cloneProject(project), projectPathCommand(command, pathId));

      setProject(set, nextProject, currentNavigation(get()), true);
    },
    applyPathElementEdit(edit, options) {
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const pathId = options?.pathId ?? requireActivePathId(state);
      const navigation = currentNavigation(state);
      const result = applyPathElementEdit(project, pathId, edit);
      if (result.status !== "applied") {
        return result;
      }

      const nextNavigation = {
        ...navigation,
        activePathId: result.consequences.focusPathId,
      };
      applyProjectTransition(
        set,
        history,
        project,
        result.project,
        navigation,
        nextNavigation,
        result.description,
        true,
        {},
        { focusPathId: result.consequences.focusPathId },
      );
      return result;
    },
    applyPathStructureEdit(edit, options) {
      requireProjectMutationAllowed();
      const state = get();
      const project = requireProject(state.project);
      const pathId = options?.pathId ?? requireActivePathId(state);
      const navigation = currentNavigation(state);
      const result = applyPathStructureEdit(project, pathId, edit, {
        selectedElementIndex: options?.selectedElementIndex,
      });
      if (result.status !== "applied") {
        return result;
      }

      const nextNavigation = {
        ...navigation,
        activePathId: result.consequences.focusPathId,
      };
      applyProjectTransition(
        set,
        history,
        project,
        result.project,
        navigation,
        nextNavigation,
        result.description,
        true,
        {},
        { focusPathId: result.consequences.focusPathId },
      );
      return result;
    },
    applyConfigCommand(command) {
      requireProjectMutationAllowed();
      const project = requireProject(get().project);
      const nextProject = history
        .getState()
        .execute(cloneProject(project), projectConfigCommand(command));

      setProject(set, nextProject, currentNavigation(get()), true);
    },
    applyDerivedPathCommand(command, ownership, requestedPathId) {
      if (activeProjectTransition) {
        return "stale";
      }
      const state = get();
      const project = state.project;
      const pathId = requestedPathId ?? state.activePathId;
      const historyState = history.getState();
      if (
        !project ||
        !pathId ||
        !projectMutationIsCurrent(state, ownership) ||
        historyState.undoStack.at(-1) !== ownership.historyEntry
      ) {
        return "stale";
      }

      const nextProject = projectPathCommand(command, pathId).apply(
        cloneProject(project),
      );
      if (JSON.stringify(nextProject) === JSON.stringify(project)) {
        return "noop";
      }

      const previousCommand = ownership.historyEntry;
      const navigation = currentNavigation(state);
      const previousProject = isProjectSnapshotCommand(previousCommand)
        ? previousCommand.previousSnapshot
        : previousCommand.revert(cloneProject(project));
      const amendedCommand = projectSnapshotCommand(
        previousCommand.description,
        previousProject,
        nextProject,
        isProjectSnapshotCommand(previousCommand)
          ? previousCommand.previousNavigation
          : navigation,
        isProjectSnapshotCommand(previousCommand)
          ? previousCommand.nextNavigation
          : navigation,
        historyMetadataForAmendedCommand(previousCommand),
      );
      const undoStack = [
        ...historyState.undoStack.slice(0, -1),
        amendedCommand,
      ];
      history.setState({
        undoStack,
        redoStack: [],
        canUndo: true,
        canRedo: false,
      });
      setProject(set, nextProject, navigation, true);
      return "applied";
    },
    undo() {
      requireProjectMutationAllowed();
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
      requireProjectMutationAllowed();
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
    markSaveError(error) {
      set({
        status: isProjectPersistenceDamage(error)
          ? "damaged"
          : isStorageConflict(error)
            ? "conflict"
            : "error",
        error: errorMessage(error),
        legacyMigrationError: null,
      });
    },
    markLegacyMigrationError(error) {
      const message = errorMessage(error);
      set({ status: "error", error: message, legacyMigrationError: message });
    },
    reset() {
      history.getState().clear();
      set({
        project: null,
        workspaceHandle: null,
        currentWorkspaceSummary: null,
        legacyProjectViewMigration: null,
        activePathId: null,
        activePathGroupId: null,
        version: undefined,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: null,
        persistenceDamage: null,
        ...inactiveSaveState(),
      });
    },
  }));

  let rememberedProjectId: string | null = null;
  let rememberedPathId: string | null = null;
  store.subscribe((state) => {
    const projectId = state.project?.project_id ?? null;
    const pathId = state.activePathId;
    if (
      !state.io ||
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

export function legacyProjectMigrationOwnsSession(
  state: Pick<
    ProjectStoreState,
    "projectSessionId" | "legacyMigrationProjectSessionId"
  >,
): boolean {
  return (
    state.projectSessionId !== null &&
    state.legacyMigrationProjectSessionId === state.projectSessionId
  );
}

export function activePathForProjectStore(
  state: Pick<ProjectStoreState, "project" | "activePathId">,
): ProjectPath | null {
  return activeProjectPath(state.project, state.activePathId);
}

export function captureProjectMutationOwnership(
  state: Pick<ProjectStoreState, "project" | "projectSessionId" | "revision">,
): ProjectMutationOwnership | null {
  return state.project && state.projectSessionId
    ? {
        projectId: state.project.project_id,
        projectSessionId: state.projectSessionId,
        revision: state.revision,
      }
    : null;
}

export function captureProjectEditOwnership(
  state: Pick<
    ProjectStoreState,
    "project" | "projectSessionId" | "revision" | "history"
  >,
): ProjectEditOwnership | null {
  const mutation = captureProjectMutationOwnership(state);
  const historyEntry = state.history.getState().undoStack.at(-1);
  return mutation && historyEntry && state.project
    ? {
        ...mutation,
        historyEntry,
        previousProject: historyEntry.revert(cloneProject(state.project)),
      }
    : null;
}

export function projectMutationIsCurrent(
  state: Pick<ProjectStoreState, "project" | "projectSessionId" | "revision">,
  ownership: ProjectMutationOwnership,
): boolean {
  return (
    state.project?.project_id === ownership.projectId &&
    state.projectSessionId === ownership.projectSessionId &&
    state.revision === ownership.revision
  );
}

function setProject(
  set: StoreApi<ProjectStoreState>["setState"],
  project: Project,
  navigation: EditorNavigation,
  dirty: boolean,
  metadata: Partial<
    Pick<
      ProjectStoreState,
      | "lastSavedAt"
      | "version"
      | "workspaceHandle"
      | "currentWorkspaceSummary"
      | "persistenceDamage"
      | "legacyProjectViewMigration"
    >
  > = {},
): void {
  const normalized = normalizeEditorNavigation(project, navigation);
  set((state) => ({
    project: cloneProject(project),
    activePathId: normalized.activePathId,
    activePathGroupId: normalized.activePathGroupId,
    dirty,
    revision: dirty ? state.revision + 1 : state.revision,
    saveQueued: dirty && state.activeSave ? true : state.saveQueued,
    status: state.activeSave
      ? "saving"
      : state.persistenceDamage
        ? "damaged"
        : "idle",
    error: null,
    ...metadata,
  }));
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
  metadata: Parameters<typeof setProject>[4] = {},
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

function historyMetadataForAmendedCommand(
  command: HistoryCommand<Project>,
): WorkspaceHistoryMetadata {
  if (isProjectSnapshotCommand(command)) {
    return {
      createdPathId: command.createdPathId,
      focusPathId: command.focusPathId,
    };
  }
  return (command as Partial<ProjectPathHistoryCommand>).kind === "path-command"
    ? { focusPathId: (command as ProjectPathHistoryCommand).pathId }
    : {};
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
  _io: ProjectIoService,
  workspace: ProjectIoWorkspace,
  dirty: boolean,
  projectSessionId: string,
): Project {
  const project = workspace.project;
  history.getState().clear();
  const legacyMigration = workspace.legacyMigration;
  const rememberedStablePath = locallyRememberedActivePath(
    project.project_id,
    null,
  );
  const rememberedLegacyReference = legacyMigration
    ? locallyRememberedActivePath(legacyMigration.legacyProjectId, null)
    : null;
  const navigation = normalizeEditorNavigation(project, {
    activePathId:
      rememberedStablePath ??
      (rememberedLegacyReference && legacyMigration
        ? legacyMigration.pathIdByLegacyReference[rememberedLegacyReference]
        : null) ??
      project.paths[0]?.path_id ??
      null,
  });
  const persistenceDamage = workspace.persistenceDamage;
  set({
    project: cloneProject(project),
    ...persistenceStateFromWorkspace(workspace),
    activePathId: navigation.activePathId,
    activePathGroupId: navigation.activePathGroupId,
    dirty,
    status: persistenceDamage ? "damaged" : "idle",
    error: persistenceDamage?.message ?? null,
    ...inactiveSaveState(projectSessionId),
  });
  return cloneProject(project);
}

function persistenceStateFromWorkspace(
  workspace: ProjectIoWorkspace,
): Pick<
  ProjectStoreState,
  | "workspaceHandle"
  | "currentWorkspaceSummary"
  | "legacyProjectViewMigration"
  | "version"
  | "lastSavedAt"
  | "persistenceDamage"
> {
  return {
    workspaceHandle: workspace.handle,
    currentWorkspaceSummary: workspace.summary,
    legacyProjectViewMigration: workspace.legacyMigration,
    version: workspace.version,
    lastSavedAt: workspace.lastSavedAt,
    persistenceDamage: workspace.persistenceDamage,
  };
}

function inactiveSaveState(projectSessionId: string | null = null) {
  return {
    projectSessionId,
    revision: 0,
    activeSave: null,
    saveQueued: false,
    legacyMigrationProjectSessionId: null,
    legacyMigrationPhase: null,
    legacyMigrationError: null,
  } satisfies Pick<
    ProjectStoreState,
    | "projectSessionId"
    | "revision"
    | "activeSave"
    | "saveQueued"
    | "legacyMigrationProjectSessionId"
    | "legacyMigrationPhase"
    | "legacyMigrationError"
  >;
}

async function persistBeforeProjectTransition(
  get: StoreApi<ProjectStoreState>["getState"],
): Promise<void> {
  const before = get();
  if (!before.dirty) {
    return;
  }
  const projectSessionId = before.projectSessionId;
  await before.saveWorkspace();
  const current = get();
  if (current.projectSessionId !== projectSessionId || !current.dirty) {
    return;
  }

  const error = new Error(
    legacyProjectMigrationOwnsSession(current)
      ? "Project changes are temporarily unavailable while legacy Project data finishes migrating"
      : "The current Project must be saved before changing Projects",
  );
  current.markSaveError(error);
  throw error;
}

function ownsProjectSession(
  state: ProjectStoreState,
  ownership: SaveOwnership,
  currentIoGeneration: number,
): boolean {
  return (
    currentIoGeneration === ownership.ioGeneration &&
    state.project?.project_id === ownership.projectId &&
    state.projectSessionId === ownership.projectSessionId
  );
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

function requireWorkspaceHandle(
  handle: ProjectIoWorkspaceHandle | null,
): ProjectIoWorkspaceHandle {
  if (!handle) {
    throw new Error("No Project I/O workspace is open");
  }
  return handle;
}

function currentIoWorkspace(
  state: ProjectStoreState,
): ProjectIoWorkspace | null {
  return state.project && state.workspaceHandle
    ? {
        project: cloneProject(state.project),
        handle: state.workspaceHandle,
        version: state.version,
        lastSavedAt: state.lastSavedAt,
        summary: state.currentWorkspaceSummary,
        persistenceDamage: state.persistenceDamage,
        legacyMigration: state.legacyProjectViewMigration,
      }
    : null;
}

function requireIoWorkspace(state: ProjectStoreState): ProjectIoWorkspace {
  const workspace = currentIoWorkspace(state);
  if (!workspace) {
    throw new Error("No Project I/O workspace is open");
  }
  return workspace;
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

function isProjectPersistenceDamage(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ProjectPersistenceDamageError"
  );
}

/**
 * A save conflict means the stored workspace changed out from under us (an
 * external edit, another tab/process, or a genuinely divergent version token).
 * It is recoverable via reload or overwrite, so it is surfaced distinctly from a
 * hard save error.
 *
 * Storage adapters normalize backend-specific failures to a named conflict at
 * the platform boundary, so state does not depend on native string protocols.
 */
export function isStorageConflict(error: unknown): boolean {
  return isProjectIoConflict(error);
}
