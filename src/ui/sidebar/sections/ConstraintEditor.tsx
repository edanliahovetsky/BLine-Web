import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityMergeToleranceMetersPerSec,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../../../core/config/projectConfig";
import {
  autoVelocityConstraintForCap,
  autoVelocityInputSignature,
  generateAutoVelocityProfile,
  type AutoVelocityProfile,
  type AutoVelocitySegmentCap,
} from "../../../core/constraints/autoVelocityConstraints";
import { domainForKey } from "../../../core/constraints/rangedConstraints";
import type { ProjectDocument } from "../../../core/io/projectSchema";
import {
  constraintKeys,
  rangedConstraintKeys,
  terminalToleranceKeys,
  type ConstraintKey,
  type AutoVelocityConstraintMetadata,
  type RangedConstraint,
  type RangedConstraintKey,
} from "../../../core/model/path";
import { projectStore } from "../../../state/projectStore";
import { selectionStore } from "../../../state/selectionStore";
import { useStoreSelector } from "../../../state/react";
import {
  NumberStepperControl,
  SidebarActionButton,
  SidebarIconButton,
} from "../../controls/SidebarControls";
import { ElementIcon, PlusIcon, RemoveIcon, XIcon } from "../../icons";
import { SidebarSection } from "../SidebarSection";
import {
  createAddRangedConstraintCommand,
  createInsertRangedConstraintCommand,
  createRemoveRangedConstraintCommand,
  createReplaceRangedConstraintsForKeyCommand,
  createSetScalarConstraintCommand,
  createSplitRangedConstraintCommand,
  createUpdateRangedConstraintCommand,
  createUpdateRangedConstraintsCommand,
} from "../sidebarCommands";

type RangedEntry = {
  constraint: RangedConstraint;
  index: number;
};

type RangeUpdate = {
  index: number;
  next: RangedConstraint;
};

type AddedRangedConstraintSelection = {
  key: RangedConstraintKey;
  index: number;
};

type RangedMeta = {
  label: string;
  unit: string;
  defaultValue: number;
  step: number;
  min: number;
  max: number;
};

type ScalarMeta = {
  label: string;
  unit: string;
  defaultValue: number;
  step: number;
  min: number;
  max: number;
};

type AutoVelocitySettings = {
  velocitySafetyFactor: number;
  accelerationSafetyFactor: number;
  mergeToleranceMps: number;
};

type AutoVelocityStatus = {
  currentSignature: string | null;
  expectedMetadata: AutoVelocityConstraintMetadata;
  autoConstraintCount: number;
  hasAutoConstraints: boolean;
  stale: boolean;
};

const rangedMeta: Record<RangedConstraintKey, RangedMeta> = {
  max_velocity_meters_per_sec: {
    label: "Max Velocity",
    unit: "m/s",
    defaultValue: 4.5,
    step: 0.1,
    min: 0,
    max: 20,
  },
  max_acceleration_meters_per_sec2: {
    label: "Max Acceleration",
    unit: "m/s2",
    defaultValue: 12,
    step: 0.1,
    min: 0,
    max: 50,
  },
  max_velocity_deg_per_sec: {
    label: "Max Rot Velocity",
    unit: "deg/s",
    defaultValue: 600,
    step: 1,
    min: 0,
    max: 1440,
  },
  max_acceleration_deg_per_sec2: {
    label: "Max Rot Acceleration",
    unit: "deg/s2",
    defaultValue: 2000,
    step: 1,
    min: 0,
    max: 5000,
  },
};

const scalarMeta: Record<(typeof terminalToleranceKeys)[number], ScalarMeta> = {
  end_translation_tolerance_meters: {
    label: "End Translation Tolerance",
    unit: "m",
    defaultValue: 0.1,
    step: 0.01,
    min: 0,
    max: 10,
  },
  end_rotation_tolerance_deg: {
    label: "End Rotation Tolerance",
    unit: "deg",
    defaultValue: 5,
    step: 0.1,
    min: 0,
    max: 180,
  },
};

const addConstraintMenuOrder: readonly ConstraintKey[] = [
  ...rangedConstraintKeys,
  ...terminalToleranceKeys,
];

const autoVelocityKey = "max_velocity_meters_per_sec";
const defaultAutoVelocitySettings: AutoVelocitySettings = {
  velocitySafetyFactor: defaultAutoVelocityVelocitySafetyFactor,
  accelerationSafetyFactor: defaultAutoVelocityAccelerationSafetyFactor,
  mergeToleranceMps: defaultAutoVelocityMergeToleranceMetersPerSec,
};

