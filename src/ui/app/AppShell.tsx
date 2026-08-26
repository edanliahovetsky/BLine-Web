import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, CSSProperties, RefObject } from "react";
import { CircleAlert } from "lucide-react";
import { PathStage, type CanvasElementPlacement } from "../../canvas/PathStage";
import type { CurveToolSession } from "../../canvas/curveAuthoring";
import { activeProjectPath } from "../../core/model/editorNavigation";
import type { ProjectConfig } from "../../core/model/project";
import {
  diffWorkspaceConflict,
  type WorkspaceConflictDiff,
} from "../../core/io/workspaceConflictDiff";
import {
  defaultFieldId,
  fieldCoordinateBounds,
  resolveUserFieldDefinition,
  type FieldBackgroundEntry,
} from "../../core/field/fieldConfig";
import type { TranslationTarget } from "../../core/model/path";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import {
  type ProjectImportResult,
  type ProjectImportRollback,
  type ProjectWorkspaceSummary,
} from "../../platform/projectIo";
import {
  downloadBlob,
  isAbortError,
  saveBlobAs,
} from "../../platform/fileExport";
import type { AutosaveStatus } from "../../state/autosave";
import {
  autoVelocityStore,
  type AutoVelocityPhase,
} from "../../state/autoVelocityStore";
import {
  canGenerateAutomaticConstraints,
  generateAutomaticConstraints,
  startAutomaticConstraintSync,
} from "../../state/automaticConstraints";
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
import { CloseButton } from "../controls";
import { Sidebar } from "../sidebar/Sidebar";
import { createDefaultElement } from "../sidebar/sidebarCommands";
import "./AppShell.css";
import { createUpdateProjectConfigCommand } from "./configCommands";
import {
  createBlankCanvasPath,
  createNamedProject,
  createSampleProject,
} from "./initialProject";
import { ProjectConfigDialog } from "./ProjectConfigDialog";
import { writeProjectFolder } from "./projectFolderExport";
import { CommandPalette, ShortcutHelpDialog } from "./CommandPalette";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import { StartCenter } from "./StartCenter";
import {
  clampInspectorWidth,
  commandForShortcut,
  executeCommand,
  readEditorUiPreferences,
  writeEditorUiPreferences,
  type EditorCommand,
  type EditorTool,
  type EditorUiPreferencesV1,
} from "./editorCommands";
import {
  derivePathDiagnostics,
  type PathDiagnostic,
} from "./pathDiagnostics";
import { TourOverlay } from "../tours/TourOverlay";
import { tourStore } from "../tours/tourStore";
import {
  createTourSessionController,
  type TourSessionController,
} from "../tours/tourSession";
import {
  flushUserData,
  listFieldBackgrounds,
  readFieldBackgroundImage,
  saveFieldBackgroundSettings,
  selectedFieldBackgroundForProject,
} from "../../userData";
import { migrateImportedLegacyFieldBackgrounds } from "../../userData/legacyFieldMigration";
import { editorBasicsTour, tours } from "../tours/tours";
import {
  ensureCurrentWorkspaceSummary,
  formatStorageLabel,
} from "./projectStoragePresentation";
import { parseProjectTimestamp } from "./projectTimestamp";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useLegacyFieldMigration } from "./useLegacyFieldMigration";
import {
  CreateProjectDialog,
  DeletePathsDialog,
  DeleteProjectsDialog,
  NameEntryDialog,
  NewPathDialog,
} from "./ProjectDialogs";
import {
  LinkedTargetsDialog,
  type LinkedTargetPickerRequest,
} from "./LinkedTargetsDialog";
import { PathLibraryDialog } from "./PathLibraryDialog";
import type { TopMenuId } from "./ToolbarMenus";
import { AppToolbar, PathHealthPopover } from "./AppToolbar";

interface PathNameAction {
  kind: "duplicate" | "rename";
  pathId: string;
  initialName: string;
}

interface TourEditorViewSnapshot {
  activeTool: EditorTool;
  autosaveStatus: AutosaveStatus;
  editorPreferences: EditorUiPreferencesV1;
  fieldSelectionOverride: {
    projectId: string;
    fieldId: string;
  } | null;
  inspectorOpen: boolean;
  inspectorWidth: number;
  optimizerError: string | null;
  showGhostPaths: boolean;
}

