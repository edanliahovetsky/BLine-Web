import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
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
import { activeProjectPath } from "../../core/model/editorNavigation";
import type {
  LinkedTarget,
  LinkedTargetKind,
  Project,
  ProjectConfig,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import {
  diffWorkspaceConflict,
  type WorkspaceConflictDiff,
} from "../../core/io/workspaceConflictDiff";
import {
  coordinateEditBounds,
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  defaultFieldId,
  resolveUserFieldDefinition,
  type FieldBackgroundEntry,
  type FieldGeometry,
  type ResolvedFieldDefinition,
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
import { createProjectIoService } from "../../platform/projectIo";
import {
  downloadBlob,
  isAbortError,
  saveBlobAs,
} from "../../platform/fileExport";
import {
  createProjectAutosaveCoordinator,
  type AutosaveCoordinator,
  type AutosaveStatus,
} from "../../state/autosave";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import {
  canGenerateAutomaticConstraints,
  generateAutomaticConstraints,
  startAutomaticConstraintSync,
} from "../../state/automaticConstraints";
import { autoVelocitySettingsForPath } from "../../core/constraints/autoVelocityApply";
import {
  legacyProjectMigrationOwnsSession,
  projectStore,
} from "../../state/projectStore";
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
  formatShortcut,
  readEditorUiPreferences,
  writeEditorUiPreferences,
  type EditorCommand,
  type EditorTool,
  type EditorUiPreferencesV1,
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
  createTourSessionController,
  type TourSessionController,
} from "../tours/tourSession";
import {
  deleteFieldBackground,
  flushUserData,
  importFieldBackgroundFromBytes,
  initializeUserData,
  listFieldBackgrounds,
  migrateProjectViewIdentity,
  readFieldBackgroundImage,
  rememberSelectedFieldBackground,
  selectedFieldBackgroundForProject,
  updateFieldBackgroundMetadata,
} from "../../userData";
import {
  migrateImportedLegacyFieldBackgrounds,
  migrateLegacyProjectFieldBackgrounds,
} from "../../userData/legacyFieldMigration";
import { displayNameFromFileName } from "../../core/io/workspaceSerde";
import { editorBasicsTour, tours } from "../tours/tours";
import {
  ensureCurrentWorkspaceSummary,
  formatStorageLabel,
} from "./projectStoragePresentation";
import { parseProjectTimestamp } from "./projectTimestamp";

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
  const [workspaceSummaries, setWorkspaceSummaries] = useState<
    ProjectWorkspaceSummary[]
  >([]);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [fieldBackgrounds, setFieldBackgrounds] = useState<
    FieldBackgroundEntry[]
  >([]);
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
  const [initializing, setInitializing] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [legacyFieldMigrationAttempt, setLegacyFieldMigrationAttempt] =
    useState<{ key: string; phase: "running" | "failed" } | null>(null);
  const [legacyFieldMigrationRetry, setLegacyFieldMigrationRetry] = useState(0);
  const [canvasInteractionActive, setCanvasInteractionActive] = useState(false);
  const [curveToolSession, setCurveToolSession] =
    useState<CurveToolSession | null>(null);
  const [inspectorDialogOpen, setInspectorDialogOpen] = useState(false);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const canvasInteractionActiveRef = useRef(false);
  const nextCurveToolSessionIdRef = useRef(1);
  const importHandlingRef = useRef(false);
  const pendingToolbarActionRef = useRef<PendingToolbarAction>(null);
  const attemptedFieldMigrationKeysRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const pathMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tourViewRef = useRef<{
    blocked: boolean;
    snapshot: TourEditorViewSnapshot;
  } | null>(null);
  const tourSessionRef = useRef<TourSessionController | null>(null);

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
        setInspectorWidth(view.inspectorWidth);
        setActiveTool(view.activeTool);
        setAutosaveStatus(view.autosaveStatus);
        autoVelocityStore.getState().setLastError(view.optimizerError);
        setShowGhostPaths(view.showGhostPaths);
      },
    });
    tourSessionRef.current = controller;
    return () => {
      controller.dispose();
      tourSessionRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    const capabilities = detectEnvironmentCapabilities();
    const service = createProjectIoService(capabilities);

    projectStore.getState().setProjectIoService(service);

    async function initializeProject() {
      setInitializing(true);

      try {
        const userData = await initializeUserData(capabilities);
        if (cancelled) {
          return;
        }
        setInspectorWidth(userData.editor_layout.inspector_width);
        setShowGhostPaths(userData.editor_layout.show_ghost_paths);
        autoVelocityStore
          .getState()
          .setAutoSyncEnabled(userData.automatic_generation.keep_in_sync);
        tourStore.getState().hydrateCompleted(userData.completed_tour_ids);
        setFieldBackgrounds(userData.field_backgrounds);
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

  const legacyFieldMigrationKey =
    durableProject && projectSessionId
      ? JSON.stringify({
          projectSessionId,
          projectId: durableProject.project_id,
          field: durableProject.config.gui.field,
        })
      : null;

  useEffect(() => {
    const migrationProject = projectStore.getState().project;
    if (!migrationProject || !projectSessionId) {
      return;
    }

    const projectId = migrationProject.project_id;
    const migrationSessionId = projectSessionId;
    const migration = projectIo?.getLegacyProjectViewMigration() ?? null;

    if (
      !projectIo ||
      !migration ||
      migration.stableProjectId !== projectId ||
      !legacyFieldMigrationKey ||
      attemptedFieldMigrationKeysRef.current.has(legacyFieldMigrationKey)
    ) {
      return;
    }
    attemptedFieldMigrationKeysRef.current.add(legacyFieldMigrationKey);
    setLegacyFieldMigrationAttempt({
      key: legacyFieldMigrationKey,
      phase: "running",
    });
    let cancelled = false;
    let finished = false;
    const ownsMigrationSession = () => {
      const state = projectStore.getState();
      return (
        !cancelled &&
        state.io === projectIo &&
        state.projectSessionId === migrationSessionId &&
        state.project?.project_id === projectId
      );
    };
    const abandonAttempt = () => {
      attemptedFieldMigrationKeysRef.current.delete(legacyFieldMigrationKey);
    };

    void (async () => {
      const preparation = await projectStore
        .getState()
        .prepareLegacyProjectMigration(migrationSessionId, migration);
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      if (preparation.status === "rejected") {
        throw new Error("Legacy Project migration could not be prepared");
      }
      await migrateProjectViewIdentity(
        migration.legacyProjectId,
        migration.stableProjectId,
        migration.pathIdByLegacyReference,
      );
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      const { errors } = await migrateLegacyProjectFieldBackgrounds(
        migrationProject,
        projectIo,
        migration.legacyProjectId,
      );
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      if (errors[0]) {
        throw errors[0];
      }
      await projectStore
        .getState()
        .completeLegacyProjectMigration(migrationSessionId, migration);
      if (!ownsMigrationSession()) {
        abandonAttempt();
        return;
      }
      setFieldBackgrounds(listFieldBackgrounds());
      setFieldSelectionOverride({
        projectId,
        fieldId:
          selectedFieldBackgroundForProject(projectId, defaultFieldId) ??
          defaultFieldId,
      });
      finished = true;
      setLegacyFieldMigrationAttempt(null);
    })().catch((migrationError: unknown) => {
      abandonAttempt();
      if (ownsMigrationSession()) {
        setLegacyFieldMigrationAttempt({
          key: legacyFieldMigrationKey,
          phase: "failed",
        });
        projectStore.getState().markLegacyMigrationError(migrationError);
      }
    });

    return () => {
      cancelled = true;
      if (!finished) {
        abandonAttempt();
      }
    };
  }, [
    legacyFieldMigrationKey,
    legacyFieldMigrationRetry,
    projectIo,
    projectSessionId,
  ]);

  const legacyFieldMigrationPhase =
    legacyFieldMigrationAttempt?.key === legacyFieldMigrationKey
      ? legacyFieldMigrationAttempt.phase
      : null;

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
    if (!projectIo) {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
      return;
    }

    autosaveRef.current?.cancel();
    autosaveRef.current = createProjectAutosaveCoordinator(projectStore, {
      delayMs: 300,
      onStatusChange: setAutosaveStatus,
      shouldDefer: () =>
        canvasInteractionActiveRef.current ||
        legacyProjectMigrationOwnsSession(projectStore.getState()) ||
        projectStore.getState().status === "conflict" ||
        projectStore.getState().status === "damaged",
    });

    return () => {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
    };
  }, [projectIo]);

  useEffect(() => {
    if (!durableProject || !dirty) {
      return;
    }

    if (canvasInteractionActiveRef.current) {
      autosaveRef.current?.cancel();
      return;
    }

    autosaveRef.current?.schedule();
  }, [canvasInteractionActive, dirty, durableProject]);

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
          .createWorkspace(createNamedProject(projectName, pathName));
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
      await projectStore.getState().createWorkspace(createSampleProject());
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      setOpenTopMenu(null);
    }
  }, [refreshWorkspaceSummaries]);

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

  const handleReplaceDamagedProject = useCallback(async () => {
    setResolvingConflict(true);
    try {
      await projectStore.getState().replaceDamagedProject();
      autosaveRef.current?.cancel();
    } catch {
      // The store keeps the damaged/error state so the choice stays actionable.
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

    if (legacyFieldMigrationPhase === "running") {
      return;
    }
    if (legacyFieldMigrationPhase === "failed") {
      setLegacyFieldMigrationRetry((generation) => generation + 1);
      return;
    }

    try {
      await projectStore.getState().saveWorkspace();
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    }
  }, [legacyFieldMigrationPhase, refreshWorkspaceSummaries]);

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
    async (projects: ProjectWorkspaceSummary[]) => {
      if (projects.length === 0) {
        setShowDeleteProjectDialog(false);
        return;
      }

      autosaveRef.current?.cancel();

      try {
        const currentStorageId =
          projectStore.getState().io?.getCurrentWorkspaceSummary()?.id ?? null;
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

        const imported = await projectStore
          .getState()
          .importProjectArchive(file);
        const fieldMigration = await migrateImportedLegacyFieldBackgrounds({
          projectId: imported.project.project_id,
          selectedFieldId: imported.legacySelectedFieldId,
          entries: imported.legacyFieldBackgrounds,
        });
        if (fieldMigration.errors[0]) {
          throw fieldMigration.errors[0];
        }
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
        const imported = await projectStore
          .getState()
          .importProjectFolder(files);
        const fieldMigration = await migrateImportedLegacyFieldBackgrounds({
          projectId: imported.project.project_id,
          selectedFieldId: imported.legacySelectedFieldId,
          entries: imported.legacyFieldBackgrounds,
        });
        if (fieldMigration.errors[0]) {
          throw fieldMigration.errors[0];
        }
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
    [endToolbarAction, refreshWorkspaceSummaries],
  );

  const handleSaveConfig = useCallback(
    async (
      nextConfig: ProjectConfig,
      options: {
        autoSyncEnabled: boolean;
        configChanged: boolean;
        selectedFieldId: string;
        fieldBackgrounds: FieldBackgroundEntry[];
      },
    ) => {
      const state = projectStore.getState();
      const currentProject = state.project;
      if (!currentProject) {
        return;
      }

      const currentFields = listFieldBackgrounds();
      const nextFieldIds = new Set(
        options.fieldBackgrounds.map((field) => field.id),
      );
      for (const field of options.fieldBackgrounds) {
        const current = currentFields.find((entry) => entry.id === field.id);
        if (
          current &&
          (current.name !== field.name ||
            JSON.stringify(current.geometry) !== JSON.stringify(field.geometry))
        ) {
          await updateFieldBackgroundMetadata(field.id, {
            name: field.name,
            geometry: field.geometry,
          });
        }
      }
      for (const field of currentFields) {
        if (!nextFieldIds.has(field.id)) {
          await deleteFieldBackground(field.id);
        }
      }
      rememberSelectedFieldBackground(
        currentProject.project_id,
        options.selectedFieldId,
      );
      await flushUserData();
      setFieldBackgrounds(listFieldBackgrounds());
      setFieldSelectionOverride({
        projectId: currentProject.project_id,
        fieldId: options.selectedFieldId,
      });
      if (options.configChanged) {
        projectStore
          .getState()
          .applyConfigCommand(
            createUpdateProjectConfigCommand(currentProject.config, nextConfig),
          );
      }
      autoVelocityStore.getState().setAutoSyncEnabled(options.autoSyncEnabled);
      setShowConfigDialog(false);
    },
    [],
  );

  const handleUploadFieldImage = useCallback(
    async (file: File, geometry: FieldGeometry) => {
      const entry = await importFieldBackgroundFromBytes({
        name: displayNameFromFileName(file.name),
        fileName: file.name,
        mimeType: file.type || "image/png",
        bytes: new Uint8Array(await file.arrayBuffer()),
        geometry,
      });
      setFieldBackgrounds(listFieldBackgrounds());
      return entry;
    },
    [],
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
  const selectedSummary =
    selectedElement && selectedElementIndex !== null
      ? `Selected: ${getElementLabel(selectedElement)} #${selectedElementIndex + 1} ${formatPointMeters(selectedPosition)}`
      : "Selected: none";
  const ioCapabilities = projectIo?.capabilities;
  const supportsProjectFolders = Boolean(
    ioCapabilities?.supportsProjectFolders,
  );
  const pathDocuments = durableProject?.paths ?? [];
  const currentWorkspaceSummary =
    projectIo?.getCurrentWorkspaceSummary() ?? null;
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
    () =>
      derivePathDiagnostics(
        activePath?.path ?? null,
        durableProject ? activeField.geometry : null,
        durableProject?.linked_targets ?? [],
      ),
    [activeField.geometry, activePath, durableProject],
  );
  // A broken reference should read as more urgent than a soft warning.
  const pathHealthSeverity = pathDiagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? "error"
    : "warning";
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

  return (
    <main
      className="app-shell"
      data-testid="app-shell"
      aria-busy={projectTransitionInProgress}
    >
      <header className="app-toolbar" ref={toolbarRef}>
        <nav className="app-tabs" aria-label="Top menu">
          <IconButton
            className="app-toolbar__navigator-button"
            aria-label={navigatorCommand.label}
            title={navigatorCommand.label}
            disabled={navigatorCommand.disabled}
            onClick={() => executeCommand(navigatorCommand)}
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
                    disabled={!projectIo || toolbarBusy}
                    onAction={() => void handleOpenWorkspace()}
                  />
                  <MenuAction
                    label="Create Project Folder..."
                    disabled={!projectIo || toolbarBusy}
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
                    disabled={!projectIo || toolbarBusy}
                    onAction={() => void handleNewProject()}
                  />
                  <MenuAction
                    label="Open Project..."
                    disabled={!projectIo || toolbarBusy}
                    onAction={handleOpenProjectPanel}
                  />
                  <MenuAction
                    label="Delete Projects..."
                    disabled={!durableProject || !projectIo || toolbarBusy}
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
                    disabled={!projectIo || toolbarBusy}
                    onAction={queueFolderImport}
                  />
                  <MenuAction
                    label="Export Autos Folder..."
                    disabled={!durableProject || !projectIo}
                    onAction={() => void handleExportProjectFolder()}
                  />
                  <div className="top-menu__separator" role="separator" />
                </>
              ) : null}
              <MenuAction
                label="Import Project Archive..."
                disabled={!projectIo || toolbarBusy}
                onAction={() => queueFileImport("archive")}
              />
              <MenuAction
                label="Export Project Archive..."
                disabled={!durableProject || !projectIo}
                onAction={() => {
                  setOpenTopMenu(null);
                  void handleExportProjectArchive();
                }}
              />
            </MenuSubmenu>
            <MenuSubmenu label="Config" testId="top-menu-project-config">
              <MenuAction
                label="Import Config..."
                disabled={!durableProject || !projectIo || toolbarBusy}
                onAction={() => queueFileImport("config")}
              />
              <MenuAction
                label="Export Config..."
                disabled={!durableProject || !projectIo}
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
              disabled={!durableProject || toolbarBusy}
              onAction={handleShowLinkedTargets}
            />
            <MenuSubmenu label="Manage Paths" testId="top-menu-path-manage">
              <MenuAction
                label="Create New Path"
                disabled={newPathCommand.disabled}
                onAction={() => executeCommand(newPathCommand)}
              />
              <MenuAction
                label="Save Path As..."
                disabled={!activePath || !projectIo || toolbarBusy}
                onAction={() => void handleSavePathAs()}
              />
              <MenuAction
                label="Rename Path..."
                disabled={!activePath || toolbarBusy}
                onAction={handleRenamePath}
              />
              <MenuAction
                label="Delete Paths..."
                disabled={
                  !durableProject || pathDocuments.length === 0 || toolbarBusy
                }
                onAction={handleShowDeletePaths}
              />
            </MenuSubmenu>
            <MenuSubmenu
              label="Import / Export"
              testId="top-menu-path-transfer"
            >
              <MenuAction
                label="Import Path..."
                disabled={!durableProject || !projectIo || toolbarBusy}
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
              project={durableProject}
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
                shortcut={undoCommand.shortcut}
                disabled={undoCommand.disabled}
                onAction={() => {
                  setShowOpenPanel(false);
                  executeCommand(undoCommand);
                  setOpenTopMenu(null);
                }}
              />
              <MenuAction
                label={redoLabel}
                shortcut={redoCommand.shortcut}
                disabled={redoCommand.disabled}
                onAction={() => {
                  setShowOpenPanel(false);
                  executeCommand(redoCommand);
                  setOpenTopMenu(null);
                }}
              />
              <div className="top-menu__separator" role="separator" />
              {supportsProjectFolders ? (
                <MenuAction
                  label="New Path"
                  disabled={newPathCommand.disabled}
                  onAction={() => {
                    executeCommand(newPathCommand);
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
                  disabled={!durableProject || !projectIo || toolbarBusy}
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
                disabled={navigatorCommand.disabled}
                onAction={() => executeCommand(navigatorCommand)}
              />
              <div className="top-menu__separator" role="separator" />
              <MenuAction
                label="Save"
                disabled={saveCommand.disabled}
                onAction={() => {
                  setOpenTopMenu(null);
                  executeCommand(saveCommand);
                }}
              />
            </TopMenuButton>
          </div>
          <div className="toolbar-actions__buttons">
            <IconButton
              aria-label="Undo"
              aria-keyshortcuts="Meta+Z Control+Z"
              title={`${undoLabel} (${formatShortcut(undoCommand.shortcut)})`}
              disabled={undoCommand.disabled}
              onClick={() => executeCommand(undoCommand)}
            >
              <Undo2 aria-hidden="true" size={16} />
            </IconButton>
            <IconButton
              aria-label="Redo"
              aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Meta+Y Control+Y"
              title={`${redoLabel} (${formatShortcut(redoCommand.shortcut)})`}
              disabled={redoCommand.disabled}
              onClick={() => executeCommand(redoCommand)}
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
                disabled={!activePath}
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
                        .selectElement(
                          diagnostic.elementIndex,
                          activePath?.path,
                        );
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
                  tourAvailable={Boolean(activePath) && toursSupported}
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
                    executeCommand(shortcutHelpCommand);
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
              disabled={settingsCommand.disabled}
              onClick={() => executeCommand(settingsCommand)}
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
                  ? `${inspectorCommand.label} (⌘B)`
                  : optimizerBeamTitle(
                      optimizerPhase,
                      optimizerError,
                      `${inspectorCommand.label} (⌘B)`,
                    )
              }
              disabled={inspectorCommand.disabled}
              onClick={() => executeCommand(inspectorCommand)}
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
              inspectorWidth={inspectorWidth}
              curveToolActive={curveToolSession !== null}
              onClose={() => setInspectorOpen(false)}
              onInspectorResize={(width) =>
                setInspectorWidth(clampInspectorWidth(width))
              }
              onStartCurve={handleStartCurveTool}
              onOpenLinkedTargetPicker={handleOpenLinkedTargetPicker}
              onDialogOpenChange={setInspectorDialogOpen}
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
            : durableProject
              ? "Nothing selected"
              : "Ready"}
        </span>
        <span className="status-bar__hint">
          {durableProject
            ? toolHint(activeTool, curveToolSession !== null)
            : ""}
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
            disabled={saveCommand.disabled}
            onClick={() => executeCommand(saveCommand)}
          >
            <span className="status-bar__save-dot" aria-hidden="true" />
            <span>{compactSaveStatus(saveStatus, saveStatusTone)}</span>
            {saveStatusTone === "danger" ? <strong>Retry</strong> : null}
          </button>
        </div>
      </footer>

      {durableProject && showConfigDialog ? (
        <ProjectConfigDialog
          autoSyncEnabled={autoSyncEnabled}
          config={durableProject.config}
          fieldBackgrounds={fieldBackgrounds}
          selectedFieldId={selectedFieldId}
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
  project,
  activeGroup,
  activePath,
  visiblePaths,
  onSelectGroup,
  onSelectPath,
}: {
  project: Project | null;
  activeGroup: ProjectPathGroup | null;
  activePath: ProjectPath | null;
  visiblePaths: ProjectPath[];
  onSelectGroup(groupId: string | null): void;
  onSelectPath(pathId: string): void;
}) {
  const collectionValue = activeGroup?.group_id ?? "__all_paths__";
  const collectionLabel = activeGroup?.display_name ?? "All Paths";
  const collectionOptions = [
    { label: "All Paths", value: "__all_paths__" },
    ...(project?.path_groups.map((group) => ({
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
          disabled={!project}
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
  activeGroup: ProjectPathGroup | null;
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
  project,
  activePathId,
  activePathGroupId,
  onCancel,
  onCreatePath,
  onDeletePaths,
  onExportPath,
  onImportPath,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(): void;
  onExportPath(): void;
  onImportPath(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    activePathGroupId,
  );
  const [selectedPathId, setSelectedPathId] = useState<string | null>(
    activePathId ?? project.paths[0]?.path_id ?? null,
  );
  const [query, setQuery] = useState("");
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] =
    useState(false);
  const [deletingGroup, setDeletingGroup] = useState<ProjectPathGroup | null>(
    null,
  );
  const [nameAction, setNameAction] = useState<LibraryNameAction | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        deletingGroup ||
        showCreateCollectionDialog ||
        nameAction
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (
        !modifier ||
        event.altKey ||
        isEditableShortcutTarget(event.target) ||
        (key !== "z" && key !== "y")
      ) {
        return;
      }

      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        projectStore.getState().redo();
      } else {
        projectStore.getState().undo();
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [deletingGroup, nameAction, showCreateCollectionDialog]);

  const selectedGroup =
    project.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const selectedCollectionPaths = visiblePathsForGroup(
    project.paths,
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
    project.paths.find((path) => path.path_id === selectedPathId) ?? null;
  const selectedPath =
    selectedPathFromState &&
    selectedCollectionPaths.some(
      (path) => path.path_id === selectedPathFromState.path_id,
    )
      ? selectedPathFromState
      : (selectedCollectionPaths.find(
          (path) => path.path_id === activePathId,
        ) ??
        selectedCollectionPaths[0] ??
        null);
  const effectiveSelectedPathId = selectedPath?.path_id ?? null;
  const handleSelectLibraryGroup = (groupId: string | null) => {
    const nextGroup =
      project.path_groups.find((group) => group.group_id === groupId) ?? null;
    const nextPaths = visiblePathsForGroup(project.paths, nextGroup);

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

    const createdGroupId = projectStore.getState().activePathGroupId;
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
        const nextPathId = projectStore.getState().activePathId;
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
            <span>{project.display_name}</span>
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
                  Permanent collection / {project.paths.length} paths
                </small>
              </button>
              {project.path_groups.map((group) => (
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
                    {activePathGroupId === group.group_id ? " / active" : ""}
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
                      path.path_id === activePathId ? "is-current" : "",
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
                      {path.path_id === activePathId ? " / open" : ""}
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
                    <span>{project.path_groups.length + 1} collections</span>
                  </div>
                  <div className="path-library-dialog__membership-list">
                    <label className="path-library-dialog__membership-row is-permanent">
                      <input type="checkbox" checked disabled />
                      <span>All Paths</span>
                      <small>Permanent</small>
                    </label>
                    {project.path_groups.map((group) => (
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
          memberPaths={visiblePathsForGroup(project.paths, deletingGroup)}
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
  project,
  field,
  onCancel,
}: {
  linkRequest?: LinkedTargetPickerRequest | null;
  project: Project;
  field: ResolvedFieldDefinition;
  onCancel(): void;
}) {
  const [requestedTargetId, setSelectedTargetId] = useState<
    string | null | undefined
  >(undefined);
  const pickerElement = linkRequest?.element ?? null;
  const pickerCompatibleTargets = pickerElement
    ? project.linked_targets.filter((target) =>
        isElementCompatibleWithLinkedTarget(pickerElement, target),
      )
    : project.linked_targets;
  const currentPickerTargetId = pickerElement
    ? getPathElementLinkedTargetId(pickerElement)
    : null;
  const fallbackTargetId =
    linkRequest && currentPickerTargetId
      ? currentPickerTargetId
      : (pickerCompatibleTargets[0]?.target_id ??
        project.linked_targets[0]?.target_id ??
        null);

  const selectedTargetId =
    requestedTargetId === undefined
      ? fallbackTargetId
      : requestedTargetId &&
          project.linked_targets.some(
            (target) => target.target_id === requestedTargetId,
          )
        ? requestedTargetId
        : null;

  const selectedTarget =
    project.linked_targets.find(
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
    ? linkedTargetUseCount(project, selectedTarget.target_id)
    : 0;
  const coordinateLength = fieldCoordinateLengthMeters(field.geometry);
  const coordinateWidth = fieldCoordinateWidthMeters(field.geometry);

  const createTarget = (kind: LinkedTargetKind) => {
    const targetId = projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(project, kind),
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
      .selectElement(
        linkRequest.elementIndex,
        activeProjectPath(
          projectStore.getState().project,
          projectStore.getState().activePathId,
        )?.path,
      );
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
                ? `${pickerCompatibleTargets.length} compatible / ${project.linked_targets.length} total`
                : `${project.linked_targets.length} ${
                    project.linked_targets.length === 1 ? "element" : "elements"
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
              <span>{project.linked_targets.length}</span>
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
              {project.linked_targets.length > 0 ? (
                project.linked_targets.map((target) => {
                  const selected = target.target_id === selectedTargetId;
                  const compatible =
                    !pickerElement ||
                    isElementCompatibleWithLinkedTarget(pickerElement, target);
                  const useCount = linkedTargetUseCount(
                    project,
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
                config={project.config}
                field={field}
                selectedTargetId={selectedTargetId}
                targets={project.linked_targets}
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
                    {...coordinateEditBounds(
                      selectedTarget.x_meters,
                      coordinateLength,
                    )}
                    onChange={(x_meters) =>
                      updateTarget(selectedTarget.target_id, { x_meters })
                    }
                  />
                  <LinkedTargetNumberField
                    label="Y (m)"
                    value={selectedTarget.y_meters}
                    disabled={Boolean(selectedTarget.locked)}
                    {...coordinateEditBounds(
                      selectedTarget.y_meters,
                      coordinateWidth,
                    )}
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
                        project.linked_targets.find(
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
          if (nextValue !== null && nextValue !== value) {
            onChange(nextValue);
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
  onDelete(projects: ProjectWorkspaceSummary[]): void;
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
          onDelete(selectedProjects);
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
  paths: ProjectPath[];
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
  group: ProjectPathGroup;
  memberPaths: ProjectPath[];
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
  paths: readonly ProjectPath[],
  group: ProjectPathGroup | null,
): ProjectPath[] {
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

  if (status === "damaged") {
    return "Project metadata needs attention";
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
    status === "damaged" ||
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

function safeDownloadName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "bline-project"
  );
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
