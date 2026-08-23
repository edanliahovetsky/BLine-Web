import { useEffect } from "react";
import type { ChangeEvent, RefCallback, RefObject } from "react";
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
import type {
  Project,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import type { ProjectWorkspaceSummary } from "../../platform/projectIo";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import { useStoreSelector } from "../../state/react";
import { IconButton } from "../controls";
import {
  optimizerBeamClass,
  optimizerBeamLabel,
  optimizerBeamTitle,
} from "../optimizerBeam";
import { tours } from "../tours/tours";
import {
  executeCommand,
  formatShortcut,
  type EditorCommand,
} from "./editorCommands";
import type { PathDiagnostic } from "./pathDiagnostics";
import { parseProjectTimestamp } from "./projectTimestamp";
import {
  MenuAction,
  MenuLabel,
  MenuSubmenu,
  ToolbarPathNavigator,
  TopMenuButton,
  type TopMenuId,
} from "./ToolbarMenus";

interface ToolbarModel {
  project: Project | null;
  activeGroup: ProjectPathGroup | null;
  activePath: ProjectPath | null;
  projectSummaries: ProjectWorkspaceSummary[];
  supportsProjectFolders: boolean;
  projectIoAvailable: boolean;
  toolbarBusy: boolean;
  undoLabel: string;
  redoLabel: string;
  pathDiagnostics: readonly PathDiagnostic[];
  saveError: string | null;
  toursSupported: boolean;
}

interface ToolbarCommands {
  navigator: EditorCommand;
  newPath: EditorCommand;
  save: EditorCommand;
  undo: EditorCommand;
  redo: EditorCommand;
  settings: EditorCommand;
  inspector: EditorCommand;
  shortcutHelp: EditorCommand;
}

interface ToolbarMenuState {
  open: TopMenuId | null;
  pathTriggerRef: RefObject<HTMLButtonElement | null>;
  setOpen(menu: TopMenuId | null): void;
  refreshWorkspaces(): void | Promise<unknown>;
}

interface ToolbarPanelState {
  showOpenPanel: boolean;
  showPathHealth: boolean;
  showHelpHub: boolean;
  inspectorOpen: boolean;
  openCommandPalette(): void;
  closeOpenPanel(): void;
  togglePathHealth(): void;
  closePathHealth(): void;
  selectDiagnostic(diagnostic: PathDiagnostic): void;
  toggleHelpHub(): void;
  closeHelpHub(): void;
  openTourPicker(): void;
}

interface ToolbarImportControls {
  setFileInput: RefCallback<HTMLInputElement>;
  setFolderInput: RefCallback<HTMLInputElement>;
  onImportFile(event: ChangeEvent<HTMLInputElement>): void;
  onImportFolder(event: ChangeEvent<HTMLInputElement>): void;
}

interface ToolbarActions {
  openWorkspace(): void | Promise<void>;
  createWorkspace(): void | Promise<void>;
  createProject(): void | Promise<void>;
  openProjectPanel(): void;
  showDeleteProjects(): void;
  importFolder(): void;
  importFile(kind: "archive" | "config" | "path"): void;
  exportProjectFolder(): void | Promise<void>;
  exportProjectArchive(): void | Promise<void>;
  exportConfig(): void | Promise<void>;
  exportPath(): void | Promise<void>;
  openWorkspaceFromMenu(id: string): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  showLinkedTargets(): void;
  savePathAs(): void | Promise<void>;
  renamePath(): void;
  showDeletePaths(): void;
  selectPath(pathId: string): void;
  openWorkspaceById(id: string): void | Promise<void>;
  openSample(): void | Promise<void>;
}

export function AppToolbar({
  toolbarRef,
  model,
  commands,
  menu,
  panels,
  imports: { setFileInput, setFolderInput, onImportFile, onImportFolder },
  actions,
}: {
  toolbarRef: RefObject<HTMLElement | null>;
  model: ToolbarModel;
  commands: ToolbarCommands;
  menu: ToolbarMenuState;
  panels: ToolbarPanelState;
  imports: ToolbarImportControls;
  actions: ToolbarActions;
}) {
  const {
    project,
    activeGroup,
    activePath,
    projectSummaries,
    supportsProjectFolders,
    projectIoAvailable,
    toolbarBusy,
    undoLabel,
    redoLabel,
    pathDiagnostics,
    saveError,
    toursSupported,
  } = model;
  const pathLabel = activePath?.display_name ?? "No path";

  return (
    <header className="app-toolbar" ref={toolbarRef}>
      <nav className="app-tabs" aria-label="Top menu">
        <IconButton
          className="app-toolbar__navigator-button"
          aria-label={commands.navigator.label}
          title={commands.navigator.label}
          disabled={commands.navigator.disabled}
          onClick={() => executeCommand(commands.navigator)}
        >
          <FolderTree aria-hidden="true" size={17} />
        </IconButton>
        <TopMenuButton
          id="project"
          label="File"
          openTopMenu={menu.open}
          setOpenTopMenu={menu.setOpen}
          onBeforeOpen={menu.refreshWorkspaces}
        >
          {supportsProjectFolders ? (
            <MenuSubmenu label="Folder" testId="top-menu-project-folder">
              <MenuAction
                label="Open Project Folder..."
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={() => void actions.openWorkspace()}
              />
              <MenuAction
                label="Create Project Folder..."
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={() => void actions.createWorkspace()}
              />
            </MenuSubmenu>
          ) : (
            <MenuSubmenu label="Workspace" testId="top-menu-project-workspace">
              <MenuAction
                label="New Project"
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={() => void actions.createProject()}
              />
              <MenuAction
                label="Open Project..."
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={actions.openProjectPanel}
              />
              <MenuAction
                label="Delete Projects..."
                disabled={!project || !projectIoAvailable || toolbarBusy}
                onAction={actions.showDeleteProjects}
              />
            </MenuSubmenu>
          )}
          <MenuSubmenu
            label="Import / Export"
            testId="top-menu-project-transfer"
          >
            {!supportsProjectFolders ? (
              <>
                <MenuAction
                  label="Import Autos Folder..."
                  disabled={!projectIoAvailable || toolbarBusy}
                  onAction={actions.importFolder}
                />
                <MenuAction
                  label="Export Autos Folder..."
                  disabled={!project || !projectIoAvailable}
                  onAction={() => void actions.exportProjectFolder()}
                />
                <div className="top-menu__separator" role="separator" />
              </>
            ) : null}
            <MenuAction
              label="Import Project Archive..."
              disabled={!projectIoAvailable || toolbarBusy}
              onAction={() => actions.importFile("archive")}
            />
            <MenuAction
              label="Export Project Archive..."
              disabled={!project || !projectIoAvailable}
              onAction={() => {
                menu.setOpen(null);
                void actions.exportProjectArchive();
              }}
            />
          </MenuSubmenu>
          <MenuSubmenu label="Config" testId="top-menu-project-config">
            <MenuAction
              label="Import Config..."
              disabled={!project || !projectIoAvailable || toolbarBusy}
              onAction={() => actions.importFile("config")}
            />
            <MenuAction
              label="Export Config..."
              disabled={!project || !projectIoAvailable}
              onAction={() => void actions.exportConfig()}
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
                  ? actions.switchWorkspace
                  : actions.openWorkspaceFromMenu
              }
            />
          </MenuSubmenu>
        </TopMenuButton>
        <TopMenuButton
          id="path"
          label="Path"
          active
          triggerRef={menu.pathTriggerRef}
          openTopMenu={menu.open}
          setOpenTopMenu={menu.setOpen}
        >
          <MenuLabel>Current: {pathLabel}</MenuLabel>
          <MenuLabel>
            Label: {activeGroup?.display_name ?? "All Paths"}
          </MenuLabel>
          <div className="top-menu__separator" role="separator" />
          <MenuAction
            label="Linked Elements..."
            disabled={!project || toolbarBusy}
            onAction={actions.showLinkedTargets}
          />
          <MenuSubmenu label="Manage Paths" testId="top-menu-path-manage">
            <MenuAction
              label="Create New Path"
              disabled={commands.newPath.disabled}
              onAction={() => executeCommand(commands.newPath)}
            />
            <MenuAction
              label="Save Path As..."
              disabled={!activePath || !projectIoAvailable || toolbarBusy}
              onAction={() => void actions.savePathAs()}
            />
            <MenuAction
              label="Rename Path..."
              disabled={!activePath || toolbarBusy}
              onAction={actions.renamePath}
            />
            <MenuAction
              label="Delete Paths..."
              disabled={!project || project.paths.length === 0 || toolbarBusy}
              onAction={actions.showDeletePaths}
            />
          </MenuSubmenu>
          <MenuSubmenu label="Import / Export" testId="top-menu-path-transfer">
            <MenuAction
              label="Import Path..."
              disabled={!project || !projectIoAvailable || toolbarBusy}
              onAction={() => actions.importFile("path")}
            />
            <MenuAction
              label="Export Path..."
              disabled={!activePath || !projectIoAvailable}
              onAction={() => void actions.exportPath()}
            />
          </MenuSubmenu>
        </TopMenuButton>
      </nav>
      <nav className="toolbar-actions" aria-label="Project actions">
        <div className="toolbar-actions__quick">
          <ToolbarPathNavigator
            project={project}
            activePath={activePath}
            onSelectPath={actions.selectPath}
          />
        </div>
        <div className="toolbar-actions__overflow">
          <TopMenuButton
            id="actions"
            label="Actions"
            align="end"
            openTopMenu={menu.open}
            setOpenTopMenu={menu.setOpen}
            onBeforeOpen={menu.refreshWorkspaces}
          >
            <MenuAction
              label={undoLabel}
              shortcut={commands.undo.shortcut}
              disabled={commands.undo.disabled}
              onAction={() => {
                panels.closeOpenPanel();
                executeCommand(commands.undo);
                menu.setOpen(null);
              }}
            />
            <MenuAction
              label={redoLabel}
              shortcut={commands.redo.shortcut}
              disabled={commands.redo.disabled}
              onAction={() => {
                panels.closeOpenPanel();
                executeCommand(commands.redo);
                menu.setOpen(null);
              }}
            />
            <div className="top-menu__separator" role="separator" />
            {supportsProjectFolders ? (
              <MenuAction
                label="New Path"
                disabled={commands.newPath.disabled}
                onAction={() => {
                  executeCommand(commands.newPath);
                  menu.setOpen(null);
                }}
              />
            ) : null}
            <MenuAction
              label={supportsProjectFolders ? "Open Folder..." : "Open..."}
              disabled={!projectIoAvailable || toolbarBusy}
              onAction={() => {
                if (supportsProjectFolders) {
                  void actions.openWorkspace();
                } else {
                  actions.openProjectPanel();
                }
              }}
            />
            <MenuSubmenu label="Import" testId="top-menu-actions-import">
              <MenuAction
                label="Import Project Folder..."
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={actions.importFolder}
              />
              <MenuAction
                label="Import Path..."
                disabled={!project || !projectIoAvailable || toolbarBusy}
                onAction={() => actions.importFile("path")}
              />
              <MenuAction
                label="Import Project Archive..."
                disabled={!projectIoAvailable || toolbarBusy}
                onAction={() => actions.importFile("archive")}
              />
            </MenuSubmenu>
            <MenuAction
              label="Export Path..."
              disabled={!activePath || !projectIoAvailable || toolbarBusy}
              onAction={() => {
                menu.setOpen(null);
                void actions.exportPath();
              }}
            />
            <div className="top-menu__separator" role="separator" />
            <MenuAction
              label="Project Navigator..."
              disabled={commands.navigator.disabled}
              onAction={() => executeCommand(commands.navigator)}
            />
            <div className="top-menu__separator" role="separator" />
            <MenuAction
              label="Save"
              disabled={commands.save.disabled}
              onAction={() => {
                menu.setOpen(null);
                executeCommand(commands.save);
              }}
            />
          </TopMenuButton>
        </div>
        <div className="toolbar-actions__buttons">
          <IconButton
            aria-label="Undo"
            aria-keyshortcuts="Meta+Z Control+Z"
            title={`${undoLabel} (${formatShortcut(commands.undo.shortcut)})`}
            disabled={commands.undo.disabled}
            onClick={() => executeCommand(commands.undo)}
          >
            <Undo2 aria-hidden="true" size={16} />
          </IconButton>
          <IconButton
            aria-label="Redo"
            aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Meta+Y Control+Y"
            title={`${redoLabel} (${formatShortcut(commands.redo.shortcut)})`}
            disabled={commands.redo.disabled}
            onClick={() => executeCommand(commands.redo)}
          >
            <Redo2 aria-hidden="true" size={16} />
          </IconButton>
          <button
            type="button"
            className="command-search-button"
            aria-label="Search commands and paths"
            onClick={panels.openCommandPalette}
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
                  ? `has-diagnostics has-diagnostics--${pathHealthSeverity(pathDiagnostics)}`
                  : ""
              }
              aria-label={`Path health: ${pathDiagnostics.length} issues`}
              aria-expanded={panels.showPathHealth}
              title={
                pathDiagnostics.length > 0
                  ? `Path health — ${pathDiagnostics.length} ${
                      pathDiagnostics.length === 1 ? "issue" : "issues"
                    } to review`
                  : "Path health — editor checks for this path"
              }
              disabled={!activePath}
              onClick={panels.togglePathHealth}
            >
              <Activity aria-hidden="true" size={16} />
              {pathDiagnostics.length > 0 ? (
                <span>{pathDiagnostics.length}</span>
              ) : null}
            </IconButton>
            {panels.showPathHealth ? (
              <PathHealthPopover
                diagnostics={pathDiagnostics}
                saveError={saveError}
                onSelect={panels.selectDiagnostic}
              />
            ) : null}
          </div>
          <div className="help-hub-control" data-tour="help-hub">
            <IconButton
              aria-label="Help and tutorials"
              aria-expanded={panels.showHelpHub}
              title="Help and tutorials"
              onClick={panels.toggleHelpHub}
            >
              <CircleHelp aria-hidden="true" size={16} />
            </IconButton>
            {panels.showHelpHub ? (
              <HelpHubPopover
                tourAvailable={Boolean(activePath) && toursSupported}
                tourUnavailableReason={
                  toursSupported
                    ? "Open a path first"
                    : "Tours need a larger window"
                }
                onClose={panels.closeHelpHub}
                onStartTour={() => {
                  panels.closeHelpHub();
                  panels.openTourPicker();
                }}
                onShortcuts={() => {
                  panels.closeHelpHub();
                  executeCommand(commands.shortcutHelp);
                }}
                onCommandPalette={() => {
                  panels.closeHelpHub();
                  panels.openCommandPalette();
                }}
                onOpenSample={() => {
                  panels.closeHelpHub();
                  void actions.openSample();
                }}
              />
            ) : null}
          </div>
          <IconButton
            aria-label="Settings"
            title="Project settings"
            disabled={commands.settings.disabled}
            onClick={() => executeCommand(commands.settings)}
          >
            <Settings aria-hidden="true" size={16} />
          </IconButton>
          <InspectorButton
            open={panels.inspectorOpen}
            command={commands.inspector}
          />
        </div>
        <input
          ref={setFileInput}
          className="file-import-input"
          aria-label="Import BLine JSON"
          type="file"
          accept="application/json,.json,.bline-project,.bline-project.json"
          onChange={onImportFile}
        />
        <input
          ref={setFolderInput}
          className="file-import-input"
          aria-label="Import autos folder"
          type="file"
          accept="application/json,.json"
          multiple
          onChange={onImportFolder}
        />
        {panels.showOpenPanel ? (
          <div className="project-open-panel" data-testid="open-project-panel">
            <strong>Saved Workspaces</strong>
            <div className="project-open-panel__list">
              {projectSummaries.map((summary) => (
                <button
                  key={summary.id}
                  type="button"
                  onClick={() => void actions.openWorkspaceById(summary.id)}
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
  );
}

function InspectorButton({
  open,
  command,
}: {
  open: boolean;
  command: EditorCommand;
}) {
  const optimizerPhase = useStoreSelector(
    autoVelocityStore,
    (state) => state.phase,
  );
  const optimizerError = useStoreSelector(
    autoVelocityStore,
    (state) => state.lastError,
  );

  return (
    <IconButton
      className={open ? "" : optimizerBeamClass(optimizerPhase, optimizerError)}
      aria-label="Toggle inspector"
      aria-expanded={open}
      aria-keyshortcuts="Meta+B Control+B"
      title={
        open
          ? `${command.label} (⌘B)`
          : optimizerBeamTitle(
              optimizerPhase,
              optimizerError,
              `${command.label} (⌘B)`,
            )
      }
      disabled={command.disabled}
      onClick={() => executeCommand(command)}
    >
      <PanelRight aria-hidden="true" size={16} />
    </IconButton>
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

function pathHealthSeverity(diagnostics: readonly PathDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "error"
    : "warning";
}

function formatTimestamp(value: string): string {
  const timestamp = parseProjectTimestamp(value);
  if (timestamp === null) {
    return "Saved project";
  }
  return timestamp.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
