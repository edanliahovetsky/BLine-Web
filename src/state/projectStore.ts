import { createStore, type StoreApi } from "zustand/vanilla";
import type { ProjectDocument } from "../core/io/projectSchema";
import type { StorageAdapter, WriteResult } from "../storage/adapter";
import {
  createHistoryStore,
  type HistoryCommand,
  type HistoryStore
} from "./historyStore";

export type ProjectStatus = "idle" | "loading" | "saving" | "error";

export interface ProjectStoreState {
  project: ProjectDocument | null;
  storage: StorageAdapter | null;
  version: string | undefined;
  dirty: boolean;
  status: ProjectStatus;
  error: string | null;
  lastSavedAt: string | null;
  history: HistoryStore<ProjectDocument>;
  setStorageAdapter(storage: StorageAdapter | null): void;
  createProject(project: ProjectDocument): void;
  loadProject(id: string): Promise<ProjectDocument>;
  saveProject(): Promise<WriteResult | null>;
  applyCommand(command: HistoryCommand<ProjectDocument>): void;
  undo(): void;
  redo(): void;
  markSaved(result: WriteResult): void;
  markSaveError(error: unknown): void;
  reset(): void;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

export function createProjectStore(
  history = createHistoryStore<ProjectDocument>()
): ProjectStore {
  return createStore<ProjectStoreState>((set, get) => ({
    project: null,
    storage: null,
    version: undefined,
    dirty: false,
    status: "idle",
    error: null,
    lastSavedAt: null,
    history,
    setStorageAdapter(storage) {
      set({ storage });
    },
    createProject(project) {
      history.getState().clear();
      set({
        project: cloneProjectDocument(project),
        version: undefined,
        dirty: true,
        status: "idle",
        error: null,
        lastSavedAt: null
      });
    },
    async loadProject(id) {
      const storage = requireStorage(get().storage);
      set({ status: "loading", error: null });

      try {
        const [project, summaries] = await Promise.all([
          storage.readProject(id),
          storage.listProjects()
        ]);
        const summary = summaries.find((candidate) => candidate.id === id);

        history.getState().clear();
        set({
          project: cloneProjectDocument(project),
          version: summary?.version,
          dirty: false,
          status: "idle",
          error: null,
          lastSavedAt: summary?.updatedAt ?? null
        });

        return project;
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error)
        });
        throw error;
      }
    },
    async saveProject() {
      const { project, storage, version } = get();
      if (!project) {
        return null;
      }

      const adapter = requireStorage(storage);
      set({ status: "saving", error: null });

      try {
        const result = await adapter.writeProject(project, version);
        get().markSaved(result);
        return result;
      } catch (error) {
        get().markSaveError(error);
        throw error;
      }
    },
    applyCommand(command) {
      const project = requireProject(get().project);
      const nextProject = history
        .getState()
        .execute(cloneProjectDocument(project), command);

      set({
        project: nextProject,
        dirty: true,
        status: "idle",
        error: null
      });
    },
    undo() {
      const project = get().project;
      if (!project) {
        return;
      }

      const transition = history
        .getState()
        .undo(cloneProjectDocument(project));

      if (transition.command) {
        set({
          project: transition.value,
          dirty: true,
          status: "idle",
          error: null
        });
      }
    },
    redo() {
      const project = get().project;
      if (!project) {
        return;
      }

      const transition = history
        .getState()
        .redo(cloneProjectDocument(project));

      if (transition.command) {
        set({
          project: transition.value,
          dirty: true,
          status: "idle",
          error: null
        });
      }
    },
    markSaved(result) {
      set({
        version: result.version,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: result.updatedAt
      });
    },
    markSaveError(error) {
      set({
        status: "error",
        error: errorMessage(error)
      });
    },
    reset() {
      history.getState().clear();
      set({
        project: null,
        version: undefined,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: null
      });
    }
  }));
}

export const projectStore = createProjectStore();

function requireStorage(storage: StorageAdapter | null): StorageAdapter {
  if (!storage) {
    throw new Error("Storage adapter is not configured");
  }
  return storage;
}

function requireProject(project: ProjectDocument | null): ProjectDocument {
  if (!project) {
    throw new Error("No active project");
  }
  return project;
}

function cloneProjectDocument(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