export function AppShell() {
  const durableProject = useStoreSelector(
    projectStore,
    (state) => state.project,
  );
  const activePathId = useStoreSelector(
    projectStore,
    (state) => state.activePathId,
  );
  const activePathGroupId = useStoreSelector(
    projectStore,
    (state) => state.activePathGroupId,
  );
  const activePath = useMemo(
    () => activeProjectPath(durableProject, activePathId),
    [activePathId, durableProject],
  );
  const projectIo = useStoreSelector(projectStore, (state) => state.io);
  const projectSessionId = useStoreSelector(
    projectStore,
    (state) => state.projectSessionId,
  );
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const projectRevision = useStoreSelector(
    projectStore,
    (state) => state.revision,
  );
  const projectTransitionInProgress = useStoreSelector(
    projectStore,
    (state) => state.projectTransitionInProgress,
  );
  const status = useStoreSelector(projectStore, (state) => state.status);
  const error = useStoreSelector(projectStore, (state) => state.error);
  const persistenceDamage = useStoreSelector(
    projectStore,
    (state) => state.persistenceDamage,
  );
  const currentVersion = useStoreSelector(
    projectStore,
    (state) => state.version,
  );
  const lastSavedAt = useStoreSelector(
    projectStore,
    (state) => state.lastSavedAt,
  );
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
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [fieldSelectionOverride, setFieldSelectionOverride] = useState<{
    projectId: string;
    fieldId: string;
  } | null>(null);
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
  const pathHealthControlRef = useRef<HTMLDivElement | null>(null);
  const [showHelpHub, setShowHelpHub] = useState(false);
  const [toursSupported, setToursSupported] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia(mobileSupportMediaQuery).matches,
  );
  const [showTourPicker, setShowTourPicker] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 1120,
  );
  const [inspectorTab, setInspectorTab] = useState<
    "elements" | "constraints"
  >(() => readEditorUiPreferences().inspectorTab);
  const [inspectorWidth, setInspectorWidth] = useState(
    () => readEditorUiPreferences().inspectorWidth,
  );
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [showGhostPaths, setShowGhostPaths] = useState(
    () => readEditorUiPreferences().showGhostPaths,
  );
  const [linkedTargetPickerRequest, setLinkedTargetPickerRequest] =
    useState<LinkedTargetPickerRequest | null>(null);
  const [showMobileSupportWarning, setShowMobileSupportWarning] =
    useState(false);
  const [pendingImportMode, setPendingImportMode] =
    useState<ImportMode>("archive");
  const [pendingToolbarAction, setPendingToolbarAction] =
    useState<PendingToolbarAction>(null);
  const [canvasInteractionActive, setCanvasInteractionActive] = useState(false);
  const [curveToolSession, setCurveToolSession] =
    useState<CurveToolSession | null>(null);
  const [inspectorDialogOpen, setInspectorDialogOpen] = useState(false);
  const canvasInteractionActiveRef = useRef(false);
  const nextCurveToolSessionIdRef = useRef(1);
  const importHandlingRef = useRef(false);
  const pendingToolbarActionRef = useRef<PendingToolbarAction>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const pathMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tourViewRef = useRef<{
    blocked: boolean;
    snapshot: TourEditorViewSnapshot;
  } | null>(null);
  const tourSessionRef = useRef<TourSessionController | null>(null);
  const configSaveInProgressRef = useRef(false);
  const {
    autosaveStatus,
    cancelAutosave,
    fieldBackgrounds,
    initializing,
    initializationError,
    projectRecoveryLifecycle,
    refreshWorkspaceSummaries,
    setAutosaveStatus,
    setFieldBackgrounds,
    retryInitialization,
    workspaceSummaries,
  } = useProjectLifecycle({
    canvasInteractionActive,
    canvasInteractionActiveRef,
    dirty,
    durableProject,
    lastSavedAt,
    projectRevision,
    isPersistenceBlocked: () => configSaveInProgressRef.current,
    prepareClose: () => tourSessionRef.current?.restore(),
    projectIo,
    onEditorLayoutLoaded: ({ inspectorTab, inspectorWidth, showGhostPaths }) => {
      setInspectorTab(inspectorTab);
      setInspectorWidth(inspectorWidth);
      setShowGhostPaths(showGhostPaths);
    },
  });

  useEffect(() => {
    if (!showPathHealth) {
      return;
    }

    const closePathHealthOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !pathHealthControlRef.current?.contains(event.target)
      ) {
        setShowPathHealth(false);
      }
    };

    document.addEventListener("pointerdown", closePathHealthOutside, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        closePathHealthOutside,
        true,
      );
  }, [showPathHealth]);

  useEffect(() => {
    tourViewRef.current = {
      blocked:
        initializing ||
        projectTransitionInProgress ||
        canvasInteractionActive ||
        curveToolSession !== null ||
        inspectorDialogOpen ||
        pendingToolbarAction !== null ||
        optimizerPhase !== "idle" ||
        openTopMenu !== null ||
        showCommandPalette ||
        showConfigDialog ||
        showDeletePathDialog ||
        showDeleteProjectDialog ||
        showLinkedTargetsDialog ||
        showMobileSupportWarning ||
        pathNameAction !== null ||
        showNewPathDialog ||
        showNewProjectDialog ||
        showOpenPanel ||
        showPathGroupsDialog ||
        showShortcutHelp,
      snapshot: {
        activeTool,
        autosaveStatus,
        editorPreferences: readEditorUiPreferences(),
        fieldSelectionOverride,
        inspectorOpen,
        inspectorWidth,
        optimizerError,
        showGhostPaths,
      },
    };
  }, [
    activeTool,
    autosaveStatus,
    canvasInteractionActive,
    curveToolSession,
    fieldSelectionOverride,
    inspectorOpen,
    inspectorDialogOpen,
    inspectorWidth,
    initializing,
    openTopMenu,
    optimizerError,
    optimizerPhase,
    pathNameAction,
    pendingToolbarAction,
    projectTransitionInProgress,
    showCommandPalette,
    showConfigDialog,
    showDeletePathDialog,
    showDeleteProjectDialog,
    showLinkedTargetsDialog,
    showMobileSupportWarning,
    showNewPathDialog,
    showNewProjectDialog,
    showOpenPanel,
    showPathGroupsDialog,
    showShortcutHelp,
    showGhostPaths,
  ]);

  useEffect(() => {
    const controller = createTourSessionController({
      captureView: () => {
        const current = tourViewRef.current;
        if (!current) {
          throw new Error("Tour editor view is unavailable");
        }
        return {
          ...current.snapshot,
          editorPreferences: readEditorUiPreferences(),
        };
      },
      canStart: () => tourViewRef.current?.blocked === false,
      showPracticeView: (projectId) => {
        setFieldSelectionOverride({ projectId, fieldId: "blank-grid" });
        setInspectorOpen(true);
        setActiveTool("select");
      },
      restoreView: (view) => {
        writeEditorUiPreferences(view.editorPreferences);
        setFieldSelectionOverride(view.fieldSelectionOverride);
        setInspectorOpen(view.inspectorOpen);
        setInspectorTab(view.editorPreferences.inspectorTab);
        setInspectorWidth(view.inspectorWidth);
        setActiveTool(view.activeTool);
        setAutosaveStatus(view.autosaveStatus);
        autoVelocityStore.getState().setLastError(view.optimizerError);
        setShowGhostPaths(view.showGhostPaths);
      },
      protectCapturedSession: (state) => {
        const protectedSession = projectRecoveryLifecycle.protectSnapshot({
          project: state.project,
          expectedVersion: state.version,
          dirty: state.dirty,
        });
        if (protectedSession) {
          cancelAutosave();
        }
        return protectedSession;
      },
      releaseCapturedSession: () =>
        projectRecoveryLifecycle.releaseSnapshotProtection(),
    });
    tourSessionRef.current = controller;
    return () => {
      controller.dispose();
      tourSessionRef.current = null;
    };
  }, [cancelAutosave, projectRecoveryLifecycle, setAutosaveStatus]);

  const setActiveTopMenu = useCallback((menu: TopMenuId | null) => {
    if (menu) {
      setShowOpenPanel(false);
    }
    setOpenTopMenu(menu);
  }, []);

  const attachFileInput = useCallback((element: HTMLInputElement | null) => {
    fileInputRef.current = element;
  }, []);

  const attachFolderInput = useCallback((element: HTMLInputElement | null) => {
    folderInputRef.current = element;
    element?.setAttribute("webkitdirectory", "");
    element?.setAttribute("directory", "");
  }, []);

  const handleCanvasInteractionStateChange = useCallback(
    (active: boolean) => {
      canvasInteractionActiveRef.current = active;
      setCanvasInteractionActive(active);
      if (active) {
        cancelAutosave();
      }
    },
    [cancelAutosave],
  );

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
      const state = projectStore.getState();
      if (state.projectTransitionInProgress) {
        setCurveToolSession(null);
        return;
      }
      const currentPath = activeProjectPath(state.project, state.activePathId);
      if (!state.project || !currentPath || targets.length === 0) {
        setCurveToolSession(null);
        return;
      }

      const result = projectStore.getState().applyPathStructureEdit(
        {
          kind: "insert-many",
          index: insertionIndex,
          elements: targets,
        },
        {
          pathId: currentPath.path_id,
          selectedElementIndex: selectionStore.getState().selectedElementIndex,
        },
      );
      if (result.status !== "applied") {
        setCurveToolSession(null);
        return;
      }
      selectionStore
        .getState()
        .selectElement(
          result.consequences.selectedElementIndex,
          activeProjectPath(
            projectStore.getState().project,
            projectStore.getState().activePathId,
          )?.path,
        );
      setCurveToolSession(null);
      setActiveTool("select");
    },
    [],
  );

  const { phase: legacyFieldMigrationPhase, retry: retryLegacyFieldMigration } =
    useLegacyFieldMigration({
      project: durableProject,
      projectIo,
      projectSessionId,
      defaultFieldId,
      onFieldBackgroundsChange: setFieldBackgrounds,
      onFieldSelectionChange: setFieldSelectionOverride,
    });

  const selectedFieldId = durableProject
    ? fieldSelectionOverride?.projectId === durableProject.project_id
      ? fieldSelectionOverride.fieldId
      : (selectedFieldBackgroundForProject(
          durableProject.project_id,
          defaultFieldId,
        ) ?? defaultFieldId)
    : defaultFieldId;

  const activeField = useMemo(
    () => resolveUserFieldDefinition(selectedFieldId, fieldBackgrounds),
    [fieldBackgrounds, selectedFieldId],
  );

  useEffect(() => startAutomaticConstraintSync(), []);

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
      cancelAutosave();

      try {
        await projectStore
          .getState()
          .createWorkspace(createNamedProject(projectName, pathName));
        selectionStore.getState().clearSelection();
        setShowNewProjectDialog(false);
        setShowOpenPanel(false);
        await refreshWorkspaceSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    },
    [cancelAutosave, refreshWorkspaceSummaries],
  );

  const handleOpenSample = useCallback(async () => {
    cancelAutosave();

    try {
      await projectStore.getState().createWorkspace(createSampleProject());
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      setOpenTopMenu(null);
    }
  }, [cancelAutosave, refreshWorkspaceSummaries]);

  const startGuidedTour = useCallback(
    (tourId: string) => tourSessionRef.current?.start(tourId) ?? false,
    [],
  );

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      setActiveTool(tool);
      if (tool === "curve") {
        const state = projectStore.getState();
        const currentPath = activeProjectPath(
          state.project,
          state.activePathId,
        );
        if (currentPath) {
          handleStartCurveTool(currentPath.path.path_elements.length);
        }
      } else if (curveToolSession) {
        setCurveToolSession(null);
      }
    },
    [curveToolSession, handleStartCurveTool],
  );
  const handlePlaceCanvasElement = useCallback(
    (placement: CanvasElementPlacement) => {
      const state = projectStore.getState();
      if (state.projectTransitionInProgress) {
        return;
      }
      const currentPath = activeProjectPath(state.project, state.activePathId);
      if (!currentPath || !state.project) {
        return;
      }

      const selectedIndex = selectionStore.getState().selectedElementIndex;
      const element = createDefaultElement(
        currentPath.path,
        state.project.config,
        placement.type,
        selectedIndex,
        activeField.geometry,
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

      const result = projectStore.getState().applyPathStructureEdit(
        { kind: "insert", index: placement.insertionIndex, element },
        {
          pathId: currentPath.path_id,
          selectedElementIndex: selectedIndex,
        },
      );
      if (result.status !== "applied") {
        return;
      }
      selectionStore
        .getState()
        .selectElement(
          result.consequences.selectedElementIndex,
          activeProjectPath(
            projectStore.getState().project,
            projectStore.getState().activePathId,
          )?.path,
        );
    },
    [activeField.geometry],
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
        const currentProject = projectStore.getState().project;
        const mine = currentProject;
        const workspaceHandle = projectStore.getState().workspaceHandle;
        if (!workspaceHandle) {
          return;
        }
        const theirs = await projectIo.peekWorkspace(workspaceHandle);
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
      cancelAutosave();
    } catch {
      // The store keeps the conflict/error state so the dialog stays actionable.
    } finally {
      setResolvingConflict(false);
    }
  }, [cancelAutosave]);

  const handleOverwriteConflict = useCallback(async () => {
    setResolvingConflict(true);
    try {
      await projectStore.getState().overwriteConflict();
      cancelAutosave();
    } catch {
      // Overwrite can still fail (e.g. permissions); leave the dialog open.
    } finally {
      setResolvingConflict(false);
    }
  }, [cancelAutosave]);

  const handleReplaceDamagedProject = useCallback(async () => {
    setResolvingConflict(true);
    try {
      await projectStore.getState().replaceDamagedProject();
      cancelAutosave();
    } catch {
      // The store keeps the damaged/error state so the choice stays actionable.
    } finally {
      setResolvingConflict(false);
    }
  }, [cancelAutosave]);

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
    if (!activePath || selectedElementIndex === null) {
      return;
    }

    const element = activePath.path.path_elements[selectedElementIndex];
    if (!element) {
      return;
    }

    setShowOpenPanel(false);
    setOpenTopMenu(null);
    setLinkedTargetPickerRequest({
      pathId: activePath.path_id,
      elementIndex: selectedElementIndex,
      element,
    });
    setShowLinkedTargetsDialog(true);
  }, [activePath, selectedElementIndex]);

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
      const activeGroupId =
        newPathGroupContextId !== undefined
          ? newPathGroupContextId
          : projectStore.getState().activePathGroupId;
      projectStore.getState().createPath({
        displayName,
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
    cancelAutosave();

    if (legacyFieldMigrationPhase === "running") {
      return;
    }
    if (legacyFieldMigrationPhase === "failed") {
      retryLegacyFieldMigration();
      return;
    }

    try {
      await projectStore.getState().saveWorkspace();
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    }
  }, [
    cancelAutosave,
    legacyFieldMigrationPhase,
    refreshWorkspaceSummaries,
    retryLegacyFieldMigration,
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
      cancelAutosave();

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
    [cancelAutosave, refreshWorkspaceSummaries],
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

    cancelAutosave();

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
  }, [
    beginToolbarAction,
    cancelAutosave,
    endToolbarAction,
    refreshWorkspaceSummaries,
  ]);

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
    async (projects: ProjectWorkspaceSummary[]) => {
      if (projects.length === 0) {
        setShowDeleteProjectDialog(false);
        return;
      }

      cancelAutosave();

      try {
        const currentStorageId =
          projectStore.getState().currentWorkspaceSummary?.id ?? null;
        const orderedProjects = [
          ...projects.filter(({ id }) => id !== currentStorageId),
          ...projects.filter(({ id }) => id === currentStorageId),
        ];

        for (const { id, version } of orderedProjects) {
          await projectStore.getState().deleteWorkspace(id, version);
        }

        selectionStore.getState().clearSelection();
        setShowOpenPanel(false);
        setShowDeleteProjectDialog(false);
        await refreshWorkspaceSummaries();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [cancelAutosave, refreshWorkspaceSummaries],
  );

  const handleSwitchWorkspace = useCallback(
    async (id: string) => {
      cancelAutosave();

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
    [cancelAutosave, refreshWorkspaceSummaries],
  );

  const handleExportProjectArchive = useCallback(async () => {
    if (!beginToolbarAction("export")) {
      return;
    }

    const currentProject = projectStore.getState().project;
    if (!currentProject) {
      endToolbarAction("export");
      return;
    }

    try {
      const bundle = await projectStore.getState().exportProjectArchive();
      if (bundle) {
        downloadBlob(
          bundle,
          `${safeDownloadName(currentProject.display_name)}.bline-project.json`,
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

    const state = projectStore.getState();
    const currentPath = activeProjectPath(state.project, state.activePathId);
    if (!currentPath) {
      endToolbarAction("export");
      return;
    }

    try {
      const blob = await projectStore
        .getState()
        .exportPath(currentPath.path_id);
      if (blob) {
        await saveBlobAs(blob, currentPath.file_name, {
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
    const state = projectStore.getState();
    const currentPath = activeProjectPath(state.project, state.activePathId);
    if (!currentPath) {
      return;
    }

    pathMenuButtonRef.current?.focus();
    setPathNameAction({
      kind: "duplicate",
      pathId: currentPath.path_id,
      initialName: currentPath.display_name,
    });
    setOpenTopMenu(null);
  }, []);

  const handleRenamePath = useCallback(() => {
    const state = projectStore.getState();
    const currentPath = activeProjectPath(state.project, state.activePathId);
    if (!currentPath) {
      return;
    }

    pathMenuButtonRef.current?.focus();
    setPathNameAction({
      kind: "rename",
      pathId: currentPath.path_id,
      initialName: currentPath.display_name,
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

        await projectStore.getState().importProjectArchive(file, {
          migrateLegacyFieldBackgrounds: migrateImportedFieldsForProject,
        });
        setFieldBackgrounds(listFieldBackgrounds());
        await refreshWorkspaceSummaries();
        selectionStore.getState().clearSelection();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      } finally {
        importHandlingRef.current = false;
        endToolbarAction("import");
      }
    },
    [
      endToolbarAction,
      pendingImportMode,
      refreshWorkspaceSummaries,
      setFieldBackgrounds,
    ],
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
        await projectStore.getState().importProjectFolder(files, {
          migrateLegacyFieldBackgrounds: migrateImportedFieldsForProject,
        });
        setFieldBackgrounds(listFieldBackgrounds());
        await refreshWorkspaceSummaries();
        selectionStore.getState().clearSelection();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      } finally {
        importHandlingRef.current = false;
        endToolbarAction("import");
      }
    },
    [endToolbarAction, refreshWorkspaceSummaries, setFieldBackgrounds],
  );

  const handleSaveConfig = useCallback(
    async (
      nextConfig: ProjectConfig,
      options: {
        autoSyncEnabled: boolean;
        configChanged: boolean;
        selectedFieldId: string;
        fieldBackgrounds: FieldBackgroundEntry[];
        fieldImageDrafts: Array<{ fieldId: string; file: File }>;
      },
    ) => {
      const state = projectStore.getState();
      const currentProject = state.project;
      const ownedProjectSessionId = state.projectSessionId;
      if (!currentProject || !ownedProjectSessionId) {
        return;
      }
      if (configSaveInProgressRef.current) {
        throw new Error("Settings are already being saved");
      }
      configSaveInProgressRef.current = true;
      try {
        const imageUpdates = await Promise.all(
          options.fieldImageDrafts.map(async (draft) => ({
            entryId: draft.fieldId,
            bytes: new Uint8Array(await draft.file.arrayBuffer()),
          })),
        );
        if (
          projectStore.getState().projectSessionId !== ownedProjectSessionId
        ) {
          throw new Error(
            "The active Project changed while Settings were saving",
          );
        }
        await saveFieldBackgroundSettings({
          projectId: currentProject.project_id,
          selectedFieldId: options.selectedFieldId,
          fieldBackgrounds: options.fieldBackgrounds,
          imageUpdates,
        });
        const latest = projectStore.getState();
        if (latest.projectSessionId !== ownedProjectSessionId) {
          throw new Error(
            "The active Project changed while Settings were saving",
          );
        }
        autoVelocityStore
          .getState()
          .setAutoSyncEnabled(options.autoSyncEnabled);
        await flushUserData();
        if (
          projectStore.getState().projectSessionId !== ownedProjectSessionId
        ) {
          throw new Error(
            "The active Project changed while Settings were saving",
          );
        }
        if (options.configChanged) {
          latest.applyConfigCommand(
            createUpdateProjectConfigCommand(currentProject.config, nextConfig),
          );
        }
        setFieldBackgrounds(listFieldBackgrounds());
        setFieldSelectionOverride({
          projectId: currentProject.project_id,
          fieldId: options.selectedFieldId,
        });
        setShowConfigDialog(false);
      } finally {
        configSaveInProgressRef.current = false;
      }
    },
    [setFieldBackgrounds],
  );

  const handleLoadFieldImage = useCallback(
    async (field: FieldBackgroundEntry) => {
      const bytes = await readFieldBackgroundImage(field.id);
      return bytes ? new Blob([bytes], { type: field.mime_type }) : null;
    },
    [],
  );

  const selectedElement =
    activePath && selectedElementIndex !== null
      ? activePath.path.path_elements[selectedElementIndex]
      : null;
  const selectedPosition =
    activePath && selectedElementIndex !== null
      ? getElementPosition(activePath.path.path_elements, selectedElementIndex)
      : null;
  const ioCapabilities = projectIo?.capabilities;
  const supportsProjectFolders = Boolean(
    ioCapabilities?.supportsProjectFolders,
  );
  const pathDocuments = durableProject?.paths ?? [];
  const currentWorkspaceSummary = useStoreSelector(
    projectStore,
    (state) => state.currentWorkspaceSummary,
  );
  const activePathGroup =
    durableProject?.path_groups.find(
      (group) => group.group_id === activePathGroupId,
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
    durableProject,
    currentWorkspaceSummary,
    currentVersion,
    lastSavedAt,
  );
  const toolbarBusy =
    pendingToolbarAction !== null || projectTransitionInProgress;
  const projectLabel = durableProject?.display_name ?? "No project";
  const pathLabel = activePath?.display_name ?? "No path";
  const currentProjectSummary = `Project: ${projectLabel}`;
  const currentPathSummary = activePathGroup
    ? `Current Path: ${activePathGroup.display_name} / ${pathLabel}`
    : `Current Path: ${pathLabel}`;
  const storageLabel = formatStorageLabel(
    currentWorkspaceSummary,
    ioCapabilities,
  );
  const saveStatus = formatSaveStatus({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    optimizerPhase,
    status,
  });
  const saveStatusTone = getSaveStatusTone({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    optimizerPhase,
    status,
  });
  const pathDiagnostics = useMemo(
    () =>
      derivePathDiagnostics(
        activePath?.path ?? null,
        durableProject ? activeField.geometry : null,
        durableProject?.linked_targets ?? [],
      ),
    [activeField.geometry, activePath, durableProject],
  );
  const handleResolvePathDiagnostic = useCallback(
    (diagnostic: PathDiagnostic) => {
      const state = projectStore.getState();
      if (state.projectTransitionInProgress) {
        return;
      }

      const project = state.project;
      const currentPath = activeProjectPath(project, state.activePathId);
      if (!project || !currentPath) {
        return;
      }

      const fix = diagnostic.fix;
      let focusIndex = diagnostic.elementIndex ?? null;

      if (fix?.kind === "add-anchors") {
        const insertionIndex = currentPath.path.path_elements.length;
        const workingPath = structuredClone(currentPath.path);
        const elements = Array.from({ length: fix.count }, () => {
          const previousIndex = workingPath.path_elements.length - 1;
          const element = createDefaultElement(
            workingPath,
            project.config,
            "waypoint",
            previousIndex >= 0 ? previousIndex : null,
            activeField.geometry,
          );
          workingPath.path_elements.push(element);
          return element;
        });
        const result = projectStore.getState().applyPathStructureEdit(
          { kind: "insert-many", index: insertionIndex, elements },
          {
            pathId: currentPath.path_id,
            selectedElementIndex:
              selectionStore.getState().selectedElementIndex,
          },
        );
        if (result.status === "applied") {
          focusIndex = insertionIndex + elements.length - 1;
        }
      } else if (fix?.kind === "focus-event-key") {
        setInspectorTab("elements");
        writeEditorUiPreferences({
          ...readEditorUiPreferences(),
          inspectorTab: "elements",
        });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>(
              '[data-testid="property-editor"] input[aria-label="Lib Key"]',
            )
            ?.focus();
        });
      } else if (fix?.kind === "move-inside-field") {
        const position = getElementPosition(
          currentPath.path.path_elements,
          fix.elementIndex,
        );
        if (position) {
          const bounds = fieldCoordinateBounds(activeField.geometry);
          projectStore.getState().applyPathElementEdit(
            {
              kind: "position",
              index: fix.elementIndex,
              position: {
                x_meters: clampCoordinateToBounds(
                  position.x_meters,
                  bounds.minX,
                  bounds.maxX,
                ),
                y_meters: clampCoordinateToBounds(
                  position.y_meters,
                  bounds.minY,
                  bounds.maxY,
                ),
              },
            },
            { pathId: currentPath.path_id },
          );
        }
      } else if (fix?.kind === "remove-missing-link") {
        projectStore
          .getState()
          .unlinkPathElement(currentPath.path_id, fix.elementIndex);
      }

      if (focusIndex !== null) {
        selectionStore
          .getState()
          .selectElement(
            focusIndex,
            activeProjectPath(
              projectStore.getState().project,
              projectStore.getState().activePathId,
            )?.path,
          );
        setInspectorOpen(true);
      }
      setShowPathHealth(false);
    },
    [activeField.geometry],
  );
  const handleSelectPathFromToolbar = useCallback((pathId: string) => {
    if (projectStore.getState().projectTransitionInProgress) {
      return;
    }
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  }, []);
  const handleSelectCollectionFromToolbar = useCallback(
    (groupId: string | null) => {
      if (projectStore.getState().projectTransitionInProgress) {
        return;
      }
      projectStore.getState().setActivePathGroup(groupId);
      selectionStore.getState().clearSelection();
    },
    [],
  );
  const projectAvailable = Boolean(durableProject);
  const pathAvailable = Boolean(activePath);
  const projectIoAvailable = Boolean(projectIo);
  const navigatorCommand: EditorCommand = {
    id: "project.navigator",
    label: "Open project navigator",
    category: "Project",
    keywords: ["paths", "collections", "library"],
    disabled: !projectAvailable || toolbarBusy,
    run: handleShowPathLibrary,
  };
  const newPathCommand: EditorCommand = {
    id: "project.new-path",
    label: "Create new path",
    category: "Project",
    keywords: ["add"],
    disabled: !projectAvailable || !projectIoAvailable || toolbarBusy,
    run: () => void handleCreateNewPath(),
  };
  const settingsCommand: EditorCommand = {
    id: "project.settings",
    label: "Open project settings",
    category: "Project",
    disabled: !projectAvailable || toolbarBusy,
    run: () => setShowConfigDialog(true),
  };
  const saveCommand: EditorCommand = {
    id: "project.save",
    label: "Save now",
    category: "Project",
    shortcut: { key: "s", metaOrCtrl: true },
    scope: "global",
    disabled:
      !projectAvailable ||
      !projectIoAvailable ||
      status === "saving" ||
      legacyFieldMigrationPhase === "running" ||
      toolbarBusy,
    run: () => void handleSaveProject(),
  };
  const undoCommand: EditorCommand = {
    id: "edit.undo",
    label: "Undo",
    category: "Edit",
    shortcut: { key: "z", metaOrCtrl: true },
    scope: "editor",
    disabled: !canUndo || toolbarBusy,
    run: () => projectStore.getState().undo(),
  };
  const redoCommand: EditorCommand = {
    id: "edit.redo",
    label: "Redo",
    category: "Edit",
    shortcut: { key: "z", metaOrCtrl: true, shift: true },
    shortcutAliases: [{ key: "y", metaOrCtrl: true }],
    scope: "editor",
    disabled: !canRedo || toolbarBusy,
    run: () => projectStore.getState().redo(),
  };
  const generateConstraintsCommand: EditorCommand = {
    id: "path.generate-constraints",
    label: "Generate constraints",
    category: "Path",
    keywords: ["corner", "handoff", "radius", "seed", "optimize", "velocity"],
    disabled:
      !activePath ||
      toolbarBusy ||
      optimizerPhase === "running" ||
      !canGenerateAutomaticConstraints(activePath.path),
    run: () => {
      if (activePath && durableProject) {
        void generateAutomaticConstraints(
          autoVelocitySettingsForPath(activePath.path, durableProject.config),
        );
      }
    },
  };
  const duplicateElementCommand: EditorCommand = {
    id: "edit.duplicate-element",
    label: "Duplicate element",
    category: "Edit",
    keywords: ["copy", "clone"],
    shortcut: { key: "d", metaOrCtrl: true },
    scope: "editor",
    disabled: selectedElementIndex === null || toolbarBusy,
    run: () => {
      duplicateSelectedPathElement();
    },
  };
  const inspectorCommand: EditorCommand = {
    id: "view.inspector",
    label: "Toggle inspector",
    category: "View",
    shortcut: { key: "b", metaOrCtrl: true },
    scope: "global",
    disabled: !pathAvailable,
    run: () => setInspectorOpen((current) => !current),
  };
  const shortcutHelpCommand: EditorCommand = {
    id: "help.shortcuts",
    label: "Keyboard shortcuts",
    category: "Help",
    shortcut: { key: "?" },
    scope: "editor",
    run: () => setShowShortcutHelp(true),
  };
  const toolCommands: EditorCommand[] = [
    {
      id: "tool.select",
      label: "Select tool",
      category: "Canvas tools",
      shortcut: { key: "v" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("select"),
    },
    {
      id: "tool.waypoint",
      label: "Waypoint tool",
      category: "Canvas tools",
      shortcut: { key: "1" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("waypoint"),
    },
    {
      id: "tool.translation",
      label: "Translation tool",
      category: "Canvas tools",
      shortcut: { key: "2" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("translation"),
    },
    {
      id: "tool.rotation",
      label: "Rotation tool",
      category: "Canvas tools",
      shortcut: { key: "3" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("rotation"),
    },
    {
      id: "tool.event",
      label: "Event tool",
      category: "Canvas tools",
      shortcut: { key: "4" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("event"),
    },
    {
      id: "tool.curve",
      label: "Curve tool",
      category: "Canvas tools",
      shortcut: { key: "c" },
      scope: "editor",
      disabled: !pathAvailable || toolbarBusy,
      run: () => handleToolChange("curve"),
    },
  ];
  const pathCommands: EditorCommand[] = pathDocuments.map((path) => ({
    id: `path.open.${path.path_id}`,
    label: `Open path: ${path.display_name}`,
    category: "Paths",
    keywords: [path.file_name],
    disabled: toolbarBusy,
    run: () => handleSelectPathFromToolbar(path.path_id),
  }));
  const commands: EditorCommand[] = [
    navigatorCommand,
    newPathCommand,
    settingsCommand,
    saveCommand,
    undoCommand,
    redoCommand,
    generateConstraintsCommand,
    duplicateElementCommand,
    inspectorCommand,
    shortcutHelpCommand,
    ...toolCommands,
    ...pathCommands,
  ];
  const shortcutCommands = [
    saveCommand,
    undoCommand,
    redoCommand,
    duplicateElementCommand,
    inspectorCommand,
    shortcutHelpCommand,
    ...toolCommands,
  ];

  const handleShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      projectTransitionInProgress ||
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
        showSaveConflict: status === "conflict" || status === "damaged",
        showShortcutHelp,
        showTourPicker,
      })
    ) {
      return;
    }

    const runShortcut = (scope: "global" | "editor") => {
      const matchingCommand = commandForShortcut(
        shortcutCommands,
        event,
        scope,
      );
      if (!matchingCommand) {
        return false;
      }
      event.preventDefault();
      executeCommand(matchingCommand);
      return true;
    };
    const modifier = event.metaKey || event.ctrlKey;

    if (event.key === "F1") {
      event.preventDefault();
      setShowCommandPalette(true);
      return;
    }

    if (modifier) {
      if (event.altKey) {
        return;
      }
      if (event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (runShortcut("global") || isEditableShortcutTarget(event.target)) {
        return;
      }
      runShortcut("editor");
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

    if (runShortcut("editor")) {
      return;
    }

    if (event.key === "Escape" && activeTool !== "select") {
      event.preventDefault();
      setActiveTool("select");
      setCurveToolSession(null);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (removeSelectedRangedConstraint() || removeSelectedPathElement()) {
        event.preventDefault();
      }
      return;
    }

    if (
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      if (moveSelectedPathElement(event.key === "ArrowUp" ? -1 : 1)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "[" || event.key === "]") {
      if (selectAdjacentPathElement(event.key === "[" ? -1 : 1)) {
        event.preventDefault();
      }
      return;
    }

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
        event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
      if (nudgeSelectedPathElement(dx, dy, activeField.geometry)) {
        event.preventDefault();
      }
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const workspaceStatusVisible = Boolean(durableProject);
  const workspaceStatus = workspaceStatusVisible ? (
    <WorkspaceStatus
      compact={!inspectorOpen}
      diagnostics={pathDiagnostics}
      saveCommand={saveCommand}
      saveStatus={saveStatus}
      saveStatusTone={saveStatusTone}
      showPathHealth={showPathHealth}
      storageLabel={storageLabel}
      controlRef={pathHealthControlRef}
      onResolveDiagnostic={handleResolvePathDiagnostic}
      onTogglePathHealth={() =>
        setShowPathHealth((current) => !current)
      }
    />
  ) : null;

  return (
    <main
      className="app-shell"
      data-testid="app-shell"
      aria-busy={projectTransitionInProgress}
    >
      <AppToolbar
        toolbarRef={toolbarRef}
        model={{
          project: durableProject,
          activeGroup: activePathGroup,
          activePath,
          visiblePaths: visiblePathDocuments,
          projectSummaries,
          supportsProjectFolders,
          projectIoAvailable,
          toolbarBusy,
          undoLabel,
          redoLabel,
          toursSupported,
        }}
        commands={{
          navigator: navigatorCommand,
          newPath: newPathCommand,
          save: saveCommand,
          undo: undoCommand,
          redo: redoCommand,
          settings: settingsCommand,
          inspector: inspectorCommand,
          shortcutHelp: shortcutHelpCommand,
        }}
        menu={{
          open: openTopMenu,
          pathTriggerRef: pathMenuButtonRef,
          setOpen: setActiveTopMenu,
          refreshWorkspaces: refreshWorkspaceSummaries,
        }}
        panels={{
          showOpenPanel,
          showHelpHub,
          inspectorOpen,
          openCommandPalette: () => setShowCommandPalette(true),
          closeOpenPanel: () => setShowOpenPanel(false),
          toggleHelpHub: () => {
            setShowPathHealth(false);
            setShowHelpHub((current) => !current);
          },
          closeHelpHub: () => setShowHelpHub(false),
          openTourPicker: () => setShowTourPicker(true),
        }}
        imports={{
          setFileInput: attachFileInput,
          setFolderInput: attachFolderInput,
          onImportFile: handleImportProject,
          onImportFolder: handleImportProjectFolder,
        }}
        actions={{
          openWorkspace: handleOpenWorkspace,
          createWorkspace: handleCreateWorkspace,
          createProject: handleNewProject,
          openProjectPanel: handleOpenProjectPanel,
          showDeleteProjects: handleShowDeleteProjects,
          importFolder: queueFolderImport,
          importFile: queueFileImport,
          exportProjectFolder: handleExportProjectFolder,
          exportProjectArchive: handleExportProjectArchive,
          exportConfig: handleExportConfig,
          exportPath: handleExportPath,
          openWorkspaceFromMenu: handleOpenWorkspaceFromMenu,
          switchWorkspace: handleSwitchWorkspace,
          showLinkedTargets: handleShowLinkedTargets,
          savePathAs: handleSavePathAs,
          renamePath: handleRenamePath,
          showDeletePaths: handleShowDeletePaths,
          selectGroup: handleSelectCollectionFromToolbar,
          selectPath: handleSelectPathFromToolbar,
          openWorkspaceById: handleOpenWorkspaceById,
          openSample: handleOpenSample,
        }}
      />

      <div
        className={[
          "workspace",
          durableProject && !inspectorOpen ? "is-inspector-collapsed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            "--inspector-width": `${inspectorWidth}px`,
          } as CSSProperties
        }
        inert={projectTransitionInProgress ? true : undefined}
      >
        {!durableProject ? (
          <StartCenter
            initializing={initializing}
            initializationError={initializationError}
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
            onStartTour={() => startGuidedTour(editorBasicsTour.id)}
            onRetryInitialization={retryInitialization}
          />
        ) : (
          <>
            <section className="canvas-region" aria-label="Editor canvas">
              <PathStage
                field={activeField}
                activeTool={activeTool}
                showGhostPaths={showGhostPaths}
                onShowGhostPathsChange={(show) => {
                  setShowGhostPaths(show);
                  writeEditorUiPreferences({
                    ...readEditorUiPreferences(),
                    showGhostPaths: show,
                  });
                }}
                curveTool={curveToolSession}
                onToolChange={handleToolChange}
                onPlaceElement={handlePlaceCanvasElement}
                onInteractionStateChange={handleCanvasInteractionStateChange}
                onCurveToolCommit={handleCommitCurveTool}
                onCurveToolCancel={handleCancelCurveTool}
              />
              {activePath?.path.path_elements.length === 0 ? (
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
              key={projectSessionId ?? "no-project-session"}
              project={durableProject}
              activePath={activePath}
              selectedElementIndex={selectedElementIndex}
              fieldGeometry={activeField.geometry}
              open={inspectorOpen}
              activeTab={inspectorTab}
              inspectorWidth={inspectorWidth}
              footer={inspectorOpen ? workspaceStatus : null}
              curveToolActive={curveToolSession !== null}
              onClose={() => setInspectorOpen(false)}
              onActiveTabChange={setInspectorTab}
              onInspectorResize={(width) =>
                setInspectorWidth(clampInspectorWidth(width))
              }
              onStartCurve={handleStartCurveTool}
              onOpenLinkedTargetPicker={handleOpenLinkedTargetPicker}
              onDialogOpenChange={setInspectorDialogOpen}
            />
            {!inspectorOpen ? workspaceStatus : null}
          </>
        )}
      </div>

      <div className="sr-only" aria-label="Workspace status">
        <span data-testid="selected-element-status">
          {selectedElement && selectedElementIndex !== null
            ? `${getElementLabel(selectedElement)} ${selectedElementIndex + 1} · ${formatPointMeters(selectedPosition)}`
            : durableProject
              ? "Nothing selected"
              : "Ready"}
        </span>
        <span data-testid="current-path-status">{currentPathSummary}</span>
        <span data-testid="current-project-status">{currentProjectSummary}</span>
        <span data-testid="storage-status">{storageLabel}</span>
        {!workspaceStatusVisible ? (
          <button
            type="button"
            data-testid="save-status"
            title={`${storageLabel}. ${saveStatus}`}
            aria-label="Save"
            disabled={saveCommand.disabled}
            onClick={() => executeCommand(saveCommand)}
          >
            {workspaceSaveStatusLabel(saveStatusTone)}
          </button>
        ) : null}
      </div>

      {durableProject && showConfigDialog ? (
        <ProjectConfigDialog
          autoSyncEnabled={autoSyncEnabled}
          config={durableProject.config}
          fieldBackgrounds={fieldBackgrounds}
          selectedFieldId={selectedFieldId}
          onCancel={() => setShowConfigDialog(false)}
          onSave={handleSaveConfig}
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
          activeWorkspaceId={currentWorkspaceSummary?.id ?? null}
          workspaces={projectSummaries}
          onCancel={() => setShowDeleteProjectDialog(false)}
          onDelete={(projects) => void handleDeleteProjects(projects)}
        />
      ) : null}
      {durableProject && showPathGroupsDialog ? (
        <PathLibraryDialog
          project={durableProject}
          activePathId={activePathId}
          activePathGroupId={activePathGroupId}
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
      {durableProject && showLinkedTargetsDialog ? (
        <LinkedTargetsDialog
          linkRequest={linkedTargetPickerRequest}
          project={durableProject}
          field={activeField}
          onCancel={closeLinkedTargetsDialog}
        />
      ) : null}
      {durableProject && showNewPathDialog ? (
        <NewPathDialog
          activeGroup={
            durableProject.path_groups.find(
              (group) =>
                group.group_id ===
                (newPathGroupContextId !== undefined
                  ? newPathGroupContextId
                  : activePathGroupId),
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
          activePathId={activePathId}
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
      {status === "damaged" && persistenceDamage ? (
        <DamagedProjectDialog
          busy={resolvingConflict}
          sourcePath={persistenceDamage.sourcePath}
          onReload={() => void handleReloadFromDisk()}
          onReplace={() => void handleReplaceDamagedProject()}
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
            if (startGuidedTour(tourId)) {
              setShowTourPicker(false);
            }
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
            const state = projectStore.getState();
            selectionStore
              .getState()
              .selectElement(
                preparation.selectElement,
                activeProjectPath(state.project, state.activePathId)?.path,
              );
          }
        }}
      />
    </main>
  );
}

function WorkspaceStatus({
  compact,
  controlRef,
  diagnostics,
  saveCommand,
  saveStatus,
  saveStatusTone,
  showPathHealth,
  storageLabel,
  onResolveDiagnostic,
  onTogglePathHealth,
}: {
  compact: boolean;
  controlRef: RefObject<HTMLDivElement | null>;
  diagnostics: readonly PathDiagnostic[];
  saveCommand: EditorCommand;
  saveStatus: string;
  saveStatusTone: SaveStatusTone;
  showPathHealth: boolean;
  storageLabel: string;
  onResolveDiagnostic(diagnostic: PathDiagnostic): void;
  onTogglePathHealth(): void;
}) {
  const issueCount = diagnostics.length;
  const issueLabel = `Path health: ${issueCount} ${
    issueCount === 1 ? "issue" : "issues"
  }`;
  const saveLabel = workspaceSaveStatusLabel(saveStatusTone);

  return (
    <aside
      className={`workspace-status ${
        compact ? "workspace-status--floating" : "workspace-status--sidebar"
      }`}
      aria-label="Workspace status"
    >
      {issueCount > 0 || showPathHealth ? (
        <div
          ref={controlRef}
          className="workspace-status__diagnostics-control"
          data-tour="path-health"
        >
          <button
            type="button"
            className={`workspace-status__diagnostics workspace-status__diagnostics--${pathHealthSeverity(diagnostics)}`}
            aria-label={issueLabel}
            aria-expanded={showPathHealth}
            title={compact ? issueLabel : undefined}
            onClick={onTogglePathHealth}
          >
            <span
              className="workspace-status__diagnostics-icon"
              aria-hidden="true"
            >
              <CircleAlert aria-hidden="true" size={16} strokeWidth={2.4} />
            </span>
            {compact ? null : (
              <span>
                {issueCount} {issueCount === 1 ? "issue" : "issues"}
              </span>
            )}
          </button>
          {showPathHealth ? (
            <PathHealthPopover
              diagnostics={diagnostics}
              saveError={null}
              onSelect={onResolveDiagnostic}
            />
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className={[
          "workspace-status__save",
          `workspace-status__save--${saveStatusTone}`,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="save-status"
        title={`${storageLabel}. ${saveStatus}`}
        aria-label="Save"
        aria-live="polite"
        disabled={saveCommand.disabled}
        onClick={() => executeCommand(saveCommand)}
      >
        <span className="workspace-status__save-glyph" aria-hidden="true">
          {workspaceSaveStatusGlyph(saveStatusTone)}
        </span>
        <span className={compact ? "sr-only" : undefined}>{saveLabel}</span>
        {!compact && saveStatusTone === "danger" ? (
          <strong>Retry</strong>
        ) : null}
      </button>
    </aside>
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

type ImportMode = "archive" | "path" | "config";
type PendingToolbarAction = "open" | "import" | "export" | null;

const MOBILE_SUPPORT_WARNING_DISMISSED_KEY =
  "bline-web:mobile-support-warning-dismissed";

const mobileSupportMediaQuery =
  "(max-width: 767px), (pointer: coarse) and (max-width: 980px)";

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

function DamagedProjectDialog({
  busy,
  sourcePath,
  onReload,
  onReplace,
}: {
  busy: boolean;
  sourcePath: string;
  onReload(): void;
  onReplace(): void;
}) {
  return (
    <div
      className="config-dialog-backdrop mobile-warning-backdrop"
      role="presentation"
    >
      <section
        className="mobile-warning-dialog save-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="damaged-project-title"
        aria-describedby="damaged-project-description"
        data-testid="damaged-project-dialog"
      >
        <header className="mobile-warning-dialog__header">
          <span className="mobile-warning-dialog__icon" aria-hidden="true">
            !
          </span>
          <h2 id="damaged-project-title">Project metadata needs attention</h2>
        </header>
        <p id="damaged-project-description">
          BLine opened the runtime Paths, but <strong>{sourcePath}</strong> is
          malformed or conflicted. The original file is untouched. Editing and
          exports remain available, but saving is blocked until you repair the
          file and reload or explicitly replace it with the Project now open.
        </p>
        <footer className="mobile-warning-dialog__footer save-conflict-dialog__footer">
          <button
            type="button"
            className="mobile-warning-dialog__action save-conflict-dialog__action--secondary"
            onClick={onReload}
            disabled={busy}
          >
            Reload after repair
          </button>
          <button
            type="button"
            className="mobile-warning-dialog__action"
            onClick={onReplace}
            disabled={busy}
          >
            Replace metadata
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
    { label: "Different contents", items: diff.changedPaths },
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

interface SaveStatusInput {
  autosaveStatus: AutosaveStatus;
  dirty: boolean;
  error: string | null;
  initializing: boolean;
  lastSavedAt: string | null;
  optimizerPhase: AutoVelocityPhase;
  status: string;
}

function formatSaveStatus({
  autosaveStatus,
  dirty,
  error,
  initializing,
  lastSavedAt,
  optimizerPhase,
  status,
}: SaveStatusInput): string {
  if (initializing || status === "loading") {
    return "Loading";
  }

  if (status === "conflict") {
    return "Project changed on disk";
  }

  if (status === "damaged") {
    return "Project metadata needs attention";
  }

  if (status === "error" && error) {
    return `Save failed: ${error}`;
  }

  if (status === "saving" || autosaveStatus === "saving") {
    return "Saving";
  }

  if (optimizerPhase === "pending") {
    return "Optimizer queued";
  }

  if (optimizerPhase === "running") {
    return "Optimizing constraints";
  }

  if (dirty && autosaveStatus === "pending") {
    return "Autosave pending";
  }

  if (dirty) {
    return "Unsaved changes";
  }

  return lastSavedAt ? `Saved ${formatTimestamp(lastSavedAt)}` : "Saved";
}

type SaveStatusTone =
  | "danger"
  | "loading"
  | "optimizing"
  | "pending"
  | "saved"
  | "saving";

function workspaceSaveStatusLabel(tone: SaveStatusTone): string {
  if (tone === "danger") {
    return "Save failed";
  }
  if (tone === "saving" || tone === "pending") {
    return "Saving…";
  }
  if (tone === "optimizing") {
    return "Optimizing…";
  }
  if (tone === "loading") {
    return "Loading…";
  }
  return "Saved";
}

function workspaceSaveStatusGlyph(tone: SaveStatusTone): string {
  if (tone === "danger") {
    return "❌";
  }
  if (tone === "saved") {
    return "✅";
  }
  return "🚀";
}

function getSaveStatusTone({
  autosaveStatus,
  dirty,
  error,
  initializing,
  optimizerPhase,
  status,
}: SaveStatusInput): SaveStatusTone {
  if (initializing || status === "loading") {
    return "loading";
  }

  if (
    status === "conflict" ||
    status === "damaged" ||
    (status === "error" && error) ||
    autosaveStatus === "error"
  ) {
    return "danger";
  }

  if (status === "saving" || autosaveStatus === "saving") {
    return "saving";
  }

  if (optimizerPhase !== "idle") {
    return "optimizing";
  }

  if (dirty) {
    return "pending";
  }

  return "saved";
}

async function migrateImportedFieldsForProject(
  pending: ProjectImportResult,
): Promise<ProjectImportRollback> {
  const migration = await migrateImportedLegacyFieldBackgrounds({
    projectId: pending.project.project_id,
    selectedFieldId: pending.legacySelectedFieldId,
    entries: pending.legacyFieldBackgrounds,
  });
  if (migration.errors[0]) {
    try {
      await migration.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [...migration.errors, rollbackError],
        "Field Background migration failed and could not be rolled back",
      );
    }
    throw migration.errors[0];
  }
  return { rollback: () => migration.rollback() };
}

function formatTimestamp(value: string): string {
  const timestamp = parseProjectTimestamp(value);
  if (timestamp === null) {
    return value;
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function pathHealthSeverity(diagnostics: readonly PathDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "error"
    : "warning";
}

function clampCoordinateToBounds(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? Math.min(Math.max(value, minimum), maximum)
    : (minimum + maximum) / 2;
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
