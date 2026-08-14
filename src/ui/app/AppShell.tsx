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
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  CircleHelp,
  FolderTree,
  PanelRight,
  Redo2,
  Search,
  Settings,
  Undo2,
} from "lucide-react";
import { LinkedTargetsCanvas } from "../../canvas/LinkedTargetsCanvas";
import { PathStage, type CanvasElementPlacement } from "../../canvas/PathStage";
import type { CurveToolSession } from "../../canvas/curveAuthoring";
import { elementColors } from "../../canvas/elementStyle";
import type {
  LinkedTarget,
  LinkedTargetKind,
  ProjectPathGroupDocument,
  ProjectPathDocument,
  ProjectWorkspaceDocument,
} from "../../core/io/projectSchema";
import {
  diffWorkspaceConflict,
  type WorkspaceConflictDiff,
} from "../../core/io/workspaceConflictDiff";
import {
  fieldCoordinateLengthMeters,
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
  nextLinkedTargetName,
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
import { autoVelocityStore } from "../../state/autoVelocityStore";
import { generateAutoConstraintsInWorker } from "../../state/autoConstraintGeneration";
import { startAutoVelocitySync } from "../../state/autoVelocitySync";
import { autoVelocitySettingsForPath } from "../../core/constraints/autoVelocityApply";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import {
  duplicateSelectedPathElement,
  isEditableShortcutTarget,
  isInteractiveShortcutTarget,
  moveSelectedPathElement,
  nudgeSelectedPathElement,
  removeSelectedPathElement,
  removeSelectedRangedConstraint,
  selectAdjacentPathElement,
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
} from "../icons";
import {
  CloseButton,
  IconButton,
  NumberStepperControl,
  SelectControl,
  SwitchInput,
} from "../controls";
import type { ProjectWorkspaceSummary } from "../../storage";
import { Sidebar } from "../sidebar/Sidebar";
import {
  canGenerateConstraints,
  createDefaultElement,
  createInsertPathElementCommand,
  createInsertPathElementsCommand,
} from "../sidebar/sidebarCommands";
import "./AppShell.css";
import { createUpdateProjectConfigCommand } from "./configCommands";
import {
  createBlankCanvasPath,
  createNamedCanvasWorkspace,
  createSampleCanvasWorkspace,
} from "./initialProject";
import { ProjectConfigDialog } from "./ProjectConfigDialog";
import { writeProjectFolder } from "./projectFolderExport";
import { CommandPalette, ShortcutHelpDialog } from "./CommandPalette";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import { StartCenter } from "./StartCenter";
import {
  clampInspectorWidth,
  formatShortcut,
  readEditorUiPreferences,
  type EditorCommand,
  type EditorTool,
  type ShortcutBinding,
} from "./editorCommands";
import { derivePathDiagnostics, type PathDiagnostic } from "./pathDiagnostics";
import {
  optimizerBeamClass,
  optimizerBeamLabel,
  optimizerBeamTitle,
} from "../optimizerBeam";
import { TourOverlay } from "../tours/TourOverlay";
import { tourStore } from "../tours/tourStore";
import {
  editorBasicsTour,
  findTour,
  tourPracticePathName,
  tours,
} from "../tours/tours";

interface LinkedTargetPickerRequest {
  pathId: string;
  elementIndex: number;
  element: PathElement;
}

interface PathNameAction {
  kind: "duplicate" | "rename";
  pathId: string;
  initialName: string;
}

type LibraryNameAction =
  | {
      kind: "rename-group";
      groupId: string;
      initialName: string;
    }
  | {
      kind: "duplicate-path" | "rename-path";
      pathId: string;
      initialName: string;
      addToGroupId: string | null;
    };

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
  const undoDescription = useStoreSelector(
    projectStore,
    (state) => state.history.getState().undoStack.at(-1)?.description ?? null,
  );
  const redoDescription = useStoreSelector(
    projectStore,
    (state) => state.history.getState().redoStack.at(-1)?.description ?? null,
  );
  const undoLabel = undoDescription ? `Undo ${undoDescription}` : "Undo";
  const redoLabel = redoDescription ? `Redo ${redoDescription}` : "Redo";
  const [workspaceSummaries, setWorkspaceSummaries] = useState<
    ProjectWorkspaceSummary[]
  >([]);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showNewPathDialog, setShowNewPathDialog] = useState(false);
  const [newPathGroupContextId, setNewPathGroupContextId] = useState<
    string | null | undefined
  >(undefined);
  const [showDeleteProjectDialog, setShowDeleteProjectDialog] = useState(false);
  const [showDeletePathDialog, setShowDeletePathDialog] = useState(false);
  const [showPathGroupsDialog, setShowPathGroupsDialog] = useState(false);
  const [pathNameAction, setPathNameAction] = useState<PathNameAction | null>(
    null,
  );
  const [showLinkedTargetsDialog, setShowLinkedTargetsDialog] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPathHealth, setShowPathHealth] = useState(false);
  const [showHelpHub, setShowHelpHub] = useState(false);
  const [toursSupported, setToursSupported] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia(mobileSupportMediaQuery).matches,
  );
  const [showTourPicker, setShowTourPicker] = useState(false);
  const tourReturnPathRef = useRef<string | null>(null);
  const tourReturnFieldRef = useRef<string | null>(null);
  const activeTourId = useStoreSelector(
    tourStore,
    (state) => state.activeTourId,
  );
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 1120,
  );
  const [inspectorWidth, setInspectorWidth] = useState(
    () => readEditorUiPreferences().inspectorWidth,
  );
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
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
  const pathMenuButtonRef = useRef<HTMLButtonElement | null>(null);

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
    setActiveTool("select");
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
      setActiveTool("select");
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
        await projectStore.getState().initializeWorkspace();
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

  const optimizerPhase = useStoreSelector(
    autoVelocityStore,
    (state) => state.phase,
  );
  const optimizerError = useStoreSelector(
    autoVelocityStore,
    (state) => state.lastError,
  );
  const autoSyncEnabled = useStoreSelector(
    autoVelocityStore,
    (state) => state.autoSyncEnabled,
  );

  useEffect(() => startAutoVelocitySync(), []);

  useEffect(() => {
    const mobileQuery = window.matchMedia(mobileSupportMediaQuery);

    const syncMobileWarning = () => {
      setShowMobileSupportWarning(
        mobileQuery.matches && !hasDismissedMobileSupportWarning(),
      );
      setToursSupported(!mobileQuery.matches);
      // Coach marks cannot coexist with the mobile overlay inspector.
      if (mobileQuery.matches) {
        tourStore.getState().exit();
      }
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
        shouldDefer: () =>
          canvasInteractionActiveRef.current ||
          projectStore.getState().status === "conflict",
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

  const handleNewProject = useCallback(() => {
    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setShowNewProjectDialog(true);
  }, []);

  const handleConfirmCreateProject = useCallback(
    async ({
      pathName,
      projectName,
    }: {
      pathName: string;
      projectName: string;
    }) => {
      autosaveRef.current?.cancel();

      try {
        await projectStore
          .getState()
          .createWorkspace(createNamedCanvasWorkspace(projectName, pathName));
        selectionStore.getState().clearSelection();
        setShowNewProjectDialog(false);
        setShowOpenPanel(false);
        await refreshWorkspaceSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    },
    [refreshWorkspaceSummaries],
  );

  const handleOpenSample = useCallback(async () => {
    autosaveRef.current?.cancel();

    try {
      await projectStore
        .getState()
        .createWorkspace(createSampleCanvasWorkspace());
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      setOpenTopMenu(null);
    }
  }, [refreshWorkspaceSummaries]);

  // Tours run on a throwaway path so every step is safe to actually perform.
  const startGuidedTour = useCallback((tourId: string) => {
    const tourDefinition = findTour(tourId);
    const state = projectStore.getState();
    const currentWorkspace = state.workspace;
    if (!tourDefinition || !currentWorkspace) {
      return;
    }

    const existingPractice = currentWorkspace.paths.find(
      (path) => path.display_name === tourPracticePathName,
    );
    const currentPathId = currentWorkspace.active_path_id;
    tourReturnPathRef.current =
      currentPathId && currentPathId !== existingPractice?.path_id
        ? currentPathId
        : null;

    // Recreate the practice path from this lesson's seed so every lesson
    // opens in the state its steps assume.
    if (existingPractice) {
      state.deletePaths([existingPractice.path_id]);
    }
    state.createPath({
      displayName: tourPracticePathName,
      path: tourDefinition.practicePath(),
    });

    // Lessons teach on the neutral blank grid; the user's field comes back
    // as soon as the tour ends.
    const latestState = projectStore.getState();
    const activeProject = latestState.project;
    if (
      activeProject &&
      activeProject.config.gui.field.selected_field_id !== "blank-grid"
    ) {
      tourReturnFieldRef.current =
        activeProject.config.gui.field.selected_field_id;
      const nextConfig = structuredClone(activeProject.config);
      nextConfig.gui.field.selected_field_id = "blank-grid";
      latestState.applyCommand(
        createUpdateProjectConfigCommand(activeProject.config, nextConfig),
      );
    } else {
      tourReturnFieldRef.current = null;
    }

    selectionStore.getState().clearSelection();
    setInspectorOpen(true);
    tourStore.getState().start(tourId);
  }, []);

  // Put the user back on the path and field they were editing once the tour
  // ends.
  useEffect(() => {
    if (activeTourId) {
      return;
    }

    const returnFieldId = tourReturnFieldRef.current;
    if (returnFieldId) {
      tourReturnFieldRef.current = null;
      const state = projectStore.getState();
      const activeProject = state.project;
      if (
        activeProject &&
        activeProject.config.gui.field.selected_field_id !== returnFieldId
      ) {
        const nextConfig = structuredClone(activeProject.config);
        nextConfig.gui.field.selected_field_id = returnFieldId;
        state.applyCommand(
          createUpdateProjectConfigCommand(activeProject.config, nextConfig),
        );
      }
    }

    const returnPathId = tourReturnPathRef.current;
    if (!returnPathId) {
      return;
    }

    tourReturnPathRef.current = null;
    const currentWorkspace = projectStore.getState().workspace;
    if (currentWorkspace?.paths.some((path) => path.path_id === returnPathId)) {
      projectStore.getState().setActivePath(returnPathId);
    }
  }, [activeTourId]);

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      setActiveTool(tool);
      if (tool === "curve") {
        const activeProject = projectStore.getState().project;
        if (activeProject) {
          handleStartCurveTool(activeProject.path.path_elements.length);
        }
      } else if (curveToolSession) {
        setCurveToolSession(null);
      }
    },
    [curveToolSession, handleStartCurveTool],
  );
  const handleSelectTool = useCallback(
    () => handleToolChange("select"),
    [handleToolChange],
  );
  const handleWaypointTool = useCallback(
    () => handleToolChange("waypoint"),
    [handleToolChange],
  );
  const handleTranslationTool = useCallback(
    () => handleToolChange("translation"),
    [handleToolChange],
  );
  const handleRotationTool = useCallback(
    () => handleToolChange("rotation"),
    [handleToolChange],
  );
  const handleEventTool = useCallback(
    () => handleToolChange("event"),
    [handleToolChange],
  );
  const handleCurveTool = useCallback(
    () => handleToolChange("curve"),
    [handleToolChange],
  );

  const handlePlaceCanvasElement = useCallback(
    (placement: CanvasElementPlacement) => {
      const activeProject = projectStore.getState().project;
      if (!activeProject) {
        return;
      }

      const selectedIndex = selectionStore.getState().selectedElementIndex;
      const element = createDefaultElement(
        activeProject,
        placement.type,
        selectedIndex,
      );
      if (element.type === "translation") {
        element.x_meters = placement.position.x_meters;
        element.y_meters = placement.position.y_meters;
      } else if (element.type === "waypoint") {
        element.translation_target.x_meters = placement.position.x_meters;
        element.translation_target.y_meters = placement.position.y_meters;
      } else if (
        (element.type === "rotation" || element.type === "event_trigger") &&
        placement.ratio !== undefined
      ) {
        element.t_ratio = placement.ratio;
      }

      projectStore
        .getState()
        .applyCommand(
          createInsertPathElementCommand(placement.insertionIndex, element),
        );
      selectionStore
        .getState()
        .selectElement(
          placement.insertionIndex,
          projectStore.getState().project,
        );
    },
    [],
  );

  const handleDismissMobileSupportWarning = useCallback(() => {
    markMobileSupportWarningDismissed();
    setShowMobileSupportWarning(false);
  }, []);

  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflictDiff, setConflictDiff] =
    useState<WorkspaceConflictDiff | null>(null);
  const [conflictDiffLoading, setConflictDiffLoading] = useState(false);

  useEffect(() => {
    if (status !== "conflict" || !projectIo) {
      return;
    }

    let cancelled = false;
    void (async () => {
      setConflictDiff(null);
      setConflictDiffLoading(true);
      try {
        const mine = projectStore.getState().workspace;
        const theirs = await projectIo.peekWorkspace();
        if (cancelled || !mine) {
          return;
        }
        setConflictDiff(diffWorkspaceConflict(mine, theirs));
      } catch {
        if (!cancelled) {
          setConflictDiff(null);
        }
      } finally {
        if (!cancelled) {
          setConflictDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, projectIo]);

  const handleReloadFromDisk = useCallback(async () => {
    setResolvingConflict(true);
    try {
      await projectStore.getState().reloadFromDisk();
      autosaveRef.current?.cancel();
    } catch {
      // The store keeps the conflict/error state so the dialog stays actionable.
    } finally {
      setResolvingConflict(false);
    }
  }, []);

  const handleOverwriteConflict = useCallback(async () => {
    setResolvingConflict(true);
    try {
      await projectStore.getState().overwriteConflict();
      autosaveRef.current?.cancel();
    } catch {
      // Overwrite can still fail (e.g. permissions); leave the dialog open.
    } finally {
      setResolvingConflict(false);
    }
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

      if (
        hasActiveBlockingSurface({
          openTopMenu,
          showCommandPalette,
          showConfigDialog,
          showDeletePathDialog,
          showDeleteProjectDialog,
          showLinkedTargetsDialog,
          showMobileSupportWarning,
          showNameEntryDialog: pathNameAction !== null,
          showNewPathDialog,
          showNewProjectDialog,
          showOpenPanel,
          showPathGroupsDialog,
          showSaveConflict: status === "conflict",
          showShortcutHelp,
          showTourPicker,
        })
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === "F1") {
        event.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      if (modifier) {
        if (event.altKey) {
          return;
        }

        if (key === "k") {
          event.preventDefault();
          setShowCommandPalette(true);
          return;
        }

        if (key === "b") {
          event.preventDefault();
          setInspectorOpen((current) => !current);
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

        if (key === "d") {
          if (duplicateSelectedPathElement()) {
            event.preventDefault();
          }
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
        isEditableShortcutTarget(event.target) ||
        (isInteractiveShortcutTarget(event.target) &&
          !isPathElementShortcutTarget(event.target) &&
          !isRangedConstraintShortcutTarget(event.target))
      ) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowShortcutHelp(true);
        return;
      }

      if (event.key === "Escape" && activeTool !== "select") {
        event.preventDefault();
        setActiveTool("select");
        setCurveToolSession(null);
        return;
      }

      const toolShortcut = toolForShortcut(event.key);
      if (toolShortcut && projectStore.getState().project) {
        event.preventDefault();
        handleToolChange(toolShortcut);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (removeSelectedRangedConstraint() || removeSelectedPathElement()) {
          event.preventDefault();
        }
        return;
      }

      // Alt + Up/Down reorders the selected element within the path.
      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        if (moveSelectedPathElement(event.key === "ArrowUp" ? -1 : 1)) {
          event.preventDefault();
        }
        return;
      }

      // [ and ] step the selection through the path elements.
      if (event.key === "[" || event.key === "]") {
        if (selectAdjacentPathElement(event.key === "[" ? -1 : 1)) {
          event.preventDefault();
        }
        return;
      }

      // Arrow keys nudge the selected element on the field; Shift = coarse.
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        const step = event.shiftKey ? 0.25 : 0.05;
        const dx =
          event.key === "ArrowRight"
            ? step
            : event.key === "ArrowLeft"
              ? -step
              : 0;
        const dy =
          event.key === "ArrowUp"
            ? step
            : event.key === "ArrowDown"
              ? -step
              : 0;
        if (nudgeSelectedPathElement(dx, dy)) {
          event.preventDefault();
        }
        return;
      }

      if (event.altKey) {
        return;
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    handleSaveProject,
    handleToolChange,
    activeTool,
    openTopMenu,
    showCommandPalette,
    showConfigDialog,
    showNewProjectDialog,
    showDeletePathDialog,
    showDeleteProjectDialog,
    showPathGroupsDialog,
    showShortcutHelp,
    showLinkedTargetsDialog,
    showMobileSupportWarning,
    showOpenPanel,
    showNewPathDialog,
    pathNameAction,
    showTourPicker,
    status,
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

  const handleCreateWorkspace = useCallback(() => {
    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setShowNewProjectDialog(true);
  }, []);

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

  const handleSavePathAs = useCallback(() => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    pathMenuButtonRef.current?.focus();
    setPathNameAction({
      kind: "duplicate",
      pathId: activePath.path_id,
      initialName: activePath.display_name,
    });
    setOpenTopMenu(null);
  }, []);

  const handleRenamePath = useCallback(() => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    pathMenuButtonRef.current?.focus();
    setPathNameAction({
      kind: "rename",
      pathId: activePath.path_id,
      initialName: activePath.display_name,
    });
    setOpenTopMenu(null);
  }, []);

  const handleConfirmPathNameAction = useCallback(
    (displayName: string) => {
      if (!pathNameAction) {
        return;
      }

      try {
        if (pathNameAction.kind === "duplicate") {
          projectStore
            .getState()
            .duplicatePath(pathNameAction.pathId, displayName);
          selectionStore.getState().clearSelection();
        } else {
          projectStore
            .getState()
            .renamePath(pathNameAction.pathId, displayName);
        }
        setPathNameAction(null);
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [pathNameAction],
  );

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
    (
      nextConfig: NonNullable<typeof project>["config"],
      options: { autoSyncEnabled: boolean; configChanged: boolean },
    ) => {
      const activeProject = projectStore.getState().project;
      if (!activeProject) {
        return;
      }

      if (options.configChanged) {
        projectStore
          .getState()
          .applyCommand(
            createUpdateProjectConfigCommand(activeProject.config, nextConfig),
          );
      }
      autoVelocityStore.getState().setAutoSyncEnabled(options.autoSyncEnabled);
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
  const pathDiagnostics = useMemo(
    () => derivePathDiagnostics(project, workspace),
    [project, workspace],
  );
  // A broken reference should read as more urgent than a soft warning.
  const pathHealthSeverity = pathDiagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? "error"
    : "warning";
  const handleSelectPathFromToolbar = useCallback((pathId: string) => {
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  }, []);
  const handleSelectCollectionFromToolbar = useCallback(
    (groupId: string | null) => {
      projectStore.getState().setActivePathGroup(groupId);
      selectionStore.getState().clearSelection();
    },
    [],
  );
  const commands: EditorCommand[] = [
    {
      id: "project.navigator",
      label: "Open project navigator",
      category: "Project",
      keywords: ["paths", "collections", "library"],
      disabled: !workspace,
      run: handleShowPathLibrary,
    },
    {
      id: "project.new-path",
      label: "Create new path",
      category: "Project",
      keywords: ["add"],
      disabled: !workspace,
      run: () => void handleCreateNewPath(),
    },
    {
      id: "project.settings",
      label: "Open project settings",
      category: "Project",
      disabled: !project,
      run: () => setShowConfigDialog(true),
    },
    {
      id: "project.save",
      label: "Save now",
      category: "Project",
      shortcut: { key: "s", metaOrCtrl: true },
      disabled: !workspace || !projectIo,
      run: () => void handleSaveProject(),
    },
    {
      id: "edit.undo",
      label: "Undo",
      category: "Edit",
      shortcut: { key: "z", metaOrCtrl: true },
      disabled: !canUndo,
      run: () => projectStore.getState().undo(),
    },
    {
      id: "edit.redo",
      label: "Redo",
      category: "Edit",
      shortcut: { key: "z", metaOrCtrl: true, shift: true },
      disabled: !canRedo,
      run: () => projectStore.getState().redo(),
    },
    {
      id: "path.generate-constraints",
      label: "Generate constraints",
      category: "Path",
      keywords: ["corner", "handoff", "radius", "seed", "optimize", "velocity"],
      disabled:
        !project ||
        optimizerPhase === "running" ||
        !canGenerateConstraints(project),
      run: () => {
        if (project) {
          void generateAutoConstraintsInWorker(
            autoVelocitySettingsForPath(project.path, project.config),
          );
        }
      },
    },
    {
      id: "edit.duplicate-element",
      label: "Duplicate element",
      category: "Edit",
      keywords: ["copy", "clone"],
      shortcut: { key: "d", metaOrCtrl: true },
      disabled: selectedElementIndex === null,
      run: () => {
        duplicateSelectedPathElement();
      },
    },
    {
      id: "view.inspector",
      label: "Toggle inspector",
      category: "View",
      shortcut: { key: "b", metaOrCtrl: true },
      disabled: !project,
      run: () => setInspectorOpen((current) => !current),
    },
    {
      id: "help.shortcuts",
      label: "Keyboard shortcuts",
      category: "Help",
      shortcut: { key: "?" },
      run: () => setShowShortcutHelp(true),
    },
    {
      id: "tool.select",
      label: "Select tool",
      category: "Canvas tools",
      shortcut: { key: "v" },
      disabled: !project,
      run: handleSelectTool,
    },
    {
      id: "tool.waypoint",
      label: "Waypoint tool",
      category: "Canvas tools",
      shortcut: { key: "1" },
      disabled: !project,
      run: handleWaypointTool,
    },
    {
      id: "tool.translation",
      label: "Translation tool",
      category: "Canvas tools",
      shortcut: { key: "2" },
      disabled: !project,
      run: handleTranslationTool,
    },
    {
      id: "tool.rotation",
      label: "Rotation tool",
      category: "Canvas tools",
      shortcut: { key: "3" },
      disabled: !project,
      run: handleRotationTool,
    },
    {
      id: "tool.event",
      label: "Event tool",
      category: "Canvas tools",
      shortcut: { key: "4" },
      disabled: !project,
      run: handleEventTool,
    },
    {
      id: "tool.curve",
      label: "Curve tool",
      category: "Canvas tools",
      shortcut: { key: "c" },
      disabled: !project,
      run: handleCurveTool,
    },
    ...pathDocuments.map((path) => ({
      id: `path.open.${path.path_id}`,
      label: `Open path: ${path.display_name}`,
      category: "Paths",
      keywords: [path.file_name],
      run: () => handleSelectPathFromToolbar(path.path_id),
    })),
  ];

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="app-toolbar" ref={toolbarRef}>
        <nav className="app-tabs" aria-label="Top menu">
          <IconButton
            className="app-toolbar__navigator-button"
            aria-label="Open project navigator"
            title="Open project navigator"
            disabled={!workspace}
            onClick={handleShowPathLibrary}
          >
            <FolderTree aria-hidden="true" size={17} />
          </IconButton>
          <TopMenuButton
            id="project"
            label="File"
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
            triggerRef={pathMenuButtonRef}
            openTopMenu={openTopMenu}
            setOpenTopMenu={setActiveTopMenu}
          >
            <MenuLabel>Current: {pathLabel}</MenuLabel>
            <MenuLabel>
              Collection: {activePathGroup?.display_name ?? "All Paths"}
            </MenuLabel>
            <div className="top-menu__separator" role="separator" />
            <MenuAction
              label="Linked Elements..."
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
        </nav>
        <nav className="toolbar-actions" aria-label="Project actions">
          <div className="toolbar-actions__quick">
            <ToolbarPathNavigator
              workspace={workspace}
              activeGroup={activePathGroup}
              activePath={activePath}
              visiblePaths={visiblePathDocuments}
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
                label={undoLabel}
                shortcut={{ key: "z", metaOrCtrl: true }}
                disabled={!canUndo || toolbarBusy}
                onAction={() => {
                  setShowOpenPanel(false);
                  projectStore.getState().undo();
                  setOpenTopMenu(null);
                }}
              />
              <MenuAction
                label={redoLabel}
                shortcut={{ key: "z", metaOrCtrl: true, shift: true }}
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
                label="Project Navigator..."
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
          <div className="toolbar-actions__buttons">
            <IconButton
              aria-label="Undo"
              aria-keyshortcuts="Meta+Z Control+Z"
              title={`${undoLabel} (${formatShortcut({
                key: "z",
                metaOrCtrl: true,
              })})`}
              disabled={!canUndo}
              onClick={() => projectStore.getState().undo()}
            >
              <Undo2 aria-hidden="true" size={16} />
            </IconButton>
            <IconButton
              aria-label="Redo"
              aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
              title={`${redoLabel} (${formatShortcut({
                key: "z",
                metaOrCtrl: true,
                shift: true,
              })})`}
              disabled={!canRedo}
              onClick={() => projectStore.getState().redo()}
            >
              <Redo2 aria-hidden="true" size={16} />
            </IconButton>
            <button
              type="button"
              className="command-search-button"
              aria-label="Search commands and paths"
              onClick={() => setShowCommandPalette(true)}
            >
              <Search aria-hidden="true" size={16} />
              <span>Commands</span>
              <kbd>⌘K</kbd>
            </button>
            <OptimizerLiveRegion />
            <div className="path-health-control" data-tour="path-health">
              <IconButton
                className={
                  pathDiagnostics.length > 0
                    ? `has-diagnostics has-diagnostics--${pathHealthSeverity}`
                    : ""
                }
                aria-label={`Path health: ${pathDiagnostics.length} issues`}
                aria-expanded={showPathHealth}
                title={
                  pathDiagnostics.length > 0
                    ? `Path health — ${pathDiagnostics.length} ${
                        pathDiagnostics.length === 1 ? "issue" : "issues"
                      } to review`
                    : "Path health — editor checks for this path"
                }
                disabled={!project}
                onClick={() => {
                  setShowHelpHub(false);
                  setShowPathHealth((current) => !current);
                }}
              >
                <Activity aria-hidden="true" size={16} />
                {pathDiagnostics.length > 0 ? (
                  <span>{pathDiagnostics.length}</span>
                ) : null}
              </IconButton>
              {showPathHealth ? (
                <PathHealthPopover
                  diagnostics={pathDiagnostics}
                  saveError={error}
                  onSelect={(diagnostic) => {
                    if (diagnostic.elementIndex !== undefined) {
                      selectionStore
                        .getState()
                        .selectElement(diagnostic.elementIndex, project);
                      setInspectorOpen(true);
                    }
                    setShowPathHealth(false);
                  }}
                />
              ) : null}
            </div>
            <div className="help-hub-control" data-tour="help-hub">
              <IconButton
                aria-label="Help and tutorials"
                aria-expanded={showHelpHub}
                title="Help and tutorials"
                onClick={() => {
                  setShowPathHealth(false);
                  setShowHelpHub((current) => !current);
                }}
              >
                <CircleHelp aria-hidden="true" size={16} />
              </IconButton>
              {showHelpHub ? (
                <HelpHubPopover
                  tourAvailable={Boolean(project) && toursSupported}
                  tourUnavailableReason={
                    toursSupported
                      ? "Open a path first"
                      : "Tours need a larger window"
                  }
                  onClose={() => setShowHelpHub(false)}
                  onStartTour={() => {
                    setShowHelpHub(false);
                    setShowTourPicker(true);
                  }}
                  onShortcuts={() => {
                    setShowHelpHub(false);
                    setShowShortcutHelp(true);
                  }}
                  onCommandPalette={() => {
                    setShowHelpHub(false);
                    setShowCommandPalette(true);
                  }}
                  onOpenSample={() => {
                    setShowHelpHub(false);
                    void handleOpenSample();
                  }}
                />
              ) : null}
            </div>
            <IconButton
              aria-label="Settings"
              title="Project settings"
              disabled={!project}
              onClick={() => setShowConfigDialog(true)}
            >
              <Settings aria-hidden="true" size={16} />
            </IconButton>
            <IconButton
              // With the inspector closed the Constraints tab is gone, so the
              // current traces the control that brings it back.
              className={
                inspectorOpen
                  ? ""
                  : optimizerBeamClass(optimizerPhase, optimizerError)
              }
              aria-label="Toggle inspector"
              aria-expanded={inspectorOpen}
              aria-keyshortcuts="Meta+B Control+B"
              title={
                inspectorOpen
                  ? "Toggle inspector (⌘B)"
                  : optimizerBeamTitle(
                      optimizerPhase,
                      optimizerError,
                      "Toggle inspector (⌘B)",
                    )
              }
              disabled={!project}
              onClick={() => setInspectorOpen((current) => !current)}
            >
              <PanelRight aria-hidden="true" size={16} />
            </IconButton>
          </div>
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

      <div
        className={[
          "workspace",
          workspace && !inspectorOpen ? "is-inspector-collapsed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            "--inspector-width": `${inspectorWidth}px`,
          } as CSSProperties
        }
      >
        {!workspace ? (
          <StartCenter
            initializing={initializing}
            recentWorkspaces={projectSummaries}
            supportsProjectFolders={supportsProjectFolders}
            onCreateProject={handleNewProject}
            onImportArchive={() => queueFileImport("archive")}
            onImportFolder={queueFolderImport}
            onOpenProject={() => {
              if (supportsProjectFolders) {
                void handleOpenWorkspace();
              } else {
                handleOpenProjectPanel();
              }
            }}
            onOpenRecent={(id) => {
              if (supportsProjectFolders) {
                void handleSwitchWorkspace(id);
              } else {
                void handleOpenWorkspaceById(id);
              }
            }}
            onOpenSample={() => void handleOpenSample()}
            tourSupported={toursSupported}
            onStartTour={() => {
              // There is no workspace yet on the start center, so open the
              // sample first and then hand over to the tour.
              void handleOpenSample().then(() =>
                startGuidedTour(editorBasicsTour.id),
              );
            }}
          />
        ) : (
          <>
            <section className="canvas-region" aria-label="Editor canvas">
              <PathStage
                activeTool={activeTool}
                curveTool={curveToolSession}
                onToolChange={handleToolChange}
                onPlaceElement={handlePlaceCanvasElement}
                onInteractionStateChange={handleCanvasInteractionStateChange}
                onCurveToolCommit={handleCommitCurveTool}
                onCurveToolCancel={handleCancelCurveTool}
              />
              {project?.path.path_elements.length === 0 ? (
                <div className="canvas-empty-guide">
                  <strong>Place your first waypoint</strong>
                  <span>Choose Waypoint or press 1, then click the field.</span>
                  <button
                    type="button"
                    onClick={() => handleToolChange("waypoint")}
                  >
                    Use waypoint tool
                  </button>
                </div>
              ) : null}
            </section>

            {inspectorOpen ? (
              <button
                type="button"
                className="inspector-backdrop is-open"
                aria-label="Dismiss inspector"
                onClick={() => setInspectorOpen(false)}
              />
            ) : null}
            <Sidebar
              project={project}
              workspace={workspace}
              selectedElementIndex={selectedElementIndex}
              open={inspectorOpen}
              inspectorWidth={inspectorWidth}
              curveToolActive={curveToolSession !== null}
              onClose={() => setInspectorOpen(false)}
              onInspectorResize={(width) =>
                setInspectorWidth(clampInspectorWidth(width))
              }
              onStartCurve={handleStartCurveTool}
              onOpenLinkedTargetPicker={handleOpenLinkedTargetPicker}
            />
          </>
        )}
      </div>

      <footer className="status-bar" aria-label="Workspace status">
        <span
          className="status-bar__selection"
          data-testid="selected-element-status"
          title={selectedSummary}
        >
          {selectedElement && selectedElementIndex !== null
            ? `${getElementLabel(selectedElement)} ${selectedElementIndex + 1} · ${formatPointMeters(selectedPosition)}`
            : workspace
              ? "Nothing selected"
              : "Ready"}
        </span>
        <span className="status-bar__hint">
          {workspace ? toolHint(activeTool, curveToolSession !== null) : ""}
        </span>
        <div className="status-bar__system">
          {pathDiagnostics.length > 0 ? (
            <button
              type="button"
              className="status-bar__diagnostics"
              onClick={() => setShowPathHealth(true)}
            >
              {pathDiagnostics.length}{" "}
              {pathDiagnostics.length === 1 ? "issue" : "issues"}
            </button>
          ) : null}
          <span className="sr-only" data-testid="current-path-status">
            {currentPathSummary}
          </span>
          <span className="sr-only" data-testid="current-project-status">
            {currentProjectSummary}
          </span>
          <span className="sr-only" data-testid="storage-status">
            {storageLabel}
          </span>
          <button
            type="button"
            className={`status-bar__save status-bar__save--${saveStatusTone}`}
            data-testid="save-status"
            title={`${storageLabel}. ${saveStatus}`}
            aria-label="Save"
            aria-live="polite"
            onClick={() => void handleSaveProject()}
          >
            <span className="status-bar__save-dot" aria-hidden="true" />
            <span>{compactSaveStatus(saveStatus, saveStatusTone)}</span>
            {saveStatusTone === "danger" ? <strong>Retry</strong> : null}
          </button>
        </div>
      </footer>

      {project && showConfigDialog ? (
        <ProjectConfigDialog
          autoSyncEnabled={autoSyncEnabled}
          config={project.config}
          onCancel={() => setShowConfigDialog(false)}
          onSave={handleSaveConfig}
          onUploadFieldImage={handleUploadFieldImage}
          onLoadFieldImage={handleLoadFieldImage}
        />
      ) : null}
      {showNewProjectDialog ? (
        <CreateProjectDialog
          onCancel={() => setShowNewProjectDialog(false)}
          onCreate={(input) => void handleConfirmCreateProject(input)}
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
      {pathNameAction ? (
        <NameEntryDialog
          ariaLabel={
            pathNameAction.kind === "duplicate" ? "Save Path As" : "Rename Path"
          }
          title={
            pathNameAction.kind === "duplicate" ? "Save Path As" : "Rename Path"
          }
          description={
            pathNameAction.kind === "duplicate"
              ? "Create a separate editable copy of this path."
              : "Update the path name everywhere it appears in this project."
          }
          fieldLabel="Path name"
          initialValue={pathNameAction.initialName}
          submitLabel={
            pathNameAction.kind === "duplicate" ? "Save Copy" : "Rename"
          }
          onCancel={() => setPathNameAction(null)}
          onSubmit={handleConfirmPathNameAction}
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
      {status === "conflict" ? (
        <SaveConflictDialog
          busy={resolvingConflict}
          diff={conflictDiff}
          diffLoading={conflictDiffLoading}
          onReload={() => void handleReloadFromDisk()}
          onOverwrite={() => void handleOverwriteConflict()}
        />
      ) : null}
      {showCommandPalette ? (
        <CommandPalette
          commands={commands}
          onClose={() => setShowCommandPalette(false)}
        />
      ) : null}
      {showShortcutHelp ? (
        <ShortcutHelpDialog
          commands={commands}
          onClose={() => setShowShortcutHelp(false)}
        />
      ) : null}
      {showTourPicker ? (
        <TourPickerDialog
          onClose={() => setShowTourPicker(false)}
          onStart={(tourId) => {
            setShowTourPicker(false);
            startGuidedTour(tourId);
          }}
        />
      ) : null}
      <TourOverlay
        onPrepare={(preparation) => {
          if (preparation.inspector === "open") {
            setInspectorOpen(true);
          }
          if (preparation.tool === "select") {
            handleToolChange("select");
          }
          if (preparation.selectElement !== undefined) {
            selectionStore
              .getState()
              .selectElement(
                preparation.selectElement,
                projectStore.getState().project,
              );
          }
        }}
      />
    </main>
  );
}

function TourPickerDialog({
  onClose,
  onStart,
}: {
  onClose(): void;
  onStart(tourId: string): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const completedTourIds = useStoreSelector(
    tourStore,
    (state) => state.completedTourIds,
  );

  return (
    <div
      className="config-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="tour-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Guided tours"
        data-testid="tour-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="tour-picker__header">
          <div>
            <strong>
              <span aria-hidden="true">🧭</span> Guided tours
            </strong>
            <span>Short lessons on a practice path. Leave any time.</span>
          </div>
          <CloseButton ariaLabel="Close guided tours" onClick={onClose} />
        </header>
        <div className="tour-picker__list">
          {tours.map((tour, index) => {
            const done = completedTourIds.includes(tour.id);
            return (
              <button
                key={tour.id}
                type="button"
                className={done ? "is-done" : ""}
                data-testid={`tour-picker-${tour.id}`}
                onClick={() => onStart(tour.id)}
              >
                <span className="tour-picker__badge">
                  {done ? "✓" : index + 1}
                </span>
                <span className="tour-picker__copy">
                  <strong>{tour.title}</strong>
                  <small>
                    {tour.summary} · {tour.steps.length} steps
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

type TopMenuId = "project" | "path" | "edit" | "view" | "help" | "actions";
type ImportMode = "archive" | "path" | "config";
type PendingToolbarAction = "open" | "import" | "export" | null;

const MOBILE_SUPPORT_WARNING_DISMISSED_KEY =
  "bline-web:mobile-support-warning-dismissed";

const mobileSupportMediaQuery =
  "(max-width: 767px), (pointer: coarse) and (max-width: 980px)";

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

function SaveConflictDialog({
  busy,
  diff,
  diffLoading,
  onReload,
  onOverwrite,
}: {
  busy: boolean;
  diff: WorkspaceConflictDiff | null;
  diffLoading: boolean;
  onReload(): void;
  onOverwrite(): void;
}) {
  const overwriteButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    overwriteButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="config-dialog-backdrop mobile-warning-backdrop"
      role="presentation"
    >
      <section
        className="mobile-warning-dialog save-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        aria-describedby="save-conflict-description"
        data-testid="save-conflict-dialog"
      >
        <header className="mobile-warning-dialog__header">
          <span className="mobile-warning-dialog__icon" aria-hidden="true">
            !
          </span>
          <h2 id="save-conflict-title">The project changed on disk</h2>
        </header>
        <p id="save-conflict-description">
          BLine couldn&apos;t autosave because this project&apos;s files were
          modified outside the app (for example by git, a deploy, or file sync).
          Your unsaved changes are still here until you decide.
        </p>
        <SaveConflictDiffSummary diff={diff} loading={diffLoading} />
        <footer className="mobile-warning-dialog__footer save-conflict-dialog__footer">
          <button
            type="button"
            className="mobile-warning-dialog__action save-conflict-dialog__action--secondary"
            onClick={onReload}
            disabled={busy}
          >
            Reload from disk
          </button>
          <button
            ref={overwriteButtonRef}
            type="button"
            className="mobile-warning-dialog__action"
            onClick={onOverwrite}
            disabled={busy}
          >
            Keep my changes
          </button>
        </footer>
      </section>
    </div>
  );
}

function SaveConflictDiffSummary({
  diff,
  loading,
}: {
  diff: WorkspaceConflictDiff | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="save-conflict-diff save-conflict-diff--muted">
        Comparing your changes with what&apos;s on disk…
      </p>
    );
  }

  if (!diff) {
    return (
      <p className="save-conflict-diff save-conflict-diff--muted">
        Couldn&apos;t read the on-disk version to compare. &quot;Keep my
        changes&quot; overwrites it; &quot;Reload from disk&quot; discards your
        unsaved edits.
      </p>
    );
  }

  if (!diff.hasChanges) {
    return (
      <p className="save-conflict-diff save-conflict-diff--muted">
        The files were touched but the contents match your version. Either
        option is safe.
      </p>
    );
  }

  const rows: { label: string; items: string[] }[] = [
    {
      label: "Only in your version (will be added on disk)",
      items: diff.addedPaths,
    },
    {
      label: "Only on disk (will be removed if you overwrite)",
      items: diff.removedPaths,
    },
    { label: "Changed on both sides", items: diff.changedPaths },
  ];

  return (
    <div className="save-conflict-diff" data-testid="save-conflict-diff">
      <p className="save-conflict-diff__intro">
        Differences between your unsaved version and the copy on disk:
      </p>
      <ul className="save-conflict-diff__list">
        {rows
          .filter((row) => row.items.length > 0)
          .map((row) => (
            <li key={row.label}>
              <span className="save-conflict-diff__label">{row.label}:</span>{" "}
              {row.items.join(", ")}
            </li>
          ))}
        {diff.configChanged ? (
          <li>
            <span className="save-conflict-diff__label">
              Project settings differ
            </span>
          </li>
        ) : null}
        {diff.linkedTargetsChanged ? (
          <li>
            <span className="save-conflict-diff__label">
              Linked targets differ
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ToolbarPathNavigator({
  workspace,
  activeGroup,
  activePath,
  visiblePaths,
  onSelectGroup,
  onSelectPath,
}: {
  workspace: ProjectWorkspaceDocument | null;
  activeGroup: ProjectPathGroupDocument | null;
  activePath: ProjectPathDocument | null;
  visiblePaths: ProjectPathDocument[];
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
    <div
      className="path-toolbar-navigator"
      data-testid="path-toolbar-nav"
      data-tour="path-breadcrumb"
    >
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--collection"
        style={toolbarSelectWidthStyle(collectionLabel, 14, 26)}
      >
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
      <span className="path-toolbar-navigator__separator" aria-hidden="true">
        /
      </span>
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--path"
        style={toolbarSelectWidthStyle(pathLabel, 15, 34)}
      >
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

function CreateProjectDialog({
  onCancel,
  onCreate,
}: {
  onCancel(): void;
  onCreate(input: { projectName: string; pathName: string }): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const [projectName, setProjectName] = useState("My Robot Project");
  const [pathName, setPathName] = useState("Path 1");

  useEffect(() => {
    projectInputRef.current?.focus();
    projectInputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            projectName: projectName.trim() || "Untitled Project",
            pathName: pathName.trim() || "Path 1",
          });
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong id="create-project-title">Create project</strong>
            <span>Give your team a clear starting point.</span>
          </div>
          <CloseButton ariaLabel="Close create project" onClick={onCancel} />
        </header>
        <section className="create-project-dialog__body">
          <label className="dialog-field">
            <span>Project name</span>
            <input
              ref={projectInputRef}
              aria-label="Project name"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.currentTarget.value)}
            />
            <small>Use your robot, event, or season name.</small>
          </label>
          <label className="dialog-field">
            <span>First path</span>
            <input
              aria-label="First path name"
              type="text"
              value={pathName}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setPathName(event.currentTarget.value)}
            />
            <small>You can add collections and more paths later.</small>
          </label>
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-dialog-action">
            Create project
          </button>
        </footer>
      </form>
    </div>
  );
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
          <CloseButton ariaLabel="Close new path" onClick={onCancel} />
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

function NameEntryDialog({
  ariaLabel,
  description,
  fieldLabel,
  initialValue,
  onCancel,
  onSubmit,
  submitLabel,
  title,
}: {
  ariaLabel: string;
  description: string;
  fieldLabel: string;
  initialValue: string;
  onCancel(): void;
  onSubmit(displayName: string): void;
  submitLabel: string;
  title: string;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(initialValue);
  const normalizedName = displayName.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="new-path-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedName) {
            onSubmit(normalizedName);
          }
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <CloseButton
            ariaLabel={`Close ${ariaLabel.toLocaleLowerCase()}`}
            onClick={onCancel}
          />
        </header>
        <section className="new-path-dialog__body">
          <label className="dialog-field">
            <span>{fieldLabel}</span>
            <input
              ref={inputRef}
              aria-label={fieldLabel}
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-dialog-action"
            disabled={!normalizedName}
          >
            {submitLabel}
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
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    workspace.active_path_group_id ?? null,
  );
  const [selectedPathId, setSelectedPathId] = useState<string | null>(
    workspace.active_path_id ?? workspace.paths[0]?.path_id ?? null,
  );
  const [query, setQuery] = useState("");
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] =
    useState(false);
  const [deletingGroup, setDeletingGroup] =
    useState<ProjectPathGroupDocument | null>(null);
  const [nameAction, setNameAction] = useState<LibraryNameAction | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);
  const selectedGroup =
    workspace.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const selectedCollectionPaths = visiblePathsForGroup(
    workspace.paths,
    selectedGroup,
  ).filter((path) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      !normalizedQuery ||
      path.display_name.toLocaleLowerCase().includes(normalizedQuery) ||
      path.file_name.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
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

    setNameAction({
      kind: "rename-group",
      groupId: selectedGroup.group_id,
      initialName: selectedGroup.display_name,
    });
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

    setNameAction({
      kind: "duplicate-path",
      pathId: selectedPath.path_id,
      initialName: selectedPath.display_name,
      addToGroupId: selectedGroup?.group_id ?? null,
    });
  };

  const handleRenameSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    setNameAction({
      kind: "rename-path",
      pathId: selectedPath.path_id,
      initialName: selectedPath.display_name,
      addToGroupId: selectedGroup?.group_id ?? null,
    });
  };

  const handleConfirmNameAction = (displayName: string) => {
    if (!nameAction) {
      return;
    }

    try {
      if (nameAction.kind === "rename-group") {
        projectStore
          .getState()
          .renamePathGroup(nameAction.groupId, displayName);
      } else if (nameAction.kind === "duplicate-path") {
        projectStore.getState().duplicatePath(nameAction.pathId, displayName, {
          addToGroupId: nameAction.addToGroupId,
        });
        const nextPathId =
          projectStore.getState().workspace?.active_path_id ?? null;
        selectionStore.getState().clearSelection();
        setSelectedPathId(nextPathId);
      } else {
        projectStore.getState().renamePath(nameAction.pathId, displayName);
        setSelectedPathId(nameAction.pathId);
      }
      setNameAction(null);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
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
    <div className="project-navigator-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="path-library-dialog project-navigator"
        role="dialog"
        aria-modal="true"
        aria-label="Project Navigator"
        data-testid="path-library-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "F2" && selectedPath) {
            event.preventDefault();
            handleRenameSelectedPath();
          }
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong>Project Navigator</strong>
            <span>{workspace.display_name}</span>
          </div>
          <CloseButton ariaLabel="Close project navigator" onClick={onCancel} />
        </header>

        <div className="path-library-dialog__utility-bar">
          <div className="path-library-dialog__selection-summary">
            <strong>{selectedGroup?.display_name ?? "All Paths"}</strong>
            <span>
              {selectedCollectionPaths.length}{" "}
              {selectedCollectionPaths.length === 1 ? "path" : "paths"} visible
            </span>
          </div>
          <label className="project-navigator__search">
            <Search aria-hidden="true" size={15} />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search paths"
              placeholder="Search paths…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="path-library-dialog__utility-actions">
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
            <div
              className="path-library-dialog__group-list"
              role="listbox"
              aria-label="Collection list"
            >
              <button
                type="button"
                className={[
                  "path-library-dialog__group",
                  "is-permanent",
                  !selectedGroup ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                aria-selected={!selectedGroup}
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
                  role="option"
                  aria-selected={selectedGroup?.group_id === group.group_id}
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
            <div
              className="path-library-dialog__path-list"
              role="listbox"
              aria-label="Path list"
            >
              {selectedCollectionPaths.length > 0 ? (
                selectedCollectionPaths.map((path) => (
                  <button
                    key={path.path_id}
                    type="button"
                    role="option"
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
                    aria-selected={path.path_id === effectiveSelectedPathId}
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
              <strong>Membership</strong>
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
      {nameAction ? (
        <NameEntryDialog
          ariaLabel={
            nameAction.kind === "rename-group"
              ? "Rename Collection"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          title={
            nameAction.kind === "rename-group"
              ? "Rename Collection"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          description={
            nameAction.kind === "rename-group"
              ? "Update this collection name without changing its paths."
              : nameAction.kind === "duplicate-path"
                ? "Create a separate editable copy of this path."
                : "Update the path name everywhere it appears in this project."
          }
          fieldLabel={
            nameAction.kind === "rename-group" ? "Collection name" : "Path name"
          }
          initialValue={nameAction.initialName}
          submitLabel={
            nameAction.kind === "duplicate-path" ? "Save Copy" : "Rename"
          }
          onCancel={() => setNameAction(null)}
          onSubmit={handleConfirmNameAction}
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
  const [requestedTargetId, setSelectedTargetId] = useState<
    string | null | undefined
  >(undefined);
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
    requestedTargetId === undefined
      ? fallbackTargetId
      : requestedTargetId &&
          workspace.linked_targets.some(
            (target) => target.target_id === requestedTargetId,
          )
        ? requestedTargetId
        : null;

  const selectedTarget =
    workspace.linked_targets.find(
      (target) => target.target_id === selectedTargetId,
    ) ?? null;
  const selectedTargetCompatible =
    !pickerElement ||
    (selectedTarget
      ? isElementCompatibleWithLinkedTarget(pickerElement, selectedTarget)
      : false);
  const compatibleTargetIds = useMemo(
    () =>
      pickerElement
        ? new Set(pickerCompatibleTargets.map((target) => target.target_id))
        : null,
    [pickerElement, pickerCompatibleTargets],
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
      rotation_radians: kind === "waypoint" ? 0 : null,
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
        aria-label={linkRequest ? "Choose Linked Element" : "Linked Elements"}
        data-testid="linked-targets-dialog"
      >
        <header className="config-dialog__header">
          <strong>
            {linkRequest ? "Choose Linked Element" : "Linked Elements"}
          </strong>
          <CloseButton ariaLabel="Close linked elements" onClick={onCancel} />
        </header>

        <div className="path-library-dialog__utility-bar">
          <div className="path-library-dialog__selection-summary">
            <strong>
              {linkRequest
                ? `Element ${linkRequest.elementIndex + 1}`
                : (selectedTarget?.display_name ?? "No linked element")}
            </strong>
            <span>
              {linkRequest
                ? `${pickerCompatibleTargets.length} compatible / ${workspace.linked_targets.length} total`
                : `${workspace.linked_targets.length} ${
                    workspace.linked_targets.length === 1
                      ? "element"
                      : "elements"
                  } / ${activeUseCount} ${
                    activeUseCount === 1 ? "use" : "uses"
                  }`}
            </span>
          </div>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            onClick={() => createTarget("translation")}
          >
            <PlusIcon size={17} />
            <span>New Translation</span>
          </button>
          <button
            type="button"
            className="path-library-dialog__utility-button"
            onClick={() => createTarget("waypoint")}
          >
            <PlusIcon size={17} />
            <span>New Waypoint</span>
          </button>
        </div>

        <div
          className="linked-targets-dialog__body"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedTargetId(null);
            }
          }}
        >
          <aside className="linked-targets-dialog__list" aria-label="Elements">
            <div className="path-library-dialog__column-header">
              <strong>Elements</strong>
              <span>{workspace.linked_targets.length}</span>
            </div>
            <div
              className="path-library-dialog__path-list"
              role="list"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedTargetId(null);
                }
              }}
            >
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
                  No linked elements yet.
                </div>
              )}
            </div>
          </aside>

          <section
            className="linked-targets-dialog__preview-column"
            aria-label="Linked element preview"
          >
            <div className="path-library-dialog__column-header">
              <strong>Field Preview</strong>
              <span>{field.label}</span>
            </div>
            <div
              className="linked-targets-dialog__preview-shell"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedTargetId(null);
                }
              }}
            >
              <LinkedTargetsCanvas
                compatibleTargetIds={compatibleTargetIds}
                config={workspace.config}
                field={field}
                selectedTargetId={selectedTargetId}
                targets={workspace.linked_targets}
                onSelectTarget={setSelectedTargetId}
                onMoveTarget={(targetId, position) =>
                  projectStore.getState().updateLinkedTarget(targetId, {
                    x_meters: position.x_meters,
                    y_meters: position.y_meters,
                  })
                }
                onRotateTarget={(targetId, rotation_radians) =>
                  projectStore.getState().updateLinkedTarget(targetId, {
                    rotation_radians,
                  })
                }
              />
            </div>
          </section>

          <section
            className="path-library-dialog__details linked-targets-dialog__details"
            aria-label="Linked element details"
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
                      aria-label="Linked element name"
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
                    <SelectControl
                      ariaLabel="Linked element type"
                      value={selectedTarget.kind}
                      options={[
                        { label: "Translation", value: "translation" },
                        { label: "Waypoint", value: "waypoint" },
                      ]}
                      onChange={(kind) =>
                        updateTarget(selectedTarget.target_id, {
                          kind,
                        })
                      }
                    />
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
                    <SwitchInput
                      ariaLabel="Locked"
                      checked={Boolean(selectedTarget.locked)}
                      onChange={(locked) =>
                        updateTarget(selectedTarget.target_id, {
                          locked,
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
                  {selectedTarget.kind === "waypoint" ? (
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
                    Delete Linked Element
                  </button>
                </div>
              ) : (
                <div className="path-library-dialog__empty">
                  Select or create a linked element.
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="config-dialog__footer path-library-dialog__footer">
          {linkRequest ? (
            <button
              type="button"
              className="primary-dialog-action linked-targets-dialog__link-selected"
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
      <NumberStepperControl
        ariaLabel={label}
        className="dialog-number-control"
        disabled={disabled}
        min={min}
        max={max}
        step={label === "Heading (deg)" ? 1 : 0.05}
        precision={3}
        value={value}
        onChange={(nextValue) => {
          if (nextValue !== null) {
            onChange(clamp(nextValue, min, max));
          }
        }}
      />
    </label>
  );
}

function LinkedTargetListGlyph({ target }: { target: LinkedTarget }) {
  return (
    <svg
      className="linked-targets-dialog__target-glyph"
      viewBox="-16 -16 32 32"
      aria-hidden="true"
    >
      {target.kind === "waypoint" ? (
        <g
          transform={`rotate(${-radiansToDegrees(target.rotation_radians ?? 0)})`}
        >
          <rect
            x="-12.2"
            y="-12.2"
            width="24.4"
            height="24.4"
            rx="3.4"
            fill="#05080b"
            fillOpacity="0.28"
            stroke="#05080b"
            strokeOpacity="0.82"
            strokeWidth="3.1"
          />
          <rect
            x="-10"
            y="-10"
            width="20"
            height="20"
            rx="2.8"
            fill={elementColors.waypoint}
            fillOpacity="0.1"
            stroke={elementColors.waypoint}
            strokeWidth="2.3"
          />
          <path
            d="M 6.8 0 L -6.8 6.8 L -6.8 -6.8 Z"
            fill="#05080b"
            fillOpacity="0.25"
            stroke={elementColors.waypoint}
            strokeLinejoin="round"
            strokeWidth="1.85"
          />
        </g>
      ) : (
        <>
          <circle r="12.2" fill="#05080b" fillOpacity="0.72" />
          <circle
            r="8.1"
            fill={elementColors.translation}
            stroke="#eff8ff"
            strokeOpacity="0.9"
            strokeWidth="1.5"
          />
          <circle r="2.4" fill="#f7fbff" />
        </>
      )}
    </svg>
  );
}

function formatLinkedTargetKind(kind: LinkedTargetKind): string {
  return kind === "waypoint" ? "Waypoint" : "Translation";
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
    <IconButton
      className={`path-library-dialog__header-button path-library-dialog__header-button--${tone}`}
      aria-label={label}
      title={label}
      tone={tone === "danger" ? "danger" : "accent"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </IconButton>
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
        <CloseButton ariaLabel="Close create collection" onClick={onCancel} />
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
  triggerRef,
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
  triggerRef?: RefObject<HTMLButtonElement | null>;
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
        ref={triggerRef}
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
  shortcut?: ShortcutBinding;
  disabled?: boolean;
  onAction(): void;
}) {
  const shortcutLabel = shortcut ? formatShortcut(shortcut) : "";
  return (
    <button
      type="button"
      role="menuitem"
      className="top-menu__item"
      disabled={disabled}
      onClick={onAction}
    >
      <span className="top-menu__item-label">{label}</span>
      {shortcutLabel ? <kbd>{shortcutLabel}</kbd> : null}
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
  showCommandPalette,
  showConfigDialog,
  showDeletePathDialog,
  showDeleteProjectDialog,
  showLinkedTargetsDialog,
  showMobileSupportWarning,
  showNameEntryDialog,
  showNewPathDialog,
  showNewProjectDialog,
  showOpenPanel,
  showPathGroupsDialog,
  showSaveConflict,
  showShortcutHelp,
  showTourPicker,
}: {
  openTopMenu: TopMenuId | null;
  showCommandPalette: boolean;
  showConfigDialog: boolean;
  showDeletePathDialog: boolean;
  showDeleteProjectDialog: boolean;
  showLinkedTargetsDialog: boolean;
  showMobileSupportWarning: boolean;
  showNameEntryDialog: boolean;
  showNewPathDialog: boolean;
  showNewProjectDialog: boolean;
  showOpenPanel: boolean;
  showPathGroupsDialog: boolean;
  showSaveConflict: boolean;
  showShortcutHelp: boolean;
  showTourPicker: boolean;
}): boolean {
  return Boolean(
    openTopMenu ||
    showCommandPalette ||
    showConfigDialog ||
    showDeletePathDialog ||
    showDeleteProjectDialog ||
    showLinkedTargetsDialog ||
    showMobileSupportWarning ||
    showNameEntryDialog ||
    showNewPathDialog ||
    showNewProjectDialog ||
    showOpenPanel ||
    showPathGroupsDialog ||
    showSaveConflict ||
    showShortcutHelp ||
    showTourPicker,
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

function HelpHubPopover({
  tourAvailable,
  tourUnavailableReason,
  onClose,
  onStartTour,
  onShortcuts,
  onCommandPalette,
  onOpenSample,
}: {
  tourAvailable: boolean;
  tourUnavailableReason: string;
  onClose(): void;
  onStartTour(): void;
  onShortcuts(): void;
  onCommandPalette(): void;
  onOpenSample(): void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <section
      className="help-hub-popover"
      role="dialog"
      aria-label="Help and tutorials"
      data-testid="help-hub"
    >
      <div className="help-hub-popover__group">
        <span className="help-hub-popover__label">Learn</span>
        <button
          type="button"
          data-testid="start-guided-tour"
          disabled={!tourAvailable}
          title={
            tourAvailable
              ? "Walk through the editor step by step"
              : tourUnavailableReason
          }
          onClick={onStartTour}
        >
          <span className="help-hub-popover__glyph" aria-hidden="true">
            🧭
          </span>
          <span>Guided tours</span>
          <small>{tours.length} lessons</small>
        </button>
        <button type="button" onClick={onShortcuts}>
          <span className="help-hub-popover__glyph" aria-hidden="true">
            ⌨️
          </span>
          <span>Keyboard shortcuts</span>
          <kbd>?</kbd>
        </button>
        <button type="button" onClick={onCommandPalette}>
          <span className="help-hub-popover__glyph" aria-hidden="true">
            ⌘
          </span>
          <span>Command palette</span>
          <kbd>{formatShortcut({ key: "k", metaOrCtrl: true })}</kbd>
        </button>
      </div>
      <div className="help-hub-popover__separator" role="separator" />
      <div className="help-hub-popover__group">
        <span className="help-hub-popover__label">Reference</span>
        <a
          href="https://bline-docs.pages.dev/"
          target="_blank"
          rel="noreferrer noopener"
          onClick={onClose}
        >
          <span className="help-hub-popover__glyph" aria-hidden="true">
            📖
          </span>
          <span>Documentation</span>
          <small>↗</small>
        </a>
        <button type="button" onClick={onOpenSample}>
          <span className="help-hub-popover__glyph" aria-hidden="true">
            🧪
          </span>
          <span>Open sample path</span>
        </button>
        <a
          href="https://www.chiefdelphi.com/t/introducing-bline-a-new-rapid-polyline-autonomous-path-planning-suite/509778"
          target="_blank"
          rel="noreferrer noopener"
          onClick={onClose}
        >
          <span className="help-hub-popover__glyph" aria-hidden="true">
            💬
          </span>
          <span>Ask on Chief Delphi</span>
          <small>↗</small>
        </a>
      </div>
    </section>
  );
}

/**
 * The optimizer shows itself visually as a current tracing the Constraints
 * tab; this is the same news for anyone who cannot see it. It draws nothing,
 * so the toolbar geometry never shifts when a solve starts.
 */
function OptimizerLiveRegion() {
  const phase = useStoreSelector(autoVelocityStore, (state) => state.phase);
  const lastError = useStoreSelector(
    autoVelocityStore,
    (state) => state.lastError,
  );

  return (
    <span
      className="optimizer-live-region"
      role="status"
      aria-live="polite"
      aria-busy={phase !== "idle"}
    >
      {optimizerBeamLabel(phase, lastError)}
    </span>
  );
}

function PathHealthPopover({
  diagnostics,
  saveError,
  onSelect,
}: {
  diagnostics: readonly PathDiagnostic[];
  saveError: string | null;
  onSelect(diagnostic: PathDiagnostic): void;
}) {
  return (
    <section
      className="path-health-popover"
      role="dialog"
      aria-label="Path health"
    >
      <header>
        <div>
          <strong>Path health</strong>
          <span>
            {diagnostics.length === 0 && !saveError
              ? "No editor issues found"
              : "Fix these before heading to the robot"}
          </span>
        </div>
      </header>
      <div className="path-health-popover__list">
        {saveError ? (
          <div className="path-health-popover__issue is-error">
            <span>Save failed</span>
            <small>{saveError}</small>
          </div>
        ) : null}
        {diagnostics.map((diagnostic) => (
          <button
            key={diagnostic.id}
            type="button"
            className={`path-health-popover__issue is-${diagnostic.severity}`}
            onClick={() => onSelect(diagnostic)}
          >
            <span>{diagnostic.summary}</span>
            {diagnostic.elementIndex !== undefined ? (
              <small>Show element {diagnostic.elementIndex + 1}</small>
            ) : (
              <small>Path guidance</small>
            )}
          </button>
        ))}
        {diagnostics.length === 0 && !saveError ? (
          <div className="path-health-popover__clear">
            BLine’s editor-level checks are clear.
          </div>
        ) : null}
      </div>
    </section>
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
          <CloseButton ariaLabel="Close delete projects" onClick={onCancel} />
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
          <CloseButton ariaLabel="Close delete paths" onClick={onCancel} />
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
          <CloseButton ariaLabel="Close delete collection" onClick={onCancel} />
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

  if (status === "conflict") {
    return "Project changed on disk";
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

function compactSaveStatus(statusLabel: string, tone: SaveStatusTone): string {
  if (tone === "danger") {
    return "Save failed";
  }
  if (tone === "saving") {
    return "Saving…";
  }
  if (tone === "pending") {
    return "Autosave pending";
  }
  if (tone === "loading") {
    return "Loading…";
  }
  return statusLabel.replace(/^Saved/, "Saved locally");
}

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

  if (
    status === "conflict" ||
    (status === "error" && error) ||
    autosaveStatus === "error"
  ) {
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

function toolForShortcut(key: string): EditorTool | null {
  const normalized = key.toLocaleLowerCase();
  if (normalized === "v") {
    return "select";
  }
  if (normalized === "1") {
    return "waypoint";
  }
  if (normalized === "2") {
    return "translation";
  }
  if (normalized === "3") {
    return "rotation";
  }
  if (normalized === "4") {
    return "event";
  }
  if (normalized === "c") {
    return "curve";
  }
  return null;
}

function toolHint(tool: EditorTool, curveDrawing: boolean): string {
  if (curveDrawing) {
    return "Draw across the field · Esc cancels";
  }
  if (tool === "select") {
    return "Drag elements to reshape the path · V selects";
  }
  if (tool === "rotation" || tool === "event") {
    return `Click near a path segment to place ${
      tool === "event" ? "an event" : "a rotation"
    } · Esc cancels`;
  }
  if (tool === "curve") {
    return "Drag across the field to sketch a curve · Esc cancels";
  }
  return `Click the field to place a ${tool} · Esc cancels`;
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
