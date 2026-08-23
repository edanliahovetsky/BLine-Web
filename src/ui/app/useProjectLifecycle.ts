import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { FieldBackgroundEntry } from "../../core/field/fieldConfig";
import type { Project } from "../../core/model/project";
import { detectEnvironmentCapabilities } from "../../env/capabilities";
import type {
  ProjectIoService,
  ProjectWorkspaceSummary,
} from "../../platform/projectIo";
import { createProjectIoService } from "../../platform/projectIo";
import {
  createBrowserAutosaveRecoveryJournal,
  createProjectRecoveryLifecycle,
  installBrowserProjectUnloadHandler,
  installDurableProjectCloseHandler,
  restoreAutosaveRecoveryJournal,
  type AutosaveRecoveryJournal,
} from "../../platform/projectLifecycle";
import {
  createProjectAutosaveCoordinator,
  type AutosaveCoordinator,
  type AutosaveStatus,
} from "../../state/autosave";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import {
  legacyProjectMigrationOwnsSession,
  projectStore,
} from "../../state/projectStore";
import { flushUserData, initializeUserData } from "../../userData";
import { tourStore } from "../tours/tourStore";

interface UseProjectLifecycleOptions {
  canvasInteractionActive: boolean;
  canvasInteractionActiveRef: RefObject<boolean>;
  dirty: boolean;
  durableProject: Project | null;
  lastSavedAt: string | null;
  isPersistenceBlocked(): boolean;
  prepareClose(): void;
  projectIo: ProjectIoService | null;
  onEditorLayoutLoaded(layout: {
    inspectorTab: "elements" | "constraints";
    inspectorWidth: number;
    showGhostPaths: boolean;
  }): void;
}

