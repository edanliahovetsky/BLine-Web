import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  FocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { PathStage } from "../../canvas/PathStage";
import {
  elementCircleRadiusMeters,
  robotLengthMeters,
  robotWidthMeters,
  triangleSizeRatio,
} from "../../canvas/constants";
import { elementColors } from "../../canvas/elementStyle";
import type { CurveToolSession } from "../../canvas/curveAuthoring";
import type {
  LinkedTarget,
  LinkedTargetKind,
  ProjectPathGroupDocument,
  ProjectPathDocument,
  ProjectWorkspaceDocument,
} from "../../core/io/projectSchema";
import {
  fieldCoordinateLengthMeters,
  fieldCoordinateOffsetXMeters,
  fieldCoordinateOffsetYMeters,
  fieldCoordinateWidthMeters,
  resolveFieldDefinition,
  type CustomFieldImage,
  type FieldGeometry,
} from "../../core/field/fieldConfig";
import {
  type PathElement,
  type TranslationTarget,
} from "../../core/model/path";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import {
  getPathElementLinkedTargetId,
  isElementCompatibleWithLinkedTarget,
  linkedTargetUseCount,
} from "../../core/linkedTargets";
import { detectEnvironmentCapabilities } from "../../env/capabilities";
import {
  createProjectIoService,
  type ProjectIoCapabilities,
} from "../../platform/projectIo";
import {
  createProjectAutosaveCoordinator,
  type AutosaveCoordinator,
  type AutosaveStatus,
} from "../../state/autosave";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import {
  isEditableShortcutTarget,
  isInteractiveShortcutTarget,
  moveSelectedPathElement,
  removeSelectedPathElement,
  removeSelectedRangedConstraint,
} from "../keyboardShortcuts";
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  LockIcon,
  OpenIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UnlockIcon,
  UploadIcon,
  XIcon,
} from "../icons";
import type { ProjectWorkspaceSummary } from "../../storage";
import { Sidebar } from "../sidebar/Sidebar";
import { createInsertPathElementsCommand } from "../sidebar/sidebarCommands";
import "./AppShell.css";
import { createUpdateProjectConfigCommand } from "./configCommands";
import {
  createBlankCanvasPath,
  createInitialCanvasWorkspace,
  createNewCanvasWorkspace,
} from "./initialProject";
import { ProjectConfigDialog } from "./ProjectConfigDialog";
import { writeProjectFolder } from "./projectFolderExport";

interface LinkedTargetPickerRequest {
  pathId: string;
  elementIndex: number;
  element: PathElement;
}

