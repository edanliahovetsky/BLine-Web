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
  ProjectIoService,
} from "../platform/projectIo";
import type { WriteResult } from "../storage/adapter";
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
  persistenceDamage: ProjectFileDamage | null;
  projectSessionId: string | null;
  revision: number;
  activeSave: SaveOwnership | null;
  saveQueued: boolean;
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
  replaceDamagedProject(): Promise<WriteResult | null>;
  prepareLegacyProjectMigration(
    projectSessionId: string,
    migration: LegacyProjectViewMigration,
  ): Promise<WriteResult | null>;
  completeLegacyProjectMigration(
    projectSessionId: string,
    migration: LegacyProjectViewMigration,
  ): Promise<WriteResult | null>;
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
  importProjectFolder(files: readonly File[]): Promise<ProjectImportResult>;
  exportProjectFolder(): Promise<ProjectFolderExport | null>;
  importProjectArchive(file: File): Promise<ProjectImportResult>;
  exportProjectArchive(): Promise<Blob | null>;
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
  markSaveError(error: unknown): void;
  reset(): void;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

export function createProjectStore(
  history = createHistoryStore<Project>(),
): ProjectStore {
  let nextProjectSessionId = 1;
  let savePromise: Promise<WriteResult> | null = null;
  let legacyMigrationProjectSessionId: string | null = null;
  const createProjectSessionId = () =>
    `project-session-${nextProjectSessionId++}`;

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
    };
    set({
      status: "saving",
      error: null,
      activeSave: ownership,
      saveQueued: false,
    });

    const service = requireProjectIo(state.io);
    savePromise = replaceDamage
      ? service.replaceDamagedProject(project, expectedVersion)
      : service.saveWorkspace(project, force ? undefined : expectedVersion);

    try {
      const result = await savePromise;
      const current = get();
      if (ownsProjectSession(current, ownership)) {
        const savedCurrentRevision = current.revision === ownership.revision;
        set({
          version: result.version,
          dirty: savedCurrentRevision ? false : current.dirty,
          status: savedCurrentRevision ? "idle" : "saving",
          error: null,
          lastSavedAt: result.updatedAt,
          persistenceDamage: service.getPersistenceDamage?.() ?? null,
          activeSave: null,
          saveQueued: savedCurrentRevision ? false : true,
        });
      }
      return result;
    } catch (error) {
      if (ownsProjectSession(get(), ownership)) {
        set({ activeSave: null, saveQueued: false });
        get().markSaveError(error);
      }
      throw error;
    } finally {
      savePromise = null;
      const current = get();
      if (
        ownsProjectSession(current, ownership) &&
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
    version: undefined,
    dirty: false,
    status: "idle",
    error: null,
    lastSavedAt: null,
    persistenceDamage: null,
    ...inactiveSaveState(),
    history,
    setProjectIoService(io) {
      set({ io });
    },
    async initializeWorkspace(fallback) {
      const io = requireProjectIo(get().io);
      set({ status: "loading", error: null });

      try {
        let project = await io.initialize();
        if (!project && fallback) {
          project = await io.createWorkspace({
            project: fallback,
          });
        }

        if (!project) {
          set({
            status: "idle",
            error: null,
          });
          return null;
        }

        return adoptWorkspace(
          set,
          history,
          io,
          project,
          false,
          createProjectSessionId(),
        );
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
      if (get().dirty) {
        await get().saveWorkspace();
      }
      set({ status: "loading", error: null });

      try {
        const created = await io.createWorkspace({
          project,
        });
        return adoptWorkspace(
          set,
          history,
          io,
          created,
          false,
          createProjectSessionId(),
        );
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
      if (get().dirty) {
        await get().saveWorkspace();
      }
      set({ status: "loading", error: null });

      try {
        const workspace = await io.openWorkspace(id);
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
          return adoptWorkspace(
            set,
            history,
            io,
            workspace,
            false,
            createProjectSessionId(),
          );
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
            persistenceDamage: null,
            ...inactiveSaveState(),
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
      if (get().dirty) {
        await get().saveWorkspace();
      }
      set({ status: "loading", error: null });

      try {
        const workspace = await io.switchWorkspace(id);
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
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    },
    async saveWorkspace() {
      if (
        legacyMigrationProjectSessionId !== null &&
        legacyMigrationProjectSessionId === get().projectSessionId
      ) {
        return null;
      }
      if (savePromise) {
        set({ saveQueued: true });
        const result = await savePromise;
        return get().dirty ? get().saveWorkspace() : result;
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
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      set({ status: "loading", error: null });

      try {
        const reloaded = await io.reloadCurrentProject();
        if (reloaded) {
          return adoptWorkspace(
            set,
            history,
            io,
            reloaded,
            false,
            createProjectSessionId(),
          );
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
      if (savePromise) {
        await savePromise;
      }
      const { project, projectSessionId } = get();
      if (!project || !projectSessionId) {
        return null;
      }
      return executeOwnedSave(set, get, project, undefined, true);
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
      const io = requireProjectIo(before.io);
      const result = await io.completeLegacyProjectMigration(migration);
      if (!result) {
        return null;
      }
      const current = get();
      if (current.projectSessionId !== projectSessionId) {
        return result;
      }
      legacyMigrationProjectSessionId = null;
      set({
        version: result.version,
        lastSavedAt: result.updatedAt,
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
        return null;
      }
      const io = requireProjectIo(before.io);
      legacyMigrationProjectSessionId = projectSessionId;
      let result: WriteResult | null;
      try {
        result = await io.prepareLegacyProjectMigration(migration);
      } catch (error) {
        if (legacyMigrationProjectSessionId === projectSessionId) {
          legacyMigrationProjectSessionId = null;
        }
        throw error;
      }
      if (!result) {
        return null;
      }
      const current = get();
      if (current.projectSessionId !== projectSessionId) {
        return result;
      }
      set({
        version: result.version,
        lastSavedAt: result.updatedAt,
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
      const imported = await io.importPath(file);
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
        {
          version: io.getCurrentVersion(),
          lastSavedAt: io.getLastSavedAt(),
        },
        {
          createdPathId,
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
      return io.exportPath(project, pathId ?? get().activePathId ?? "");
    },
    async importConfig(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const workspace = await io.importConfig(file);
      return adoptWorkspace(
        set,
        history,
        io,
        workspace,
        false,
        createProjectSessionId(),
      );
    },
    async exportConfig() {
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      return io.exportConfig(project);
    },
    async importProjectFolder(files) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const imported = await io.importProjectFolder(files);
      const project = adoptWorkspace(
        set,
        history,
        io,
        imported.project,
        false,
        createProjectSessionId(),
      );
      return { ...imported, project };
    },
    async exportProjectFolder() {
      const io = requireProjectIo(get().io);
      const project = get().project;
      if (!project) {
        return null;
      }
      return io.exportProjectFolder(project);
    },
    async importProjectArchive(file) {
      const io = requireProjectIo(get().io);
      if (get().dirty) {
        await get().saveWorkspace();
      }
      const imported = await io.importProjectArchive(file);
      const project = adoptWorkspace(
        set,
        history,
        io,
        imported.project,
        false,
        createProjectSessionId(),
      );
      return { ...imported, project };
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
    markSaveError(error) {
      set({
        status: isProjectPersistenceDamage(error)
          ? "damaged"
          : isStorageConflict(error)
            ? "conflict"
            : "error",
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
  project: Project,
  dirty: boolean,
  projectSessionId: string,
): Project {
  history.getState().clear();
  const legacyMigration = io.getLegacyProjectViewMigration?.() ?? null;
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
  const persistenceDamage = io.getPersistenceDamage?.() ?? null;
  set({
    project: cloneProject(project),
    activePathId: navigation.activePathId,
    activePathGroupId: navigation.activePathGroupId,
    dirty,
    status: persistenceDamage ? "damaged" : "idle",
    error: persistenceDamage?.message ?? null,
    version: io.getCurrentVersion(),
    lastSavedAt: io.getLastSavedAt(),
    persistenceDamage,
    ...inactiveSaveState(projectSessionId),
  });
  return cloneProject(project);
}

function inactiveSaveState(projectSessionId: string | null = null) {
  return {
    projectSessionId,
    revision: 0,
    activeSave: null,
    saveQueued: false,
  } satisfies Pick<
    ProjectStoreState,
    "projectSessionId" | "revision" | "activeSave" | "saveQueued"
  >;
}

function ownsProjectSession(
  state: ProjectStoreState,
  ownership: SaveOwnership,
): boolean {
  return (
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