export function useProjectLifecycle({
  canvasInteractionActive,
  canvasInteractionActiveRef,
  dirty,
  durableProject,
  lastSavedAt,
  isPersistenceBlocked,
  prepareClose,
  projectIo,
  onEditorLayoutLoaded,
}: UseProjectLifecycleOptions) {
  const [workspaceSummaries, setWorkspaceSummaries] = useState<
    ProjectWorkspaceSummary[]
  >([]);
  const [fieldBackgrounds, setFieldBackgrounds] = useState<
    FieldBackgroundEntry[]
  >([]);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<Error | null>(
    null,
  );
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const recoveryReleaseTimerRef = useRef<number | null>(null);
  const [environmentCapabilities] = useState(detectEnvironmentCapabilities);
  const [autosaveRecoveryJournal] = useState<AutosaveRecoveryJournal | null>(
    () =>
      environmentCapabilities.shell === "browser-web"
        ? createBrowserAutosaveRecoveryJournal()
        : null,
  );
  const [projectRecoveryLifecycle] = useState(() =>
    createProjectRecoveryLifecycle(autosaveRecoveryJournal),
  );
  const applyEditorLayout = useEffectEvent(onEditorLayoutLoaded);
  const prepareProjectClose = useEffectEvent(prepareClose);
  const additionalPersistenceBlocked = useEffectEvent(isPersistenceBlocked);

  const refreshWorkspaceSummaries = useCallback(
    async (service = projectStore.getState().io) => {
      if (!service) {
        setWorkspaceSummaries([]);
        return [];
      }

      const summaries = await service.listWorkspaces();
      setWorkspaceSummaries(summaries);
      return summaries;
    },
    [],
  );

  const cancelAutosave = useCallback(() => {
    autosaveRef.current?.cancel();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const capabilities = environmentCapabilities;
    const service = createProjectIoService(capabilities);

    projectStore.getState().setProjectIoService(service);

    async function initializeProject() {
      setInitializing(true);
      setInitializationError(null);

      try {
        const userData = await initializeUserData(capabilities);
        if (cancelled) {
          return;
        }
        applyEditorLayout({
          inspectorTab: userData.editor_layout.inspector_tab,
          inspectorWidth: userData.editor_layout.inspector_width,
          showGhostPaths: userData.editor_layout.show_ghost_paths,
        });
        autoVelocityStore
          .getState()
          .setAutoSyncEnabled(userData.automatic_generation.keep_in_sync);
        tourStore.getState().hydrateCompleted(userData.completed_tour_ids);
        setFieldBackgrounds(userData.field_backgrounds);
        let recoveryError: unknown;
        if (autosaveRecoveryJournal) {
          try {
            await restoreAutosaveRecoveryJournal(
              service,
              autosaveRecoveryJournal,
            );
            projectRecoveryLifecycle.completeInitialization();
          } catch (error) {
            projectRecoveryLifecycle.markInitializationFailed();
            recoveryError = error;
          }
        } else {
          projectRecoveryLifecycle.completeInitialization();
        }
        await projectStore.getState().initializeWorkspace();
        if (recoveryError) {
          throw recoveryError;
        }
        if (!cancelled) {
          await refreshWorkspaceSummaries(service);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setInitializationError(toError(caughtError));
          projectStore.getState().markSaveError(caughtError);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    void initializeProject();

    return () => {
      cancelled = true;
      autosaveRef.current?.cancel();
    };
  }, [
    autosaveRecoveryJournal,
    environmentCapabilities,
    projectRecoveryLifecycle,
    refreshWorkspaceSummaries,
    initializationAttempt,
  ]);

  useEffect(() => {
    if (!projectIo) {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
      return;
    }

    autosaveRef.current?.cancel();
    autosaveRef.current = createProjectAutosaveCoordinator(projectStore, {
      delayMs: 300,
      onStatusChange: setAutosaveStatus,
      onSaved: () => {
        if (!projectStore.getState().dirty) {
          projectRecoveryLifecycle.clearIfReady();
        }
      },
      onCheckpoint: (snapshot) => {
        if (!projectRecoveryLifecycle.checkpoint(snapshot)) {
          throw new Error("Project recovery checkpoint could not be written");
        }
      },
      shouldDefer: () =>
        legacyProjectMigrationOwnsSession(projectStore.getState()) ||
        projectStore.getState().status === "conflict" ||
        projectStore.getState().status === "damaged",
    });
    const coordinator = autosaveRef.current;

    return () => {
      coordinator.checkpoint();
      coordinator.cancel();
      autosaveRef.current = null;
    };
  }, [projectIo, projectRecoveryLifecycle]);

  useEffect(() => {
    const checkpoint = () => {
      if (additionalPersistenceBlocked()) {
        return false;
      }
      const state = projectStore.getState();
      if (!state.dirty) {
        return true;
      }
      return projectRecoveryLifecycle.checkpoint({
        project: state.project,
        expectedVersion: state.version,
        dirty: state.dirty,
      });
    };

    if (environmentCapabilities.shell === "browser-web") {
      return installBrowserProjectUnloadHandler(window, {
        prepareClose: prepareProjectClose,
        checkpoint,
      });
    }

    let disposed = false;
    let removeCloseListener: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        installDurableProjectCloseHandler(getCurrentWindow(), {
          prepareClose: prepareProjectClose,
          getProjectState: () => {
            const state = projectStore.getState();
            return {
              dirty: state.dirty,
              activeSave: state.activeSave,
              blocked:
                additionalPersistenceBlocked() ||
                state.projectTransitionInProgress ||
                legacyProjectMigrationOwnsSession(state) ||
                state.status === "conflict" ||
                state.status === "damaged",
            };
          },
          flushProject: () => projectStore.getState().saveWorkspace(),
          flushUserData,
          onError: (error) => projectStore.getState().markSaveError(error),
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          removeCloseListener = unlisten;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      removeCloseListener?.();
    };
  }, [environmentCapabilities, projectRecoveryLifecycle]);

  useEffect(() => {
    if (!durableProject || !dirty) {
      if (!dirty) {
        projectRecoveryLifecycle.clearIfReady();
      }
      return;
    }

    if (canvasInteractionActiveRef.current) {
      autosaveRef.current?.cancel();
      return;
    }

    autosaveRef.current?.schedule();
  }, [
    canvasInteractionActive,
    dirty,
    durableProject,
    projectRecoveryLifecycle,
    canvasInteractionActiveRef,
  ]);

  useEffect(() => {
    if (lastSavedAt && projectIo) {
      const refreshTimer = window.setTimeout(() => {
        void refreshWorkspaceSummaries(projectIo);
      }, 0);

      return () => window.clearTimeout(refreshTimer);
    }

    return undefined;
  }, [lastSavedAt, projectIo, refreshWorkspaceSummaries]);

  useEffect(() => {
    if (recoveryReleaseTimerRef.current !== null) {
      window.clearTimeout(recoveryReleaseTimerRef.current);
      recoveryReleaseTimerRef.current = null;
    }
    return () => {
      // React development Strict Mode immediately remounts effects after its
      // cleanup probe. Defer the terminal lease release so that probe can cancel
      // it, while a real in-app unmount still releases the journal promptly.
      recoveryReleaseTimerRef.current = window.setTimeout(() => {
        autosaveRecoveryJournal?.releaseOwnership?.();
        recoveryReleaseTimerRef.current = null;
      }, 0);
    };
  }, [autosaveRecoveryJournal]);

  return {
    autosaveStatus,
    cancelAutosave,
    fieldBackgrounds,
    initializing,
    initializationError,
    projectRecoveryLifecycle,
    refreshWorkspaceSummaries,
    setAutosaveStatus,
    setFieldBackgrounds,
    retryInitialization: () =>
      setInitializationAttempt((attempt) => attempt + 1),
    workspaceSummaries,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