export function AppShell() {
  const workspace = useStoreSelector(projectStore, (state) => state.workspace);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const projectIo = useStoreSelector(projectStore, (state) => state.io);
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const status = useStoreSelector(projectStore, (state) => state.status);
  const error = useStoreSelector(projectStore, (state) => state.error);
  const currentVersion = useStoreSelector(
    projectStore,
    (state) => state.version,
  );
  const lastSavedAt = useStoreSelector(
    projectStore,
    (state) => state.lastSavedAt,
  );
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex,
  );
  const canUndo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canUndo,
  );
  const canRedo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canRedo,
  );
  const [workspaceSummaries, setWorkspaceSummaries] = useState<
    ProjectWorkspaceSummary[]
  >([]);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showNewPathDialog, setShowNewPathDialog] = useState(false);
  const [newPathGroupContextId, setNewPathGroupContextId] = useState<
    string | null | undefined
  >(undefined);
  const [showDeleteProjectDialog, setShowDeleteProjectDialog] = useState(false);
  const [showDeletePathDialog, setShowDeletePathDialog] = useState(false);
  const [showPathGroupsDialog, setShowPathGroupsDialog] = useState(false);
  const [showLinkedTargetsDialog, setShowLinkedTargetsDialog] = useState(false);
  const [linkedTargetPickerRequest, setLinkedTargetPickerRequest] =
    useState<LinkedTargetPickerRequest | null>(null);
  const [showMobileSupportWarning, setShowMobileSupportWarning] =
    useState(false);
  const [pendingImportMode, setPendingImportMode] =
    useState<ImportMode>("archive");
  const [pendingToolbarAction, setPendingToolbarAction] =
    useState<PendingToolbarAction>(null);
  const [initializing, setInitializing] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [canvasInteractionActive, setCanvasInteractionActive] = useState(false);
  const [curveToolSession, setCurveToolSession] =
    useState<CurveToolSession | null>(null);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const canvasInteractionActiveRef = useRef(false);
  const nextCurveToolSessionIdRef = useRef(1);
  const importHandlingRef = useRef(false);
  const pendingToolbarActionRef = useRef<PendingToolbarAction>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

  const setActiveTopMenu = useCallback((menu: TopMenuId | null) => {
    if (menu) {
      setShowOpenPanel(false);
    }
    setOpenTopMenu(menu);
  }, []);

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

  const attachFolderInput = useCallback((element: HTMLInputElement | null) => {
    folderInputRef.current = element;
    element?.setAttribute("webkitdirectory", "");
    element?.setAttribute("directory", "");
  }, []);

  const handleCanvasInteractionStateChange = useCallback((active: boolean) => {
    canvasInteractionActiveRef.current = active;
    setCanvasInteractionActive(active);
    if (active) {
      autosaveRef.current?.cancel();
    }
  }, []);

  const handleStartCurveTool = useCallback((insertionIndex: number) => {
    setCurveToolSession({
      id: nextCurveToolSessionIdRef.current,
      insertionIndex,
    });
    nextCurveToolSessionIdRef.current += 1;
  }, []);

  const handleCancelCurveTool = useCallback(() => {
    setCurveToolSession(null);
  }, []);

  const handleCommitCurveTool = useCallback(
    (insertionIndex: number, targets: readonly TranslationTarget[]) => {
      const activeProject = projectStore.getState().project;
      if (!activeProject || targets.length === 0) {
        setCurveToolSession(null);
        return;
      }

      projectStore.getState().applyCommand(
        createInsertPathElementsCommand(insertionIndex, targets, {
          applyAutoVelocityToInsertedRange: true,
        }),
      );
      selectionStore
        .getState()
        .selectElement(insertionIndex, projectStore.getState().project);
      setCurveToolSession(null);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const service = createProjectIoService(detectEnvironmentCapabilities());

    projectStore.getState().setProjectIoService(service);

    async function initializeProject() {
      setInitializing(true);

      try {
        await projectStore
          .getState()
          .initializeWorkspace(
            service.capabilities.supportsProjectFolders
              ? undefined
              : createInitialCanvasWorkspace(),
          );
        if (!cancelled) {
          await refreshWorkspaceSummaries(service);
        }
      } catch (caughtError) {
        if (!cancelled) {
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
  }, [refreshWorkspaceSummaries]);

  useEffect(() => {
    const mobileQuery = window.matchMedia(
      "(max-width: 767px), (pointer: coarse) and (max-width: 980px)",
    );

    const syncMobileWarning = () => {
      setShowMobileSupportWarning(
        mobileQuery.matches && !hasDismissedMobileSupportWarning(),
      );
    };

    syncMobileWarning();
    mobileQuery.addEventListener("change", syncMobileWarning);

    return () => {
      mobileQuery.removeEventListener("change", syncMobileWarning);
    };
  }, []);

  useEffect(() => {
    if (!projectIo) {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
      return;
    }

    autosaveRef.current?.cancel();
    autosaveRef.current = createProjectAutosaveCoordinator(
      projectStore,
      projectIo,
      {
        delayMs: 300,
        onStatusChange: setAutosaveStatus,
        shouldDefer: () => canvasInteractionActiveRef.current,
      },
    );

    return () => {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
    };
  }, [projectIo]);

  useEffect(() => {
    if (!workspace || !dirty) {
      return;
    }

    if (canvasInteractionActiveRef.current) {
      autosaveRef.current?.cancel();
      return;
    }

    autosaveRef.current?.schedule();
  }, [canvasInteractionActive, dirty, workspace]);

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
    if (!openTopMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const targetElement = target instanceof Element ? target : null;

      if (
        !toolbarRef.current?.contains(target) &&
        !targetElement?.closest(".top-menu__submenu-panel")
      ) {
        setOpenTopMenu(null);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenTopMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openTopMenu]);

  useEffect(() => {
    if (!showOpenPanel) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!toolbarRef.current?.contains(target)) {
        setShowOpenPanel(false);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowOpenPanel(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showOpenPanel]);

  const handleNewProject = useCallback(async () => {
    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().createWorkspace(createNewCanvasWorkspace());
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      setOpenTopMenu(null);
    }
  }, [refreshWorkspaceSummaries]);

  const handleDismissMobileSupportWarning = useCallback(() => {
    markMobileSupportWarningDismissed();
    setShowMobileSupportWarning(false);
  }, []);

  const handleCreateNewPath = useCallback(async () => {
    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setNewPathGroupContextId(undefined);
    setShowNewPathDialog(true);
  }, []);

  const handleShowPathLibrary = useCallback(() => {
    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setShowPathGroupsDialog(true);
  }, []);

  const handleShowLinkedTargets = useCallback(() => {
    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setLinkedTargetPickerRequest(null);
    setShowLinkedTargetsDialog(true);
  }, []);

  const handleOpenLinkedTargetPicker = useCallback(() => {
    if (!project || selectedElementIndex === null) {
      return;
    }

    const element = project.path.path_elements[selectedElementIndex];
    if (!element) {
      return;
    }

    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setLinkedTargetPickerRequest({
      pathId: project.project_id,
      elementIndex: selectedElementIndex,
      element,
    });
    setShowLinkedTargetsDialog(true);
  }, [project, selectedElementIndex]);

  const closeLinkedTargetsDialog = useCallback(() => {
    setShowLinkedTargetsDialog(false);
    setLinkedTargetPickerRequest(null);
  }, []);

  const handleConfirmCreateNewPath = useCallback(
    ({
      addToCurrentGroup,
      displayName,
    }: {
      addToCurrentGroup: boolean;
      displayName: string;
    }) => {
      const workspaceSnapshot = projectStore.getState().workspace;
      const activeGroupId =
        newPathGroupContextId !== undefined
          ? newPathGroupContextId
          : (workspaceSnapshot?.active_path_group_id ?? null);
      projectStore.getState().createPath({
        displayName,
        fileName: ensureJsonFileName(displayName),
        path: createBlankCanvasPath(),
        addToGroupId: addToCurrentGroup ? activeGroupId : null,
      });
      selectionStore.getState().clearSelection();
      setNewPathGroupContextId(undefined);
      setShowNewPathDialog(false);
    },
    [newPathGroupContextId],
  );

  const handleSaveProject = useCallback(async () => {
    setShowOpenPanel(false);
    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().saveWorkspace();
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    }
  }, [refreshWorkspaceSummaries]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (modifier) {
        if (event.altKey) {
          return;
        }

        if (key === "s") {
          event.preventDefault();
          void handleSaveProject();
          return;
        }

        if (isEditableShortcutTarget(event.target)) {
          return;
        }

        if (key === "z" && event.shiftKey) {
          event.preventDefault();
          projectStore.getState().redo();
          return;
        }

        if (key === "z") {
          event.preventDefault();
          projectStore.getState().undo();
          return;
        }

        if (key === "y") {
          event.preventDefault();
          projectStore.getState().redo();
        }
        return;
      }

      if (
        event.altKey ||
        hasActiveBlockingSurface({
          openTopMenu,
          showConfigDialog,
          showNewPathDialog,
          showDeletePathDialog,
          showDeleteProjectDialog,
          showPathGroupsDialog,
          showLinkedTargetsDialog,
          showMobileSupportWarning,
          showOpenPanel,
        }) ||
        isEditableShortcutTarget(event.target) ||
        (isInteractiveShortcutTarget(event.target) &&
          !isPathElementShortcutTarget(event.target) &&
          !isRangedConstraintShortcutTarget(event.target))
      ) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (removeSelectedRangedConstraint() || removeSelectedPathElement()) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (moveSelectedPathElement(direction)) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    handleSaveProject,
    openTopMenu,
    showConfigDialog,
    showDeletePathDialog,
    showDeleteProjectDialog,
    showPathGroupsDialog,
    showLinkedTargetsDialog,
    showMobileSupportWarning,
    showOpenPanel,
    showNewPathDialog,
  ]);

  const beginToolbarAction = useCallback(
    (action: Exclude<PendingToolbarAction, null>) => {
      if (pendingToolbarActionRef.current) {
        return false;
      }

      pendingToolbarActionRef.current = action;
      setPendingToolbarAction(action);
      setShowOpenPanel(false);
      setOpenTopMenu(null);
      return true;
    },
    [],
  );

  const endToolbarAction = useCallback(
    (action: Exclude<PendingToolbarAction, null>) => {
      if (pendingToolbarActionRef.current === action) {
        pendingToolbarActionRef.current = null;
        setPendingToolbarAction(null);
      }
    },
    [],
  );

  const handleOpenProjectPanel = useCallback(() => {
    void refreshWorkspaceSummaries();
    setShowOpenPanel(true);
    setOpenTopMenu(null);
  }, [refreshWorkspaceSummaries]);

  const handleOpenWorkspaceById = useCallback(
    async (id: string) => {
      autosaveRef.current?.cancel();

      try {
        await projectStore.getState().openWorkspace(id);
        selectionStore.getState().clearSelection();
        setShowOpenPanel(false);
        setOpenTopMenu(null);
        await refreshWorkspaceSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    },
    [refreshWorkspaceSummaries],
  );

  const handleOpenWorkspaceFromMenu = useCallback(
    async (id: string) => {
      setOpenTopMenu(null);
      await handleOpenWorkspaceById(id);
    },
    [handleOpenWorkspaceById],
  );

  const handleOpenWorkspace = useCallback(async () => {
    if (!beginToolbarAction("open")) {
      return;
    }

    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().openWorkspace();
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      endToolbarAction("open");
    }
  }, [beginToolbarAction, endToolbarAction, refreshWorkspaceSummaries]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!beginToolbarAction("open")) {
      return;
    }

    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().createWorkspace(createNewCanvasWorkspace());
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      endToolbarAction("open");
    }
  }, [beginToolbarAction, endToolbarAction, refreshWorkspaceSummaries]);

  const handleShowDeleteProjects = useCallback(() => {
    void refreshWorkspaceSummaries();
    setShowDeleteProjectDialog(true);
    setOpenTopMenu(null);
  }, [refreshWorkspaceSummaries]);

  const handleDeleteProjects = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        setShowDeleteProjectDialog(false);
        return;
      }

      autosaveRef.current?.cancel();

      try {
        const currentProjectId =
          projectStore.getState().workspace?.project_id ?? null;
        const orderedIds = [
          ...ids.filter((id) => id !== currentProjectId),
          ...ids.filter((id) => id === currentProjectId),
        ];

        for (const id of orderedIds) {
          await projectStore.getState().deleteWorkspace(id);
        }

        selectionStore.getState().clearSelection();
        setShowOpenPanel(false);
        setShowDeleteProjectDialog(false);
        await refreshWorkspaceSummaries();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [refreshWorkspaceSummaries],
  );

  const handleSwitchWorkspace = useCallback(
    async (id: string) => {
      autosaveRef.current?.cancel();

      try {
        await projectStore.getState().switchWorkspace(id);
        selectionStore.getState().clearSelection();
        await refreshWorkspaceSummaries();
      } catch {
        // The project store already records the error for the status bar.
      } finally {
        setShowOpenPanel(false);
        setOpenTopMenu(null);
      }
    },
    [refreshWorkspaceSummaries],
  );

  const handleExportProjectArchive = useCallback(async () => {
    if (!beginToolbarAction("export")) {
      return;
    }

    const activeWorkspace = projectStore.getState().workspace;
    if (!activeWorkspace) {
      endToolbarAction("export");
      return;
    }

    try {
      const bundle = await projectStore.getState().exportProjectArchive();
      if (bundle) {
        downloadBlob(
          bundle,
          `${safeDownloadName(activeWorkspace.display_name)}.bline-project.json`,
        );
      }
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      endToolbarAction("export");
    }
  }, [beginToolbarAction, endToolbarAction]);

  const handleExportProjectFolder = useCallback(async () => {
    if (!beginToolbarAction("export")) {
      return;
    }

    try {
      const projectFolder = await projectStore.getState().exportProjectFolder();
      if (projectFolder) {
        await writeProjectFolder(projectFolder);
      }
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        projectStore.getState().markSaveError(caughtError);
      }
    } finally {
      endToolbarAction("export");
    }
  }, [beginToolbarAction, endToolbarAction]);

  const handleExportPath = useCallback(async () => {
    if (!beginToolbarAction("export")) {
      return;
    }

    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      endToolbarAction("export");
      return;
    }

    try {
      const blob = await projectStore.getState().exportPath(activePath.path_id);
      if (blob) {
        await saveBlobAs(blob, activePath.file_name, {
          title: "Export BLine Path",
          useNativeSaveDialog: Boolean(
            projectStore.getState().io?.capabilities.directFileAutosave,
          ),
        });
      }
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        projectStore.getState().markSaveError(caughtError);
      }
    } finally {
      endToolbarAction("export");
    }
  }, [beginToolbarAction, endToolbarAction]);

  const handleExportConfig = useCallback(async () => {
    try {
      const blob = await projectStore.getState().exportConfig();
      if (blob) {
        downloadBlob(blob, "config.json");
      }
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      setOpenTopMenu(null);
    }
  }, []);

  const queueFileImport = useCallback(
    (mode: ImportMode) => {
      if (!beginToolbarAction("import")) {
        return;
      }

      setPendingImportMode(mode);
      const input = fileInputRef.current;
      if (!input) {
        endToolbarAction("import");
        return;
      }

      const clearPendingOnCancel = () => {
        window.setTimeout(() => {
          if (!input.files?.length && !importHandlingRef.current) {
            endToolbarAction("import");
          }
        }, 400);
      };

      window.addEventListener("focus", clearPendingOnCancel, { once: true });
      input.click();
    },
    [beginToolbarAction, endToolbarAction],
  );

  const queueFolderImport = useCallback(() => {
    if (!beginToolbarAction("import")) {
      return;
    }

    const input = folderInputRef.current;
    if (!input) {
      endToolbarAction("import");
      return;
    }

    const clearPendingOnCancel = () => {
      window.setTimeout(() => {
        if (!input.files?.length && !importHandlingRef.current) {
          endToolbarAction("import");
        }
      }, 400);
    };

    window.addEventListener("focus", clearPendingOnCancel, { once: true });
    input.click();
  }, [beginToolbarAction, endToolbarAction]);

  const handleSavePathAs = useCallback(async () => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    const rawName = window.prompt("Save Path As", activePath.display_name);
    const displayName = rawName?.trim();
    if (!displayName) {
      setOpenTopMenu(null);
      return;
    }

    try {
      projectStore.getState().duplicatePath(activePath.path_id, displayName);
      selectionStore.getState().clearSelection();
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      setOpenTopMenu(null);
    }
  }, []);

  const handleRenamePath = useCallback(() => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    const rawName = window.prompt("Rename Path", activePath.display_name);
    const displayName = rawName?.trim();
    if (!displayName) {
      setOpenTopMenu(null);
      return;
    }

    projectStore.getState().renamePath(activePath.path_id, displayName);
    setOpenTopMenu(null);
  }, []);

  const handleShowDeletePaths = useCallback(() => {
    setShowDeletePathDialog(true);
    setOpenTopMenu(null);
  }, []);

  const handleDeletePaths = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setShowDeletePathDialog(false);
      return;
    }

    try {
      projectStore.getState().deletePaths(ids);
      selectionStore.getState().clearSelection();
      setShowDeletePathDialog(false);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
  }, []);

  const handleImportProject = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      importHandlingRef.current = Boolean(file);
      event.currentTarget.value = "";

      if (!file) {
        endToolbarAction("import");
        return;
      }

      if (!projectStore.getState().io) {
        importHandlingRef.current = false;
        endToolbarAction("import");
        return;
      }

      try {
        if (pendingImportMode === "path") {
          await projectStore.getState().importPath(file);
          selectionStore.getState().clearSelection();
          return;
        }

        if (pendingImportMode === "config") {
          await projectStore.getState().importConfig(file);
          return;
        }

        await projectStore.getState().importProjectArchive(file);
        await refreshWorkspaceSummaries();
        selectionStore.getState().clearSelection();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      } finally {
        importHandlingRef.current = false;
        endToolbarAction("import");
      }
    },
    [endToolbarAction, pendingImportMode, refreshWorkspaceSummaries],
  );

  const handleImportProjectFolder = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      importHandlingRef.current = files.length > 0;
      event.currentTarget.value = "";

      if (files.length === 0 || !projectStore.getState().io) {
        importHandlingRef.current = false;
        endToolbarAction("import");
        return;
      }

      try {
        await projectStore.getState().importProjectFolder(files);
        await refreshWorkspaceSummaries();
        selectionStore.getState().clearSelection();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      } finally {
        importHandlingRef.current = false;
        endToolbarAction("import");
      }
    },
    [endToolbarAction, refreshWorkspaceSummaries],
  );

  const handleSaveConfig = useCallback(
    (nextConfig: NonNullable<typeof project>["config"]) => {
      const activeProject = projectStore.getState().project;
      if (!activeProject) {
        return;
      }

      projectStore
        .getState()
        .applyCommand(
          createUpdateProjectConfigCommand(activeProject.config, nextConfig),
        );
      setShowConfigDialog(false);
    },
    [],
  );

  const handleUploadFieldImage = useCallback(
    (file: File, geometry: FieldGeometry) =>
      projectStore.getState().writeFieldImageAsset({ file, geometry }),
    [],
  );

  const handleLoadFieldImage = useCallback(
    (field: CustomFieldImage) =>
      projectStore.getState().readFieldImageAsset(field),
    [],
  );

  const selectedElement =
    project && selectedElementIndex !== null
      ? project.path.path_elements[selectedElementIndex]
      : null;
  const selectedPosition =
    project && selectedElementIndex !== null
      ? getElementPosition(project.path.path_elements, selectedElementIndex)
      : null;
  const selectedSummary =
    selectedElement && selectedElementIndex !== null
      ? `Selected: ${getElementLabel(selectedElement)} #${selectedElementIndex + 1} ${formatPointMeters(selectedPosition)}`
      : "Selected: none";
  const ioCapabilities = projectIo?.capabilities;
  const supportsProjectFolders = Boolean(
    ioCapabilities?.supportsProjectFolders,
  );
  const activePath = activePathDocument(workspace);
  const pathDocuments = workspace?.paths ?? [];
  const activePathGroup =
    workspace?.path_groups.find(
      (group) => group.group_id === workspace.active_path_group_id,
    ) ?? null;
  const visiblePathDocuments = activePathGroup
    ? activePathGroup.path_ids.flatMap((pathId) => {
        const path = pathDocuments.find(
          (candidate) => candidate.path_id === pathId,
        );
        return path ? [path] : [];
      })
    : pathDocuments;
  const projectSummaries = ensureCurrentWorkspaceSummary(
    workspaceSummaries,
    workspace,
    currentVersion,
    lastSavedAt,
  );
  const toolbarBusy = pendingToolbarAction !== null;
  const projectLabel = workspace?.display_name ?? "No project";
  const pathLabel = activePath?.display_name ?? "No path";
  const currentProjectSummary = `Project: ${projectLabel}`;
  const currentPathSummary = activePathGroup
    ? `Current Path: ${activePathGroup.display_name} / ${pathLabel}`
    : `Current Path: ${pathLabel}`;
  const storageLabel = formatStorageLabel(workspace, ioCapabilities);
  const saveStatus = formatSaveStatus({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    status,
  });
  const saveStatusTone = getSaveStatusTone({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    status,
  });
  const handleSelectPathFromToolbar = (pathId: string) => {
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  };
  const handleSelectCollectionFromToolbar = (groupId: string | null) => {
    projectStore.getState().setActivePathGroup(groupId);
    selectionStore.getState().clearSelection();
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="app-toolbar" ref={toolbarRef}>
        <nav className="app-tabs" aria-label="Top menu">
          <TopMenuButton
            id="project"
            label="Project"
            openTopMenu={openTopMenu}
            setOpenTopMenu={setActiveTopMenu}
            onBeforeOpen={refreshWorkspaceSummaries}
          >
            {supportsProjectFolders ? (
              <>
                <MenuSubmenu label="Folder" testId="top-menu-project-folder">
                  <MenuAction
                    label="Open Project Folder..."
                    disabled={!projectIo}
                    onAction={() => void handleOpenWorkspace()}
                  />
                  <MenuAction
                    label="Create Project Folder..."
                    disabled={!projectIo}
                    onAction={() => void handleCreateWorkspace()}
                  />
                </MenuSubmenu>
              </>
            ) : (
              <>
                <MenuSubmenu
                  label="Workspace"
                  testId="top-menu-project-workspace"
                >
                  <MenuAction
                    label="New Project"
                    disabled={!projectIo}
                    onAction={() => void handleNewProject()}
                  />
                  <MenuAction
                    label="Open Project..."
                    disabled={!projectIo}
                    onAction={handleOpenProjectPanel}
                  />
                  <MenuAction
                    label="Delete Projects..."
                    disabled={!workspace || !projectIo}
                    onAction={handleShowDeleteProjects}
                  />
                </MenuSubmenu>
              </>
            )}
            <MenuSubmenu
              label="Import / Export"
              testId="top-menu-project-transfer"
            >
              {!supportsProjectFolders ? (
                <>
                  <MenuAction
                    label="Import Autos Folder..."
                    disabled={!projectIo}
                    onAction={queueFolderImport}
                  />
                  <MenuAction
                    label="Export Autos Folder..."
                    disabled={!workspace || !projectIo}
                    onAction={() => void handleExportProjectFolder()}
                  />
                  <div className="top-menu__separator" role="separator" />
                </>
              ) : null}
              <MenuAction
                label="Import Project Archive..."
                disabled={!projectIo}
                onAction={() => queueFileImport("archive")}
              />
              <MenuAction
                label="Export Project Archive..."
                disabled={!workspace || !projectIo}
                onAction={() => {
                  setOpenTopMenu(null);
                  void handleExportProjectArchive();
                }}
              />
            </MenuSubmenu>
            <MenuSubmenu label="Config" testId="top-menu-project-config">
              <MenuAction
                label="Import Config..."
                disabled={!workspace || !projectIo}
                onAction={() => queueFileImport("config")}
              />
              <MenuAction
                label="Export Config..."
                disabled={!workspace || !projectIo}
                onAction={() => void handleExportConfig()}
              />
            </MenuSubmenu>
            <MenuSubmenu
              label={
                supportsProjectFolders
                  ? "Recent Project Folders"
                  : "Recent Projects"
              }
              testId="top-menu-project-recent"
            >
              <WorkspaceMenuList
                emptyLabel={
                  supportsProjectFolders
                    ? "(No recent folders)"
                    : "(No saved projects)"
                }
                workspaces={projectSummaries}
                onOpen={
                  supportsProjectFolders
                    ? handleSwitchWorkspace
                    : handleOpenWorkspaceFromMenu
                }
              />
            </MenuSubmenu>
          </TopMenuButton>
          <TopMenuButton
            id="path"
            label="Path"
            active
            openTopMenu={openTopMenu}
            setOpenTopMenu={setActiveTopMenu}
          >
            <MenuLabel>Current: {pathLabel}</MenuLabel>
            <MenuLabel>
              Collection: {activePathGroup?.display_name ?? "All Paths"}
            </MenuLabel>
            <div className="top-menu__separator" role="separator" />
            <MenuAction
              label="Path Library..."
              disabled={!workspace}
              onAction={handleShowPathLibrary}
            />
            <MenuAction
              label="Linked Points..."
              disabled={!workspace}
              onAction={handleShowLinkedTargets}
            />
            <MenuSubmenu label="Manage Paths" testId="top-menu-path-manage">
              <MenuAction
                label="Create New Path"
                disabled={!workspace || !projectIo}
                onAction={() => void handleCreateNewPath()}
              />
              <MenuAction
                label="Save Path As..."
                disabled={!activePath || !projectIo}
                onAction={() => void handleSavePathAs()}
              />
              <MenuAction
                label="Rename Path..."
                disabled={!activePath}
                onAction={handleRenamePath}
              />
              <MenuAction
                label="Delete Paths..."
                disabled={!workspace || pathDocuments.length === 0}
                onAction={handleShowDeletePaths}
              />
            </MenuSubmenu>
            <MenuSubmenu
              label="Import / Export"
              testId="top-menu-path-transfer"
            >
              <MenuAction
                label="Import Path..."
                disabled={!workspace || !projectIo}
                onAction={() => queueFileImport("path")}
              />
              <MenuAction
                label="Export Path..."
                disabled={!activePath || !projectIo}
                onAction={() => void handleExportPath()}
              />
            </MenuSubmenu>
          </TopMenuButton>
          <TopMenuButton
            id="edit"
            label="Edit"
            openTopMenu={openTopMenu}
            setOpenTopMenu={setActiveTopMenu}
          >
            <MenuAction
              label={canUndo ? "Undo" : "Undo"}
              shortcut="Ctrl+Z"
              disabled={!canUndo}
              onAction={() => {
                projectStore.getState().undo();
                setOpenTopMenu(null);
              }}
            />
            <MenuAction
              label="Redo"
              shortcut="Ctrl+Y"
              disabled={!canRedo}
              onAction={() => {
                projectStore.getState().redo();
                setOpenTopMenu(null);
              }}
            />
          </TopMenuButton>
          <button
            type="button"
            className="app-tab-button"
            aria-expanded={showConfigDialog}
            onClick={() => {
              setShowOpenPanel(false);
              setOpenTopMenu(null);
              setShowConfigDialog(true);
            }}
            disabled={!project}
          >
            Settings
          </button>
        </nav>
        <nav className="toolbar-actions" aria-label="Project actions">
          <div className="toolbar-actions__quick">
            <ToolbarPathNavigator
              workspace={workspace}
              activeGroup={activePathGroup}
              activePath={activePath}
              paths={pathDocuments}
              visiblePaths={visiblePathDocuments}
              onOpenLibrary={handleShowPathLibrary}
              onSelectGroup={handleSelectCollectionFromToolbar}
              onSelectPath={handleSelectPathFromToolbar}
            />
          </div>
          <div className="toolbar-actions__overflow">
            <TopMenuButton
              id="actions"
              label="Actions"
              align="end"
              openTopMenu={openTopMenu}
              setOpenTopMenu={setActiveTopMenu}
              onBeforeOpen={refreshWorkspaceSummaries}
            >
              <MenuAction
                label="Undo"
                shortcut="Ctrl+Z"
                disabled={!canUndo || toolbarBusy}
                onAction={() => {
                  setShowOpenPanel(false);
                  projectStore.getState().undo();
                  setOpenTopMenu(null);
                }}
              />
              <MenuAction
                label="Redo"
                shortcut="Ctrl+Y"
                disabled={!canRedo || toolbarBusy}
                onAction={() => {
                  setShowOpenPanel(false);
                  projectStore.getState().redo();
                  setOpenTopMenu(null);
                }}
              />
              <div className="top-menu__separator" role="separator" />
              {supportsProjectFolders ? (
                <MenuAction
                  label="New Path"
                  disabled={!projectIo || toolbarBusy}
                  onAction={() => {
                    void handleCreateNewPath();
                    setOpenTopMenu(null);
                  }}
                />
              ) : null}
              <MenuAction
                label={supportsProjectFolders ? "Open Folder..." : "Open..."}
                disabled={!projectIo || toolbarBusy}
                onAction={() => {
                  if (supportsProjectFolders) {
                    void handleOpenWorkspace();
                  } else {
                    handleOpenProjectPanel();
                  }
                }}
              />
              <MenuSubmenu label="Import" testId="top-menu-actions-import">
                <MenuAction
                  label="Import Project Folder..."
                  disabled={!projectIo || toolbarBusy}
                  onAction={queueFolderImport}
                />
                <MenuAction
                  label="Import Path..."
                  disabled={!workspace || !projectIo || toolbarBusy}
                  onAction={() => queueFileImport("path")}
                />
                <MenuAction
                  label="Import Project Archive..."
                  disabled={!projectIo || toolbarBusy}
                  onAction={() => queueFileImport("archive")}
                />
              </MenuSubmenu>
              <MenuAction
                label="Export Path..."
                disabled={!activePath || !projectIo || toolbarBusy}
                onAction={() => {
                  setOpenTopMenu(null);
                  void handleExportPath();
                }}
              />
              <div className="top-menu__separator" role="separator" />
              <MenuAction
                label="Path Library..."
                disabled={!workspace}
                onAction={handleShowPathLibrary}
              />
              <div className="top-menu__separator" role="separator" />
              <MenuAction
                label="Save"
                disabled={
                  !workspace || !projectIo || status === "saving" || toolbarBusy
                }
                onAction={() => {
                  setOpenTopMenu(null);
                  void handleSaveProject();
                }}
              />
            </TopMenuButton>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={handleSaveProject}
            disabled={
              !workspace || !projectIo || status === "saving" || toolbarBusy
            }
          >
            Save
          </button>
          <input
            ref={fileInputRef}
            className="file-import-input"
            aria-label="Import BLine JSON"
            type="file"
            accept="application/json,.json,.bline-project,.bline-project.json"
            onChange={handleImportProject}
          />
          <input
            ref={attachFolderInput}
            className="file-import-input"
            aria-label="Import autos folder"
            type="file"
            accept="application/json,.json"
            multiple
            onChange={handleImportProjectFolder}
          />
          {showOpenPanel ? (
            <div
              className="project-open-panel"
              data-testid="open-project-panel"
            >
              <strong>Saved Workspaces</strong>
              <div className="project-open-panel__list">
                {projectSummaries.map((summary) => (
                  <button
                    key={summary.id}
                    type="button"
                    onClick={() => void handleOpenWorkspaceById(summary.id)}
                  >
                    <span>{summary.displayName}</span>
                    <small>{formatTimestamp(summary.updatedAt)}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </nav>
      </header>

      <div className="workspace">
        <section className="canvas-region" aria-label="Editor canvas">
          <PathStage
            curveTool={curveToolSession}
            onInteractionStateChange={handleCanvasInteractionStateChange}
            onCurveToolCommit={handleCommitCurveTool}
            onCurveToolCancel={handleCancelCurveTool}
          />
        </section>

        <Sidebar
          project={project}
          workspace={workspace}
          selectedElementIndex={selectedElementIndex}
          curveToolActive={curveToolSession !== null}
          onStartCurve={handleStartCurveTool}
          onOpenLinkedTargetPicker={handleOpenLinkedTargetPicker}
        />
      </div>

      <footer className="status-bar" aria-label="Workspace status">
        <div className="status-bar__context">
          <span
            className="status-bar__item status-bar__item--path"
            data-testid="current-path-status"
            title={currentPathSummary}
          >
            <span className="status-bar__marker" aria-hidden="true" />
            <span className="status-bar__text">{currentPathSummary}</span>
          </span>
          <span
            className="status-bar__item status-bar__item--project"
            data-testid="current-project-status"
            title={currentProjectSummary}
          >
            <span className="status-bar__marker" aria-hidden="true" />
            <span className="status-bar__text">{currentProjectSummary}</span>
          </span>
          <span
            className="status-bar__item status-bar__item--selection"
            data-testid="selected-element-status"
            title={selectedSummary}
          >
            <span className="status-bar__marker" aria-hidden="true" />
            <span className="status-bar__text">{selectedSummary}</span>
          </span>
        </div>
        <div className="status-bar__system">
          <span
            className="status-bar__item status-bar__item--storage"
            data-testid="storage-status"
            title={storageLabel}
          >
            <span className="status-bar__marker" aria-hidden="true" />
            <span className="status-bar__text">{storageLabel}</span>
          </span>
          <span
            className={`status-bar__item status-bar__item--save status-bar__save--${saveStatusTone}`}
            data-testid="save-status"
            title={saveStatus}
          >
            <span className="status-bar__marker" aria-hidden="true" />
            <span className="status-bar__text">{saveStatus}</span>
          </span>
        </div>
      </footer>

      {project && showConfigDialog ? (
        <ProjectConfigDialog
          config={project.config}
          onCancel={() => setShowConfigDialog(false)}
          onSave={handleSaveConfig}
          onUploadFieldImage={handleUploadFieldImage}
          onLoadFieldImage={handleLoadFieldImage}
        />
      ) : null}
      {showDeleteProjectDialog ? (
        <DeleteProjectsDialog
          activeWorkspaceId={workspace?.project_id ?? null}
          workspaces={projectSummaries}
          onCancel={() => setShowDeleteProjectDialog(false)}
          onDelete={(ids) => void handleDeleteProjects(ids)}
        />
      ) : null}
      {workspace && showPathGroupsDialog ? (
        <PathLibraryDialog
          workspace={workspace}
          onCancel={() => setShowPathGroupsDialog(false)}
          onCreatePath={(groupId) => {
            setShowOpenPanel(false);
            setOpenTopMenu(null);
            setNewPathGroupContextId(groupId);
            setShowNewPathDialog(true);
          }}
          onDeletePaths={() => {
            handleShowDeletePaths();
          }}
          onExportPath={() => void handleExportPath()}
          onImportPath={() => queueFileImport("path")}
        />
      ) : null}
      {workspace && showLinkedTargetsDialog ? (
        <LinkedTargetsDialog
          linkRequest={linkedTargetPickerRequest}
          workspace={workspace}
          onCancel={closeLinkedTargetsDialog}
        />
      ) : null}
      {workspace && showNewPathDialog ? (
        <NewPathDialog
          activeGroup={
            workspace.path_groups.find(
              (group) =>
                group.group_id ===
                (newPathGroupContextId !== undefined
                  ? newPathGroupContextId
                  : workspace.active_path_group_id),
            ) ?? null
          }
          onCancel={() => {
            setNewPathGroupContextId(undefined);
            setShowNewPathDialog(false);
          }}
          onCreate={handleConfirmCreateNewPath}
        />
      ) : null}
      {showDeletePathDialog ? (
        <DeletePathsDialog
          activePathId={workspace?.active_path_id ?? null}
          paths={pathDocuments}
          onCancel={() => setShowDeletePathDialog(false)}
          onDelete={(ids) => void handleDeletePaths(ids)}
        />
      ) : null}
      {showMobileSupportWarning ? (
        <MobileSupportWarningDialog
          onDismiss={handleDismissMobileSupportWarning}
        />
      ) : null}
    </main>
  );
}

type TopMenuId = "project" | "path" | "edit" | "actions";
type ImportMode = "archive" | "path" | "config";
type PendingToolbarAction = "open" | "import" | "export" | null;

const MOBILE_SUPPORT_WARNING_DISMISSED_KEY =
  "bline-web:mobile-support-warning-dismissed";

interface TopMenuSubmenuContextValue {
  activeSubmenuId: string | null;
  closeDelayMs: number;
  setActiveSubmenuId(id: string | null): void;
}

const TopMenuSubmenuContext = createContext<TopMenuSubmenuContextValue | null>(
  null,
);

function hasDismissedMobileSupportWarning(): boolean {
  try {
    return (
      window.sessionStorage.getItem(MOBILE_SUPPORT_WARNING_DISMISSED_KEY) ===
      "true"
    );
  } catch {
    return false;
  }
}

function markMobileSupportWarningDismissed() {
  try {
    window.sessionStorage.setItem(MOBILE_SUPPORT_WARNING_DISMISSED_KEY, "true");
  } catch {
    // Dismiss the dialog for this render even if private storage is unavailable.
  }
}

function MobileSupportWarningDialog({ onDismiss }: { onDismiss(): void }) {
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    dismissButtonRef.current?.focus();

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onDismiss]);

  return (
    <div
      className="config-dialog-backdrop mobile-warning-backdrop"
      role="presentation"
    >
      <section
        className="mobile-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-warning-title"
        aria-describedby="mobile-warning-description"
        data-testid="mobile-support-warning"
      >
        <header className="mobile-warning-dialog__header">
          <span className="mobile-warning-dialog__icon" aria-hidden="true">
            !
          </span>
          <h2 id="mobile-warning-title">Mobile support warning</h2>
        </header>
        <p id="mobile-warning-description">
          Mobile support is very limited and may be buggy. For full path
          editing, use BLine Web on a desktop or laptop browser.
        </p>
        <footer className="mobile-warning-dialog__footer">
          <button
            ref={dismissButtonRef}
            type="button"
            className="mobile-warning-dialog__action"
            onClick={onDismiss}
          >
            Continue
          </button>
        </footer>
      </section>
    </div>
  );
}

function ToolbarPathNavigator({
  workspace,
  activeGroup,
  activePath,
  paths,
  visiblePaths,
  onOpenLibrary,
  onSelectGroup,
  onSelectPath,
}: {
  workspace: ProjectWorkspaceDocument | null;
  activeGroup: ProjectPathGroupDocument | null;
  activePath: ProjectPathDocument | null;
  paths: ProjectPathDocument[];
  visiblePaths: ProjectPathDocument[];
  onOpenLibrary(): void;
  onSelectGroup(groupId: string | null): void;
  onSelectPath(pathId: string): void;
}) {
  const collectionValue = activeGroup?.group_id ?? "__all_paths__";
  const collectionLabel = activeGroup?.display_name ?? "All Paths";
  const collectionOptions = [
    { label: "All Paths", value: "__all_paths__" },
    ...(workspace?.path_groups.map((group) => ({
      label: group.display_name,
      value: group.group_id,
    })) ?? []),
  ];
  const pathOptions =
    visiblePaths.length > 0
      ? visiblePaths.map((path) => ({
          label: path.display_name,
          value: path.path_id,
        }))
      : [{ label: "No paths", value: "__no_path__" }];
  const pathValue = activePath?.path_id ?? "__no_path__";
  const pathLabel = activePath?.display_name ?? "No paths";

  return (
    <div className="path-toolbar-navigator" data-testid="path-toolbar-nav">
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--collection"
        style={toolbarSelectWidthStyle(collectionLabel, 14, 26)}
      >
        <span className="path-toolbar-navigator__label">Collection</span>
        <ToolbarSelectControl
          ariaLabel="Toolbar collection"
          value={collectionValue}
          disabled={!workspace}
          options={collectionOptions}
          onChange={(value) =>
            onSelectGroup(value === "__all_paths__" ? null : value)
          }
        />
      </div>
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--path"
        style={toolbarSelectWidthStyle(pathLabel, 15, 34)}
      >
        <span className="path-toolbar-navigator__label">Path</span>
        <ToolbarSelectControl
          ariaLabel="Toolbar path"
          value={pathValue}
          disabled={visiblePaths.length === 0}
          options={pathOptions}
          onChange={(value) => {
            if (value !== "__no_path__") {
              onSelectPath(value);
            }
          }}
        />
      </div>
      <button
        type="button"
        className="path-toolbar-navigator__library"
        onClick={onOpenLibrary}
        disabled={!workspace}
      >
        Path Library
      </button>
      <span className="path-toolbar-navigator__count">
        {activeGroup
          ? `${visiblePaths.length} visible`
          : `${paths.length} total`}
      </span>
    </div>
  );
}

interface ToolbarSelectOption<T extends string> {
  label: string;
  value: T;
}

function ToolbarSelectControl<T extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange(value: T): void;
  options: readonly ToolbarSelectOption<T>[];
  value: T;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectRelativeOption = (direction: 1 | -1) => {
    if (options.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const nextIndex =
      (currentIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];
    if (nextOption) {
      onChange(nextOption.value);
    }
  };

  return (
    <div
      className={`toolbar-select-control${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="toolbar-select-control__button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            selectRelativeOption(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <span className="toolbar-select-control__value">
          {selectedOption?.label ?? ""}
        </span>
        <span className="toolbar-select-control__indicator" aria-hidden="true">
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {open ? (
        <div
          className="toolbar-select-control__menu"
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} options`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={[
                "toolbar-select-control__option",
                option.value === value ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toolbarSelectWidthStyle(label: string, minCh: number, maxCh: number) {
  const widthCh = Math.max(minCh, Math.min(maxCh, label.length + 7));

  return {
    "--path-toolbar-field-width": `${widthCh}ch`,
  } as CSSProperties;
}

function NewPathDialog({
  activeGroup,
  onCancel,
  onCreate,
}: {
  activeGroup: ProjectPathGroupDocument | null;
  onCancel(): void;
  onCreate(input: { displayName: string; addToCurrentGroup: boolean }): void;
}) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("new_path");
  const [addToCurrentGroup, setAddToCurrentGroup] = useState(
    Boolean(activeGroup),
  );

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="new-path-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create New Path"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            displayName: displayName.trim() || "Untitled Path",
            addToCurrentGroup: Boolean(activeGroup) && addToCurrentGroup,
          });
        }}
      >
        <header className="config-dialog__header">
          <strong>Create New Path</strong>
          <button type="button" aria-label="Close new path" onClick={onCancel}>
            x
          </button>
        </header>
        <section className="new-path-dialog__body">
          <label className="dialog-field">
            <span>Path name</span>
            <input
              ref={nameInputRef}
              aria-label="Path name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          {activeGroup ? (
            <label className="dialog-checkbox-row">
              <input
                aria-label={`Add to ${activeGroup.display_name}`}
                type="checkbox"
                checked={addToCurrentGroup}
                onChange={(event) =>
                  setAddToCurrentGroup(event.currentTarget.checked)
                }
              />
              <span>Add to {activeGroup.display_name}</span>
            </label>
          ) : null}
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-dialog-action">
            Create Path
          </button>
        </footer>
      </form>
    </div>
  );
}

