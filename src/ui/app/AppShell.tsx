import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PathStage } from "../../canvas/PathStage";
import type {
  ProjectPathDocument,
  ProjectWorkspaceDocument
} from "../../core/io/projectSchema";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import { detectEnvironmentCapabilities } from "../../env/capabilities";
import {
  createProjectIoService,
  type ProjectFolderExport,
  type ProjectIoCapabilities
} from "../../platform/projectIo";
import {
  createProjectAutosaveCoordinator,
  type AutosaveCoordinator,
  type AutosaveStatus
} from "../../state/autosave";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import type { ProjectWorkspaceSummary } from "../../storage";
import { Sidebar } from "../sidebar/Sidebar";
import "./AppShell.css";
import { createUpdateProjectConfigCommand } from "./configCommands";
import {
  createInitialCanvasWorkspace,
  createNewCanvasWorkspace
} from "./initialProject";
import { ProjectConfigDialog } from "./ProjectConfigDialog";

export function AppShell() {
  const workspace = useStoreSelector(projectStore, (state) => state.workspace);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const projectIo = useStoreSelector(projectStore, (state) => state.io);
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const status = useStoreSelector(projectStore, (state) => state.status);
  const error = useStoreSelector(projectStore, (state) => state.error);
  const currentVersion = useStoreSelector(projectStore, (state) => state.version);
  const lastSavedAt = useStoreSelector(projectStore, (state) => state.lastSavedAt);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );
  const canUndo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canUndo
  );
  const canRedo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canRedo
  );
  const [workspaceSummaries, setWorkspaceSummaries] = useState<ProjectWorkspaceSummary[]>([]);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showDeleteProjectDialog, setShowDeleteProjectDialog] = useState(false);
  const [showDeletePathDialog, setShowDeletePathDialog] = useState(false);
  const [pendingImportMode, setPendingImportMode] =
    useState<ImportMode>("archive");
  const [initializing, setInitializing] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [canvasInteractionActive, setCanvasInteractionActive] = useState(false);
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const canvasInteractionActiveRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

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
    []
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
              : createInitialCanvasWorkspace()
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
    if (!projectIo) {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
      return;
    }

    autosaveRef.current?.cancel();
    autosaveRef.current = createProjectAutosaveCoordinator(projectStore, projectIo, {
      delayMs: 300,
      onStatusChange: setAutosaveStatus,
      shouldDefer: () => canvasInteractionActiveRef.current
    });

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

  const handleCreateNewPath = useCallback(async () => {
    const rawName = window.prompt("Enter path name:", "new_path");
    if (rawName === null) {
      setOpenTopMenu(null);
      return;
    }

    const displayName = rawName.trim() || "Untitled Path";
    projectStore.getState().createPath({
      displayName,
      fileName: ensureJsonFileName(displayName)
    });
    selectionStore.getState().clearSelection();
    setShowOpenPanel(false);
    setOpenTopMenu(null);
  }, []);

  const handleSaveProject = useCallback(async () => {
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
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void handleSaveProject();
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
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [handleSaveProject]);

  const handleToggleOpenPanel = useCallback(() => {
    setShowOpenPanel((current) => {
      if (!current) {
        void refreshWorkspaceSummaries();
      }
      return !current;
    });
  }, [refreshWorkspaceSummaries]);

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
        await refreshWorkspaceSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    },
    [refreshWorkspaceSummaries]
  );

  const handleOpenWorkspaceFromMenu = useCallback(
    async (id: string) => {
      setOpenTopMenu(null);
      await handleOpenWorkspaceById(id);
    },
    [handleOpenWorkspaceById]
  );

  const handleOpenWorkspace = useCallback(async () => {
    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().openWorkspace();
      selectionStore.getState().clearSelection();
      setShowOpenPanel(false);
      await refreshWorkspaceSummaries();
    } catch {
      // The project store already records the error for the status bar.
    } finally {
      setOpenTopMenu(null);
    }
  }, [refreshWorkspaceSummaries]);

  const handleCreateWorkspace = useCallback(async () => {
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
        const currentProjectId = projectStore.getState().workspace?.project_id ?? null;
        const orderedIds = [
          ...ids.filter((id) => id !== currentProjectId),
          ...ids.filter((id) => id === currentProjectId)
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
    [refreshWorkspaceSummaries]
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
    [refreshWorkspaceSummaries]
  );

  const handleExportProjectArchive = useCallback(async () => {
    const activeWorkspace = projectStore.getState().workspace;
    if (!activeWorkspace) {
      return;
    }

    try {
      const bundle = await projectStore.getState().exportProjectArchive();
      if (bundle) {
        downloadBlob(
          bundle,
          `${safeDownloadName(activeWorkspace.display_name)}.bline-project.json`
        );
      }
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      setOpenTopMenu(null);
    }
  }, []);

  const handleExportProjectFolder = useCallback(async () => {
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
      setOpenTopMenu(null);
    }
  }, []);

  const handleExportPath = useCallback(async () => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    try {
      const blob = await projectStore.getState().exportPath(activePath.path_id);
      if (blob) {
        downloadBlob(blob, activePath.file_name);
      }
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      setOpenTopMenu(null);
    }
  }, []);

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

  const queueFileImport = useCallback((mode: ImportMode) => {
    setPendingImportMode(mode);
    setOpenTopMenu(null);
    fileInputRef.current?.click();
  }, []);

  const queueFolderImport = useCallback(() => {
    setOpenTopMenu(null);
    folderInputRef.current?.click();
  }, []);

  const handleSavePathAs = useCallback(async () => {
    const activeWorkspace = projectStore.getState().workspace;
    const activePath = activePathDocument(activeWorkspace);
    if (!activePath) {
      return;
    }

    const rawName = window.prompt(
      "Save Path As",
      activePath.display_name
    );
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

  const handleDeletePaths = useCallback(
    async (ids: string[]) => {
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
    },
    []
  );

  const handleImportProject = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";

      if (!file) {
        return;
      }

      if (!projectStore.getState().io) {
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
      }
    },
    [pendingImportMode, refreshWorkspaceSummaries]
  );

  const handleImportProjectFolder = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";

      if (files.length === 0 || !projectStore.getState().io) {
        return;
      }

      try {
        await projectStore.getState().importProjectFolder(files);
        await refreshWorkspaceSummaries();
        selectionStore.getState().clearSelection();
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [refreshWorkspaceSummaries]
  );

  const handleSaveConfig = useCallback((nextConfig: NonNullable<typeof project>["config"]) => {
    const activeProject = projectStore.getState().project;
    if (!activeProject) {
      return;
    }

    projectStore
      .getState()
      .applyCommand(
        createUpdateProjectConfigCommand(activeProject.config, nextConfig)
      );
    setShowConfigDialog(false);
  }, []);

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
  const supportsProjectFolders = Boolean(ioCapabilities?.supportsProjectFolders);
  const activePath = activePathDocument(workspace);
  const pathDocuments = workspace?.paths ?? [];
  const projectSummaries = ensureCurrentWorkspaceSummary(
    workspaceSummaries,
    workspace,
    currentVersion,
    lastSavedAt
  );
  const toolbarActions = ioCapabilities?.primaryToolbarActions ?? [];
  const projectLabel = workspace?.display_name ?? "No project";
  const pathLabel = activePath?.display_name ?? "No path";
  const currentProjectSummary = `Project: ${projectLabel}`;
  const currentPathSummary = `Current Path: ${pathLabel}`;
  const storageLabel = formatStorageLabel(workspace, ioCapabilities);
  const saveStatus = formatSaveStatus({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    status
  });
  const saveStatusTone = getSaveStatusTone({
    autosaveStatus,
    dirty,
    error,
    initializing,
    lastSavedAt,
    status
  });

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="app-toolbar" ref={toolbarRef}>
        <nav className="app-tabs" aria-label="Top menu">
          <TopMenuButton
            id="project"
            label="Project"
            openTopMenu={openTopMenu}
            setOpenTopMenu={setOpenTopMenu}
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
                <MenuSubmenu label="Workspace" testId="top-menu-project-workspace">
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
            <MenuSubmenu label="Import / Export" testId="top-menu-project-transfer">
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
              label={supportsProjectFolders ? "Recent Project Folders" : "Recent Projects"}
              testId="top-menu-project-recent"
            >
              <WorkspaceMenuList
                emptyLabel={
                  supportsProjectFolders ? "(No recent folders)" : "(No saved projects)"
                }
                workspaces={projectSummaries}
                onOpen={supportsProjectFolders ? handleSwitchWorkspace : handleOpenWorkspaceFromMenu}
              />
            </MenuSubmenu>
          </TopMenuButton>
          <TopMenuButton
            id="path"
            label="Path"
            active
            openTopMenu={openTopMenu}
            setOpenTopMenu={setOpenTopMenu}
          >
            <MenuLabel>Current: {pathLabel}</MenuLabel>
            <div className="top-menu__separator" role="separator" />
            <MenuSubmenu label="Load Path" testId="top-menu-path-load">
              <PathMenuList
                emptyLabel="(No paths)"
                paths={pathDocuments.filter(
                  (path) => path.path_id !== workspace?.active_path_id
                )}
                onOpen={async (pathId) => {
                  projectStore.getState().setActivePath(pathId);
                  selectionStore.getState().clearSelection();
                  setOpenTopMenu(null);
                }}
              />
            </MenuSubmenu>
            <div className="top-menu__separator" role="separator" />
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
            <div className="top-menu__separator" role="separator" />
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
          </TopMenuButton>
          <TopMenuButton
            id="edit"
            label="Edit"
            openTopMenu={openTopMenu}
            setOpenTopMenu={setOpenTopMenu}
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
            <button type="button" onClick={() => projectStore.getState().undo()} disabled={!canUndo}>
              Undo
            </button>
            <button type="button" onClick={() => projectStore.getState().redo()} disabled={!canRedo}>
              Redo
            </button>
            {toolbarActions.includes("open-workspace") ? (
              <button
                type="button"
                aria-expanded={showOpenPanel}
                onClick={handleToggleOpenPanel}
                disabled={!projectIo || workspaceSummaries.length === 0}
              >
                Open
              </button>
            ) : null}
            {toolbarActions.includes("open-folder") ? (
              <button type="button" onClick={() => void handleOpenWorkspace()} disabled={!projectIo}>
                Open Folder
              </button>
            ) : null}
            {toolbarActions.includes("new-path") ? (
              <button type="button" onClick={() => void handleCreateNewPath()} disabled={!workspace}>
                New Path
              </button>
            ) : null}
            {toolbarActions.includes("export-project") ? (
              <button
                type="button"
                onClick={() => void handleExportProjectFolder()}
                disabled={!workspace || !projectIo}
              >
                Export
              </button>
            ) : null}
            {toolbarActions.includes("import-project") ? (
              <button
                type="button"
                onClick={queueFolderImport}
                disabled={!projectIo}
              >
                Import
              </button>
            ) : null}
          </div>
          <div className="toolbar-actions__overflow">
            <TopMenuButton
              id="actions"
              label="Actions"
              align="end"
              openTopMenu={openTopMenu}
              setOpenTopMenu={setOpenTopMenu}
              onBeforeOpen={refreshWorkspaceSummaries}
            >
              <MenuAction
                label="Undo"
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
              <div className="top-menu__separator" role="separator" />
              {supportsProjectFolders ? (
                <MenuAction
                  label="New Path"
                  disabled={!projectIo}
                  onAction={() => {
                    void handleCreateNewPath();
                    setOpenTopMenu(null);
                  }}
                />
              ) : null}
              <MenuAction
                label={supportsProjectFolders ? "Open Folder..." : "Open..."}
                disabled={!projectIo}
                onAction={() => {
                  if (supportsProjectFolders) {
                    void handleOpenWorkspace();
                  } else {
                    handleOpenProjectPanel();
                  }
                }}
              />
              <MenuAction
                label={
                  supportsProjectFolders
                    ? "Import Project Archive..."
                    : "Import Autos Folder..."
                }
                disabled={!projectIo}
                onAction={() => {
                  if (supportsProjectFolders) {
                    queueFileImport("archive");
                  } else {
                    queueFolderImport();
                  }
                }}
              />
              <MenuAction
                label={
                  supportsProjectFolders
                    ? "Export Project Archive..."
                    : "Export Autos Folder..."
                }
                disabled={!workspace || !projectIo}
                onAction={() => {
                  setOpenTopMenu(null);
                  if (supportsProjectFolders) {
                    void handleExportProjectArchive();
                  } else {
                    void handleExportProjectFolder();
                  }
                }}
              />
              <div className="top-menu__separator" role="separator" />
              <MenuAction
                label="Save"
                disabled={!workspace || !projectIo || status === "saving"}
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
            disabled={!workspace || !projectIo || status === "saving"}
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
            <div className="project-open-panel" data-testid="open-project-panel">
              <strong>Saved Workspaces</strong>
              <div className="project-open-panel__list" role="list">
                {projectSummaries.map((summary) => (
                  <button
                    key={summary.id}
                    type="button"
                    role="listitem"
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
          <PathStage onInteractionStateChange={handleCanvasInteractionStateChange} />
        </section>

        <Sidebar project={project} selectedElementIndex={selectedElementIndex} />
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
      {showDeletePathDialog ? (
        <DeletePathsDialog
          activePathId={workspace?.active_path_id ?? null}
          paths={pathDocuments}
          onCancel={() => setShowDeletePathDialog(false)}
          onDelete={(ids) => void handleDeletePaths(ids)}
        />
      ) : null}
    </main>
  );
}

type TopMenuId = "project" | "path" | "edit" | "actions";
type ImportMode = "archive" | "path" | "config";

function TopMenuButton({
  id,
  label,
  active = false,
  openTopMenu,
  setOpenTopMenu,
  onBeforeOpen,
  align = "start",
  children
}: {
  id: TopMenuId;
  label: string;
  active?: boolean;
  openTopMenu: TopMenuId | null;
  setOpenTopMenu(menu: TopMenuId | null): void;
  onBeforeOpen?: () => Promise<unknown> | void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const open = openTopMenu === id;
  const className = [
    "top-menu",
    `top-menu--${id}`,
    align === "end" ? "top-menu--align-end" : null
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
        onClick={() => {
          if (!open) {
            void onBeforeOpen?.();
          }
          setOpenTopMenu(open ? null : id);
        }}
      >
        {label}
      </button>
      {open ? (
        <div className="top-menu__panel" role="menu" data-testid={`top-menu-${id}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuSubmenu({
  label,
  testId,
  children
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

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
    const width = Math.min(266, Math.max(160, window.innerWidth - viewportMargin * 2));
    const left = Math.min(rect.right + flyoutGap, window.innerWidth - width - viewportMargin);
    const top = Math.max(viewportMargin, Math.min(rect.top - 4, window.innerHeight - 128));
    const maxHeight = Math.max(120, window.innerHeight - top - viewportMargin);

    setPlacement({
      left,
      maxHeight,
      top,
      width
    });
  }, []);

  const openSubmenu = useCallback(() => {
    clearCloseTimer();
    updatePlacement();
    setOpen(true);
  }, [clearCloseTimer, updatePlacement]);

  const closeSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  }, [clearCloseTimer]);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;

    if (
      nextTarget &&
      (submenuRef.current?.contains(nextTarget) || panelRef.current?.contains(nextTarget))
    ) {
      return;
    }

    closeSubmenu();
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleReposition = () => updatePlacement();

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <div
      ref={submenuRef}
      className={`top-menu__submenu${open ? " is-open" : ""}`}
      role="none"
      onBlur={handleBlur}
      onFocus={openSubmenu}
      onMouseEnter={openSubmenu}
      onMouseLeave={closeSubmenu}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="top-menu__item"
        onClick={openSubmenu}
      >
        <span>{label}</span>
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
              onMouseEnter={openSubmenu}
              onMouseLeave={closeSubmenu}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function MenuAction({
  label,
  shortcut,
  disabled = false,
  onAction
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
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="top-menu__label">{children}</div>;
}

function PathMenuList({
  paths,
  emptyLabel,
  onOpen
}: {
  paths: ProjectPathDocument[];
  emptyLabel: string;
  onOpen(id: string): Promise<void>;
}) {
  if (paths.length === 0) {
    return <div className="top-menu__empty">{emptyLabel}</div>;
  }

  return (
    <div className="top-menu__list">
      {paths.map((path) => (
        <button
          key={path.path_id}
          type="button"
          role="menuitem"
          className="top-menu__item top-menu__project"
          onClick={() => void onOpen(path.path_id)}
        >
          <span>{path.display_name}</span>
          <small>{path.file_name}</small>
        </button>
      ))}
    </div>
  );
}

function WorkspaceMenuList({
  workspaces,
  emptyLabel,
  onOpen
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
          <span>{summary.displayName}</span>
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
  onDelete
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
    selectedIds.has(workspaceSummary.id)
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
          <button type="button" aria-label="Close delete projects" onClick={onCancel}>
            x
          </button>
        </header>
        {confirming ? (
          <section
            className="delete-projects-dialog__confirm"
            aria-label="Confirm project deletion"
          >
            <strong>
              Delete {selectedCount} selected project{selectedCount === 1 ? "" : "s"}?
            </strong>
            <p>
              This removes the selected project{selectedCount === 1 ? "" : "s"} from
              browser storage. Exported autos folders and downloaded archives are not
              deleted.
            </p>
            <ul>
              {selectedProjects.map((workspaceSummary) => (
                <li key={workspaceSummary.id}>{workspaceSummary.displayName}</li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="delete-projects-dialog__list" aria-label="Saved projects">
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
                  setSelectedIds(new Set(workspaces.map((summary) => summary.id)))
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
  onDelete
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
          <button type="button" aria-label="Close delete paths" onClick={onCancel}>
            x
          </button>
        </header>
        <section className="delete-paths-dialog__list" aria-label="Saved paths">
          {paths.length === 0 ? (
            <div className="delete-paths-dialog__empty">No paths found to delete.</div>
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
                  {path.path_id === activePathId ? <small>Current</small> : null}
                </label>
              );
            })
          )}
        </section>
        <footer className="config-dialog__footer">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(paths.map((path) => path.path_id)))}
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
  status
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
  status
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
  const base = safeDownloadName(value.replace(/\.json$/i, "")) || "untitled-path";
  return `${base}.json`;
}

function activePathDocument(
  workspace: ProjectWorkspaceDocument | null
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
  lastSavedAt: string | null
): ProjectWorkspaceSummary[] {
  if (!workspace || summaries.some((summary) => summary.id === workspace.project_id)) {
    return summaries;
  }

  return [
    {
      id: workspace.project_id,
      displayName: workspace.display_name,
      updatedAt: lastSavedAt ?? new Date().toISOString(),
      version: version ?? ""
    },
    ...summaries
  ];
}

function formatStorageLabel(
  workspace: ProjectWorkspaceDocument | null,
  capabilities: ProjectIoCapabilities | undefined
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
    minute: "2-digit"
  });
}

async function writeProjectFolder(projectFolder: ProjectFolderExport): Promise<void> {
  const directoryPicker = (window as BrowserFolderWindow).showDirectoryPicker;

  if (directoryPicker) {
    const selectedDirectory = await directoryPicker.call(window, {
      mode: "readwrite"
    });
    const autosDirectory =
      selectedDirectory.name.toLowerCase() === projectFolder.folderName.toLowerCase()
        ? selectedDirectory
        : await selectedDirectory.getDirectoryHandle(projectFolder.folderName, {
            create: true
          });

    for (const file of projectFolder.files) {
      await writeFolderFile(autosDirectory, file.relativePath, file.blob);
    }
    return;
  }

  for (const file of projectFolder.files) {
    downloadBlob(
      file.blob,
      `${projectFolder.folderName}-${file.relativePath.replace(/\//g, "-")}`
    );
  }
}

async function writeFolderFile(
  directory: BrowserDirectoryHandle,
  relativePath: string,
  blob: Blob
): Promise<void> {
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.at(-1);

  if (!fileName) {
    return;
  }

  let currentDirectory = directory;
  for (const segment of segments.slice(0, -1)) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment, {
      create: true
    });
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "bline-project";
}

interface BrowserFolderWindow extends Window {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<BrowserDirectoryHandle>;
}

interface BrowserDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<BrowserDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<BrowserFileHandle>;
}

interface BrowserFileHandle {
  createWritable(): Promise<BrowserWritableFileStream>;
}

interface BrowserWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