export function ConstraintEditor({
  project,
  open,
  onToggleSection,
}: {
  project: ProjectDocument | null;
  open: boolean;
  onToggleSection(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [selectedByKey, setSelectedByKey] = useState<
    Partial<Record<RangedConstraintKey, number>>
  >({});
  const projectAutoVelocitySettings = project
    ? autoVelocitySettingsFromProject(project)
    : defaultAutoVelocitySettings;
  const resetProjectId = project?.project_id ?? null;
  const resetVelocitySafetyFactor =
    projectAutoVelocitySettings.velocitySafetyFactor;
  const resetAccelerationSafetyFactor =
    projectAutoVelocitySettings.accelerationSafetyFactor;
  const resetMergeToleranceMps = projectAutoVelocitySettings.mergeToleranceMps;
  const autoSettingsResetKey = [
    resetProjectId ?? "no-project",
    resetVelocitySafetyFactor,
    resetAccelerationSafetyFactor,
    resetMergeToleranceMps,
  ].join(":");
  const [autoSettingsState, setAutoSettingsState] = useState<{
    resetKey: string;
    settings: AutoVelocitySettings;
  }>(() => ({
    resetKey: autoSettingsResetKey,
    settings: projectAutoVelocitySettings,
  }));
  const autoSettings =
    autoSettingsState.resetKey === autoSettingsResetKey
      ? autoSettingsState.settings
      : projectAutoVelocitySettings;
  const setAutoSettings = (settings: AutoVelocitySettings) => {
    setAutoSettingsState({
      resetKey: autoSettingsResetKey,
      settings,
    });
  };
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint,
  );
  const availableItems = useMemo(
    () => (project ? buildConstraintMenuItems(project) : []),
    [project],
  );
  const activeCount = project ? countActiveConstraints(project) : 0;
  const setSelectedForKey = (key: RangedConstraintKey, index: number) => {
    setSelectedByKey((selected) => ({ ...selected, [key]: index }));
    const latestProject = projectStore.getState().project ?? project;
    if (latestProject) {
      selectRangedConstraint(latestProject, key, index);
    }
  };

  useEffect(() => {
    if (!selectedRangedConstraint) {
      return;
    }

    const selectedToken = rangedSelectionToken(
      selectedRangedConstraint.key,
      selectedRangedConstraint.index,
    );
    const clearIfOutsideSelectedRange = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-ranged-constraint-selection="${selectedToken}"]`)
      ) {
        return;
      }

      setSelectedByKey((selected) => ({
        ...selected,
        [selectedRangedConstraint.key]: -1,
      }));
      selectionStore.getState().clearRangedConstraintSelection();
    };

    document.addEventListener("pointerdown", clearIfOutsideSelectedRange, true);

    return () => {
      document.removeEventListener(
        "pointerdown",
        clearIfOutsideSelectedRange,
        true,
      );
    };
  }, [selectedRangedConstraint]);

  const popoutOverlay =
    popoutOpen && project
      ? createPortal(
          <ConstraintPopout
            project={project}
            selectedByKey={selectedByKey}
            autoSettings={autoSettings}
            onSelect={setSelectedForKey}
            onClose={() => setPopoutOpen(false)}
          />,
          document.body,
        )
      : null;

  return (
    <>
      <SidebarSection
        actions={
          <details
            className="add-element-menu add-constraint-menu"
            open={menuOpen}
          >
            <summary
              className={
                project
                  ? "add-element-button"
                  : "add-element-button is-disabled"
              }
              role="button"
              onClick={(event) => {
                event.preventDefault();
                if (!project) {
                  return;
                }
                setMenuOpen((open) => !open);
              }}
            >
              <span
                className="sidebar-add-icon"
                data-testid="add-constraint-icon"
                aria-hidden="true"
              >
                <PlusIcon size={17} />
              </span>
              <span>Add constraint</span>
            </summary>
            <div
              className="add-element-menu__panel"
              role="menu"
              aria-label="Add constraint"
            >
              {availableItems.length === 0 ? (
                <p className="constraint-empty-state">
                  All constraints are active.
                </p>
              ) : (
                availableItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="add-element-menu__item"
                    role="menuitem"
                    onClick={() => {
                      if (!project) {
                        return;
                      }
                      const added = addConstraint(project, item.key);
                      if (added) {
                        setSelectedForKey(added.key, added.index);
                      }
                      setMenuOpen(false);
                    }}
                  >
                    <ElementIcon
                      type={constraintIconType(item.key)}
                      size={22}
                    />
                    <span>{item.label}</span>
                  </button>
                ))
              )}
            </div>
          </details>
        }
        className="constraints-section"
        meta={project ? constraintCountLabel(activeCount) : "No project"}
        open={open}
        sectionId="constraints"
        title="Constraints"
        onToggle={onToggleSection}
      >
        <div className="constraint-list">
          {project ? (
            <>
              {rangedConstraintKeys.map((key) => (
                <RangedConstraintCard
                  key={`${project.project_id}-${key}-${projectConfigSignature(project)}`}
                  project={project}
                  constraintKey={key}
                  selectedIndex={selectedByKey[key] ?? null}
                  autoSettings={autoSettings}
                  onAutoSettingsChange={setAutoSettings}
                  onSelect={(index) => setSelectedForKey(key, index)}
                  onOpenPopout={() => setPopoutOpen(true)}
                />
              ))}

              <div className="constraint-terminal-group">
                {terminalToleranceKeys.map((key) =>
                  project.path.constraints[key] !== null ? (
                    <ScalarConstraintRow
                      key={key}
                      project={project}
                      constraintKey={key}
                    />
                  ) : null,
                )}
              </div>

              {!hasAnyConstraint(project) &&
              domainLabelsForKey(project, autoVelocityKey).length === 0 ? (
                <p className="constraint-empty-state">
                  No path constraints added.
                </p>
              ) : null}
            </>
          ) : (
            <p className="constraint-empty-state">
              Open or create a project to edit constraints.
            </p>
          )}
        </div>
      </SidebarSection>
      {popoutOverlay}
    </>
  );
}

function RangedConstraintCard({
  project,
  constraintKey,
  selectedIndex,
  autoSettings,
  onAutoSettingsChange,
  onSelect,
  onOpenPopout,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  selectedIndex: number | null;
  autoSettings: AutoVelocitySettings;
  onAutoSettingsChange(settings: AutoVelocitySettings): void;
  onSelect: (index: number) => void;
  onOpenPopout: () => void;
}) {
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(
    () => domainLabelsForKey(project, constraintKey),
    [project, constraintKey],
  );
  const isAutoVelocityCard = constraintKey === autoVelocityKey;
  const autoStatus = useMemo(
    () =>
      isAutoVelocityCard
        ? autoVelocityStatusForProject(project, autoSettings)
        : null,
    [autoSettings, isAutoVelocityCard, project],
  );
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const selectedLocalIndex = selectedEntry
    ? entries.findIndex((entry) => entry.index === selectedEntry.index)
    : -1;
  const total = labels.length;

  if (entries.length === 0 && !isAutoVelocityCard) {
    return null;
  }

  const selectedSegmentNumber =
    selectedLocalIndex >= 0 ? selectedLocalIndex + 1 : 1;

  return (
    <article
      className="constraint-card"
      data-testid={`constraint-card-${constraintKey}`}
    >
      <div className="constraint-card__header">
        <div>
          <h3>{meta.label}</h3>
          <span>
            {constraintCardMeta(constraintKey, entries.length, total)}
          </span>
        </div>
        {isAutoVelocityCard && autoStatus ? (
          <div className="constraint-card__actions constraint-card__actions--auto">
            <AutoVelocityStatusIndicator
              status={autoStatus}
              onClick={() => runAutoVelocityAll(project, autoSettings)}
              disabled={total === 0}
            />
            <SidebarActionButton
              onClick={() => runAutoVelocityAll(project, autoSettings)}
              disabled={total === 0}
              aria-label="Apply auto velocity to open segments"
              title="Apply auto velocity to open and auto segments"
            >
              Auto all
            </SidebarActionButton>
            <SidebarActionButton
              onClick={() => clearAutoVelocity(project)}
              disabled={!hasAutoVelocityConstraints(project)}
              aria-label="Clear auto velocity segments"
              title="Clear auto velocity segments"
            >
              Clear auto
            </SidebarActionButton>
          </div>
        ) : null}
      </div>

      {isAutoVelocityCard && autoStatus ? (
        <AutoVelocityInlineControls
          status={autoStatus}
          settings={autoSettings}
          onSettingsChange={onAutoSettingsChange}
        />
      ) : null}

      <ConstraintSegmentBar
        project={project}
        constraintKey={constraintKey}
        entries={entries}
        labels={labels}
        unit={meta.unit}
        autoStatus={autoStatus}
        selectedIndex={selectedEntry?.index ?? null}
        onSelect={onSelect}
        onPreview={(index, constraint) => {
          previewRangedConstraint(constraintKey, index, constraint);
        }}
        onRangesChange={(updates) => updateRangedConstraints(project, updates)}
        onGapDoubleClick={(start, end) => {
          const insertedIndex = insertRangedConstraint(
            project,
            constraintKey,
            start,
            end,
            defaultFor(project, constraintKey, meta.defaultValue),
          );
          if (insertedIndex !== null) {
            onSelect(insertedIndex);
          }
        }}
      />

      <RangedConstraintControls
        project={project}
        constraintKey={constraintKey}
        entry={selectedEntry}
        segmentNumber={selectedSegmentNumber}
        autoStatus={autoStatus}
        autoSettings={autoSettings}
        onSelect={onSelect}
        onOpenPopout={onOpenPopout}
      />
    </article>
  );
}

function ConstraintPopout({
  project,
  selectedByKey,
  autoSettings,
  onSelect,
  onClose,
}: {
  project: ProjectDocument;
  selectedByKey: Partial<Record<RangedConstraintKey, number>>;
  autoSettings: AutoVelocitySettings;
  onSelect: (key: RangedConstraintKey, index: number) => void;
  onClose: () => void;
}) {
  const activeKeys = rangedConstraintKeys.filter((key) => {
    if (getRangedEntries(project, key).length > 0) {
      return true;
    }

    return (
      key === autoVelocityKey && domainLabelsForKey(project, key).length > 0
    );
  });
  const popoutRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState(() => initialPopoutPosition());

  const startWindowDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    const popout = popoutRef.current;
    if (!popout) {
      return;
    }

    const rect = popout.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.preventDefault();

    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      const currentPopout = popoutRef.current;
      if (!drag || !currentPopout) {
        return;
      }

      const currentRect = currentPopout.getBoundingClientRect();
      setPosition({
        left: clamp(
          moveEvent.clientX - drag.offsetX,
          8,
          Math.max(8, window.innerWidth - currentRect.width - 8),
        ),
        top: clamp(
          moveEvent.clientY - drag.offsetY,
          8,
          Math.max(8, window.innerHeight - currentRect.height - 8),
        ),
      });
      moveEvent.preventDefault();
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <div className="constraint-popout-backdrop" role="presentation">
      <div
        ref={popoutRef}
        className="constraint-popout"
        role="dialog"
        aria-modal="false"
        aria-label="Constraint Editor"
        data-testid="constraint-popout-window"
        style={{ left: position.left, top: position.top }}
      >
        <div
          className="constraint-popout__header"
          data-testid="constraint-popout-drag-handle"
          onMouseDown={startWindowDrag}
        >
          <div>
            <h2>Constraint Editor</h2>
            <span>Ranged constraints</span>
          </div>
          <button
            type="button"
            className="dialog-close-button"
            onClick={onClose}
            aria-label="Close Constraint Editor"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="constraint-popout__content">
          {activeKeys.length === 0 ? (
            <p className="constraint-empty-state">
              No ranged constraints defined.
            </p>
          ) : (
            activeKeys.map((key) => (
              <PopoutConstraintPanel
                key={key}
                project={project}
                constraintKey={key}
                selectedIndex={selectedByKey[key] ?? null}
                autoSettings={autoSettings}
                onSelect={(index) => onSelect(key, index)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PopoutConstraintPanel({
  project,
  constraintKey,
  selectedIndex,
  autoSettings,
  onSelect,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  selectedIndex: number | null;
  autoSettings: AutoVelocitySettings;
  onSelect: (index: number) => void;
}) {
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(
    () => domainLabelsForKey(project, constraintKey),
    [project, constraintKey],
  );
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const selectedLocalIndex = selectedEntry
    ? entries.findIndex((entry) => entry.index === selectedEntry.index)
    : -1;
  const segmentNumber = selectedLocalIndex >= 0 ? selectedLocalIndex + 1 : 1;
  const isAutoVelocityPanel = constraintKey === autoVelocityKey;
  const autoStatus = useMemo(
    () =>
      isAutoVelocityPanel
        ? autoVelocityStatusForProject(project, autoSettings)
        : null,
    [autoSettings, isAutoVelocityPanel, project],
  );

  return (
    <article className="constraint-popout-card">
      <div className="constraint-popout-card__header">
        <div>
          <h3>{meta.label}</h3>
          <span>
            {entries.length} {entries.length === 1 ? "segment" : "segments"}
          </span>
        </div>
        {isAutoVelocityPanel && autoStatus ? (
          <div className="constraint-card__actions constraint-card__actions--auto">
            <AutoVelocityStatusIndicator
              status={autoStatus}
              onClick={() => runAutoVelocityAll(project, autoSettings)}
              disabled={labels.length === 0}
            />
            <SidebarActionButton
              onClick={() => runAutoVelocityAll(project, autoSettings)}
              disabled={labels.length === 0}
              aria-label="Apply auto velocity to open segments"
              title="Apply auto velocity to open and auto segments"
            >
              Auto all
            </SidebarActionButton>
            <SidebarActionButton
              onClick={() => clearAutoVelocity(project)}
              disabled={!hasAutoVelocityConstraints(project)}
              aria-label="Clear auto velocity segments"
              title="Clear auto velocity segments"
            >
              Clear auto
            </SidebarActionButton>
          </div>
        ) : null}
      </div>

      <ConstraintSegmentBar
        project={project}
        constraintKey={constraintKey}
        entries={entries}
        labels={labels}
        unit={meta.unit}
        autoStatus={autoStatus}
        selectedIndex={selectedEntry?.index ?? null}
        onSelect={onSelect}
        onPreview={(index, constraint) => {
          previewRangedConstraint(constraintKey, index, constraint);
        }}
        onRangesChange={(updates) => updateRangedConstraints(project, updates)}
        onGapDoubleClick={(start, end) => {
          const insertedIndex = insertRangedConstraint(
            project,
            constraintKey,
            start,
            end,
            defaultFor(project, constraintKey, meta.defaultValue),
          );
          if (insertedIndex !== null) {
            onSelect(insertedIndex);
          }
        }}
        density="popout"
      />

      <RangedConstraintControls
        project={project}
        constraintKey={constraintKey}
        entry={selectedEntry}
        segmentNumber={segmentNumber}
        autoStatus={autoStatus}
        autoSettings={autoSettings}
        onSelect={onSelect}
        compact={false}
      />
    </article>
  );
}

function ConstraintSegmentBar({
  project,
  constraintKey,
  entries,
  labels,
  unit,
  autoStatus,
  selectedIndex,
  onSelect,
  onPreview,
  onRangesChange,
  onGapDoubleClick,
  density = "sidebar",
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  entries: RangedEntry[];
  labels: string[];
  unit: string;
  autoStatus?: AutoVelocityStatus | null;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onPreview?: (index: number, constraint: RangedConstraint) => void;
  onRangesChange: (updates: RangeUpdate[]) => void;
  onGapDoubleClick: (start: number, end: number) => void;
  density?: "sidebar" | "popout";
}) {
  const meta = rangedMeta[constraintKey];
  const total = labels.length;
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<SegmentDragState | null>(null);
  const [draftEntries, setDraftEntries] = useState<RangedEntry[] | null>(null);
  const displayedEntries = draftEntries ?? entries;

  useEffect(() => {
    if (!dragRef.current) {
      setDraftEntries(null);
    }
  }, [entries]);

  const startDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || total <= 0) {
      return;
    }

    const bar = barRef.current;
    if (!bar) {
      return;
    }

    const metrics = segmentBarMetrics(bar, total);
    const x = event.clientX - metrics.left + bar.scrollLeft;
    const boundary = hitTestBoundary(displayedEntries, x, metrics.cellWidth);
    const segmentIndex =
      boundary?.segmentIndex ??
      hitTestSegment(displayedEntries, x, metrics.cellWidth);

    if (segmentIndex < 0) {
      return;
    }

    const workingEntries = cloneEntries(displayedEntries);
    const selectedEntry = workingEntries[segmentIndex];
    if (!selectedEntry) {
      return;
    }

    onSelect(selectedEntry.index);
    event.preventDefault();

    const clickOrdinal = xToOrdinal(x, metrics.cellWidth, total);
    dragRef.current = boundary
      ? {
          changed: false,
          entries: workingEntries,
          mode: "boundary",
          originalEntries: cloneEntries(displayedEntries),
          segmentIndex,
          side: boundary.side,
        }
      : {
          changed: false,
          entries: workingEntries,
          mode: "segment",
          originalEntries: cloneEntries(displayedEntries),
          segmentIndex,
          offset: clickOrdinal - selectedEntry.constraint.start_ordinal,
          width:
            selectedEntry.constraint.end_ordinal -
            selectedEntry.constraint.start_ordinal,
        };

    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      const currentBar = barRef.current;
      if (!drag || !currentBar) {
        return;
      }

      const moveMetrics = segmentBarMetrics(currentBar, total);
      const nextOrdinal = xToOrdinal(
        moveEvent.clientX - moveMetrics.left + currentBar.scrollLeft,
        moveMetrics.cellWidth,
        total,
      );
      const nextEntries =
        drag.mode === "boundary"
          ? dragBoundary(
              drag.entries,
              drag.segmentIndex,
              drag.side,
              nextOrdinal,
              total,
            )
          : dragWholeSegment(
              drag.entries,
              drag.segmentIndex,
              nextOrdinal,
              drag.offset,
              drag.width,
              total,
            );
      const displayedNextEntries = manualizeChangedAutoVelocityEntries(
        constraintKey,
        drag.originalEntries,
        nextEntries,
      );

      drag.entries = displayedNextEntries;
      drag.changed = true;
      setDraftEntries(displayedNextEntries);
      const previewEntry = displayedNextEntries[drag.segmentIndex];
      if (previewEntry) {
        onPreview?.(previewEntry.index, previewEntry.constraint);
      }
      moveEvent.preventDefault();
    };

    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);

      const drag = dragRef.current;
      dragRef.current = null;
      setDraftEntries(null);

      if (!drag || !drag.changed) {
        return;
      }

      const updates = changedRangeUpdates(drag.originalEntries, drag.entries);
      if (updates.length > 0) {
        onRangesChange(updates);
      }
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar || total <= 0) {
      return;
    }

    const metrics = segmentBarMetrics(bar, total);
    const ordinal = xToOrdinal(
      event.clientX - metrics.left + bar.scrollLeft,
      metrics.cellWidth,
      total,
    );
    const gap = contiguousGap(displayedEntries, total, ordinal);
    if (gap) {
      onGapDoubleClick(gap.start, gap.end);
    }
  };

  return (
    <div
      ref={barRef}
      className={`ranged-segment-bar ranged-segment-bar--${density}`}
      style={{
        gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(54px, 1fr))`,
      }}
      role="listbox"
      aria-label={`${meta.label} segments`}
      tabIndex={0}
      onMouseDown={startDrag}
      onDoubleClick={handleDoubleClick}
    >
      {labels.map((label, ordinalIndex) => {
        const ordinal = ordinalIndex + 1;
        const entry = displayedEntries.find(({ constraint }) =>
          ordinalInRange(ordinal, constraint),
        );

        return (
          <div
            key={`${constraintKey}-${ordinal}`}
            className={[
              "ranged-segment-ordinal",
              ordinal === total ? "is-last" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ gridColumn: ordinal, gridRow: 1 }}
            data-testid={`constraint-cell-${constraintKey}-${ordinal}`}
            aria-hidden="true"
          >
            <span>{label}</span>
            <span className="visually-hidden">
              {entry
                ? `${formatValue(entry.constraint.value)} ${unit}`
                : "Open"}
            </span>
          </div>
        );
      })}

      {labels.map((label, ordinalIndex) => {
        const ordinal = ordinalIndex + 1;
        const entry = displayedEntries.find(({ constraint }) =>
          ordinalInRange(ordinal, constraint),
        );

        if (entry) {
          return null;
        }

        return (
          <div
            key={`${constraintKey}-gap-${ordinal}`}
            className={[
              "ranged-segment-gap",
              ordinal === total ? "is-last" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ gridColumn: ordinal, gridRow: 2 }}
            role="option"
            aria-selected="false"
            aria-label={`Create ${meta.label} segment at ${label}`}
          >
            <span>Open</span>
          </div>
        );
      })}

      {displayedEntries.map((entry) => {
        const { constraint } = entry;
        const start = clampOrdinal(constraint.start_ordinal, total);
        const end = clampOrdinal(constraint.end_ordinal, total);
        const selected = entry.index === selectedIndex;
        const segmentNumber =
          entries.findIndex((candidate) => candidate.index === entry.index) + 1;
        const constraintState = rangedConstraintStateForConstraint(
          project,
          constraint,
          autoStatus,
        );
        const sourceClass =
          constraint.source === "auto_velocity"
            ? "ranged-segment-range--auto"
            : "ranged-segment-range--manual";
        const warningTitle = constraintState.globalWarning
          ? "Above global value"
          : constraintState.autoWarning
            ? "Above auto value"
            : undefined;

        return (
          <div
            key={`${constraintKey}-range-${entry.index}`}
            className={[
              "ranged-segment-range",
              sourceClass,
              selected ? "is-selected" : "",
              constraintState.stale ? "is-stale" : "",
              constraintState.globalWarning || constraintState.autoWarning
                ? "has-warning"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              gridColumn: `${Math.min(start, end)} / ${Math.max(start, end) + 1}`,
              gridRow: 2,
            }}
            data-testid={`constraint-range-${constraintKey}-${entry.index}`}
            data-ranged-constraint-selection={rangedSelectionToken(
              constraintKey,
              entry.index,
            )}
            role="option"
            aria-selected={selected}
            aria-keyshortcuts="Delete Backspace"
            aria-label={[
              `Select ${meta.label} segment ${segmentNumber}`,
              warningTitle,
            ]
              .filter(Boolean)
              .join(", ")}
            title={warningTitle}
          >
            {density === "popout" ? (
              <span className="ranged-segment-range__label">
                {rangeLabel(labels, constraint)}
              </span>
            ) : null}
            <span className="ranged-segment-range__value">
              {formatSegmentValue(constraint.value, unit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type SegmentDragState =
  | {
      changed: boolean;
      entries: RangedEntry[];
      mode: "boundary";
      originalEntries: RangedEntry[];
      segmentIndex: number;
      side: "start" | "end";
    }
  | {
      changed: boolean;
      entries: RangedEntry[];
      mode: "segment";
      originalEntries: RangedEntry[];
      segmentIndex: number;
      offset: number;
      width: number;
    };

function segmentBarMetrics(
  bar: HTMLDivElement,
  total: number,
): { cellWidth: number; left: number } {
  const rect = bar.getBoundingClientRect();
  return {
    cellWidth: Math.max(bar.scrollWidth, rect.width) / Math.max(1, total),
    left: rect.left,
  };
}

function xToOrdinal(x: number, cellWidth: number, total: number): number {
  return clampOrdinal(Math.floor(x / Math.max(1, cellWidth)) + 1, total);
}

function cloneEntries(entries: RangedEntry[]): RangedEntry[] {
  return entries.map((entry) => ({
    index: entry.index,
    constraint: { ...entry.constraint },
  }));
}

function hitTestBoundary(
  entries: RangedEntry[],
  x: number,
  cellWidth: number,
): { segmentIndex: number; side: "start" | "end" } | null {
  const hitWidth = 8;
  for (const [segmentIndex, { constraint }] of entries.entries()) {
    const startX = (constraint.start_ordinal - 1) * cellWidth;
    const endX = constraint.end_ordinal * cellWidth;
    if (Math.abs(x - startX) <= hitWidth / 2) {
      return { segmentIndex, side: "start" };
    }
    if (Math.abs(x - endX) <= hitWidth / 2) {
      return { segmentIndex, side: "end" };
    }
  }

  return null;
}

function hitTestSegment(
  entries: RangedEntry[],
  x: number,
  cellWidth: number,
): number {
  return entries.findIndex(({ constraint }) => {
    const startX = (constraint.start_ordinal - 1) * cellWidth;
    const endX = constraint.end_ordinal * cellWidth;
    return x >= startX && x < endX;
  });
}

function dragBoundary(
  entries: RangedEntry[],
  segmentIndex: number,
  side: "start" | "end",
  ordinal: number,
  total: number,
): RangedEntry[] {
  const nextEntries = cloneEntries(entries);
  const entry = nextEntries[segmentIndex];
  if (!entry) {
    return entries;
  }

  const segment = entry.constraint;
  const adjacentIndex = findAdjacentSegment(nextEntries, segmentIndex, side);

  if (side === "start") {
    let nextStart = Math.max(1, Math.min(ordinal, segment.end_ordinal));
    if (adjacentIndex >= 0) {
      const adjacent = nextEntries[adjacentIndex].constraint;
      nextStart = Math.max(nextStart, adjacent.start_ordinal + 1);
      adjacent.end_ordinal = nextStart - 1;
    } else {
      for (const candidate of nextEntries) {
        const other = candidate.constraint;
        if (other === segment) {
          continue;
        }
        if (
          other.end_ordinal < segment.end_ordinal &&
          other.end_ordinal >= nextStart
        ) {
          nextStart = other.end_ordinal + 1;
        }
      }
    }
    segment.start_ordinal = clampOrdinal(nextStart, total);
  } else {
    let nextEnd = Math.min(total, Math.max(ordinal, segment.start_ordinal));
    if (adjacentIndex >= 0) {
      const adjacent = nextEntries[adjacentIndex].constraint;
      nextEnd = Math.min(nextEnd, adjacent.end_ordinal - 1);
      adjacent.start_ordinal = nextEnd + 1;
    } else {
      for (const candidate of nextEntries) {
        const other = candidate.constraint;
        if (other === segment) {
          continue;
        }
        if (
          other.start_ordinal > segment.start_ordinal &&
          other.start_ordinal <= nextEnd
        ) {
          nextEnd = other.start_ordinal - 1;
        }
      }
    }
    segment.end_ordinal = clampOrdinal(nextEnd, total);
  }

  return nextEntries;
}

function dragWholeSegment(
  entries: RangedEntry[],
  segmentIndex: number,
  targetOrdinal: number,
  offset: number,
  width: number,
  total: number,
): RangedEntry[] {
  const nextEntries = cloneEntries(entries);
  const entry = nextEntries[segmentIndex];
  if (!entry) {
    return entries;
  }

  const segment = entry.constraint;
  let nextStart = targetOrdinal - offset;
  let nextEnd = nextStart + width;

  if (nextStart < 1) {
    nextStart = 1;
    nextEnd = nextStart + width;
  }
  if (nextEnd > total) {
    nextEnd = total;
    nextStart = nextEnd - width;
  }

  for (const candidate of nextEntries) {
    const other = candidate.constraint;
    if (other === segment) {
      continue;
    }
    if (nextStart <= other.end_ordinal && nextEnd >= other.start_ordinal) {
      if (segment.start_ordinal <= other.start_ordinal) {
        nextEnd = other.start_ordinal - 1;
        nextStart = nextEnd - width;
      } else {
        nextStart = other.end_ordinal + 1;
        nextEnd = nextStart + width;
      }
    }
  }

  segment.start_ordinal = clampOrdinal(nextStart, total);
  segment.end_ordinal = clampOrdinal(nextEnd, total);
  return nextEntries;
}

function findAdjacentSegment(
  entries: RangedEntry[],
  segmentIndex: number,
  side: "start" | "end",
): number {
  const segment = entries[segmentIndex]?.constraint;
  if (!segment) {
    return -1;
  }

  return entries.findIndex(({ constraint }, index) => {
    if (index === segmentIndex) {
      return false;
    }

    if (side === "start") {
      return constraint.end_ordinal === segment.start_ordinal - 1;
    }

    return constraint.start_ordinal === segment.end_ordinal + 1;
  });
}

function changedRangeUpdates(
  originalEntries: RangedEntry[],
  nextEntries: RangedEntry[],
): RangeUpdate[] {
  return nextEntries.flatMap((nextEntry) => {
    const original = originalEntries.find(
      (entry) => entry.index === nextEntry.index,
    );
    if (
      !original ||
      (original.constraint.start_ordinal ===
        nextEntry.constraint.start_ordinal &&
        original.constraint.end_ordinal === nextEntry.constraint.end_ordinal)
    ) {
      return [];
    }

    return [{ index: nextEntry.index, next: nextEntry.constraint }];
  });
}

function manualizeChangedAutoVelocityEntries(
  constraintKey: RangedConstraintKey,
  originalEntries: RangedEntry[],
  nextEntries: RangedEntry[],
): RangedEntry[] {
  if (constraintKey !== autoVelocityKey) {
    return nextEntries;
  }

  return nextEntries.map((nextEntry) => {
    const original = originalEntries.find(
      (entry) => entry.index === nextEntry.index,
    );
    if (
      nextEntry.constraint.source !== "auto_velocity" ||
      !original ||
      (original.constraint.start_ordinal ===
        nextEntry.constraint.start_ordinal &&
        original.constraint.end_ordinal === nextEntry.constraint.end_ordinal)
    ) {
      return nextEntry;
    }

    return {
      ...nextEntry,
      constraint: {
        ...nextEntry.constraint,
        source: "manual",
        auto_velocity: null,
      },
    };
  });
}

function RangedConstraintControls({
  project,
  constraintKey,
  entry,
  segmentNumber,
  autoStatus,
  autoSettings,
  onSelect,
  onOpenPopout,
  compact = true,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  entry: RangedEntry | null;
  segmentNumber: number;
  autoStatus?: AutoVelocityStatus | null;
  autoSettings?: AutoVelocitySettings;
  onSelect: (index: number) => void;
  onOpenPopout?: () => void;
  compact?: boolean;
}) {
  const meta = rangedMeta[constraintKey];
  const constraint = entry?.constraint ?? null;
  const constraintSelectionToken = entry
    ? rangedSelectionToken(constraintKey, entry.index)
    : undefined;
  const rowTestId = entry
    ? `ranged-constraint-row-${segmentNumber}`
    : `ranged-constraint-row-${constraintKey}-empty`;
  const valueLabel = entry
    ? `Constraint ${segmentNumber} value`
    : `${meta.label} value`;
  const selectedActionLabel = entry
    ? `constraint ${segmentNumber}`
    : "selected constraint";
  const showAutoVelocityMode = constraintKey === autoVelocityKey;
  const constraintState = constraint
    ? rangedConstraintStateForConstraint(
        project,
        constraint,
        autoStatus ?? null,
      )
    : null;

  return (
    <div
      className={
        compact
          ? "ranged-constraint-controls"
          : "ranged-constraint-controls ranged-constraint-controls--wide"
      }
      data-testid={rowTestId}
      data-ranged-constraint-selection={constraintSelectionToken}
    >
      <div className="ranged-constraint-controls__fields">
        {showAutoVelocityMode ? (
          <AutoVelocityModeControl
            disabled={!entry || !constraint}
            mode={
              constraint?.source === "auto_velocity"
                ? "auto"
                : constraint
                  ? "manual"
                  : null
            }
            onModeChange={(mode) => {
              if (!entry || !constraint || !autoSettings) {
                return;
              }
              applyVelocityMode(project, entry, mode, autoSettings, onSelect);
            }}
          />
        ) : null}
        <label className="ranged-constraint-controls__value">
          <span>Value</span>
          <div className="constraint-value-input">
            <NumberStepperControl
              allowEmpty
              ariaLabel={valueLabel}
              value={constraint?.value ?? null}
              step={meta.step}
              min={meta.min}
              max={meta.max}
              disabled={!constraint}
              onChange={(value) => {
                if (!entry || !constraint) {
                  return;
                }

                updateRangedConstraint(project, entry.index, {
                  ...constraint,
                  value: value ?? constraint.value,
                  source:
                    constraintKey === autoVelocityKey
                      ? "manual"
                      : constraint.source,
                  auto_velocity:
                    constraintKey === autoVelocityKey
                      ? null
                      : constraint.auto_velocity,
                });
              }}
            />
            <span>{meta.unit}</span>
          </div>
        </label>
        {constraintState?.globalWarning ? (
          <span className="auto-velocity-status auto-velocity-status--warning">
            Above global
          </span>
        ) : null}
        {constraintState?.stale ? (
          <span className="auto-velocity-status">Stale</span>
        ) : constraintState?.autoWarning ? (
          <span className="auto-velocity-status auto-velocity-status--warning">
            Above auto
          </span>
        ) : null}
      </div>
      <div className="ranged-constraint-controls__actions">
        <SidebarIconButton
          className="sidebar-icon-button--add"
          onClick={() => {
            const addedIndex = addRangedConstraint(project, constraintKey);
            if (addedIndex !== null) {
              onSelect(addedIndex);
            }
          }}
          disabled={!canAddMoreRanged(project, constraintKey)}
          aria-label={`Add ${meta.label} segment`}
          title="Add segment"
        >
          <PlusIcon size={16} />
        </SidebarIconButton>
        <SidebarIconButton
          className="sidebar-icon-button--remove"
          onClick={() => {
            if (entry) {
              deleteRangedConstraint(project, entry.index);
            }
          }}
          disabled={!entry}
          aria-label={`Delete ${selectedActionLabel}`}
          aria-keyshortcuts={entry ? "Delete Backspace" : undefined}
          title={`Delete ${selectedActionLabel}`}
        >
          <RemoveIcon size={16} />
        </SidebarIconButton>
        <SidebarActionButton
          onClick={() => {
            if (entry) {
              splitRangedConstraint(project, entry.index);
            }
          }}
          disabled={!constraint || !canSplit(constraint)}
          aria-label={`Split ${selectedActionLabel}`}
        >
          Split
        </SidebarActionButton>
        {onOpenPopout ? (
          <SidebarActionButton
            className="constraint-popout-button"
            onClick={onOpenPopout}
            aria-label={`Show ${meta.label} editor`}
            title="Show editor"
          >
            Editor
          </SidebarActionButton>
        ) : null}
      </div>
    </div>
  );
}

function AutoVelocityInlineControls({
  status,
  settings,
  onSettingsChange,
}: {
  status: AutoVelocityStatus;
  settings: AutoVelocitySettings;
  onSettingsChange(settings: AutoVelocitySettings): void;
}) {
  return (
    <div className="auto-velocity-inline" data-testid="auto-velocity-controls">
      <fieldset className="auto-velocity-inline__group auto-velocity-inline__group--factors">
        <legend>Factors</legend>
        <div className="auto-velocity-inline__group-fields">
          <label>
            <span>Velocity</span>
            <NumberStepperControl
              ariaLabel="Velocity safety factor"
              value={settings.velocitySafetyFactor}
              step={0.05}
              min={0.05}
              max={1}
              onChange={(value) =>
                onSettingsChange({
                  ...settings,
                  velocitySafetyFactor: value ?? settings.velocitySafetyFactor,
                })
              }
            />
          </label>
          <label>
            <span>Accel</span>
            <NumberStepperControl
              ariaLabel="Acceleration safety factor"
              value={settings.accelerationSafetyFactor}
              step={0.05}
              min={0.05}
              max={1}
              onChange={(value) =>
                onSettingsChange({
                  ...settings,
                  accelerationSafetyFactor:
                    value ?? settings.accelerationSafetyFactor,
                })
              }
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="auto-velocity-inline__group auto-velocity-inline__group--merge">
        <legend>Merge diff</legend>
        <label>
          <span>Tolerance</span>
          <NumberStepperControl
            ariaLabel="Auto velocity merge diff"
            value={settings.mergeToleranceMps}
            step={0.05}
            min={0}
            max={20}
            onChange={(value) =>
              onSettingsChange({
                ...settings,
                mergeToleranceMps: value ?? settings.mergeToleranceMps,
              })
            }
          />
        </label>
      </fieldset>
      <div className="auto-velocity-inline__summary">
        <span>{status.autoConstraintCount} auto caps</span>
      </div>
    </div>
  );
}

function AutoVelocityStatusIndicator({
  status,
  onClick,
  disabled,
}: {
  status: AutoVelocityStatus;
  onClick(): void;
  disabled: boolean;
}) {
  const isCurrent = autoVelocityStatusIsCurrent(status);
  return (
    <button
      type="button"
      className={[
        "auto-velocity-status",
        isCurrent ? "auto-velocity-status--current" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      onClick={onClick}
      aria-label={isCurrent ? "Optimizer up to date" : "Optimizer stale"}
      title={autoVelocityStatusTooltip(status)}
    >
      Optimizer
    </button>
  );
}

function AutoVelocityModeControl({
  mode,
  disabled,
  onModeChange,
}: {
  mode: "auto" | "manual" | null;
  disabled: boolean;
  onModeChange(mode: "auto" | "manual"): void;
}) {
  return (
    <div
      className="auto-velocity-mode"
      role="group"
      aria-label="Velocity constraint mode"
    >
      {(["auto", "manual"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={mode === option ? "is-active" : ""}
          disabled={disabled}
          onClick={() => onModeChange(option)}
        >
          {option === "auto" ? "Auto" : "Manual"}
        </button>
      ))}
    </div>
  );
}

function ScalarConstraintRow({
  project,
  constraintKey,
}: {
  project: ProjectDocument;
  constraintKey: (typeof terminalToleranceKeys)[number];
}) {
  const meta = scalarMeta[constraintKey];
  const currentValue = project.path.constraints[constraintKey];
  const value =
    currentValue ?? defaultFor(project, constraintKey, meta.defaultValue);

  return (
    <div className="scalar-constraint-row">
      <label className="scalar-constraint-row__label">
        <span>{meta.label}</span>
      </label>
      <div className="constraint-value-input">
        <NumberStepperControl
          ariaLabel={meta.label}
          value={value}
          step={meta.step}
          min={meta.min}
          max={meta.max}
          onChange={(nextValue) => {
            projectStore
              .getState()
              .applyCommand(
                createSetScalarConstraintCommand(
                  constraintKey,
                  currentValue,
                  nextValue ?? value,
                ),
              );
          }}
        />
        <span>{meta.unit}</span>
      </div>
      <SidebarIconButton
        className="sidebar-icon-button--remove"
        onClick={() => {
          projectStore
            .getState()
            .applyCommand(
              createSetScalarConstraintCommand(
                constraintKey,
                currentValue,
                null,
              ),
            );
        }}
        aria-label={`Remove ${meta.label}`}
        title={`Remove ${meta.label}`}
      >
        <RemoveIcon size={16} />
      </SidebarIconButton>
    </div>
  );
}

function buildConstraintMenuItems(
  project: ProjectDocument,
): Array<{ key: ConstraintKey; label: string }> {
  return addConstraintMenuOrder.flatMap<{ key: ConstraintKey; label: string }>(
    (key) => {
      if (isRangedKey(key)) {
        const active = getRangedEntries(project, key).length > 0;

        if (!active) {
          return [{ key, label: rangedMeta[key].label }];
        }

        return canAddMoreRanged(project, key)
          ? [{ key, label: `${rangedMeta[key].label} (+)` }]
          : [];
      }

      if (project.path.constraints[key] !== null) {
        return [];
      }

      return [{ key, label: scalarMeta[key].label }];
    },
  );
}

function hasAnyConstraint(project: ProjectDocument): boolean {
  return (
    project.path.ranged_constraints.length > 0 ||
    constraintKeys.some(
      (key) => !isRangedKey(key) && project.path.constraints[key] !== null,
    )
  );
}

function countActiveConstraints(project: ProjectDocument): number {
  return (
    project.path.ranged_constraints.length +
    terminalToleranceKeys.filter(
      (key) => project.path.constraints[key] !== null,
    ).length
  );
}

function projectConfigSignature(project: ProjectDocument): string {
  const constraints = project.config.kinematic_constraints;
  return [
    constraints.default_auto_velocity_velocity_safety_factor,
    constraints.default_auto_velocity_acceleration_safety_factor,
    constraints.default_auto_velocity_merge_tolerance_meters_per_sec,
  ].join(":");
}

function constraintCountLabel(count: number): string {
  if (count === 0) {
    return "No path constraints";
  }

  return `${count} ${count === 1 ? "constraint" : "constraints"}`;
}

function constraintCardMeta(
  key: RangedConstraintKey,
  entryCount: number,
  domainTotal: number,
): string {
  if (key === autoVelocityKey) {
    const pathSegments = Math.max(0, domainTotal - 1);
    return `${entryCount} constrained, ${pathSegments} ${pathSegments === 1 ? "path segment" : "path segments"}`;
  }

  return `${entryCount} ${entryCount === 1 ? "segment" : "segments"} across ${domainTotal} ${
    domainTotal === 1 ? "element" : "elements"
  }`;
}

function addConstraint(
  project: ProjectDocument,
  key: ConstraintKey,
): AddedRangedConstraintSelection | null {
  if (isRangedKey(key)) {
    const index = addRangedConstraint(project, key);
    return index === null ? null : { key, index };
  }

  projectStore
    .getState()
    .applyCommand(
      createSetScalarConstraintCommand(
        key,
        project.path.constraints[key],
        defaultFor(project, key, scalarMeta[key].defaultValue),
      ),
    );
  return null;
}

function addRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
): number | null {
  if (key === autoVelocityKey) {
    const total = domainLabelsForKey(project, key).length;
    const ordinal = firstOpenVelocityOrdinal(project, total);
    return ordinal === null
      ? null
      : insertRangedConstraint(
          project,
          key,
          ordinal,
          ordinal,
          defaultFor(project, key, rangedMeta[key].defaultValue),
        );
  }

  const previousConstraints = project.path.ranged_constraints;
  projectStore
    .getState()
    .applyCommand(
      createAddRangedConstraintCommand(
        key,
        defaultFor(project, key, rangedMeta[key].defaultValue),
        domainLabelsForKey(project, key).length,
      ),
    );

  const nextProject = projectStore.getState().project;
  if (!nextProject) {
    return null;
  }

  return findAddedRangedConstraintIndex(
    previousConstraints,
    nextProject.path.ranged_constraints,
    key,
  );
}

function selectRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
  index: number,
): void {
  const constraint = project.path.ranged_constraints[index];
  if (!constraint || constraint.key !== key) {
    return;
  }

  selectionStore.getState().selectRangedConstraint(
    {
      key,
      index,
      startOrdinal: constraint.start_ordinal,
      endOrdinal: constraint.end_ordinal,
    },
    project,
  );
}

function previewRangedConstraint(
  key: RangedConstraintKey,
  index: number,
  constraint: RangedConstraint,
): void {
  if (constraint.key !== key) {
    return;
  }

  selectionStore.getState().selectRangedConstraint({
    key,
    index,
    startOrdinal: constraint.start_ordinal,
    endOrdinal: constraint.end_ordinal,
  });
}

function insertRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
  startOrdinal: number,
  endOrdinal: number,
  value: number,
): number | null {
  const total = domainLabelsForKey(project, key).length;
  const start = clampOrdinal(startOrdinal, total);
  const end = clampOrdinal(endOrdinal, total);
  const previousLength = project.path.ranged_constraints.length;

  projectStore.getState().applyCommand(
    createInsertRangedConstraintCommand({
      key,
      value,
      start_ordinal: Math.min(start, end),
      end_ordinal: Math.max(start, end),
    }),
  );

  const nextProject = projectStore.getState().project;
  return nextProject &&
    nextProject.path.ranged_constraints.length > previousLength
    ? nextProject.path.ranged_constraints.length - 1
    : null;
}

function updateRangedConstraint(
  project: ProjectDocument,
  index: number,
  next: RangedConstraint,
): void {
  const total = domainLabelsForKey(project, next.key).length;
  const previous = project.path.ranged_constraints[index];
  if (!previous) {
    return;
  }

  projectStore
    .getState()
    .applyCommand(
      createUpdateRangedConstraintCommand(
        index,
        previous,
        normalizeRangedConstraint(project, index, next, previous, total),
      ),
    );
}

function updateRangedConstraints(
  project: ProjectDocument,
  updates: RangeUpdate[],
): void {
  const commandUpdates = updates.flatMap((update) => {
    const previous = project.path.ranged_constraints[update.index];
    if (!previous) {
      return [];
    }

    const total = domainLabelsForKey(project, update.next.key).length;
    return [
      {
        index: update.index,
        previous,
        next: normalizeRangedConstraintBounds(update.next, total),
      },
    ];
  });

  if (commandUpdates.length > 0) {
    projectStore
      .getState()
      .applyCommand(createUpdateRangedConstraintsCommand(commandUpdates));
  }
}

function deleteRangedConstraint(project: ProjectDocument, index: number): void {
  const constraint = project.path.ranged_constraints[index];
  if (constraint) {
    projectStore
      .getState()
      .applyCommand(createRemoveRangedConstraintCommand(index, constraint));
    selectionStore.getState().clearRangedConstraintSelection();
  }
}

function splitRangedConstraint(project: ProjectDocument, index: number): void {
  projectStore
    .getState()
    .applyCommand(createSplitRangedConstraintCommand(index));
}

function runAutoVelocityAll(
  project: ProjectDocument,
  settings: AutoVelocitySettings,
): void {
  const profile = generateAutoVelocityProfile(
    project.path,
    project.config,
    autoVelocityOptionsFromSettings(settings),
  );
  applyAutoVelocityAll(project, profile, settings);
}

function applyAutoVelocityAll(
  project: ProjectDocument,
  profile: AutoVelocityProfile,
  settings: AutoVelocitySettings,
): void {
  const total = domainLabelsForKey(project, autoVelocityKey).length;
  const existing = ordinalConstraintMap(project, autoVelocityKey, total);
  const metadata = autoVelocityMetadataFromSettings(project, settings);

  for (const cap of profile.segmentCaps) {
    const current = existing.get(cap.targetOrdinal);
    if (current && current.source !== "auto_velocity") {
      continue;
    }

    existing.set(
      cap.targetOrdinal,
      autoVelocityConstraintForCap(cap, metadata),
    );
  }

  replaceVelocityConstraints(
    project,
    constraintsFromOrdinalMap(existing, total, settings.mergeToleranceMps),
    "Apply auto velocity",
  );
}

function clearAutoVelocity(project: ProjectDocument): void {
  const total = domainLabelsForKey(project, autoVelocityKey).length;
  const existing = ordinalConstraintMap(project, autoVelocityKey, total);

  for (const [ordinal, constraint] of existing) {
    if (constraint.source === "auto_velocity") {
      existing.delete(ordinal);
    }
  }

  replaceVelocityConstraints(
    project,
    constraintsFromOrdinalMap(existing, total),
    "Clear auto velocity",
  );
  selectionStore.getState().clearRangedConstraintSelection();
}

function applyVelocityMode(
  project: ProjectDocument,
  entry: RangedEntry,
  mode: "auto" | "manual",
  settings: AutoVelocitySettings,
  onSelect: (index: number) => void,
): void {
  const total = domainLabelsForKey(project, autoVelocityKey).length;
  const existing = ordinalConstraintMap(project, autoVelocityKey, total);
  const ordinals = ordinalsForConstraint(entry.constraint, total);
  const selectedOrdinals = new Set(ordinals);
  const profile = generateAutoVelocityProfile(
    project.path,
    project.config,
    autoVelocityOptionsFromSettings(settings),
  );
  const metadata = autoVelocityMetadataFromSettings(project, settings);
  const capsByOrdinal = new Map(
    profile.segmentCaps.map((cap) => [cap.targetOrdinal, cap]),
  );

  if (mode === "manual") {
    refreshExistingAutoVelocityCaps(
      existing,
      capsByOrdinal,
      metadata,
      selectedOrdinals,
    );
    for (const ordinal of ordinals) {
      existing.set(ordinal, {
        key: autoVelocityKey,
        value: entry.constraint.value,
        start_ordinal: ordinal,
        end_ordinal: ordinal,
      });
    }
    replaceVelocityConstraints(
      project,
      constraintsFromOrdinalMap(existing, total, settings.mergeToleranceMps),
      "Set manual velocity",
    );
    selectOrdinalAfterReplace(autoVelocityKey, ordinals[0], onSelect);
    return;
  }

  refreshExistingAutoVelocityCaps(existing, capsByOrdinal, metadata);
  for (const ordinal of ordinals) {
    const cap = capsByOrdinal.get(ordinal);
    if (cap) {
      existing.set(ordinal, autoVelocityConstraintForCap(cap, metadata));
    }
  }
  replaceVelocityConstraints(
    project,
    constraintsFromOrdinalMap(existing, total, settings.mergeToleranceMps),
    "Set auto velocity",
  );
  selectOrdinalAfterReplace(autoVelocityKey, ordinals[0], onSelect);
}

function refreshExistingAutoVelocityCaps(
  existing: Map<number, RangedConstraint>,
  capsByOrdinal: ReadonlyMap<number, AutoVelocitySegmentCap>,
  metadata: AutoVelocityConstraintMetadata,
  skippedOrdinals = new Set<number>(),
): void {
  for (const [ordinal, constraint] of existing) {
    if (constraint.source !== "auto_velocity" || skippedOrdinals.has(ordinal)) {
      continue;
    }

    const cap = capsByOrdinal.get(ordinal);
    if (cap) {
      existing.set(ordinal, autoVelocityConstraintForCap(cap, metadata));
    }
  }
}

function replaceVelocityConstraints(
  project: ProjectDocument,
  nextVelocityConstraints: readonly RangedConstraint[],
  description: string,
): void {
  projectStore.getState().applyCommand(
    createReplaceRangedConstraintsForKeyCommand(
      autoVelocityKey,
      project.path.ranged_constraints.filter(
        (constraint) => constraint.key === autoVelocityKey,
      ),
      nextVelocityConstraints,
      description,
    ),
  );
}

function selectOrdinalAfterReplace(
  key: RangedConstraintKey,
  ordinal: number | undefined,
  onSelect: (index: number) => void,
): void {
  if (ordinal === undefined) {
    return;
  }

  const nextProject = projectStore.getState().project;
  if (!nextProject) {
    return;
  }

  const index = nextProject.path.ranged_constraints.findIndex(
    (constraint) =>
      constraint.key === key && ordinalInRange(ordinal, constraint),
  );
  if (index >= 0) {
    onSelect(index);
  }
}

function ordinalConstraintMap(
  project: ProjectDocument,
  key: RangedConstraintKey,
  total: number,
): Map<number, RangedConstraint> {
  const map = new Map<number, RangedConstraint>();

  for (const constraint of project.path.ranged_constraints) {
    if (constraint.key !== key) {
      continue;
    }

    for (const ordinal of ordinalsForConstraint(constraint, total)) {
      map.set(ordinal, {
        ...constraint,
        source:
          constraint.source === "auto_velocity" ? "auto_velocity" : undefined,
        auto_velocity:
          constraint.source === "auto_velocity"
            ? (constraint.auto_velocity ?? null)
            : null,
        start_ordinal: ordinal,
        end_ordinal: ordinal,
      });
    }
  }

  return map;
}

function constraintsFromOrdinalMap(
  map: ReadonlyMap<number, RangedConstraint>,
  total: number,
  autoMergeToleranceMps = 0,
): RangedConstraint[] {
  const constraints: RangedConstraint[] = [];

  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    const constraint = map.get(ordinal);
    if (!constraint) {
      continue;
    }

    const last = constraints.at(-1);
    if (
      last &&
      canMergeOrdinalConstraint(
        last,
        constraint,
        ordinal,
        autoMergeToleranceMps,
      )
    ) {
      last.value = mergedOrdinalConstraintValue(last, constraint);
      last.end_ordinal = ordinal;
      continue;
    }

    constraints.push({
      ...constraint,
      start_ordinal: ordinal,
      end_ordinal: ordinal,
    });
  }

  return constraints;
}

function canMergeOrdinalConstraint(
  previous: RangedConstraint,
  next: RangedConstraint,
  nextOrdinal: number,
  autoMergeToleranceMps: number,
): boolean {
  const valuesMatch =
    previous.source === "auto_velocity" &&
    next.source === "auto_velocity" &&
    previous.key === autoVelocityKey
      ? Math.abs(previous.value - next.value) <= autoMergeToleranceMps
      : previous.value === next.value;

  return (
    previous.end_ordinal === nextOrdinal - 1 &&
    previous.key === next.key &&
    valuesMatch &&
    previous.source === next.source &&
    sameAutoVelocityMetadata(previous.auto_velocity, next.auto_velocity)
  );
}

function mergedOrdinalConstraintValue(
  previous: RangedConstraint,
  next: RangedConstraint,
): number {
  return previous.source === "auto_velocity" && next.source === "auto_velocity"
    ? Math.min(previous.value, next.value)
    : previous.value;
}

function ordinalsForConstraint(
  constraint: RangedConstraint,
  total: number,
): number[] {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  const ordinals: number[] = [];
  for (
    let ordinal = Math.min(start, end);
    ordinal <= Math.max(start, end);
    ordinal += 1
  ) {
    ordinals.push(ordinal);
  }
  return ordinals;
}

function hasAutoVelocityConstraints(project: ProjectDocument): boolean {
  return project.path.ranged_constraints.some(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
}

function autoVelocitySettingsFromProject(
  project: ProjectDocument,
): AutoVelocitySettings {
  const metadata = project.path.ranged_constraints.find(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  )?.auto_velocity;
  const configDefaults = autoVelocitySettingsFromConfig(project);

  return {
    velocitySafetyFactor:
      metadata?.velocity_safety_factor ?? configDefaults.velocitySafetyFactor,
    accelerationSafetyFactor:
      metadata?.acceleration_safety_factor ??
      configDefaults.accelerationSafetyFactor,
    mergeToleranceMps:
      metadata?.merge_tolerance_meters_per_sec ??
      configDefaults.mergeToleranceMps,
  };
}

function autoVelocitySettingsFromConfig(
  project: ProjectDocument,
): AutoVelocitySettings {
  return {
    velocitySafetyFactor:
      getDefaultOptionalConfigValue(
        project.config,
        "auto_velocity_velocity_safety_factor",
      ) ?? defaultAutoVelocitySettings.velocitySafetyFactor,
    accelerationSafetyFactor:
      getDefaultOptionalConfigValue(
        project.config,
        "auto_velocity_acceleration_safety_factor",
      ) ?? defaultAutoVelocitySettings.accelerationSafetyFactor,
    mergeToleranceMps:
      getDefaultOptionalConfigValue(
        project.config,
        "auto_velocity_merge_tolerance_meters_per_sec",
      ) ?? defaultAutoVelocitySettings.mergeToleranceMps,
  };
}

function autoVelocityOptionsFromSettings(settings: AutoVelocitySettings) {
  return {
    velocitySafetyFactor: settings.velocitySafetyFactor,
    accelerationSafetyFactor: settings.accelerationSafetyFactor,
  };
}

function autoVelocityStatusForProject(
  project: ProjectDocument,
  settings: AutoVelocitySettings,
): AutoVelocityStatus {
  const currentSignature = autoVelocityInputSignature(
    project.path,
    project.config,
    autoVelocityOptionsFromSettings(settings),
  );
  const expectedMetadata = autoVelocityMetadataFromSettings(project, settings);
  const autoConstraints = project.path.ranged_constraints.filter(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
  const stale =
    autoConstraints.length === 0 ||
    autoConstraints.some(
      (constraint) =>
        !currentSignature ||
        constraint.auto_velocity?.input_signature !== currentSignature ||
        !autoVelocityMetadataMatchesSettings(
          constraint.auto_velocity,
          expectedMetadata,
        ),
    );

  return {
    currentSignature,
    expectedMetadata,
    autoConstraintCount: autoConstraints.length,
    hasAutoConstraints: autoConstraints.length > 0,
    stale,
  };
}

function autoVelocityStatusIsCurrent(status: AutoVelocityStatus): boolean {
  return status.hasAutoConstraints && !status.stale;
}

function autoVelocityStatusTooltip(status: AutoVelocityStatus): string {
  if (autoVelocityStatusIsCurrent(status)) {
    return "Optimizer is up to date for the current path, handoff radii, rotation constraints, and auto-velocity settings. Click to rerun it.";
  }
  return "Optimizer is stale or has not been run for the current path/settings. Click to rerun it and update auto velocity caps.";
}

function autoVelocityMetadataFromSettings(
  project: ProjectDocument,
  settings: AutoVelocitySettings,
): AutoVelocityConstraintMetadata {
  return {
    velocity_safety_factor: settings.velocitySafetyFactor,
    acceleration_safety_factor: settings.accelerationSafetyFactor,
    merge_tolerance_meters_per_sec: settings.mergeToleranceMps,
    input_signature:
      autoVelocityInputSignature(
        project.path,
        project.config,
        autoVelocityOptionsFromSettings(settings),
      ) ?? undefined,
  };
}

function autoVelocityStateForConstraint(
  constraint: RangedConstraint,
  status: AutoVelocityStatus | null | undefined,
): { stale: boolean; warning: boolean } {
  if (
    constraint.key !== autoVelocityKey ||
    constraint.source !== "auto_velocity"
  ) {
    return { stale: false, warning: false };
  }

  return {
    stale:
      !status?.currentSignature ||
      constraint.auto_velocity?.input_signature !== status.currentSignature ||
      !autoVelocityMetadataMatchesSettings(
        constraint.auto_velocity,
        status.expectedMetadata,
      ),
    warning: false,
  };
}

function autoVelocityMetadataMatchesSettings(
  metadata: AutoVelocityConstraintMetadata | null | undefined,
  expected: AutoVelocityConstraintMetadata,
): boolean {
  return (
    !!metadata &&
    nearlyEqual(
      metadata.velocity_safety_factor,
      expected.velocity_safety_factor,
    ) &&
    nearlyEqual(
      metadata.acceleration_safety_factor,
      expected.acceleration_safety_factor,
    ) &&
    nearlyEqual(
      metadata.merge_tolerance_meters_per_sec ??
        defaultAutoVelocityMergeToleranceMetersPerSec,
      expected.merge_tolerance_meters_per_sec ??
        defaultAutoVelocityMergeToleranceMetersPerSec,
    )
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function rangedConstraintStateForConstraint(
  project: ProjectDocument,
  constraint: RangedConstraint,
  autoStatus: AutoVelocityStatus | null | undefined,
): { stale: boolean; autoWarning: boolean; globalWarning: boolean } {
  const autoState = autoVelocityStateForConstraint(constraint, autoStatus);
  const globalLimit = globalLimitForRangedConstraint(project, constraint.key);
  const globalWarning =
    globalLimit !== null &&
    constraint.value > globalLimit + constraintWarningTolerance(constraint.key);

  return {
    stale: autoState.stale,
    autoWarning: autoState.warning,
    globalWarning,
  };
}

function globalLimitForRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
): number | null {
  const pathValue = project.path.constraints[key];
  if (
    typeof pathValue === "number" &&
    Number.isFinite(pathValue) &&
    pathValue > 0
  ) {
    return pathValue;
  }

  const configured = getDefaultOptionalConfigValue(project.config, key);
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }

  const fallback = rangedMeta[key].defaultValue;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function constraintWarningTolerance(key: RangedConstraintKey): number {
  return Math.max(rangedMeta[key].step / 20, 1e-6);
}

function sameAutoVelocityMetadata(
  left: RangedConstraint["auto_velocity"],
  right: RangedConstraint["auto_velocity"],
): boolean {
  if (!left && !right) {
    return true;
  }

  return (
    Boolean(left) &&
    Boolean(right) &&
    left?.velocity_safety_factor === right?.velocity_safety_factor &&
    left?.acceleration_safety_factor === right?.acceleration_safety_factor &&
    left?.merge_tolerance_meters_per_sec ===
      right?.merge_tolerance_meters_per_sec
  );
}

function getRangedEntries(
  project: ProjectDocument,
  key: RangedConstraintKey,
): RangedEntry[] {
  return project.path.ranged_constraints
    .map((constraint, index) => ({ constraint, index }))
    .filter(({ constraint }) => constraint.key === key)
    .sort(
      (left, right) =>
        left.constraint.start_ordinal - right.constraint.start_ordinal,
    );
}

function findAddedRangedConstraintIndex(
  previousConstraints: readonly RangedConstraint[],
  nextConstraints: readonly RangedConstraint[],
  key: RangedConstraintKey,
): number | null {
  const previousForKey = previousConstraints.filter(
    (constraint) => constraint.key === key,
  );
  const unmatched = nextConstraints.flatMap((constraint, index) => {
    if (constraint.key !== key) {
      return [];
    }

    return previousForKey.some((previous) =>
      sameRangedConstraint(previous, constraint),
    )
      ? []
      : [index];
  });

  return unmatched.at(-1) ?? null;
}

function sameRangedConstraint(
  left: RangedConstraint,
  right: RangedConstraint,
): boolean {
  return (
    left.key === right.key &&
    left.value === right.value &&
    left.start_ordinal === right.start_ordinal &&
    left.end_ordinal === right.end_ordinal &&
    left.source === right.source &&
    sameAutoVelocityMetadata(left.auto_velocity, right.auto_velocity)
  );
}

function chooseSelectedEntry(
  entries: RangedEntry[],
  selectedIndex: number | null,
): RangedEntry | null {
  if (entries.length === 0) {
    return null;
  }

  if (selectedIndex === null) {
    return null;
  }

  if (selectedIndex < 0) {
    return null;
  }

  return entries.find((entry) => entry.index === selectedIndex) ?? null;
}

function domainLabelsForKey(
  project: ProjectDocument,
  key: RangedConstraintKey,
): string[] {
  const domainElements = domainForKey(key, project.path.path_elements);
  const counts: Record<string, number> = {
    translation: 0,
    waypoint: 0,
    rotation: 0,
    event_trigger: 0,
  };

  return domainElements.map((element) => {
    counts[element.type] = (counts[element.type] ?? 0) + 1;

    switch (element.type) {
      case "translation":
        return `T${counts.translation}`;
      case "waypoint":
        return `W${counts.waypoint}`;
      case "rotation":
        return `R${counts.rotation}`;
      case "event_trigger":
        return `E${counts.event_trigger}`;
    }
  });
}

function canAddMoreRanged(
  project: ProjectDocument,
  key: RangedConstraintKey,
): boolean {
  const total = domainLabelsForKey(project, key).length;

  if (total <= 0) {
    return false;
  }

  const entries = getRangedEntries(project, key);
  const covered = new Set<number>();

  for (const { constraint } of entries) {
    for (
      let ordinal = constraint.start_ordinal;
      ordinal <= constraint.end_ordinal;
      ordinal += 1
    ) {
      covered.add(ordinal);
    }
  }

  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    if (!covered.has(ordinal)) {
      return true;
    }
  }

  return entries.some(({ constraint }) => canSplit(constraint));
}

function firstOpenVelocityOrdinal(
  project: ProjectDocument,
  total: number,
): number | null {
  const entries = getRangedEntries(project, autoVelocityKey);
  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    if (
      !entries.some(({ constraint }) => ordinalInRange(ordinal, constraint))
    ) {
      return ordinal;
    }
  }

  return null;
}

function contiguousGap(
  entries: RangedEntry[],
  total: number,
  ordinal: number,
): { start: number; end: number } | null {
  if (entries.some(({ constraint }) => ordinalInRange(ordinal, constraint))) {
    return null;
  }

  let start = ordinal;
  let end = ordinal;

  while (
    start > 1 &&
    !entries.some(({ constraint }) => ordinalInRange(start - 1, constraint))
  ) {
    start -= 1;
  }

  while (
    end < total &&
    !entries.some(({ constraint }) => ordinalInRange(end + 1, constraint))
  ) {
    end += 1;
  }

  return { start, end };
}

function ordinalInRange(
  ordinal: number,
  constraint: RangedConstraint,
): boolean {
  return (
    ordinal >= constraint.start_ordinal && ordinal <= constraint.end_ordinal
  );
}

function initialPopoutPosition(): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left: 24, top: 72 };
  }

  const estimatedWidth = Math.min(760, window.innerWidth - 32);
  return {
    left: Math.max(16, window.innerWidth - estimatedWidth - 20),
    top: 72,
  };
}

function rangeLabel(labels: string[], constraint: RangedConstraint): string {
  const startLabel =
    labels[constraint.start_ordinal - 1] ?? String(constraint.start_ordinal);
  const endLabel =
    labels[constraint.end_ordinal - 1] ?? String(constraint.end_ordinal);

  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`;
}

function rangedSelectionToken(key: RangedConstraintKey, index: number): string {
  return `${key}-${index}`;
}

function canSplit(constraint: RangedConstraint): boolean {
  return constraint.end_ordinal > constraint.start_ordinal;
}

function normalizeRangedConstraint(
  project: ProjectDocument,
  index: number,
  constraint: RangedConstraint,
  previous: RangedConstraint,
  total: number,
): RangedConstraint {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  const [lowerBound, upperBound] = editableRangeBounds(
    project,
    index,
    previous,
    total,
  );
  const boundedStart = clamp(start, lowerBound, upperBound);
  const boundedEnd = clamp(end, lowerBound, upperBound);

  return {
    ...constraint,
    start_ordinal: Math.min(boundedStart, boundedEnd),
    end_ordinal: Math.max(boundedStart, boundedEnd),
  };
}

function normalizeRangedConstraintBounds(
  constraint: RangedConstraint,
  total: number,
): RangedConstraint {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  return {
    ...constraint,
    start_ordinal: Math.min(start, end),
    end_ordinal: Math.max(start, end),
  };
}

function editableRangeBounds(
  project: ProjectDocument,
  index: number,
  previous: RangedConstraint,
  total: number,
): [number, number] {
  let lowerBound = 1;
  let upperBound = Math.max(1, total);

  for (const { constraint, index: siblingIndex } of getRangedEntries(
    project,
    previous.key,
  )) {
    if (siblingIndex === index) {
      continue;
    }

    if (constraint.end_ordinal < previous.start_ordinal) {
      lowerBound = Math.max(lowerBound, constraint.end_ordinal + 1);
    }

    if (constraint.start_ordinal > previous.end_ordinal) {
      upperBound = Math.min(upperBound, constraint.start_ordinal - 1);
    }
  }

  if (lowerBound > upperBound) {
    return [previous.start_ordinal, previous.end_ordinal];
  }

  return [lowerBound, upperBound];
}

function clampOrdinal(value: number, total: number): number {
  if (total <= 0) {
    return 1;
  }

  return Math.max(1, Math.min(total, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function defaultFor(
  project: ProjectDocument,
  key: ConstraintKey,
  fallback: number,
): number {
  const pathValue = project.path.constraints[key];
  if (typeof pathValue === "number" && Number.isFinite(pathValue)) {
    return pathValue;
  }

  const configured = getDefaultOptionalConfigValue(project.config, key);
  return typeof configured === "number" ? configured : fallback;
}

function isRangedKey(key: ConstraintKey): key is RangedConstraintKey {
  return rangedConstraintKeys.includes(key as RangedConstraintKey);
}

function constraintIconType(
  key: ConstraintKey,
): "translation" | "waypoint" | "rotation" {
  if (
    key === "max_velocity_deg_per_sec" ||
    key === "max_acceleration_deg_per_sec2"
  ) {
    return "rotation";
  }

  if (
    key === "end_translation_tolerance_meters" ||
    key === "end_rotation_tolerance_deg"
  ) {
    return "waypoint";
  }

  return "translation";
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatSegmentValue(value: number, unit: string): string {
  return `${formatSegmentNumber(value)} ${unit}`;
}

function formatSegmentNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Number(value.toFixed(2)).toString();
}
