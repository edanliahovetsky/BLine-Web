import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { ReactNode } from "react";
import { PathStage } from "../../canvas/PathStage";
import { createProjectDocument, type ProjectDocument } from "../../core/io/projectSchema";
import { createPathModel } from "../../core/model/path";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import {
  detectEnvironmentCapabilities,
  type EnvironmentCapabilities
} from "../../env/capabilities";
import {
  createProjectAutosaveCoordinator,
  type AutosaveCoordinator,
  type AutosaveStatus
} from "../../state/autosave";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import { createStorageAdapter, type ProjectSummary } from "../../storage";
import { Sidebar } from "../sidebar/Sidebar";
import "./AppShell.css";
import { createUpdateProjectConfigCommand } from "./configCommands";
import { createInitialCanvasProject, createNewCanvasProject } from "./initialProject";
import { ProjectConfigDialog } from "./ProjectConfigDialog";

export function AppShell() {
  const project = useStoreSelector(projectStore, (state) => state.project);
  const storage = useStoreSelector(projectStore, (state) => state.storage);
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const status = useStoreSelector(projectStore, (state) => state.status);
  const error = useStoreSelector(projectStore, (state) => state.error);
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
  const [capabilities] = useState<EnvironmentCapabilities>(() =>
    detectEnvironmentCapabilities()
  );
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [showOpenPanel, setShowOpenPanel] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showDeletePathDialog, setShowDeletePathDialog] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const autosaveRef = useRef<AutosaveCoordinator | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

  const refreshProjectSummaries = useCallback(async (adapter = projectStore.getState().storage) => {
    if (!adapter) {
      setProjectSummaries([]);
      return [];
    }

    const summaries = await adapter.listProjects();
    setProjectSummaries(summaries);
    return summaries;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const adapter = createStorageAdapter(capabilities);

    projectStore.getState().setStorageAdapter(adapter);

    async function initializeProject() {
      setInitializing(true);

      try {
        const summaries = await adapter.listProjects();
        if (cancelled) {
          return;
        }

        setProjectSummaries(summaries);

        if (projectStore.getState().project) {
          return;
        }

        if (summaries.length > 0) {
          await projectStore.getState().loadProject(summaries[0].id);
        } else {
          projectStore.getState().createProject(createInitialCanvasProject());
        }
      } catch (caughtError) {
        if (!cancelled) {
          projectStore.getState().createProject(createInitialCanvasProject());
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
  }, [capabilities]);

  useEffect(() => {
    if (!storage) {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
      return;
    }

    autosaveRef.current?.cancel();
    autosaveRef.current = createProjectAutosaveCoordinator(projectStore, storage, {
      delayMs: 300,
      onStatusChange: setAutosaveStatus
    });

    return () => {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
    };
  }, [storage]);

  useEffect(() => {
    if (project && dirty) {
      autosaveRef.current?.schedule();
    }
  }, [dirty, project]);

  useEffect(() => {
    if (lastSavedAt && storage) {
      const refreshTimer = window.setTimeout(() => {
        void refreshProjectSummaries(storage);
      }, 0);

      return () => window.clearTimeout(refreshTimer);
    }

    return undefined;
  }, [lastSavedAt, refreshProjectSummaries, storage]);

  useEffect(() => {
    if (!openTopMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
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

  const handleNewProject = useCallback(() => {
    autosaveRef.current?.cancel();
    projectStore.getState().createProject(createNewCanvasProject());
    selectionStore.getState().clearSelection();
    setShowOpenPanel(false);
  }, []);

  const handleCreateNewPath = useCallback(async () => {
    const rawName = window.prompt("Enter path name:", "new_path");
    const displayName = rawName?.trim() || "Untitled Path";
    const nextProject = createBlankPathProject({
      displayName,
      config: projectStore.getState().project?.config
    });

    autosaveRef.current?.cancel();
    projectStore.getState().createProject(nextProject);
    selectionStore.getState().clearSelection();
    setShowOpenPanel(false);
    setOpenTopMenu(null);

    if (rawName !== null && projectStore.getState().storage) {
      try {
        await projectStore.getState().saveProject();
        await refreshProjectSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    }
  }, [refreshProjectSummaries]);

  const handleSaveProject = useCallback(async () => {
    autosaveRef.current?.cancel();

    try {
      await projectStore.getState().saveProject();
      await refreshProjectSummaries();
    } catch {
      // The project store already records the error for the status bar.
    }
  }, [refreshProjectSummaries]);

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
        void refreshProjectSummaries();
      }
      return !current;
    });
  }, [refreshProjectSummaries]);

  const handleOpenProjectPanel = useCallback(() => {
    void refreshProjectSummaries();
    setShowOpenPanel(true);
    setOpenTopMenu(null);
  }, [refreshProjectSummaries]);

  const handleOpenProject = useCallback(
    async (id: string) => {
      autosaveRef.current?.cancel();

      try {
        await projectStore.getState().loadProject(id);
        selectionStore.getState().clearSelection();
        setShowOpenPanel(false);
        await refreshProjectSummaries();
      } catch {
        // The project store already records the error for the status bar.
      }
    },
    [refreshProjectSummaries]
  );

  const handleOpenProjectFromMenu = useCallback(
    async (id: string) => {
      setOpenTopMenu(null);
      await handleOpenProject(id);
    },
    [handleOpenProject]
  );

  const handleExportProject = useCallback(async () => {
    const activeProject = projectStore.getState().project;
    const adapter = projectStore.getState().storage;
    if (!activeProject || !adapter) {
      return;
    }

    try {
      if (projectStore.getState().dirty) {
        autosaveRef.current?.cancel();
        await projectStore.getState().saveProject();
        await refreshProjectSummaries(adapter);
      }

      const bundle = await adapter.exportBundle([activeProject.project_id]);
      downloadBlob(
        bundle,
        `${safeDownloadName(activeProject.display_name)}.bline-project.json`
      );
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
  }, [refreshProjectSummaries]);

  const handleSavePathAs = useCallback(async () => {
    const activeProject = projectStore.getState().project;
    const adapter = projectStore.getState().storage;
    if (!activeProject || !adapter) {
      return;
    }

    const rawName = window.prompt(
      "Save Path As",
      pathDisplayName(activeProject)
    );
    const displayName = rawName?.trim();
    if (!displayName) {
      setOpenTopMenu(null);
      return;
    }

    const nextProject = createProjectDocument({
      project_id: createPathProjectId(),
      display_name: displayName,
      path_file_name: ensureJsonFileName(displayName),
      path: structuredClone(activeProject.path),
      config: structuredClone(activeProject.config)
    });

    try {
      autosaveRef.current?.cancel();
      await adapter.writeProject(nextProject);
      await projectStore.getState().loadProject(nextProject.project_id);
      selectionStore.getState().clearSelection();
      await refreshProjectSummaries(adapter);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    } finally {
      setOpenTopMenu(null);
    }
  }, [refreshProjectSummaries]);

  const handleRenamePath = useCallback(() => {
    const activeProject = projectStore.getState().project;
    if (!activeProject) {
      return;
    }

    const rawName = window.prompt("Rename Path", pathDisplayName(activeProject));
    const displayName = rawName?.trim();
    if (!displayName) {
      setOpenTopMenu(null);
      return;
    }

    projectStore.getState().applyCommand({
      description: "Rename path",
      apply: (projectDocument) => ({
        ...projectDocument,
        display_name: displayName,
        path_file_name: ensureJsonFileName(displayName)
      }),
      revert: (projectDocument) => ({
        ...projectDocument,
        display_name: activeProject.display_name,
        path_file_name: activeProject.path_file_name
      })
    });
    setOpenTopMenu(null);
  }, []);

  const handleShowDeletePaths = useCallback(() => {
    void refreshProjectSummaries();
    setShowDeletePathDialog(true);
    setOpenTopMenu(null);
  }, [refreshProjectSummaries]);

  const handleDeletePaths = useCallback(
    async (ids: string[]) => {
      const adapter = projectStore.getState().storage;
      if (!adapter || ids.length === 0) {
        setShowDeletePathDialog(false);
        return;
      }

      const activeId = projectStore.getState().project?.project_id ?? null;
      const selectedSummaries = projectSummaries.filter((summary) =>
        ids.includes(summary.id)
      );

      try {
        autosaveRef.current?.cancel();
        await Promise.all(
          selectedSummaries.map((summary) =>
            adapter.deleteProject(summary.id, summary.version)
          )
        );
        const summaries = await refreshProjectSummaries(adapter);
        setShowDeletePathDialog(false);

        if (activeId && ids.includes(activeId)) {
          selectionStore.getState().clearSelection();
          const nextProject = summaries.find((summary) => !ids.includes(summary.id));
          if (nextProject) {
            await projectStore.getState().loadProject(nextProject.id);
          } else {
            projectStore.getState().createProject(createInitialCanvasProject());
          }
        }
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [projectSummaries, refreshProjectSummaries]
  );

  const handleImportProject = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";

      if (!file) {
        return;
      }

      const adapter = projectStore.getState().storage;
      if (!adapter) {
        return;
      }

      try {
        const result = await adapter.importBundle(file);
        const summaries = await refreshProjectSummaries(adapter);
        const imported = result.imported[0] ?? summaries[0];

        if (imported) {
          await projectStore.getState().loadProject(imported.id);
          selectionStore.getState().clearSelection();
        }
      } catch (caughtError) {
        projectStore.getState().markSaveError(caughtError);
      }
    },
    [refreshProjectSummaries]
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
  const storageLabel = capabilities.shell === "tauri" ? "Tauri local" : "Browser local";
  const saveStatus = formatSaveStatus({
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
            onBeforeOpen={refreshProjectSummaries}
          >
            <MenuAction label="Open Project..." disabled={!storage} onAction={handleOpenProjectPanel} />
            <MenuAction
              label="Import Project..."
              disabled={!storage}
              onAction={() => {
                setOpenTopMenu(null);
                fileInputRef.current?.click();
              }}
            />
            <MenuAction
              label="Export Project..."
              disabled={!project || !storage}
              onAction={() => {
                setOpenTopMenu(null);
                void handleExportProject();
              }}
            />
            <div className="top-menu__separator" role="separator" />
            <MenuSubmenu label="Recent Projects" testId="top-menu-project-recent">
              <ProjectMenuList
                emptyLabel="(No recent projects)"
                projects={projectSummaries}
                onOpen={handleOpenProjectFromMenu}
              />
            </MenuSubmenu>
          </TopMenuButton>
          <TopMenuButton
            id="path"
            label="Path"
            active
            openTopMenu={openTopMenu}
            setOpenTopMenu={setOpenTopMenu}
            onBeforeOpen={refreshProjectSummaries}
          >
            <MenuLabel>Current: {project?.display_name ?? "(No Path)"}</MenuLabel>
            <div className="top-menu__separator" role="separator" />
            <MenuSubmenu label="Load Path" testId="top-menu-path-load">
              <ProjectMenuList
                emptyLabel="(No paths)"
                projects={projectSummaries.filter(
                  (summary) => summary.id !== project?.project_id
                )}
                onOpen={handleOpenProjectFromMenu}
              />
            </MenuSubmenu>
            <div className="top-menu__separator" role="separator" />
            <MenuAction
              label="Create New Path"
              disabled={!storage}
              onAction={() => void handleCreateNewPath()}
            />
            <MenuAction
              label="Save Path As..."
              disabled={!project || !storage}
              onAction={() => void handleSavePathAs()}
            />
            <MenuAction
              label="Rename Path..."
              disabled={!project}
              onAction={handleRenamePath}
            />
            <MenuAction
              label="Delete Paths..."
              disabled={!storage || projectSummaries.length === 0}
              onAction={handleShowDeletePaths}
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
            <button type="button" onClick={handleNewProject} disabled={!storage}>
              New
            </button>
            <button
              type="button"
              aria-expanded={showOpenPanel}
              onClick={handleToggleOpenPanel}
              disabled={!storage || projectSummaries.length === 0}
            >
              Open
            </button>
            <button type="button" onClick={handleExportProject} disabled={!project || !storage}>
              Export
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!storage}
            >
              Import
            </button>
          </div>
          <div className="toolbar-actions__overflow">
            <TopMenuButton
              id="actions"
              label="Actions"
              align="end"
              openTopMenu={openTopMenu}
              setOpenTopMenu={setOpenTopMenu}
              onBeforeOpen={refreshProjectSummaries}
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
              <MenuAction
                label="New"
                disabled={!storage}
                onAction={() => {
                  handleNewProject();
                  setOpenTopMenu(null);
                }}
              />
              <MenuAction
                label="Open..."
                disabled={!storage}
                onAction={handleOpenProjectPanel}
              />
              <MenuAction
                label="Import..."
                disabled={!storage}
                onAction={() => {
                  setOpenTopMenu(null);
                  fileInputRef.current?.click();
                }}
              />
              <MenuAction
                label="Export..."
                disabled={!project || !storage}
                onAction={() => {
                  setOpenTopMenu(null);
                  void handleExportProject();
                }}
              />
              <div className="top-menu__separator" role="separator" />
              <MenuAction
                label="Save"
                disabled={!project || !storage || status === "saving"}
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
            disabled={!project || !storage || status === "saving"}
          >
            Save
          </button>
          <input
            ref={fileInputRef}
            className="file-import-input"
            aria-label="Import project bundle"
            type="file"
            accept="application/json,.json,.bline-project"
            onChange={handleImportProject}
          />
          {showOpenPanel ? (
            <div className="project-open-panel" data-testid="open-project-panel">
              <strong>Saved Projects</strong>
              <div className="project-open-panel__list" role="list">
                {projectSummaries.map((summary) => (
                  <button
                    key={summary.id}
                    type="button"
                    role="listitem"
                    onClick={() => void handleOpenProject(summary.id)}
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
        <aside className="tool-rail" aria-label="Canvas tools">
          <button type="button" className="is-active" aria-label="Select tool">
            <span aria-hidden="true">S</span>
            <span>Select</span>
          </button>
          <button type="button" aria-label="Add waypoint tool" disabled>
            <span aria-hidden="true">W</span>
            <span>Waypoint</span>
          </button>
          <button type="button" aria-label="Add event tool" disabled>
            <span aria-hidden="true">E</span>
            <span>Event</span>
          </button>
          <button type="button" aria-label="Rotate tool" disabled>
            <span aria-hidden="true">R</span>
            <span>Rotate</span>
          </button>
        </aside>

        <section className="canvas-region" aria-label="Editor canvas">
          <PathStage />
        </section>

        <Sidebar project={project} selectedElementIndex={selectedElementIndex} />
      </div>

      <footer className="status-bar">
        <span data-testid="current-path-status">
          Current Path: {project?.display_name ?? "No project"}
        </span>
        <span data-testid="selected-element-status">{selectedSummary}</span>
        <span data-testid="storage-status">{storageLabel}</span>
        <span data-testid="save-status">{saveStatus}</span>
      </footer>

      {project && showConfigDialog ? (
        <ProjectConfigDialog
          config={project.config}
          onCancel={() => setShowConfigDialog(false)}
          onSave={handleSaveConfig}
        />
      ) : null}
      {showDeletePathDialog ? (
        <DeletePathsDialog
          activeProjectId={project?.project_id ?? null}
          projects={projectSummaries}
          onCancel={() => setShowDeletePathDialog(false)}
          onDelete={(ids) => void handleDeletePaths(ids)}
        />
      ) : null}
    </main>
  );
}

type TopMenuId = "project" | "path" | "edit" | "actions";

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
  onBeforeOpen?: () => Promise<ProjectSummary[]>;
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
  return (
    <div className="top-menu__submenu" role="none">
      <button type="button" role="menuitem" aria-haspopup="menu" className="top-menu__item">
        <span>{label}</span>
        <span className="top-menu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <div className="top-menu__submenu-panel" role="menu" data-testid={testId}>
        {children}
      </div>
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

function ProjectMenuList({
  projects,
  emptyLabel,
  onOpen
}: {
  projects: ProjectSummary[];
  emptyLabel: string;
  onOpen(id: string): Promise<void>;
}) {
  if (projects.length === 0) {
    return <div className="top-menu__empty">{emptyLabel}</div>;
  }

  return (
    <div className="top-menu__list">
      {projects.map((summary) => (
        <button
          key={summary.id}
          type="button"
          role="menuitem"
          className="top-menu__item top-menu__project"
          onClick={() => void onOpen(summary.id)}
        >
          <span>{summary.displayName}</span>
          <small>{formatTimestamp(summary.updatedAt)}</small>
        </button>
      ))}
    </div>
  );
}

function DeletePathsDialog({
  activeProjectId,
  projects,
  onCancel,
  onDelete
}: {
  activeProjectId: string | null;
  projects: ProjectSummary[];
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
          {projects.length === 0 ? (
            <div className="delete-paths-dialog__empty">No paths found to delete.</div>
          ) : (
            projects.map((summary) => {
              const checked = selectedIds.has(summary.id);
              return (
                <label
                  key={summary.id}
                  className={
                    summary.id === activeProjectId
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
                          next.add(summary.id);
                        } else {
                          next.delete(summary.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span>{summary.displayName}</span>
                  {summary.id === activeProjectId ? <small>Current</small> : null}
                </label>
              );
            })
          )}
        </section>
        <footer className="config-dialog__footer">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(projects.map((summary) => summary.id)))}
            disabled={projects.length === 0}
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

function createBlankPathProject({
  displayName,
  config
}: {
  displayName: string;
  config?: ProjectDocument["config"];
}): ProjectDocument {
  return createProjectDocument({
    project_id: createPathProjectId(),
    display_name: displayName,
    path_file_name: ensureJsonFileName(displayName),
    path: createPathModel(),
    config
  });
}

function createPathProjectId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);
  return `path-${stamp}-${random}`;
}

function pathDisplayName(project: ProjectDocument): string {
  return project.path_file_name?.replace(/\.json$/i, "") || project.display_name;
}

function ensureJsonFileName(value: string): string {
  const base = safeDownloadName(value) || "untitled-path";
  return base.endsWith(".json") ? base : `${base}.json`;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
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