function PathLibraryDialog({
  workspace,
  onCancel,
  onCreatePath,
  onDeletePaths,
  onExportPath,
  onImportPath,
}: {
  workspace: ProjectWorkspaceDocument;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(): void;
  onExportPath(): void;
  onImportPath(): void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    workspace.active_path_group_id ?? null,
  );
  const [selectedPathId, setSelectedPathId] = useState<string | null>(
    workspace.active_path_id ?? workspace.paths[0]?.path_id ?? null,
  );
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] =
    useState(false);
  const [deletingGroup, setDeletingGroup] =
    useState<ProjectPathGroupDocument | null>(null);
  const selectedGroup =
    workspace.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const selectedCollectionPaths = visiblePathsForGroup(
    workspace.paths,
    selectedGroup,
  );
  const selectedPathFromState =
    workspace.paths.find((path) => path.path_id === selectedPathId) ?? null;
  const selectedPath =
    selectedPathFromState &&
    selectedCollectionPaths.some(
      (path) => path.path_id === selectedPathFromState.path_id,
    )
      ? selectedPathFromState
      : (selectedCollectionPaths.find(
          (path) => path.path_id === workspace.active_path_id,
        ) ??
        selectedCollectionPaths[0] ??
        null);
  const effectiveSelectedPathId = selectedPath?.path_id ?? null;
  const handleSelectLibraryGroup = (groupId: string | null) => {
    const nextGroup =
      workspace.path_groups.find((group) => group.group_id === groupId) ?? null;
    const nextPaths = visiblePathsForGroup(workspace.paths, nextGroup);

    setSelectedGroupId(groupId);
    setSelectedPathId((current) =>
      current && nextPaths.some((path) => path.path_id === current)
        ? current
        : (nextPaths[0]?.path_id ?? null),
    );
  };

  const handleUsePath = (pathId: string) => {
    projectStore.getState().setActivePathGroup(selectedGroup?.group_id ?? null);
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  };

  const handleCreateGroup = (displayName: string) => {
    const pathId = effectiveSelectedPathId;

    projectStore.getState().createPathGroup({
      displayName,
      activePathId: pathId,
      pathIds: pathId ? [pathId] : [],
      makeActive: true,
    });

    const createdGroupId =
      projectStore.getState().workspace?.active_path_group_id ?? null;
    selectionStore.getState().clearSelection();
    setSelectedGroupId(createdGroupId);
    setSelectedPathId(pathId);
    setShowCreateCollectionDialog(false);
  };

  const handleRenameGroup = () => {
    if (!selectedGroup) {
      return;
    }

    const rawName = window.prompt(
      "Rename Collection",
      selectedGroup.display_name,
    );
    const displayName = rawName?.trim();
    if (!displayName) {
      return;
    }

    projectStore
      .getState()
      .renamePathGroup(selectedGroup.group_id, displayName);
  };

  const handleToggleSelectedPathMembership = (
    groupId: string,
    checked: boolean,
  ) => {
    if (!selectedPath) {
      return;
    }

    if (checked) {
      projectStore.getState().addPathsToGroup(groupId, [selectedPath.path_id]);
    } else {
      projectStore
        .getState()
        .removePathsFromGroup(groupId, [selectedPath.path_id]);
    }
    selectionStore.getState().clearSelection();
  };

  const handleCreatePathInSelectedCollection = () => {
    selectionStore.getState().clearSelection();
    onCreatePath(selectedGroup?.group_id ?? null);
  };

  const handleDuplicateSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    const rawName = window.prompt("Save Path As", selectedPath.display_name);
    const displayName = rawName?.trim();
    if (!displayName) {
      return;
    }

    try {
      projectStore.getState().duplicatePath(selectedPath.path_id, displayName, {
        addToGroupId: selectedGroup?.group_id ?? null,
      });
      const nextPathId =
        projectStore.getState().workspace?.active_path_id ?? null;
      selectionStore.getState().clearSelection();
      setSelectedPathId(nextPathId);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
  };

  const handleRenameSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    const rawName = window.prompt("Rename Path", selectedPath.display_name);
    const displayName = rawName?.trim();
    if (!displayName) {
      return;
    }

    projectStore.getState().renamePath(selectedPath.path_id, displayName);
    setSelectedPathId(selectedPath.path_id);
  };

  const handleExportSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    projectStore.getState().setActivePath(selectedPath.path_id);
    selectionStore.getState().clearSelection();
    onExportPath();
  };

  const handleDeleteSelectedPath = () => {
    selectionStore.getState().clearSelection();
    onDeletePaths();
  };

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <section
        className="path-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Path Library"
        data-testid="path-library-dialog"
      >
        <header className="config-dialog__header">
          <strong>Path Library</strong>
          <button
            type="button"
            aria-label="Close path library"
            onClick={onCancel}
          >
            x
          </button>
        </header>

        <div className="path-library-dialog__utility-bar">
          <div className="path-library-dialog__selection-summary">
            <strong>{selectedGroup?.display_name ?? "All Paths"}</strong>
            <span>
              {selectedCollectionPaths.length}{" "}
              {selectedCollectionPaths.length === 1 ? "path" : "paths"} visible
            </span>
          </div>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            onClick={onImportPath}
          >
            <UploadIcon size={17} />
            <span>Import Path</span>
          </button>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            disabled={!selectedPath}
            onClick={handleExportSelectedPath}
          >
            <DownloadIcon size={17} />
            <span>Export Path</span>
          </button>
        </div>

        <div className="path-library-dialog__body">
          <aside
            className="path-library-dialog__groups"
            aria-label="Collections"
          >
            <div className="path-library-dialog__column-header path-library-dialog__column-header--action">
              <strong>Collections</strong>
              <div className="path-library-dialog__header-actions">
                <PathLibraryHeaderButton
                  label="Create collection"
                  onClick={() => setShowCreateCollectionDialog(true)}
                >
                  <PlusIcon size={17} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Rename collection"
                  disabled={!selectedGroup}
                  onClick={handleRenameGroup}
                >
                  <PencilIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Delete collection"
                  tone="danger"
                  disabled={!selectedGroup}
                  onClick={() => {
                    if (selectedGroup) {
                      setDeletingGroup(selectedGroup);
                    }
                  }}
                >
                  <TrashIcon size={16} />
                </PathLibraryHeaderButton>
              </div>
            </div>
            <div className="path-library-dialog__group-list" role="list">
              <button
                type="button"
                className={[
                  "path-library-dialog__group",
                  "is-permanent",
                  !selectedGroup ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="listitem"
                aria-pressed={!selectedGroup}
                onClick={() => handleSelectLibraryGroup(null)}
              >
                <span>All Paths</span>
                <small>
                  Permanent collection / {workspace.paths.length} paths
                </small>
              </button>
              {workspace.path_groups.map((group) => (
                <button
                  key={group.group_id}
                  type="button"
                  className={
                    selectedGroup?.group_id === group.group_id
                      ? "path-library-dialog__group is-selected"
                      : "path-library-dialog__group"
                  }
                  role="listitem"
                  aria-pressed={selectedGroup?.group_id === group.group_id}
                  onClick={() => handleSelectLibraryGroup(group.group_id)}
                >
                  <span>{group.display_name}</span>
                  <small>
                    {group.path_ids.length}{" "}
                    {group.path_ids.length === 1 ? "path" : "paths"}
                    {workspace.active_path_group_id === group.group_id
                      ? " / active"
                      : ""}
                  </small>
                </button>
              ))}
            </div>
          </aside>

          <section
            className="path-library-dialog__paths"
            aria-label="Paths in selected collection"
          >
            <div className="path-library-dialog__column-header path-library-dialog__column-header--action">
              <strong>Paths</strong>
              <div className="path-library-dialog__header-actions">
                <PathLibraryHeaderButton
                  label="Open path"
                  disabled={!selectedPath}
                  onClick={() => {
                    if (selectedPath) {
                      handleUsePath(selectedPath.path_id);
                    }
                  }}
                >
                  <OpenIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Save path as"
                  disabled={!selectedPath}
                  onClick={handleDuplicateSelectedPath}
                >
                  <CopyIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Create new path"
                  onClick={handleCreatePathInSelectedCollection}
                >
                  <FilePlusIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Rename path"
                  disabled={!selectedPath}
                  onClick={handleRenameSelectedPath}
                >
                  <PencilIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Delete path"
                  tone="danger"
                  disabled={!selectedPath}
                  onClick={handleDeleteSelectedPath}
                >
                  <TrashIcon size={16} />
                </PathLibraryHeaderButton>
              </div>
            </div>
            <div className="path-library-dialog__path-list" role="list">
              {selectedCollectionPaths.length > 0 ? (
                selectedCollectionPaths.map((path) => (
                  <button
                    key={path.path_id}
                    type="button"
                    role="listitem"
                    className={[
                      "path-library-dialog__path",
                      path.path_id === effectiveSelectedPathId
                        ? "is-selected"
                        : "",
                      path.path_id === workspace.active_path_id
                        ? "is-current"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={path.path_id === effectiveSelectedPathId}
                    onClick={() => setSelectedPathId(path.path_id)}
                    onDoubleClick={() => handleUsePath(path.path_id)}
                  >
                    <span>{path.display_name}</span>
                    <small>
                      {path.file_name}
                      {path.path_id === workspace.active_path_id
                        ? " / open"
                        : ""}
                    </small>
                  </button>
                ))
              ) : (
                <div className="path-library-dialog__empty">
                  No paths are in this collection yet.
                </div>
              )}
            </div>
          </section>

          <section
            className="path-library-dialog__details"
            aria-label="Collection membership"
          >
            <div className="path-library-dialog__column-header">
              <strong>Collection Membership</strong>
              <span>
                {selectedPath ? selectedPath.display_name : "No path"}
              </span>
            </div>
            <div className="path-library-dialog__details-scroll">
              {selectedPath ? (
                <section className="path-library-dialog__membership">
                  <div className="path-library-dialog__subhead">
                    <strong>{selectedPath.file_name}</strong>
                    <span>{workspace.path_groups.length + 1} collections</span>
                  </div>
                  <div className="path-library-dialog__membership-list">
                    <label className="path-library-dialog__membership-row is-permanent">
                      <input type="checkbox" checked disabled />
                      <span>All Paths</span>
                      <small>Permanent</small>
                    </label>
                    {workspace.path_groups.map((group) => (
                      <label
                        key={group.group_id}
                        className={
                          group.group_id === selectedGroup?.group_id
                            ? "path-library-dialog__membership-row is-current"
                            : "path-library-dialog__membership-row"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={group.path_ids.includes(
                            selectedPath.path_id,
                          )}
                          onChange={(event) =>
                            handleToggleSelectedPathMembership(
                              group.group_id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span>{group.display_name}</span>
                        <small>
                          {group.path_ids.length}{" "}
                          {group.path_ids.length === 1 ? "path" : "paths"}
                        </small>
                      </label>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="path-library-dialog__empty">
                  Select a path to manage collection membership.
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="config-dialog__footer path-library-dialog__footer">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </footer>
      </section>

      {deletingGroup ? (
        <DeletePathGroupDialog
          group={deletingGroup}
          memberPaths={visiblePathsForGroup(workspace.paths, deletingGroup)}
          onCancel={() => setDeletingGroup(null)}
          onDelete={(deleteMemberPaths) => {
            projectStore
              .getState()
              .deletePathGroup(deletingGroup.group_id, { deleteMemberPaths });
            selectionStore.getState().clearSelection();
            setDeletingGroup(null);
          }}
        />
      ) : null}
      {showCreateCollectionDialog ? (
        <CreateCollectionDialog
          onCancel={() => setShowCreateCollectionDialog(false)}
          onCreate={handleCreateGroup}
        />
      ) : null}
    </div>
  );
}

function LinkedTargetsDialog({
  linkRequest,
  workspace,
  onCancel,
}: {
  linkRequest?: LinkedTargetPickerRequest | null;
  workspace: ProjectWorkspaceDocument;
  onCancel(): void;
}) {
  const field = useMemo(
    () => resolveFieldDefinition(workspace.config.gui.field),
    [workspace.config.gui.field],
  );
  const [requestedTargetId, setSelectedTargetId] = useState<string | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<{
    targetId: string;
    start_x_meters: number;
    start_y_meters: number;
    x_meters: number;
    y_meters: number;
  } | null>(null);
  const previewRef = useRef<SVGSVGElement | null>(null);
  const pickerElement = linkRequest?.element ?? null;
  const pickerCompatibleTargets = pickerElement
    ? workspace.linked_targets.filter((target) =>
        isElementCompatibleWithLinkedTarget(pickerElement, target),
      )
    : workspace.linked_targets;
  const currentPickerTargetId = pickerElement
    ? getPathElementLinkedTargetId(pickerElement)
    : null;
  const fallbackTargetId =
    linkRequest && currentPickerTargetId
      ? currentPickerTargetId
      : (pickerCompatibleTargets[0]?.target_id ??
        workspace.linked_targets[0]?.target_id ??
        null);

  const selectedTargetId =
    requestedTargetId &&
    workspace.linked_targets.some(
      (target) => target.target_id === requestedTargetId,
    )
      ? requestedTargetId
      : fallbackTargetId;

  const selectedTarget =
    workspace.linked_targets.find(
      (target) => target.target_id === selectedTargetId,
    ) ?? null;
  const selectedTargetCompatible =
    !pickerElement ||
    (selectedTarget
      ? isElementCompatibleWithLinkedTarget(pickerElement, selectedTarget)
      : false);
  const displayedTargets = workspace.linked_targets.map((target) =>
    dragPreview?.targetId === target.target_id
      ? {
          ...target,
          x_meters: dragPreview.x_meters,
          y_meters: dragPreview.y_meters,
        }
      : target,
  );
  const activeUseCount = selectedTarget
    ? linkedTargetUseCount(workspace, selectedTarget.target_id)
    : 0;
  const coordinateLength = fieldCoordinateLengthMeters(field.geometry);
  const coordinateWidth = fieldCoordinateWidthMeters(field.geometry);

  const createTarget = (kind: LinkedTargetKind) => {
    const targetId = projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(workspace, kind),
      kind,
      x_meters: coordinateLength / 2,
      y_meters: coordinateWidth / 2,
      rotation_radians: kind === "pose" ? 0 : null,
      locked: false,
    });
    setSelectedTargetId(targetId);
  };

  const updateTarget = (
    targetId: string,
    update: Partial<
      Pick<
        LinkedTarget,
        | "display_name"
        | "kind"
        | "x_meters"
        | "y_meters"
        | "rotation_radians"
        | "locked"
      >
    >,
  ) => {
    projectStore.getState().updateLinkedTarget(targetId, update);
  };

  const handlePreviewPointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (!dragPreview) {
      return;
    }
    const nextPosition = previewPointerToModelPoint(
      event,
      previewRef.current,
      field.geometry,
    );
    if (!nextPosition) {
      return;
    }
    setDragPreview({
      ...dragPreview,
      ...nextPosition,
    });
  };

  const finishPreviewDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragPreview) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      !nearlyEqual(dragPreview.x_meters, dragPreview.start_x_meters) ||
      !nearlyEqual(dragPreview.y_meters, dragPreview.start_y_meters)
    ) {
      projectStore.getState().updateLinkedTarget(dragPreview.targetId, {
        x_meters: dragPreview.x_meters,
        y_meters: dragPreview.y_meters,
      });
    }
    setDragPreview(null);
  };

  const cancelPreviewDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragPreview(null);
  };

  const linkSelectedTarget = () => {
    if (!linkRequest || !selectedTarget || !selectedTargetCompatible) {
      return;
    }

    projectStore
      .getState()
      .linkPathElementToTarget(
        linkRequest.pathId,
        linkRequest.elementIndex,
        selectedTarget.target_id,
      );
    selectionStore
      .getState()
      .selectElement(linkRequest.elementIndex, projectStore.getState().project);
    onCancel();
  };

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <section
        className="path-library-dialog linked-targets-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={linkRequest ? "Choose Linked Target" : "Linked Points"}
        data-testid="linked-targets-dialog"
      >
        <header className="config-dialog__header">
          <strong>
            {linkRequest ? "Choose Linked Target" : "Linked Points"}
          </strong>
          <button
            type="button"
            aria-label="Close linked points"
            onClick={onCancel}
          >
            x
          </button>
        </header>

        <div className="path-library-dialog__utility-bar">
          <div className="path-library-dialog__selection-summary">
            <strong>
              {linkRequest
                ? `Element ${linkRequest.elementIndex + 1}`
                : (selectedTarget?.display_name ?? "No linked target")}
            </strong>
            <span>
              {linkRequest
                ? `${pickerCompatibleTargets.length} compatible / ${workspace.linked_targets.length} total`
                : `${workspace.linked_targets.length} ${
                    workspace.linked_targets.length === 1 ? "target" : "targets"
                  } / ${activeUseCount} ${
                    activeUseCount === 1 ? "use" : "uses"
                  }`}
            </span>
          </div>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            onClick={() => createTarget("point")}
          >
            <PlusIcon size={17} />
            <span>New Point</span>
          </button>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            onClick={() => createTarget("pose")}
          >
            <PlusIcon size={17} />
            <span>New Pose</span>
          </button>
        </div>

        <div className="linked-targets-dialog__body">
          <aside className="linked-targets-dialog__list" aria-label="Targets">
            <div className="path-library-dialog__column-header">
              <strong>Targets</strong>
              <span>{workspace.linked_targets.length}</span>
            </div>
            <div className="path-library-dialog__path-list" role="list">
              {workspace.linked_targets.length > 0 ? (
                workspace.linked_targets.map((target) => {
                  const selected = target.target_id === selectedTargetId;
                  const compatible =
                    !pickerElement ||
                    isElementCompatibleWithLinkedTarget(pickerElement, target);
                  const useCount = linkedTargetUseCount(
                    workspace,
                    target.target_id,
                  );
                  return (
                    <button
                      key={target.target_id}
                      type="button"
                      role="listitem"
                      className={[
                        "path-library-dialog__path",
                        "linked-targets-dialog__target-row",
                        selected ? "is-selected" : "",
                        compatible ? "" : "is-incompatible",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={selected}
                      onClick={() => setSelectedTargetId(target.target_id)}
                    >
                      <span className="linked-targets-dialog__target-title">
                        <LinkedTargetListGlyph target={target} />
                        <span>{target.display_name}</span>
                      </span>
                      <small>
                        {target.locked ? "Locked / " : ""}
                        {formatLinkedTargetKind(target.kind)} / {useCount}{" "}
                        {useCount === 1 ? "use" : "uses"}
                      </small>
                    </button>
                  );
                })
              ) : (
                <div className="path-library-dialog__empty">
                  No linked points yet.
                </div>
              )}
            </div>
          </aside>

          <section
            className="linked-targets-dialog__preview-column"
            aria-label="Linked target preview"
          >
            <div className="path-library-dialog__column-header">
              <strong>Field Preview</strong>
              <span>{field.label}</span>
            </div>
            <div className="linked-targets-dialog__preview-shell">
              <svg
                ref={previewRef}
                className="linked-targets-dialog__preview"
                viewBox={`0 0 ${field.geometry.length_meters} ${field.geometry.width_meters}`}
                role="img"
                aria-label="Linked target field preview"
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={finishPreviewDrag}
                onPointerCancel={cancelPreviewDrag}
              >
                <rect
                  className="linked-targets-dialog__preview-base"
                  x="0"
                  y="0"
                  width={field.geometry.length_meters}
                  height={field.geometry.width_meters}
                />
                {field.kind === "image" && field.image_src ? (
                  <image
                    href={field.image_src}
                    x="0"
                    y="0"
                    width={field.geometry.length_meters}
                    height={field.geometry.width_meters}
                    preserveAspectRatio="none"
                  />
                ) : (
                  <PreviewGrid field={field.geometry} />
                )}
                {displayedTargets.map((target) => {
                  const point = linkedTargetToPreviewPoint(
                    target,
                    field.geometry,
                  );
                  const selected = target.target_id === selectedTargetId;
                  const compatible =
                    !pickerElement ||
                    isElementCompatibleWithLinkedTarget(pickerElement, target);
                  return (
                    <LinkedTargetPreviewMarker
                      key={target.target_id}
                      compatible={compatible}
                      point={point}
                      selected={selected}
                      target={target}
                      onSelect={() => setSelectedTargetId(target.target_id)}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedTargetId(target.target_id);
                        if (target.locked) {
                          return;
                        }
                        previewRef.current?.setPointerCapture(event.pointerId);
                        setDragPreview({
                          targetId: target.target_id,
                          start_x_meters: target.x_meters,
                          start_y_meters: target.y_meters,
                          x_meters: target.x_meters,
                          y_meters: target.y_meters,
                        });
                      }}
                    />
                  );
                })}
              </svg>
            </div>
          </section>

          <section
            className="path-library-dialog__details linked-targets-dialog__details"
            aria-label="Linked target details"
          >
            <div className="path-library-dialog__column-header">
              <strong>Details</strong>
              <span>
                {selectedTarget
                  ? formatLinkedTargetKind(selectedTarget.kind)
                  : ""}
              </span>
            </div>
            <div className="path-library-dialog__details-scroll">
              {selectedTarget ? (
                <div className="linked-targets-dialog__editor">
                  <label className="dialog-field">
                    <span>Name</span>
                    <input
                      aria-label="Linked target name"
                      value={selectedTarget.display_name}
                      onChange={(event) =>
                        updateTarget(selectedTarget.target_id, {
                          display_name: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label className="dialog-field">
                    <span>Type</span>
                    <select
                      aria-label="Linked target type"
                      value={selectedTarget.kind}
                      onChange={(event) =>
                        updateTarget(selectedTarget.target_id, {
                          kind: event.currentTarget.value as LinkedTargetKind,
                        })
                      }
                    >
                      <option value="point">Point</option>
                      <option value="pose">Pose</option>
                    </select>
                  </label>
                  <label className="dialog-field dialog-field--toggle linked-targets-dialog__lock-field">
                    <span>
                      {selectedTarget.locked ? (
                        <LockIcon size={15} />
                      ) : (
                        <UnlockIcon size={15} />
                      )}
                      Locked
                    </span>
                    <input
                      aria-label="Locked"
                      type="checkbox"
                      checked={Boolean(selectedTarget.locked)}
                      onChange={(event) =>
                        updateTarget(selectedTarget.target_id, {
                          locked: event.currentTarget.checked,
                        })
                      }
                    />
                  </label>
                  <LinkedTargetNumberField
                    label="X (m)"
                    value={selectedTarget.x_meters}
                    disabled={Boolean(selectedTarget.locked)}
                    min={0}
                    max={coordinateLength}
                    onChange={(x_meters) =>
                      updateTarget(selectedTarget.target_id, { x_meters })
                    }
                  />
                  <LinkedTargetNumberField
                    label="Y (m)"
                    value={selectedTarget.y_meters}
                    disabled={Boolean(selectedTarget.locked)}
                    min={0}
                    max={coordinateWidth}
                    onChange={(y_meters) =>
                      updateTarget(selectedTarget.target_id, { y_meters })
                    }
                  />
                  {selectedTarget.kind === "pose" ? (
                    <LinkedTargetNumberField
                      label="Heading (deg)"
                      value={radiansToDegrees(
                        selectedTarget.rotation_radians ?? 0,
                      )}
                      disabled={Boolean(selectedTarget.locked)}
                      onChange={(degrees) =>
                        updateTarget(selectedTarget.target_id, {
                          rotation_radians: degreesToRadians(degrees),
                        })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className="linked-targets-dialog__danger"
                    onClick={() => {
                      const nextSelection =
                        workspace.linked_targets.find(
                          (target) =>
                            target.target_id !== selectedTarget.target_id,
                        )?.target_id ?? null;
                      projectStore
                        .getState()
                        .deleteLinkedTarget(selectedTarget.target_id);
                      setSelectedTargetId(nextSelection);
                    }}
                  >
                    Delete Linked Target
                  </button>
                </div>
              ) : (
                <div className="path-library-dialog__empty">
                  Select or create a linked point.
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="config-dialog__footer path-library-dialog__footer">
          {linkRequest ? (
            <button
              type="button"
              className="primary-dialog-action"
              disabled={!selectedTarget || !selectedTargetCompatible}
              onClick={linkSelectedTarget}
            >
              Link Selected
            </button>
          ) : null}
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

function LinkedTargetNumberField({
  disabled = false,
  label,
  max,
  min,
  value,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label className="dialog-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        disabled={disabled}
        min={min}
        max={max}
        step={label === "Heading (deg)" ? 1 : 0.05}
        value={formatNumericInputValue(value)}
        onChange={(event) => {
          const parsed = Number(event.currentTarget.value);
          if (Number.isFinite(parsed)) {
            onChange(clamp(parsed, min, max));
          }
        }}
      />
    </label>
  );
}

function PreviewGrid({ field }: { field: FieldGeometry }) {
  const lines = [];
  for (let x = 1; x < field.length_meters; x += 1) {
    lines.push(
      <line key={`x-${x}`} x1={x} y1={0} x2={x} y2={field.width_meters} />,
    );
  }
  for (let y = 1; y < field.width_meters; y += 1) {
    lines.push(
      <line key={`y-${y}`} x1={0} y1={y} x2={field.length_meters} y2={y} />,
    );
  }
  return <g className="linked-targets-dialog__preview-grid">{lines}</g>;
}

function LinkedTargetPreviewMarker({
  compatible,
  point,
  selected,
  target,
  onSelect,
  onPointerDown,
}: {
  compatible: boolean;
  point: { x: number; y: number };
  selected: boolean;
  target: LinkedTarget;
  onSelect(): void;
  onPointerDown(event: ReactPointerEvent<SVGGElement>): void;
}) {
  return (
    <g
      className={[
        "linked-targets-dialog__marker",
        selected ? "is-selected" : "is-muted",
        compatible ? "" : "is-incompatible",
        target.locked ? "is-locked" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="button"
      tabIndex={0}
      aria-label={`${target.display_name} ${formatLinkedTargetKind(target.kind)}${
        target.locked ? " locked" : ""
      }`}
      transform={`translate(${point.x} ${point.y})`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={onPointerDown}
    >
      <title>{target.display_name}</title>
      {target.kind === "pose" ? (
        <LinkedTargetPoseGlyph target={target} selected={selected} />
      ) : (
        <LinkedTargetPointGlyph selected={selected} />
      )}
    </g>
  );
}

function LinkedTargetPointGlyph({ selected }: { selected: boolean }) {
  return (
    <>
      {selected ? (
        <circle
          r={elementCircleRadiusMeters + 0.16}
          fill="none"
          stroke={elementColors.selected}
          strokeWidth={0.045}
          opacity={0.9}
        />
      ) : null}
      <circle
        r={elementCircleRadiusMeters * 1.7}
        fill={elementColors.shadow}
        opacity={0.72}
      />
      <circle
        r={elementCircleRadiusMeters}
        fill={elementColors.translation}
        stroke="#eff8ff"
        strokeWidth={0.022}
      />
      <circle r={elementCircleRadiusMeters * 0.24} fill="#f7fbff" />
    </>
  );
}

function LinkedTargetPoseGlyph({
  selected,
  target,
}: {
  selected: boolean;
  target: LinkedTarget;
}) {
  const halfLength = robotLengthMeters / 2;
  const halfWidth = robotWidthMeters / 2;
  const triangleLength =
    Math.min(robotLengthMeters, robotWidthMeters) * triangleSizeRatio;
  const halfTriangleHeight = triangleLength / 2;

  return (
    <g transform={`rotate(${-radiansToDegrees(target.rotation_radians ?? 0)})`}>
      {selected ? (
        <rect
          x={-halfLength - 0.12}
          y={-halfWidth - 0.12}
          width={robotLengthMeters + 0.24}
          height={robotWidthMeters + 0.24}
          rx={0.08}
          fill="none"
          stroke={elementColors.selected}
          strokeWidth={0.055}
          opacity={0.9}
        />
      ) : null}
      <rect
        x={-halfLength - 0.045}
        y={-halfWidth - 0.045}
        width={robotLengthMeters + 0.09}
        height={robotWidthMeters + 0.09}
        rx={0.075}
        fill={elementColors.shadow}
        opacity={0.78}
      />
      <rect
        x={-halfLength}
        y={-halfWidth}
        width={robotLengthMeters}
        height={robotWidthMeters}
        rx={0.055}
        fill="rgba(255, 159, 67, 0.16)"
        stroke={elementColors.waypoint}
        strokeWidth={0.06}
      />
      <path
        d={`M ${halfLength - triangleLength} ${-halfTriangleHeight} L ${
          halfLength - triangleLength
        } ${halfTriangleHeight} L ${halfLength} 0 Z`}
        fill={elementColors.waypoint}
        opacity={0.95}
      />
    </g>
  );
}

function LinkedTargetListGlyph({ target }: { target: LinkedTarget }) {
  return (
    <svg
      className="linked-targets-dialog__target-glyph"
      viewBox="-0.5 -0.5 1 1"
      aria-hidden="true"
    >
      {target.kind === "pose" ? (
        <g
          transform={`rotate(${-radiansToDegrees(target.rotation_radians ?? 0)})`}
        >
          <rect
            x="-0.28"
            y="-0.28"
            width="0.56"
            height="0.56"
            rx="0.06"
            fill="rgba(255, 159, 67, 0.16)"
            stroke={elementColors.waypoint}
            strokeWidth="0.08"
          />
          <path
            d="M 0.05 -0.16 L 0.05 0.16 L 0.32 0 Z"
            fill={elementColors.waypoint}
          />
        </g>
      ) : (
        <>
          <circle
            r="0.24"
            fill={elementColors.translation}
            stroke="#eff8ff"
            strokeWidth="0.04"
          />
          <circle r="0.06" fill="#f7fbff" />
        </>
      )}
    </svg>
  );
}

function linkedTargetToPreviewPoint(
  target: LinkedTarget,
  field: FieldGeometry,
): { x: number; y: number } {
  return {
    x: target.x_meters + fieldCoordinateOffsetXMeters(field),
    y:
      field.width_meters -
      target.y_meters -
      fieldCoordinateOffsetYMeters(field),
  };
}

function previewPointerToModelPoint(
  event: ReactPointerEvent<SVGSVGElement>,
  svg: SVGSVGElement | null,
  field: FieldGeometry,
): { x_meters: number; y_meters: number } | null {
  if (!svg) {
    return null;
  }

  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const sceneX =
    ((event.clientX - rect.left) / rect.width) * field.length_meters;
  const sceneY =
    ((event.clientY - rect.top) / rect.height) * field.width_meters;
  return {
    x_meters: clamp(
      sceneX - fieldCoordinateOffsetXMeters(field),
      0,
      fieldCoordinateLengthMeters(field),
    ),
    y_meters: clamp(
      field.width_meters - sceneY - fieldCoordinateOffsetYMeters(field),
      0,
      fieldCoordinateWidthMeters(field),
    ),
  };
}

function nextLinkedTargetName(
  workspace: ProjectWorkspaceDocument,
  kind: LinkedTargetKind,
): string {
  const base = kind === "pose" ? "Linked Pose" : "Linked Point";
  const names = new Set(
    workspace.linked_targets.map((target) => target.display_name),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
  return `${base} ${workspace.linked_targets.length + 1}`;
}

function formatLinkedTargetKind(kind: LinkedTargetKind): string {
  return kind === "pose" ? "Pose" : "Point";
}

function formatNumericInputValue(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "0";
}

function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(Math.max(value, min ?? -Infinity), max ?? Infinity);
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function PathLibraryHeaderButton({
  children,
  disabled = false,
  label,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick(): void;
  tone?: "danger" | "neutral";
}) {
  return (
    <button
      type="button"
      className={`path-library-dialog__header-button path-library-dialog__header-button--${tone}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CreateCollectionDialog({
  onCancel,
  onCreate,
}: {
  onCancel(): void;
  onCreate(displayName: string): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="path-library-create-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Create collection"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(displayName.trim() || "New Collection");
      }}
    >
      <header>
        <strong>Create Collection</strong>
        <button
          type="button"
          aria-label="Close create collection"
          onClick={onCancel}
        >
          <XIcon size={16} />
        </button>
      </header>
      <label className="dialog-field">
        <span>Collection name</span>
        <input
          ref={inputRef}
          aria-label="Collection name"
          data-testid="path-collection-new-name"
          type="text"
          value={displayName}
          placeholder="Score autos"
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
      </label>
      <footer>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-dialog-action"
          data-testid="create-path-collection"
        >
          Create
        </button>
      </footer>
    </form>
  );
}

function TopMenuButton({
  id,
  label,
  active = false,
  disabled = false,
  openTopMenu,
  setOpenTopMenu,
  onBeforeOpen,
  align = "start",
  children,
}: {
  id: TopMenuId;
  label: string;
  active?: boolean;
  disabled?: boolean;
  openTopMenu: TopMenuId | null;
  setOpenTopMenu(menu: TopMenuId | null): void;
  onBeforeOpen?: () => Promise<unknown> | void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const open = openTopMenu === id;
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const submenuCloseDelayMs = id === "project" ? 220 : 100;
  const className = [
    "top-menu",
    `top-menu--${id}`,
    align === "end" ? "top-menu--align-end" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <button
        type="button"
        className={active ? "is-active" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setActiveSubmenuId(null);
          if (!open) {
            void onBeforeOpen?.();
          }
          setOpenTopMenu(open ? null : id);
        }}
      >
        {label}
      </button>
      {open ? (
        <TopMenuSubmenuContext.Provider
          value={{
            activeSubmenuId,
            closeDelayMs: submenuCloseDelayMs,
            setActiveSubmenuId,
          }}
        >
          <div
            className="top-menu__panel"
            role="menu"
            data-testid={`top-menu-${id}`}
          >
            {children}
          </div>
        </TopMenuSubmenuContext.Provider>
      ) : null}
    </div>
  );
}

function MenuSubmenu({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const submenuId = useId();
  const submenuContext = useContext(TopMenuSubmenuContext);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const activeSubmenuIdRef = useRef<string | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const open = submenuContext
    ? submenuContext.activeSubmenuId === submenuId
    : localOpen;
  const closeDelayMs = submenuContext?.closeDelayMs ?? 100;
  const setActiveSubmenuId = submenuContext?.setActiveSubmenuId;

  useEffect(() => {
    activeSubmenuIdRef.current = submenuContext?.activeSubmenuId ?? null;
  }, [submenuContext?.activeSubmenuId]);

  const setSubmenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (setActiveSubmenuId) {
        if (nextOpen) {
          setActiveSubmenuId(submenuId);
          return;
        }

        if (activeSubmenuIdRef.current === submenuId) {
          setActiveSubmenuId(null);
        }
        return;
      }

      setLocalOpen(nextOpen);
    },
    [setActiveSubmenuId, submenuId],
  );

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePlacement = useCallback(() => {
    const rect = submenuRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const viewportMargin = 8;
    const flyoutGap = 6;
    const width = Math.min(
      266,
      Math.max(160, window.innerWidth - viewportMargin * 2),
    );
    const rightSpace =
      window.innerWidth - viewportMargin - rect.right - flyoutGap;
    const leftSpace = rect.left - viewportMargin - flyoutGap;
    const shouldOpenLeft = rightSpace < width && leftSpace > rightSpace;
    const idealLeft = shouldOpenLeft
      ? rect.left - flyoutGap - width
      : rect.right + flyoutGap;
    const left = Math.min(
      Math.max(viewportMargin, idealLeft),
      window.innerWidth - width - viewportMargin,
    );
    const top = Math.max(
      viewportMargin,
      Math.min(rect.top - 4, window.innerHeight - 128),
    );
    const maxHeight = Math.max(120, window.innerHeight - top - viewportMargin);

    setPlacement({
      left,
      maxHeight,
      top,
      width,
    });
  }, []);

  const openSubmenu = useCallback(() => {
    clearCloseTimer();
    updatePlacement();
    setSubmenuOpen(true);
  }, [clearCloseTimer, setSubmenuOpen, updatePlacement]);

  const getSubmenuPointerZone = useCallback((x: number, y: number) => {
    const triggerRect = submenuRef.current?.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    const bridgePadding = 4;
    const surfacePadding = 1;

    if (triggerRect && pointInsideRect(x, y, triggerRect, surfacePadding)) {
      return "surface";
    }

    if (panelRect && pointInsideRect(x, y, panelRect, surfacePadding)) {
      return "surface";
    }

    if (!triggerRect || !panelRect) {
      return "outside";
    }

    const horizontalGap =
      panelRect.left >= triggerRect.right
        ? { left: triggerRect.right, right: panelRect.left }
        : triggerRect.left >= panelRect.right
          ? { left: panelRect.right, right: triggerRect.left }
          : {
              left: Math.min(triggerRect.left, panelRect.left),
              right: Math.max(triggerRect.right, panelRect.right),
            };
    const bridgeRect = {
      bottom: Math.max(triggerRect.bottom, panelRect.bottom) + bridgePadding,
      left: horizontalGap.left - bridgePadding,
      right: horizontalGap.right + bridgePadding,
      top: Math.min(triggerRect.top, panelRect.top) - bridgePadding,
    };

    if (
      x >= bridgeRect.left &&
      x <= bridgeRect.right &&
      y >= bridgeRect.top &&
      y <= bridgeRect.bottom
    ) {
      return "bridge";
    }

    return "outside";
  }, []);

  const isSubmenuHovered = useCallback(() => {
    return Boolean(
      submenuRef.current?.matches(":hover") ||
      panelRef.current?.matches(":hover"),
    );
  }, []);

  const closeSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const pointerPosition = pointerPositionRef.current;
      const pointerZone = pointerPosition
        ? getSubmenuPointerZone(pointerPosition.x, pointerPosition.y)
        : "outside";
      if (isSubmenuHovered() || pointerZone === "surface") {
        clearCloseTimer();
        return;
      }

      setSubmenuOpen(false);
    }, closeDelayMs);
  }, [
    clearCloseTimer,
    closeDelayMs,
    getSubmenuPointerZone,
    isSubmenuHovered,
    setSubmenuOpen,
  ]);

  const isInsideSubmenu = useCallback((target: EventTarget | null) => {
    return (
      target instanceof Node &&
      (Boolean(submenuRef.current?.contains(target)) ||
        Boolean(panelRef.current?.contains(target)))
    );
  }, []);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (isInsideSubmenu(event.relatedTarget)) {
      return;
    }

    closeSubmenu();
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    pointerPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    closeSubmenu();
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleReposition = () => updatePlacement();
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      pointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      const pointerZone = getSubmenuPointerZone(event.clientX, event.clientY);

      if (isInsideSubmenu(event.target) || pointerZone === "surface") {
        clearCloseTimer();
        return;
      }

      closeSubmenu();
    };
    const handlePointerOut = (event: globalThis.PointerEvent) => {
      if (event.relatedTarget !== null) {
        return;
      }

      pointerPositionRef.current = null;
      closeSubmenu();
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerout", handlePointerOut, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerout", handlePointerOut, true);
    };
  }, [
    clearCloseTimer,
    closeSubmenu,
    getSubmenuPointerZone,
    isInsideSubmenu,
    open,
    updatePlacement,
  ]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <div
      ref={submenuRef}
      className={`top-menu__submenu${open ? " is-open" : ""}`}
      role="none"
      onBlur={handleBlur}
      onFocus={openSubmenu}
      onPointerEnter={openSubmenu}
      onPointerLeave={handlePointerLeave}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="top-menu__item"
        onClick={openSubmenu}
      >
        <span className="top-menu__item-label">{label}</span>
        <span className="top-menu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && placement
        ? createPortal(
            <div
              ref={panelRef}
              className="top-menu__submenu-panel"
              role="menu"
              data-testid={testId}
              style={placement}
              onBlur={handleBlur}
              onFocus={openSubmenu}
              onPointerEnter={openSubmenu}
              onPointerLeave={handlePointerLeave}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuAction({
  label,
  shortcut,
  disabled = false,
  onAction,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onAction(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="top-menu__item"
      disabled={disabled}
      onClick={onAction}
    >
      <span className="top-menu__item-label">{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="top-menu__label">{children}</div>;
}

function pointInsideRect(
  x: number,
  y: number,
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  padding = 0,
): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  );
}

function hasActiveBlockingSurface({
  openTopMenu,
  showConfigDialog,
  showNewPathDialog,
  showDeletePathDialog,
  showDeleteProjectDialog,
  showPathGroupsDialog,
  showLinkedTargetsDialog,
  showMobileSupportWarning,
  showOpenPanel,
}: {
  openTopMenu: TopMenuId | null;
  showConfigDialog: boolean;
  showNewPathDialog: boolean;
  showDeletePathDialog: boolean;
  showDeleteProjectDialog: boolean;
  showPathGroupsDialog: boolean;
  showLinkedTargetsDialog: boolean;
  showMobileSupportWarning: boolean;
  showOpenPanel: boolean;
}): boolean {
  return Boolean(
    openTopMenu ||
    showConfigDialog ||
    showNewPathDialog ||
    showDeletePathDialog ||
    showDeleteProjectDialog ||
    showPathGroupsDialog ||
    showLinkedTargetsDialog ||
    showMobileSupportWarning ||
    showOpenPanel,
  );
}

function isPathElementShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-path-element-index]"))
  );
}

function isRangedConstraintShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-ranged-constraint-selection]"))
  );
}

function WorkspaceMenuList({
  workspaces,
  emptyLabel,
  onOpen,
}: {
  workspaces: ProjectWorkspaceSummary[];
  emptyLabel: string;
  onOpen(id: string): Promise<void>;
}) {
  if (workspaces.length === 0) {
    return <div className="top-menu__empty">{emptyLabel}</div>;
  }

  return (
    <div className="top-menu__list">
      {workspaces.map((summary) => (
        <button
          key={summary.id}
          type="button"
          role="menuitem"
          className="top-menu__item top-menu__project"
          title={summary.directoryPath}
          onClick={() => void onOpen(summary.id)}
        >
          <span className="top-menu__item-label">{summary.displayName}</span>
          <small>{formatTimestamp(summary.updatedAt)}</small>
        </button>
      ))}
    </div>
  );
}

function DeleteProjectsDialog({
  activeWorkspaceId,
  workspaces,
  onCancel,
  onDelete,
}: {
  activeWorkspaceId: string | null;
  workspaces: ProjectWorkspaceSummary[];
  onCancel(): void;
  onDelete(ids: string[]): void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const selectedCount = selectedIds.size;
  const selectedProjects = workspaces.filter((workspaceSummary) =>
    selectedIds.has(workspaceSummary.id),
  );

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="delete-projects-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Projects"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirming) {
            setConfirming(true);
            return;
          }
          onDelete([...selectedIds]);
        }}
      >
        <header className="config-dialog__header">
          <strong>Delete Projects</strong>
          <button
            type="button"
            aria-label="Close delete projects"
            onClick={onCancel}
          >
            x
          </button>
        </header>
        {confirming ? (
          <section
            className="delete-projects-dialog__confirm"
            aria-label="Confirm project deletion"
          >
            <strong>
              Delete {selectedCount} selected project
              {selectedCount === 1 ? "" : "s"}?
            </strong>
            <p>
              This removes the selected project{selectedCount === 1 ? "" : "s"}{" "}
              from browser storage. Exported autos folders and downloaded
              archives are not deleted.
            </p>
            <ul>
              {selectedProjects.map((workspaceSummary) => (
                <li key={workspaceSummary.id}>
                  {workspaceSummary.displayName}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section
            className="delete-projects-dialog__list"
            aria-label="Saved projects"
          >
            {workspaces.length === 0 ? (
              <div className="delete-projects-dialog__empty">
                No projects found to delete.
              </div>
            ) : (
              workspaces.map((workspaceSummary) => {
                const checked = selectedIds.has(workspaceSummary.id);
                const isCurrent = workspaceSummary.id === activeWorkspaceId;
                return (
                  <label
                    key={workspaceSummary.id}
                    className={
                      isCurrent
                        ? "delete-project-row is-current"
                        : "delete-project-row"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextChecked = event.currentTarget.checked;
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (nextChecked) {
                            next.add(workspaceSummary.id);
                          } else {
                            next.delete(workspaceSummary.id);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>{workspaceSummary.displayName}</span>
                    {isCurrent ? <small>Current</small> : null}
                  </label>
                );
              })
            )}
          </section>
        )}
        <footer className="config-dialog__footer">
          {confirming ? (
            <button type="button" onClick={() => setConfirming(false)}>
              Back
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    new Set(workspaces.map((summary) => summary.id)),
                  )
                }
                disabled={workspaces.length === 0}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedCount === 0}
              >
                Select None
              </button>
            </>
          )}
          <span className="delete-projects-dialog__spacer" />
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="danger-action"
            disabled={selectedCount === 0}
          >
            {confirming ? "Confirm Delete" : "Delete Selected"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function DeletePathsDialog({
  activePathId,
  paths,
  onCancel,
  onDelete,
}: {
  activePathId: string | null;
  paths: ProjectPathDocument[];
  onCancel(): void;
  onDelete(ids: string[]): void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedCount = selectedIds.size;

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="delete-paths-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Paths"
        onSubmit={(event) => {
          event.preventDefault();
          onDelete([...selectedIds]);
        }}
      >
        <header className="config-dialog__header">
          <strong>Delete Paths</strong>
          <button
            type="button"
            aria-label="Close delete paths"
            onClick={onCancel}
          >
            x
          </button>
        </header>
        <section className="delete-paths-dialog__list" aria-label="Saved paths">
          {paths.length === 0 ? (
            <div className="delete-paths-dialog__empty">
              No paths found to delete.
            </div>
          ) : (
            paths.map((path) => {
              const checked = selectedIds.has(path.path_id);
              return (
                <label
                  key={path.path_id}
                  className={
                    path.path_id === activePathId
                      ? "delete-path-row is-current"
                      : "delete-path-row"
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextChecked = event.currentTarget.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (nextChecked) {
                          next.add(path.path_id);
                        } else {
                          next.delete(path.path_id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span>{path.display_name}</span>
                  {path.path_id === activePathId ? (
                    <small>Current</small>
                  ) : null}
                </label>
              );
            })
          )}
        </section>
        <footer className="config-dialog__footer">
          <button
            type="button"
            onClick={() =>
              setSelectedIds(new Set(paths.map((path) => path.path_id)))
            }
            disabled={paths.length === 0}
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedCount === 0}
          >
            Select None
          </button>
          <span className="delete-paths-dialog__spacer" />
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="danger-action"
            disabled={selectedCount === 0}
          >
            Delete Selected
          </button>
        </footer>
      </form>
    </div>
  );
}

function DeletePathGroupDialog({
  group,
  memberPaths,
  onCancel,
  onDelete,
}: {
  group: ProjectPathGroupDocument;
  memberPaths: ProjectPathDocument[];
  onCancel(): void;
  onDelete(deleteMemberPaths: boolean): void;
}) {
  const [deleteMemberPaths, setDeleteMemberPaths] = useState(false);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="delete-path-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Collection"
        onSubmit={(event) => {
          event.preventDefault();
          onDelete(deleteMemberPaths);
        }}
      >
        <header className="config-dialog__header">
          <strong>Delete Collection</strong>
          <button
            type="button"
            aria-label="Close delete collection"
            onClick={onCancel}
          >
            x
          </button>
        </header>
        <section className="delete-path-group-dialog__body">
          <strong>{group.display_name}</strong>
          <p>
            Deleting the collection normally keeps every path in All Paths. Only
            use the checkbox below if you want to delete the member paths too.
          </p>
          <label className="delete-path-group-dialog__option">
            <input
              type="checkbox"
              checked={deleteMemberPaths}
              onChange={(event) =>
                setDeleteMemberPaths(event.currentTarget.checked)
              }
            />
            <span>
              Also delete {memberPaths.length} member{" "}
              {memberPaths.length === 1 ? "path" : "paths"} from All Paths
            </span>
          </label>
          {deleteMemberPaths ? (
            <div className="delete-path-group-dialog__warning">
              This removes the selected paths from the project, not just from
              this collection.
            </div>
          ) : null}
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={deleteMemberPaths ? "danger-action" : undefined}
          >
            {deleteMemberPaths
              ? "Delete Collection and Paths"
              : "Delete Collection Only"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function visiblePathsForGroup(
  paths: readonly ProjectPathDocument[],
  group: ProjectPathGroupDocument | null,
): ProjectPathDocument[] {
  if (!group) {
    return [...paths];
  }

  return group.path_ids.flatMap((pathId) => {
    const path = paths.find((candidate) => candidate.path_id === pathId);
    return path ? [path] : [];
  });
}

interface SaveStatusInput {
  autosaveStatus: AutosaveStatus;
  dirty: boolean;
  error: string | null;
  initializing: boolean;
  lastSavedAt: string | null;
  status: string;
}

function formatSaveStatus({
  autosaveStatus,
  dirty,
  error,
  initializing,
  lastSavedAt,
  status,
}: SaveStatusInput): string {
  if (initializing || status === "loading") {
    return "Loading";
  }

  if (status === "error" && error) {
    return `Save failed: ${error}`;
  }

  if (status === "saving" || autosaveStatus === "saving") {
    return "Saving";
  }

  if (dirty && autosaveStatus === "pending") {
    return "Autosave pending";
  }

  if (dirty) {
    return "Unsaved changes";
  }

  return lastSavedAt ? `Saved ${formatTimestamp(lastSavedAt)}` : "Saved";
}

type SaveStatusTone = "danger" | "loading" | "pending" | "saved" | "saving";

function getSaveStatusTone({
  autosaveStatus,
  dirty,
  error,
  initializing,
  status,
}: SaveStatusInput): SaveStatusTone {
  if (initializing || status === "loading") {
    return "loading";
  }

  if ((status === "error" && error) || autosaveStatus === "error") {
    return "danger";
  }

  if (status === "saving" || autosaveStatus === "saving") {
    return "saving";
  }

  if (dirty) {
    return "pending";
  }

  return "saved";
}

function ensureJsonFileName(value: string): string {
  const base =
    safeDownloadName(value.replace(/\.json$/i, "")) || "untitled-path";
  return `${base}.json`;
}

function activePathDocument(
  workspace: ProjectWorkspaceDocument | null,
): ProjectPathDocument | null {
  if (!workspace) {
    return null;
  }

  return (
    workspace.paths.find((path) => path.path_id === workspace.active_path_id) ??
    workspace.paths[0] ??
    null
  );
}

function ensureCurrentWorkspaceSummary(
  summaries: ProjectWorkspaceSummary[],
  workspace: ProjectWorkspaceDocument | null,
  version: string | undefined,
  lastSavedAt: string | null,
): ProjectWorkspaceSummary[] {
  if (
    !workspace ||
    summaries.some((summary) => summary.id === workspace.project_id)
  ) {
    return summaries;
  }

  return [
    {
      id: workspace.project_id,
      displayName: workspace.display_name,
      updatedAt: lastSavedAt ?? new Date().toISOString(),
      version: version ?? "",
    },
    ...summaries,
  ];
}

function formatStorageLabel(
  workspace: ProjectWorkspaceDocument | null,
  capabilities: ProjectIoCapabilities | undefined,
): string {
  if (!capabilities) {
    return "Storage: unavailable";
  }

  if (capabilities.directFileAutosave) {
    return `Autosave: ${workspace?.project_id ?? "No folder"}`;
  }

  return `Autosave: ${capabilities.autosaveTargetLabel}`;
}

function formatTimestamp(value: string): string {
  const millis = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const timestamp = new Date(Number.isFinite(millis) ? millis : value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

async function saveBlobAs(
  blob: Blob,
  fileName: string,
  {
    title,
    useNativeSaveDialog,
  }: {
    title: string;
    useNativeSaveDialog: boolean;
  },
): Promise<boolean> {
  if (useNativeSaveDialog) {
    return invoke<boolean>("storage_write_text_file_dialog", {
      contents: await blob.text(),
      defaultFileName: fileName,
      title,
    });
  }

  const saveFilePicker = (window as BrowserSaveWindow).showSaveFilePicker;
  if (saveFilePicker) {
    const fileHandle = await saveFilePicker.call(window, {
      suggestedName: fileName,
      types: [
        {
          accept: {
            "application/json": [".json"],
          },
          description: "JSON files",
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  downloadBlob(blob, fileName);
  return true;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeDownloadName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "bline-project"
  );
}

interface BrowserSaveWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      accept: Record<string, string[]>;
      description: string;
    }>;
  }) => Promise<BrowserFileHandle>;
}

interface BrowserFileHandle {
  createWritable(): Promise<BrowserWritableFileStream>;
}

interface BrowserWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
