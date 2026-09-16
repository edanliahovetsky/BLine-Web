import { useEffect, useRef } from "react";
import type { ChangeEvent, RefCallback, RefObject } from "react";
import { CircleHelp, FolderTree, PanelRight, Redo2, Undo2 } from "lucide-react";
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
import {
  executeCommand,
  formatShortcut,
  type EditorCommand,
} from "./editorCommands";
import type { PathDiagnostic } from "./pathDiagnostics";
import { BugReportButton } from "./BugReportButton";
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
  showHelpHub: boolean;
  navigatorOpen: boolean;
  inspectorOpen: boolean;
  openCommandPalette(): void;
  closeOpenPanel(): void;
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
  home(): void;
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
  showDeletePathGroups(): void;
  selectPath(pathId: string): void;
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
    toursSupported,
  } = model;
  const helpHubRef = useRef<HTMLDivElement>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const { showHelpHub, closeHelpHub } = panels;

  useEffect(() => {
    if (!showHelpHub) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !helpHubRef.current?.contains(event.target)
      ) {
        closeHelpHub();
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOutside, true);
  }, [showHelpHub, closeHelpHub]);

  return (
    <header className="app-toolbar" ref={toolbarRef} data-tour="editor-toolbar">
      <nav className="app-tabs" aria-label="Top menu">
        <IconButton
          className="app-toolbar__navigator-button"
          data-tour="navigator-button"
          aria-label={commands.navigator.label}
          aria-expanded={panels.navigatorOpen}
          title={commands.navigator.label}
          disabled={commands.navigator.disabled}
          onClick={() => executeCommand(commands.navigator)}
        >
          <FolderTree aria-hidden="true" size={17} />
        </IconButton>
        <TopMenuButton
          id="project"
          label="File"
          triggerRef={fileMenuButtonRef}
          dataTour="export-menu-entry"
          openTopMenu={menu.open}
          setOpenTopMenu={menu.setOpen}
          onBeforeOpen={menu.refreshWorkspaces}
        >
          <MenuAction
            label="Home"
            disabled={!project || !projectIoAvailable || toolbarBusy}
            onAction={actions.home}
          />
          <MenuAction
            label="New Path"
            disabled={commands.newPath.disabled}
            onAction={() => executeCommand(commands.newPath)}
          />
          <div className="top-menu__separator" role="separator" />
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
            <div className="top-menu__separator" role="separator" />
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
          <div className="top-menu__separator" role="separator" />
          <MenuAction
            label="Settings"
            dataTour="settings-menu-item"
            disabled={commands.settings.disabled}
            onAction={() => {
              fileMenuButtonRef.current?.focus();
              menu.setOpen(null);
              executeCommand(commands.settings);
            }}
          />
        </TopMenuButton>
        <TopMenuButton
          id="path"
          dataTour="path-menu-entry"
          label="Edit"
          active
          triggerRef={menu.pathTriggerRef}
          openTopMenu={menu.open}
          setOpenTopMenu={menu.setOpen}
        >
          {activeGroup ? (
            <>
              <MenuLabel>Path Group: {activeGroup.display_name}</MenuLabel>
              <div className="top-menu__separator" role="separator" />
            </>
          ) : null}
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
            onAction={() => actions.showDeletePaths()}
          />
          <MenuAction
            label="Delete Path Groups..."
            disabled={
              !project || project.path_groups.length === 0 || toolbarBusy
            }
            onAction={() => actions.showDeletePathGroups()}
          />
          <div className="top-menu__separator" role="separator" />
          <MenuAction
            label="Linked Elements..."
            disabled={!project || toolbarBusy}
            onAction={actions.showLinkedTargets}
          />
        </TopMenuButton>
      </nav>
      <nav className="toolbar-actions" aria-label="Project actions">
        <div
          className={`toolbar-actions__quick${import.meta.env.VITE_ENABLE_BUG_REPORT === "true" ? " toolbar-actions__quick--bug-report" : ""}`}
        >
          <ToolbarPathNavigator
            project={project}
            activePath={activePath}
            onSelectPath={actions.selectPath}
          />
          {import.meta.env.VITE_ENABLE_BUG_REPORT === "true" ? (
            <BugReportButton />
          ) : null}
        </div>
        <div className="toolbar-actions__buttons" data-tour="edit-controls">
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
          <OptimizerLiveRegion />
          <div
            ref={helpHubRef}
            className="help-hub-control"
            data-tour="help-hub"
          >
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
                tourAvailable={toursSupported}
                tourUnavailableReason="Guided lessons require a wider window."
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
          <InspectorButton
            open={panels.inspectorOpen}
            command={commands.inspector}
          />
        </div>
        <input
          ref={setFileInput}
          className="file-import-input"
          aria-label="Import BLine JSON"
          data-tour="lesson-import-file"
          type="file"
          accept="application/json,.json,.bline-project,.bline-project.json"
          onChange={onImportFile}
        />
        <input
          ref={setFolderInput}
          className="file-import-input"
          aria-label="Import autos folder"
          data-tour="lesson-import-folder"
          type="file"
          accept="application/json,.json"
          multiple
          onChange={onImportFolder}
        />
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
      data-tour="inspector-toggle"
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
          <span>Lessons</span>
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
          <span>Sample path</span>
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

export function PathHealthPopover({
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
        <strong>Path health</strong>
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
            {diagnostic.fix ? (
              <small>{diagnostic.fix.label}</small>
            ) : diagnostic.elementIndex !== undefined ? (
              <small>Show element {diagnostic.elementIndex + 1}</small>
            ) : null}
          </button>
        ))}
        {diagnostics.length === 0 && !saveError ? (
          <div className="path-health-popover__clear">
            No editor issues found.
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
