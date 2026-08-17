import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";

import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityMergeToleranceMetersPerSec,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../../../core/config/projectConfig";
import {
  autoConstraintLargePathWarningBudget,
  autoRadiiCapSearchPlan,
} from "../../../core/constraints/autoConstraintGeneration";
import {
  autoVelocityConstraintForCap,
  autoVelocityInputSignature,
  generateAutoVelocityProfile,
  type AutoVelocitySegmentCap,
} from "../../../core/constraints/autoVelocityConstraints";
import {
  autoVelocityConstraintsByOrdinal,
  autoVelocityConstraintsFromOrdinalMap,
  autoVelocitySettingsForPath,
  type AutoVelocitySettings,
} from "../../../core/constraints/autoVelocityApply";
import {
  createSetHandoffRadiusCommand,
  createSetHandoffRadiiCommand,
  type HandoffRadiusState,
} from "../../../canvas/modelSync";
import {
  domainForKey,
  ordinalsForConstraint,
} from "../../../core/constraints/rangedConstraints";
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
import { autoVelocityStore } from "../../../state/autoVelocityStore";
import { generateAutoConstraintsInWorker } from "../../../state/autoConstraintGeneration";
import { projectStore } from "../../../state/projectStore";
import { selectionStore } from "../../../state/selectionStore";
import { useStoreSelector } from "../../../state/react";
import {
  CloseButton,
  SidebarActionButton,
  SidebarIconButton,
  NumberStepperControl,
} from "../../controls";
import { ElementIcon, PlusIcon, RemoveIcon, WarningIcon } from "../../icons";
import {
  cloneRangedEntries,
  hitTestRangeBoundary,
  hitTestRangeSegment,
  moveRangedSegment,
  resizeRangedSegment,
  type RangeBoundary,
  type RangedEntry,
} from "../rangedConstraintDrag";
import {
  orderedSelectionGesture,
  updateOrderedSelection,
  type OrderedSelectionGesture,
  type OrderedSelectionState,
} from "../orderedSelection";
import { SidebarSection } from "../SidebarSection";
import {
  canClearGeneratedConstraints,
  canGenerateConstraints,
  createAddRangedConstraintCommand,
  createClearGeneratedConstraintsCommand,
  createInsertRangedConstraintCommand,
  createRemoveRangedConstraintCommand,
  createReplaceRangedConstraintsForKeyCommand,
  createSetScalarConstraintCommand,
  createSplitRangedConstraintCommand,
  createUpdateRangedConstraintCommand,
  createUpdateRangedConstraintsCommand,
  handoffRadiusChipsForPath,
  type HandoffRadiusChip,
} from "../sidebarCommands";

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

type AddConstraintMenuItem = {
  key: ConstraintKey;
  label: string;
};

type AddConstraintMenuSection = {
  id: string;
  label: string;
  keys: readonly ConstraintKey[];
};

type AutoVelocityStatus = {
  currentSignature: string | null;
  expectedMetadata: AutoVelocityConstraintMetadata;
  autoConstraintCount: number;
  hasAutoConstraints: boolean;
  stale: boolean;
};

type AutoVelocityTaskRunner = (task: () => void) => void;

const rangedMeta: Record<RangedConstraintKey, RangedMeta> = {
  max_velocity_meters_per_sec: {
    label: "Max Velocity",
    unit: "m/s",
    defaultValue: 4.5,
    step: 0.1,
    min: 0,
    max: 20,
  },
  min_velocity_meters_per_sec: {
    label: "Min Velocity",
    unit: "m/s",
    defaultValue: 0.5,
    step: 0.05,
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
  min_velocity_deg_per_sec: {
    label: "Min Rot Velocity",
    unit: "deg/s",
    defaultValue: 45,
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

const addConstraintMenuSections: readonly AddConstraintMenuSection[] = [
  {
    id: "translation",
    label: "Translation",
    keys: [
      "max_velocity_meters_per_sec",
      "max_acceleration_meters_per_sec2",
      "min_velocity_meters_per_sec",
    ],
  },
  {
    id: "rotation",
    label: "Rotation",
    keys: [
      "max_velocity_deg_per_sec",
      "max_acceleration_deg_per_sec2",
      "min_velocity_deg_per_sec",
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    keys: [...terminalToleranceKeys],
  },
];

const autoVelocityKey = "max_velocity_meters_per_sec";
type NonAutoRangedConstraintKey = Exclude<
  RangedConstraintKey,
  typeof autoVelocityKey
>;
const handoffRadiusStep = 0.05;
// The property pane says the same thing about the final anchor; the first one is
// inert for the mirror-image reason, so both endpoints explain themselves here.
const startAnchorHandoffNote =
  "Not used on the first element — a handoff happens at the anchor a segment drives to, and nothing drives to the start.";
const finalAnchorHandoffNote =
  "Not used on the final element — the path finishes here by tolerance, not by a handoff.";
const minimumConstraintWarning =
  "Minimum constraints are an advanced tuning feature for paths where the translation PID controller may be undertuned near the end of a path. They are not recommended for most users.";
const minimumConflictWarningTitle =
  "Above max constraint; BLine will use the global default and disable the minimum baseline.";
const minimumConstraintTooltipDelayMs = 1000;
const defaultAutoVelocitySettings: AutoVelocitySettings = {
  velocitySafetyFactor: defaultAutoVelocityVelocitySafetyFactor,
  accelerationSafetyFactor: defaultAutoVelocityAccelerationSafetyFactor,
  mergeToleranceMps: defaultAutoVelocityMergeToleranceMetersPerSec,
};

export function ConstraintEditor({
  project,
  open,
}: {
  project: ProjectDocument | null;
  open: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDetailsElement | null>(null);
  const menuSummaryRef = useRef<HTMLElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const [menuPanelStyle, setMenuPanelStyle] = useState<CSSProperties>();
  const [popoutKey, setPopoutKey] = useState<RangedConstraintKey | null>(null);
  const popoutTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectedByKey, setSelectedByKey] = useState<
    Partial<Record<RangedConstraintKey, number>>
  >({});
  const [manualRunActive, setManualRunActive] = useState(false);
  const autoVelocityRunningRef = useRef(false);
  const syncPhase = useStoreSelector(autoVelocityStore, (state) => state.phase);
  // The background sync and the Generate button drive the same optimizer, so
  // the card locks for either.
  const autoVelocityRunning = manualRunActive || syncPhase === "running";
  const autoSettings = project
    ? autoVelocitySettingsForPath(project.path, project.config)
    : defaultAutoVelocitySettings;
  const runAutoVelocityTask: AutoVelocityTaskRunner = (task) => {
    if (autoVelocityRunningRef.current) {
      return;
    }

    autoVelocityRunningRef.current = true;
    setManualRunActive(true);
    runAfterBrowserPaint(task, () => {
      autoVelocityRunningRef.current = false;
      setManualRunActive(false);
    });
  };
  const generateAutoVelocity = () => {
    void generateAutoConstraintsInWorker(autoSettings);
  };
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint,
  );
  const availableSections = useMemo(
    () => (project ? buildConstraintMenuSections(project) : []),
    [project],
  );
  const availableItemCount = availableSections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  useLayoutEffect(() => {
    if (!menuOpen) {
      return;
    }

    const summary = menuSummaryRef.current;
    const panel = menuPanelRef.current;
    if (!summary || !panel) {
      return;
    }

    const updatePanelPosition = () => {
      const viewportPadding = 12;
      const menuGap = 6;
      const maxMenuHeight = 360;
      const minimumUsableHeight = 96;
      const summaryRect = summary.getBoundingClientRect();
      const preferredHeight = Math.min(panel.scrollHeight, maxMenuHeight);
      const spaceBelow =
        window.innerHeight - summaryRect.bottom - menuGap - viewportPadding;
      const spaceAbove = summaryRect.top - menuGap - viewportPadding;
      const openBelow =
        spaceBelow >= preferredHeight || spaceBelow >= spaceAbove;
      const availableSpace = Math.max(
        minimumUsableHeight,
        Math.min(maxMenuHeight, openBelow ? spaceBelow : spaceAbove),
      );
      const panelHeight = Math.min(preferredHeight, availableSpace);
      const top = openBelow
        ? Math.min(
            summaryRect.bottom + menuGap,
            window.innerHeight - viewportPadding - panelHeight,
          )
        : Math.max(viewportPadding, summaryRect.top - menuGap - panelHeight);
      const right = Math.max(
        viewportPadding,
        window.innerWidth - summaryRect.right,
      );

      setMenuPanelStyle({
        maxHeight: `${Math.round(availableSpace)}px`,
        right: `${Math.round(right)}px`,
        top: `${Math.round(top)}px`,
      });
    };

    const animationFrame = window.requestAnimationFrame(updatePanelPosition);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [availableItemCount, menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const closeMenuIfOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRootRef.current?.contains(target)) {
        return;
      }

      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenuIfOutside, true);

    return () => {
      document.removeEventListener("pointerdown", closeMenuIfOutside, true);
    };
  }, [menuOpen]);

  const setSelectedForKey = (key: RangedConstraintKey, index: number) => {
    setSelectedByKey((selected) => ({ ...selected, [key]: index }));
    const latestProject = projectStore.getState().project ?? project;
    if (latestProject) {
      selectRangedConstraint(latestProject, key, index);
    }
  };

  const openPopout = (key: RangedConstraintKey, trigger: HTMLButtonElement) => {
    popoutTriggerRef.current = trigger;
    setPopoutKey(key);
  };

  const closePopout = () => {
    setPopoutKey(null);
    window.requestAnimationFrame(() => popoutTriggerRef.current?.focus());
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
      if (target instanceof Element) {
        const clickedRange = target.closest<HTMLElement>(
          "[data-ranged-constraint-key]",
        );
        if (
          target.closest(
            `[data-ranged-constraint-selection="${selectedToken}"]`,
          ) ||
          clickedRange?.dataset.rangedConstraintKey ===
            selectedRangedConstraint.key
        ) {
          return;
        }
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
    popoutKey && project
      ? createPortal(
          <ConstraintPopout
            project={project}
            constraintKey={popoutKey}
            selectedByKey={selectedByKey}
            autoSettings={autoSettings}
            autoVelocityRunning={autoVelocityRunning}
            runAutoVelocityTask={runAutoVelocityTask}
            onGenerateAutoVelocity={generateAutoVelocity}
            onSelect={setSelectedForKey}
            onClose={closePopout}
          />,
          document.body,
        )
      : null;

  return (
    <>
      <SidebarSection
        className="constraints-section"
        headerless
        open={open}
        sectionId="constraints"
        title="Constraints"
      >
        <div className="constraint-list">
          {project ? (
            <>
              {rangedConstraintKeys.map((key) =>
                key === autoVelocityKey ? (
                  <AutoConstraintLedgerCard
                    key={`${project.project_id}-${key}-${projectConfigSignature(project)}`}
                    project={project}
                    selectedIndex={selectedByKey[key] ?? null}
                    autoSettings={autoSettings}
                    autoVelocityRunning={autoVelocityRunning}
                    runAutoVelocityTask={runAutoVelocityTask}
                    onGenerateAutoVelocity={generateAutoVelocity}
                    onSelect={(index) => setSelectedForKey(key, index)}
                    onOpenPopout={(trigger) => openPopout(key, trigger)}
                  />
                ) : (
                  <RangedConstraintCard
                    key={`${project.project_id}-${key}-${projectConfigSignature(project)}`}
                    project={project}
                    constraintKey={key}
                    selectedIndex={selectedByKey[key] ?? null}
                    onSelect={(index) => setSelectedForKey(key, index)}
                    onOpenPopout={(trigger) => openPopout(key, trigger)}
                  />
                ),
              )}

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
                <p className="constraint-empty-state">No path limits added.</p>
              ) : null}
            </>
          ) : (
            <p className="constraint-empty-state">
              Open or create a project to edit limits.
            </p>
          )}
          <div
            className="constraint-add-surface"
            data-testid="constraint-add-surface"
          >
            <details
              ref={menuRootRef}
              className="add-element-menu add-constraint-menu"
              open={menuOpen}
            >
              <summary
                ref={menuSummaryRef}
                className={
                  project
                    ? "add-element-button"
                    : "add-element-button is-disabled"
                }
                role="button"
                aria-label="Add constraint"
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
                ref={menuPanelRef}
                className="add-element-menu__panel"
                role="menu"
                aria-label="Add constraint"
                style={menuPanelStyle}
              >
                {availableItemCount === 0 ? (
                  <p className="constraint-empty-state">
                    Everything is already active.
                  </p>
                ) : (
                  availableSections.map((section) => (
                    <div
                      key={section.id}
                      className="add-constraint-menu__section"
                      role="group"
                      aria-labelledby={`add-constraint-menu-${section.id}`}
                    >
                      <div
                        className="add-constraint-menu__section-label"
                        id={`add-constraint-menu-${section.id}`}
                      >
                        {section.label}
                      </div>
                      <div className="add-constraint-menu__section-items">
                        {section.items.map((item) => (
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
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </details>
          </div>
        </div>
      </SidebarSection>
      {popoutOverlay}
    </>
  );
}

/**
 * The optimizer's two outputs share one path-ordered ledger. Velocity ranges
 * occupy the left lane and handoff radii occupy the right lane, but their
 * selection and editing stay type-specific.
 */
function AutoConstraintLedgerCard({
  project,
  selectedIndex,
  autoSettings,
  autoVelocityRunning,
  runAutoVelocityTask,
  onGenerateAutoVelocity,
  onSelect,
  onOpenPopout,
}: {
  project: ProjectDocument;
  selectedIndex: number | null;
  autoSettings: AutoVelocitySettings;
  autoVelocityRunning: boolean;
  runAutoVelocityTask: AutoVelocityTaskRunner;
  onGenerateAutoVelocity(): void;
  onSelect: (index: number) => void;
  onOpenPopout(trigger: HTMLButtonElement): void;
}) {
  const constraintKey = autoVelocityKey;
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(
    () => domainLabelsForKey(project, constraintKey),
    [constraintKey, project],
  );
  const chips = useMemo(() => handoffRadiusChipsForPath(project), [project]);
  const autoStatus = useMemo(
    () => autoVelocityStatusForProject(project, autoSettings),
    [autoSettings, project],
  );
  const canGenerate = useMemo(() => canGenerateConstraints(project), [project]);
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const initialSelectedElementIndex =
    selectionStore.getState().selectedElementIndex;
  const initiallySelectedRadius = chips.some(
    (chip) => !chip.inert && chip.elementIndex === initialSelectedElementIndex,
  );
  const [activeType, setActiveType] = useState<"velocity" | "radius" | null>(
    initiallySelectedRadius ? "radius" : selectedEntry ? "velocity" : null,
  );
  const [velocitySelectionState, setVelocitySelectionState] =
    useState<OrderedSelectionState>(
      selectedEntry
        ? {
            anchorIndex: selectedEntry.index,
            focusIndex: selectedEntry.index,
            indexes: [selectedEntry.index],
          }
        : { anchorIndex: null, focusIndex: null, indexes: [] },
    );
  const availableIndexes = new Set(entries.map((entry) => entry.index));
  const reconciledVelocityIndexes = velocitySelectionState.indexes.filter(
    (index) => availableIndexes.has(index),
  );
  const velocitySelectionIsCurrent =
    velocitySelectionState.focusIndex === selectedIndex;
  const selectedIndexes =
    activeType !== "velocity" || !selectedEntry
      ? []
      : velocitySelectionIsCurrent && reconciledVelocityIndexes.length > 0
        ? reconciledVelocityIndexes
        : [selectedEntry.index];
  const selectedEntries = entries.filter((entry) =>
    selectedIndexes.includes(entry.index),
  );
  const selectVelocityEntry = (
    index: number,
    gesture: OrderedSelectionGesture = "replace",
  ) => {
    const nextSelection = updateOrderedSelection({
      orderedIndexes: entries.map((entry) => entry.index),
      selectedIndexes,
      anchorIndex:
        activeType === "velocity" && velocitySelectionIsCurrent
          ? velocitySelectionState.anchorIndex
          : (selectedEntry?.index ?? null),
      targetIndex: index,
      gesture,
    });
    setVelocitySelectionState(nextSelection);
    setActiveType("velocity");
    if (nextSelection.focusIndex === null) {
      setActiveType(null);
      selectionStore.getState().clearRangedConstraintSelection();
      return;
    }
    onSelect(nextSelection.focusIndex);
  };
  const selectedLocalIndex = selectedEntry
    ? entries.findIndex((entry) => entry.index === selectedEntry.index)
    : -1;
  const selectedSegmentNumber =
    selectedLocalIndex >= 0 ? selectedLocalIndex + 1 : 1;

  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex,
  );
  const [radiusSelectionState, setRadiusSelectionState] =
    useState<OrderedSelectionState>(
      initiallySelectedRadius && initialSelectedElementIndex !== null
        ? {
            anchorIndex: initialSelectedElementIndex,
            focusIndex: initialSelectedElementIndex,
            indexes: [initialSelectedElementIndex],
          }
        : { anchorIndex: null, focusIndex: null, indexes: [] },
    );
  const orderedRadiusIndexes = chips
    .filter((chip) => !chip.inert)
    .map((chip) => chip.elementIndex);
  const selectableRadiusIndexes = new Set(orderedRadiusIndexes);
  const radiusSelectionIsCurrent =
    radiusSelectionState.focusIndex === selectedElementIndex;
  const selectedElementIndexes = (
    activeType === "radius" && radiusSelectionIsCurrent
      ? radiusSelectionState.indexes
      : activeType === "radius" && selectedElementIndex !== null
        ? [selectedElementIndex]
        : []
  ).filter((index) => selectableRadiusIndexes.has(index));
  const selectedChips = chips.filter((chip) =>
    selectedElementIndexes.includes(chip.elementIndex),
  );
  const selectedChip =
    selectedChips.length === 1 ? (selectedChips[0] ?? null) : null;
  const total = labels.length;

  const selectRadiusChip = (
    chip: HandoffRadiusChip,
    gesture: OrderedSelectionGesture,
  ) => {
    const nextSelection = updateOrderedSelection({
      orderedIndexes: orderedRadiusIndexes,
      selectedIndexes: selectedElementIndexes,
      anchorIndex:
        activeType === "radius" && radiusSelectionIsCurrent
          ? radiusSelectionState.anchorIndex
          : selectedElementIndex,
      targetIndex: chip.elementIndex,
      gesture,
    });
    setRadiusSelectionState(nextSelection);
    setActiveType("radius");
    if (nextSelection.focusIndex === null) {
      setActiveType(null);
      selectionStore.getState().clearSelection();
      return;
    }
    const latestProject = projectStore.getState().project ?? project;
    selectionStore
      .getState()
      .selectElement(nextSelection.focusIndex, latestProject);
  };

  return (
    <article
      className="constraint-card constraint-card--auto-ledger"
      data-testid={`constraint-card-${constraintKey}`}
      data-tour="max-velocity-card"
      aria-label="Path constraints"
    >
      <div className="constraint-card__header constraint-card__header--auto constraint-card__header--auto-ledger">
        <AutoVelocityStatusIndicator
          status={autoStatus}
          running={autoVelocityRunning}
        />
        <div className="constraint-card__auto-actions">
          <SidebarActionButton
            onClick={onGenerateAutoVelocity}
            disabled={total === 0 || autoVelocityRunning || !canGenerate}
            aria-label="Generate constraints"
            title={
              !canGenerate && !autoVelocityRunning
                ? "Every handoff radius and velocity segment is set manually. Switch one to Auto to generate."
                : "Generate handoff radii and velocity constraints"
            }
          >
            Generate
          </SidebarActionButton>
          <SidebarActionButton
            onClick={() => clearGeneratedConstraints(project)}
            disabled={
              autoVelocityRunning || !canClearGeneratedConstraints(project)
            }
            aria-label="Clear generated constraints"
            title="Clear generated handoff radii and velocity constraints"
          >
            Clear
          </SidebarActionButton>
        </div>
      </div>

      {!autoVelocityRunning && !canGenerate ? (
        <p className="auto-velocity-hint" role="note">
          All values are set manually. Switch one to Auto to generate.
        </p>
      ) : entries.length === 0 && total > 0 ? (
        <p className="auto-velocity-hint" role="note">
          No caps yet, so this path drives at the global maximum. Generate
          proposes caps and radii from its shape.
        </p>
      ) : null}

      <AutoVelocityWorkloadWarning project={project} settings={autoSettings} />

      <div className="auto-constraint-ledger__legend" aria-label="Value modes">
        <span>
          <i className="auto-constraint-ledger__legend-sample is-auto" />
          Auto
        </span>
        <span>
          <i className="auto-constraint-ledger__legend-sample is-manual" />
          Manual
        </span>
      </div>

      <div
        className="auto-constraint-ledger"
        data-testid="auto-constraint-ledger"
      >
        <ConstraintSegmentBar
          project={project}
          constraintKey={constraintKey}
          entries={entries}
          labels={labels}
          unit={meta.unit}
          autoStatus={autoStatus}
          selectedIndex={
            activeType === "velocity" ? (selectedEntry?.index ?? null) : null
          }
          selectedIndexes={selectedIndexes}
          orientation="vertical"
          onSelect={selectVelocityEntry}
          onPreview={(index, constraint) => {
            previewRangedConstraint(constraintKey, index, constraint);
          }}
          onRangesChange={(updates) =>
            updateRangedConstraints(project, updates)
          }
          onGapDoubleClick={(start, end) => {
            const insertedIndex = insertRangedConstraint(
              project,
              constraintKey,
              start,
              end,
              defaultFor(project, constraintKey, meta.defaultValue),
            );
            if (insertedIndex !== null) {
              selectVelocityEntry(insertedIndex);
            }
          }}
        />
        <div
          className="handoff-radius-chips handoff-radius-chips--ledger"
          data-testid="constraint-card-handoff-radii"
          role="group"
          aria-label="Handoff radii"
          style={{
            gridTemplateRows: `repeat(${Math.max(total, 1)}, minmax(44px, 1fr))`,
          }}
        >
          {chips.map((chip) => (
            <HandoffRadiusChipButton
              key={chip.elementIndex}
              chip={chip}
              selected={selectedElementIndexes.includes(chip.elementIndex)}
              ledger
              style={{ gridRow: chip.ordinal }}
              onSelect={(gesture) => selectRadiusChip(chip, gesture)}
            />
          ))}
        </div>
      </div>

      {entries.length > 1 || chips.filter((chip) => !chip.inert).length > 1 ? (
        <p className="bulk-selection-hint">
          Shift-click selects a range · ⌘/Ctrl-click toggles values.
        </p>
      ) : null}

      {activeType === "radius" ? (
        selectedChips.length > 1 ? (
          <HandoffRadiusBulkControls
            chips={selectedChips}
            autoVelocityRunning={autoVelocityRunning}
            onClearSelection={() => {
              setRadiusSelectionState({
                anchorIndex: null,
                focusIndex: null,
                indexes: [],
              });
              setActiveType(null);
              selectionStore.getState().clearSelection();
            }}
          />
        ) : (
          <HandoffRadiusControls
            chip={selectedChip}
            autoVelocityRunning={autoVelocityRunning}
          />
        )
      ) : activeType === "velocity" ? (
        selectedEntries.length > 1 ? (
          <BulkRangedConstraintControls
            project={project}
            constraintKey={constraintKey}
            entries={selectedEntries}
            allEntries={entries}
            autoSettings={autoSettings}
            autoVelocityRunning={autoVelocityRunning}
            runAutoVelocityTask={runAutoVelocityTask}
            onClearSelection={() => {
              setVelocitySelectionState({
                anchorIndex: null,
                focusIndex: null,
                indexes: [],
              });
              setActiveType(null);
              selectionStore.getState().clearRangedConstraintSelection();
            }}
          />
        ) : (
          <RangedConstraintControls
            project={project}
            constraintKey={constraintKey}
            entry={selectedEntry}
            segmentNumber={selectedSegmentNumber}
            autoStatus={autoStatus}
            autoSettings={autoSettings}
            autoVelocityRunning={autoVelocityRunning}
            runAutoVelocityTask={runAutoVelocityTask}
            onSelect={(index) => selectVelocityEntry(index)}
            onOpenPopout={onOpenPopout}
          />
        )
      ) : (
        <div className="auto-constraint-ledger__empty" role="note">
          Select a speed or distance value to edit it.
        </div>
      )}
    </article>
  );
}

function RangedConstraintCard({
  project,
  constraintKey,
  selectedIndex,
  onSelect,
  onOpenPopout,
}: {
  project: ProjectDocument;
  constraintKey: NonAutoRangedConstraintKey;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onOpenPopout(trigger: HTMLButtonElement): void;
}) {
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(
    () => domainLabelsForKey(project, constraintKey),
    [project, constraintKey],
  );
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const [localSelectedIndexes, setLocalSelectedIndexes] = useState<number[]>(
    selectedEntry ? [selectedEntry.index] : [],
  );
  const availableIndexes = new Set(entries.map((entry) => entry.index));
  const reconciledLocalIndexes = localSelectedIndexes.filter((index) =>
    availableIndexes.has(index),
  );
  const selectedIndexes =
    selectedIndex === null
      ? []
      : reconciledLocalIndexes.length > 0
        ? reconciledLocalIndexes
        : selectedEntry
          ? [selectedEntry.index]
          : [];
  const selectedEntries = entries.filter((entry) =>
    selectedIndexes.includes(entry.index),
  );
  const selectEntry = (
    index: number,
    gesture: OrderedSelectionGesture = "replace",
  ) => {
    if (gesture !== "replace" && selectedIndexes.length > 0) {
      setLocalSelectedIndexes(
        selectedIndexes.includes(index)
          ? selectedIndexes
          : [...selectedIndexes, index],
      );
      return;
    }
    setLocalSelectedIndexes([index]);
    onSelect(index);
  };
  const selectedLocalIndex = selectedEntry
    ? entries.findIndex((entry) => entry.index === selectedEntry.index)
    : -1;

  if (entries.length === 0) {
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
        <div className="constraint-heading-row">
          <h3>{meta.label}</h3>
          {isMinimumVelocityConstraintKey(constraintKey) ? (
            <MinimumConstraintTooltip />
          ) : null}
        </div>
      </div>

      <ConstraintSegmentBar
        project={project}
        constraintKey={constraintKey}
        entries={entries}
        labels={labels}
        unit={meta.unit}
        selectedIndex={selectedEntry?.index ?? null}
        selectedIndexes={selectedIndexes}
        onSelect={selectEntry}
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
            selectEntry(insertedIndex);
          }
        }}
      />
      {entries.length > 1 ? (
        <p className="bulk-selection-hint">
          Shift-click segments to edit them together.
        </p>
      ) : null}

      {selectedEntries.length > 1 ? (
        <BulkRangedConstraintControls
          project={project}
          constraintKey={constraintKey}
          entries={selectedEntries}
          allEntries={entries}
          onClearSelection={() => {
            setLocalSelectedIndexes([]);
            selectionStore.getState().clearRangedConstraintSelection();
          }}
        />
      ) : (
        <RangedConstraintControls
          project={project}
          constraintKey={constraintKey}
          entry={selectedEntry}
          segmentNumber={selectedSegmentNumber}
          onSelect={onSelect}
          onOpenPopout={onOpenPopout}
        />
      )}
    </article>
  );
}

function HandoffRadiusChipButton({
  chip,
  selected,
  ledger = false,
  style,
  onSelect,
}: {
  chip: HandoffRadiusChip;
  selected: boolean;
  ledger?: boolean;
  style?: CSSProperties;
  onSelect(gesture: OrderedSelectionGesture): void;
}) {
  return (
    <button
      type="button"
      className={[
        "handoff-radius-chip",
        `handoff-radius-chip--${chip.state}`,
        ledger ? "handoff-radius-chip--ledger" : "",
        selected ? "is-selected" : "",
        chip.inert ? "is-inert" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`handoff-radius-chip-${chip.elementIndex}`}
      disabled={chip.inert}
      style={style}
      aria-pressed={selected}
      aria-label={`Handoff radius ${chip.ordinal}, ${formatSegmentNumber(
        chip.effectiveValueMeters,
      )} m`}
      title={handoffRadiusChipTitle(chip)}
      onClick={(event) => onSelect(orderedSelectionGesture(event))}
    >
      {chip.inert ? null : (
        <span className="handoff-radius-chip__value">
          {formatSegmentNumber(chip.effectiveValueMeters)} m
        </span>
      )}
    </button>
  );
}

function HandoffRadiusBulkControls({
  chips,
  autoVelocityRunning,
  onClearSelection,
}: {
  chips: readonly HandoffRadiusChip[];
  autoVelocityRunning: boolean;
  onClearSelection(): void;
}) {
  const modes = new Set(chips.map((chip) => chip.state));
  const mode =
    modes.size === 1 && !modes.has("unset")
      ? (chips[0]?.state as "auto" | "manual")
      : null;
  const firstValue = chips[0]?.effectiveValueMeters ?? null;
  const commonValue =
    firstValue !== null &&
    chips.every(
      (chip) => Math.abs(chip.effectiveValueMeters - firstValue) < 1e-9,
    )
      ? firstValue
      : null;

  return (
    <div
      className="ranged-constraint-controls"
      data-testid="handoff-radius-bulk-detail"
    >
      <div className="ranged-constraint-controls__fields">
        <p className="bulk-selection-summary">{chips.length} radii selected</p>
        <AutoVelocityModeControl
          ariaLabel="Selected handoff radius mode"
          disabled={autoVelocityRunning}
          mode={mode}
          onModeChange={(nextMode) => setHandoffRadiusModes(chips, nextMode)}
        />
        <label className="ranged-constraint-controls__value">
          <span>Set all values</span>
          <div className="constraint-value-input">
            <NumberStepperControl
              allowEmpty
              ariaLabel="Selected handoff radii value"
              value={commonValue}
              step={handoffRadiusStep}
              min={0}
              disabled={autoVelocityRunning}
              onChange={(value) => {
                if (value !== null) {
                  pinHandoffRadii(chips, value);
                }
              }}
            />
            <span>m</span>
          </div>
        </label>
      </div>
      <div className="ranged-constraint-controls__actions">
        <SidebarIconButton
          className="sidebar-icon-button--remove"
          disabled={autoVelocityRunning}
          aria-label={`Delete ${chips.length} handoff radii`}
          title="Clear selected radii"
          onClick={() => {
            clearHandoffRadii(chips);
            onClearSelection();
          }}
        >
          <RemoveIcon size={16} />
        </SidebarIconButton>
      </div>
    </div>
  );
}

function HandoffRadiusControls({
  chip,
  autoVelocityRunning,
}: {
  chip: HandoffRadiusChip | null;
  autoVelocityRunning: boolean;
}) {
  return (
    <div
      className="ranged-constraint-controls"
      data-testid="handoff-radius-detail"
    >
      <div className="ranged-constraint-controls__fields">
        {chip ? (
          <>
            <AutoVelocityModeControl
              ariaLabel="Handoff radius mode"
              disabled={autoVelocityRunning}
              mode={chip.state === "unset" ? null : chip.state}
              onModeChange={(mode) => setHandoffRadiusMode(chip, mode)}
            />
            <label className="ranged-constraint-controls__value">
              <span>Anchor {chip.ordinal}</span>
              <div className="constraint-value-input">
                <NumberStepperControl
                  ariaLabel={`Handoff radius ${chip.ordinal} value`}
                  value={chip.effectiveValueMeters}
                  step={handoffRadiusStep}
                  min={0}
                  disabled={chip.state === "auto" || autoVelocityRunning}
                  onChange={(value) => {
                    if (value === null) {
                      return;
                    }
                    pinHandoffRadius(chip, value);
                  }}
                />
                <span>m</span>
              </div>
            </label>
          </>
        ) : (
          <p className="ranged-constraint-controls__empty" role="note">
            Select an anchor to pin its radius.
          </p>
        )}
      </div>
    </div>
  );
}

function ConstraintPopout({
  project,
  constraintKey,
  selectedByKey,
  autoSettings,
  autoVelocityRunning,
  runAutoVelocityTask,
  onGenerateAutoVelocity,
  onSelect,
  onClose,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  selectedByKey: Partial<Record<RangedConstraintKey, number>>;
  autoSettings: AutoVelocitySettings;
  autoVelocityRunning: boolean;
  runAutoVelocityTask: AutoVelocityTaskRunner;
  onGenerateAutoVelocity(): void;
  onSelect: (key: RangedConstraintKey, index: number) => void;
  onClose: () => void;
}) {
  const meta = rangedMeta[constraintKey];
  const popoutRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState(() => initialPopoutPosition());

  useLayoutEffect(() => {
    popoutRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const keepWindowInViewport = () => {
      const popout = popoutRef.current;
      if (!popout) {
        return;
      }

      const rect = popout.getBoundingClientRect();
      setPosition((current) => ({
        left: clamp(
          current.left,
          8,
          Math.max(8, window.innerWidth - rect.width - 8),
        ),
        top: clamp(
          current.top,
          8,
          Math.max(8, window.innerHeight - rect.height - 8),
        ),
      }));
    };

    window.addEventListener("resize", keepWindowInViewport);
    return () => window.removeEventListener("resize", keepWindowInViewport);
  }, []);

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
        aria-label={`${meta.label} expanded editor`}
        data-testid="constraint-popout-window"
        tabIndex={-1}
        style={{ left: position.left, top: position.top }}
      >
        <div
          className="constraint-popout__header"
          data-testid="constraint-popout-drag-handle"
          onMouseDown={startWindowDrag}
        >
          <div className="constraint-popout__title">
            <span className="constraint-popout__eyebrow">
              Expanded constraint
            </span>
            <h2>{meta.label}</h2>
          </div>
          <div className="constraint-popout__window-actions">
            <CloseButton
              className="dialog-close-button"
              onClick={onClose}
              ariaLabel={`Close ${meta.label} expanded editor`}
            />
          </div>
        </div>

        <div className="constraint-popout__content">
          <PopoutConstraintPanel
            project={project}
            constraintKey={constraintKey}
            selectedIndex={selectedByKey[constraintKey] ?? null}
            autoSettings={autoSettings}
            autoVelocityRunning={autoVelocityRunning}
            runAutoVelocityTask={runAutoVelocityTask}
            onGenerateAutoVelocity={onGenerateAutoVelocity}
            onSelect={(index) => onSelect(constraintKey, index)}
          />
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
  autoVelocityRunning,
  runAutoVelocityTask,
  onGenerateAutoVelocity,
  onSelect,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  selectedIndex: number | null;
  autoSettings: AutoVelocitySettings;
  autoVelocityRunning: boolean;
  runAutoVelocityTask: AutoVelocityTaskRunner;
  onGenerateAutoVelocity(): void;
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
  const canGenerate = useMemo(
    () => (isAutoVelocityPanel ? canGenerateConstraints(project) : false),
    [isAutoVelocityPanel, project],
  );

  return (
    <article className="constraint-popout-card">
      <div
        className={[
          "constraint-popout-card__header",
          isAutoVelocityPanel && autoStatus
            ? "constraint-card__header--auto"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="constraint-heading-row">
          <h3>{meta.label}</h3>
          {isMinimumVelocityConstraintKey(constraintKey) ? (
            <MinimumConstraintTooltip />
          ) : null}
        </div>
        {isAutoVelocityPanel && autoStatus ? (
          <>
            <AutoVelocityStatusIndicator
              status={autoStatus}
              running={autoVelocityRunning}
            />
            <div className="constraint-card__auto-actions">
              <SidebarActionButton
                onClick={onGenerateAutoVelocity}
                disabled={
                  labels.length === 0 || autoVelocityRunning || !canGenerate
                }
                aria-label="Generate constraints"
                title={
                  !canGenerate && !autoVelocityRunning
                    ? "Every handoff radius and velocity segment is set manually. Switch one to Auto to generate."
                    : "Generate handoff radii and velocity constraints"
                }
              >
                Generate
              </SidebarActionButton>
              <SidebarActionButton
                onClick={() => clearGeneratedConstraints(project)}
                disabled={
                  autoVelocityRunning || !canClearGeneratedConstraints(project)
                }
                aria-label="Clear generated constraints"
                title="Clear generated handoff radii and velocity constraints"
              >
                Clear
              </SidebarActionButton>
            </div>
          </>
        ) : null}
        {isAutoVelocityPanel &&
        autoStatus &&
        !canGenerate &&
        !autoVelocityRunning ? (
          <p className="auto-velocity-hint" role="note">
            All segments are set manually. Switch a segment to Auto to generate.
          </p>
        ) : null}
      </div>

      {isAutoVelocityPanel && autoStatus ? (
        <AutoVelocityWorkloadWarning
          project={project}
          settings={autoSettings}
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
        density="popout"
      />

      <RangedConstraintControls
        project={project}
        constraintKey={constraintKey}
        entry={selectedEntry}
        segmentNumber={segmentNumber}
        autoStatus={autoStatus}
        autoSettings={autoSettings}
        autoVelocityRunning={autoVelocityRunning}
        runAutoVelocityTask={runAutoVelocityTask}
        onSelect={onSelect}
        compact={false}
      />
    </article>
  );
}

function MinimumConstraintTooltip() {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const clearShowTimer = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const openTooltip = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const viewportPadding = 12;
    const gap = 8;
    const maxWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    const triggerRect = trigger.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - viewportPadding - maxWidth,
      Math.max(
        viewportPadding,
        triggerRect.left + triggerRect.width / 2 - maxWidth / 2,
      ),
    );
    const top = Math.min(
      window.innerHeight - viewportPadding - 72,
      triggerRect.bottom + gap,
    );

    setTooltipStyle({
      left: Math.round(left),
      maxWidth: Math.round(maxWidth),
      top: Math.max(viewportPadding, Math.round(top)),
    });
  };

  const showTooltip = () => {
    clearShowTimer();
    showTimerRef.current = window.setTimeout(() => {
      openTooltip();
      showTimerRef.current = null;
    }, minimumConstraintTooltipDelayMs);
  };

  const showTooltipImmediately = () => {
    clearShowTimer();
    openTooltip();
  };

  const hideTooltip = () => {
    clearShowTimer();
    setTooltipStyle(null);
  };

  useEffect(
    () => () => {
      clearShowTimer();
    },
    [],
  );

  useEffect(() => {
    if (!tooltipStyle) {
      return;
    }

    window.addEventListener("resize", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);

    return () => {
      window.removeEventListener("resize", hideTooltip);
      window.removeEventListener("scroll", hideTooltip, true);
    };
  });

  return (
    <>
      <span
        ref={triggerRef}
        className="minimum-constraint-tooltip"
        tabIndex={0}
        role="img"
        aria-describedby={tooltipStyle ? tooltipId : undefined}
        aria-label="Minimum constraint warning"
        data-testid="minimum-constraint-tooltip"
        onBlur={hideTooltip}
        onClick={showTooltipImmediately}
        onFocus={showTooltip}
        onPointerEnter={showTooltip}
        onPointerLeave={hideTooltip}
      >
        <WarningIcon className="minimum-constraint-tooltip__icon" size={14} />
      </span>
      {tooltipStyle
        ? createPortal(
            <div
              className="minimum-constraint-tooltip__bubble"
              id={tooltipId}
              role="tooltip"
              style={tooltipStyle}
            >
              {minimumConstraintWarning}
            </div>,
            document.body,
          )
        : null}
    </>
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
  selectedIndexes = selectedIndex === null ? [] : [selectedIndex],
  onSelect,
  onPreview,
  onRangesChange,
  onGapDoubleClick,
  density = "sidebar",
  orientation = "horizontal",
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  entries: RangedEntry[];
  labels: string[];
  unit: string;
  autoStatus?: AutoVelocityStatus | null;
  selectedIndex: number | null;
  selectedIndexes?: readonly number[];
  onSelect: (index: number, gesture?: OrderedSelectionGesture) => void;
  onPreview?: (index: number, constraint: RangedConstraint) => void;
  onRangesChange: (updates: RangeUpdate[]) => void;
  onGapDoubleClick: (start: number, end: number) => void;
  density?: "sidebar" | "popout";
  orientation?: "horizontal" | "vertical";
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

    const metrics = segmentBarMetrics(bar, total, orientation);
    const position = segmentPointerPosition(event, bar, metrics, orientation);
    const target = event.target instanceof HTMLElement ? event.target : null;
    const rangeTarget = target?.closest<HTMLElement>(
      "[data-ranged-constraint-index]",
    );
    const preferredEntryIndex = Number(
      rangeTarget?.dataset.rangedConstraintIndex ?? Number.NaN,
    );
    const preferredSegmentIndex = Number.isInteger(preferredEntryIndex)
      ? displayedEntries.findIndex(
          (entry) => entry.index === preferredEntryIndex,
        )
      : -1;
    const explicitHandle = target?.closest<HTMLElement>("[data-range-handle]")
      ?.dataset.rangeHandle;
    const boundary: RangeBoundary | null =
      preferredSegmentIndex >= 0 &&
      (explicitHandle === "start" || explicitHandle === "end")
        ? {
            segmentIndex: preferredSegmentIndex,
            side: explicitHandle,
          }
        : hitTestRangeBoundary(
            displayedEntries,
            position,
            metrics.cellExtent,
            preferredSegmentIndex,
          );
    const segmentIndex =
      boundary?.segmentIndex ??
      (preferredSegmentIndex >= 0
        ? preferredSegmentIndex
        : hitTestRangeSegment(displayedEntries, position, metrics.cellExtent));

    if (segmentIndex < 0) {
      return;
    }

    const workingEntries = cloneRangedEntries(displayedEntries);
    const selectedEntry = workingEntries[segmentIndex];
    if (!selectedEntry) {
      return;
    }

    const gesture = orderedSelectionGesture(event);
    onSelect(selectedEntry.index, gesture);
    event.preventDefault();
    if (gesture !== "replace") {
      return;
    }

    const clickOrdinal = positionToOrdinal(position, metrics.cellExtent, total);
    dragRef.current = boundary
      ? {
          changed: false,
          entries: workingEntries,
          mode: "boundary",
          originalEntries: cloneRangedEntries(displayedEntries),
          segmentIndex,
          side: boundary.side,
        }
      : {
          changed: false,
          entries: workingEntries,
          mode: "segment",
          originalEntries: cloneRangedEntries(displayedEntries),
          segmentIndex,
          offset: clickOrdinal - selectedEntry.constraint.start_ordinal,
        };

    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      const currentBar = barRef.current;
      if (!drag || !currentBar) {
        return;
      }

      const moveMetrics = segmentBarMetrics(currentBar, total, orientation);
      const nextOrdinal = positionToOrdinal(
        segmentPointerPosition(moveEvent, currentBar, moveMetrics, orientation),
        moveMetrics.cellExtent,
        total,
      );
      const nextEntries =
        drag.mode === "boundary"
          ? resizeRangedSegment(
              drag.originalEntries,
              drag.segmentIndex,
              drag.side,
              nextOrdinal,
              total,
            )
          : moveRangedSegment(
              drag.originalEntries,
              drag.segmentIndex,
              nextOrdinal,
              drag.offset,
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

    const metrics = segmentBarMetrics(bar, total, orientation);
    const ordinal = positionToOrdinal(
      segmentPointerPosition(event, bar, metrics, orientation),
      metrics.cellExtent,
      total,
    );
    const gap = contiguousGap(displayedEntries, total, ordinal);
    if (gap) {
      onGapDoubleClick(gap.start, gap.end);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (entries.length === 0) {
      return;
    }

    const currentPosition = entries.findIndex(
      (entry) => entry.index === selectedIndex,
    );

    let nextPosition: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextPosition = currentPosition < 0 ? 0 : currentPosition + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextPosition =
          currentPosition < 0 ? entries.length - 1 : currentPosition - 1;
        break;
      case "Home":
        nextPosition = 0;
        break;
      case "End":
        nextPosition = entries.length - 1;
        break;
      default:
        return;
    }

    const clamped = Math.min(Math.max(nextPosition, 0), entries.length - 1);
    const nextEntry = entries[clamped];
    if (nextEntry) {
      event.preventDefault();
      onSelect(nextEntry.index);
    }
  };

  return (
    <div
      ref={barRef}
      className={[
        "ranged-segment-bar",
        `ranged-segment-bar--${density}`,
        orientation === "vertical" ? "ranged-segment-bar--vertical" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        orientation === "vertical"
          ? {
              gridTemplateRows: `repeat(${Math.max(total, 1)}, minmax(44px, 1fr))`,
            }
          : {
              gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(54px, 1fr))`,
            }
      }
      role="listbox"
      aria-multiselectable="true"
      aria-label={`${meta.label} segments`}
      tabIndex={0}
      onMouseDown={startDrag}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {orientation === "horizontal"
        ? labels.map((label, ordinalIndex) => {
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
                title={`${describeDomainLabel(label)} · ${meta.label} position ${ordinal} of ${total}`}
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
          })
        : labels.map((_label, ordinalIndex) => {
            const ordinal = ordinalIndex + 1;
            const entry = displayedEntries.find(({ constraint }) =>
              ordinalInRange(ordinal, constraint),
            );

            return entry ? (
              <div
                key={`${constraintKey}-cell-${ordinal}`}
                className="ranged-segment-ledger-cell"
                style={{ gridColumn: 1, gridRow: ordinal }}
                data-testid={`constraint-cell-${constraintKey}-${ordinal}`}
                title={`${meta.label} position ${ordinal} of ${total}`}
                aria-hidden="true"
              >
                <span className="visually-hidden">
                  {formatSegmentValue(entry.constraint.value, unit)}
                </span>
              </div>
            ) : (
              <div
                key={`${constraintKey}-gap-${ordinal}`}
                className="ranged-segment-gap ranged-segment-gap--vertical"
                style={{ gridColumn: 1, gridRow: ordinal }}
                data-testid={`constraint-cell-${constraintKey}-${ordinal}`}
                role="option"
                aria-selected="false"
                aria-label={`Create ${meta.label} segment at position ${ordinal}`}
              >
                <span className="visually-hidden">Open</span>
              </div>
            );
          })}

      {displayedEntries.map((entry) => {
        const { constraint } = entry;
        const start = clampOrdinal(constraint.start_ordinal, total);
        const end = clampOrdinal(constraint.end_ordinal, total);
        const selected = selectedIndexes.includes(entry.index);
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
        const warningTitle = warningTitleForConstraintState(constraintState);

        return (
          <div
            key={`${constraintKey}-range-${entry.index}`}
            className={[
              "ranged-segment-range",
              sourceClass,
              selected ? "is-selected" : "",
              constraintState.stale ? "is-stale" : "",
              constraintState.globalWarning ||
              constraintState.autoWarning ||
              constraintState.minMaxWarning
                ? "has-warning"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              gridColumn:
                orientation === "vertical"
                  ? 1
                  : `${Math.min(start, end)} / ${Math.max(start, end) + 1}`,
              gridRow:
                orientation === "vertical"
                  ? `${Math.min(start, end)} / ${Math.max(start, end) + 1}`
                  : 2,
            }}
            data-testid={`constraint-range-${constraintKey}-${entry.index}`}
            data-ranged-constraint-selection={rangedSelectionToken(
              constraintKey,
              entry.index,
            )}
            data-ranged-constraint-key={constraintKey}
            data-ranged-constraint-index={entry.index}
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
            {orientation === "vertical" ? (
              <>
                <span
                  className="ranged-segment-range__handle ranged-segment-range__handle--start"
                  data-range-handle="start"
                  data-testid={`constraint-range-handle-${constraintKey}-${entry.index}-start`}
                  aria-hidden="true"
                />
                <span
                  className="ranged-segment-range__handle ranged-segment-range__handle--end"
                  data-range-handle="end"
                  data-testid={`constraint-range-handle-${constraintKey}-${entry.index}-end`}
                  aria-hidden="true"
                />
              </>
            ) : null}
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
    };

function segmentBarMetrics(
  bar: HTMLDivElement,
  total: number,
  orientation: "horizontal" | "vertical",
): { cellExtent: number; start: number } {
  const rect = bar.getBoundingClientRect();
  return orientation === "vertical"
    ? {
        cellExtent:
          Math.max(bar.scrollHeight, rect.height) / Math.max(1, total),
        start: rect.top,
      }
    : {
        cellExtent: Math.max(bar.scrollWidth, rect.width) / Math.max(1, total),
        start: rect.left,
      };
}

function segmentPointerPosition(
  event: Pick<globalThis.MouseEvent, "clientX" | "clientY">,
  bar: HTMLDivElement,
  metrics: { start: number },
  orientation: "horizontal" | "vertical",
): number {
  return orientation === "vertical"
    ? event.clientY - metrics.start + bar.scrollTop
    : event.clientX - metrics.start + bar.scrollLeft;
}

function positionToOrdinal(
  position: number,
  cellExtent: number,
  total: number,
): number {
  return clampOrdinal(
    Math.floor(position / Math.max(1, cellExtent)) + 1,
    total,
  );
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

type BulkRangedConstraintControlsProps = {
  project: ProjectDocument;
  entries: readonly RangedEntry[];
  allEntries: readonly RangedEntry[];
  onClearSelection(): void;
} & (
  | {
      constraintKey: typeof autoVelocityKey;
      autoSettings: AutoVelocitySettings;
      autoVelocityRunning: boolean;
      runAutoVelocityTask: AutoVelocityTaskRunner;
    }
  | {
      constraintKey: NonAutoRangedConstraintKey;
      autoSettings?: never;
      autoVelocityRunning?: never;
      runAutoVelocityTask?: never;
    }
);

function BulkRangedConstraintControls(
  props: BulkRangedConstraintControlsProps,
) {
  const { project, constraintKey, entries, allEntries, onClearSelection } =
    props;
  const meta = rangedMeta[constraintKey];
  const isAutoVelocity = constraintKey === autoVelocityKey;
  const sources = new Set(
    entries.map((entry) =>
      entry.constraint.source === "auto_velocity" ? "auto" : "manual",
    ),
  );
  const mode =
    isAutoVelocity && sources.size === 1
      ? (sources.values().next().value ?? null)
      : null;
  const firstValue = entries[0]?.constraint.value ?? null;
  const commonValue =
    firstValue !== null &&
    entries.every(
      (entry) => Math.abs(entry.constraint.value - firstValue) < 1e-9,
    )
      ? firstValue
      : null;

  return (
    <div
      className="ranged-constraint-controls"
      data-testid={`ranged-constraint-bulk-${constraintKey}`}
      data-ranged-constraint-key={constraintKey}
    >
      <div className="ranged-constraint-controls__fields">
        <p className="bulk-selection-summary">
          {entries.length} segments selected
        </p>
        {props.constraintKey === autoVelocityKey ? (
          <AutoVelocityModeControl
            ariaLabel="Selected velocity constraint mode"
            disabled={props.autoVelocityRunning}
            mode={mode}
            onModeChange={(nextMode) => {
              props.runAutoVelocityTask(() => {
                applyVelocityModes(
                  project,
                  entries,
                  nextMode,
                  props.autoSettings,
                );
                onClearSelection();
              });
            }}
          />
        ) : null}
        <label className="ranged-constraint-controls__value">
          <span>Set all values</span>
          <div className="constraint-value-input">
            <NumberStepperControl
              allowEmpty
              ariaLabel={`Selected ${meta.label} values`}
              value={commonValue}
              step={meta.step}
              min={meta.min}
              max={meta.max}
              disabled={
                props.constraintKey === autoVelocityKey &&
                props.autoVelocityRunning
              }
              onChange={(value) => {
                if (value !== null) {
                  updateRangedConstraintValues(entries, value);
                }
              }}
            />
            <span>{meta.unit}</span>
          </div>
        </label>
      </div>
      <div className="ranged-constraint-controls__actions">
        <SidebarIconButton
          className="sidebar-icon-button--remove"
          disabled={
            props.constraintKey === autoVelocityKey && props.autoVelocityRunning
          }
          aria-label={`Delete ${entries.length} ${meta.label} segments`}
          title="Delete selected segments"
          onClick={() => {
            removeRangedConstraints(constraintKey, allEntries, entries);
            onClearSelection();
          }}
        >
          <RemoveIcon size={16} />
        </SidebarIconButton>
      </div>
    </div>
  );
}

function RangedConstraintControls({
  project,
  constraintKey,
  entry,
  segmentNumber,
  autoStatus,
  autoSettings,
  autoVelocityRunning = false,
  runAutoVelocityTask,
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
  autoVelocityRunning?: boolean;
  runAutoVelocityTask?: AutoVelocityTaskRunner;
  onSelect: (index: number) => void;
  onOpenPopout?(trigger: HTMLButtonElement): void;
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
        {entry ? (
          <>
            {showAutoVelocityMode ? (
              <AutoVelocityModeControl
                disabled={!entry || !constraint || autoVelocityRunning}
                mode={
                  constraint?.source === "auto_velocity"
                    ? "auto"
                    : constraint
                      ? "manual"
                      : null
                }
                onModeChange={(mode) => {
                  if (
                    !entry ||
                    !constraint ||
                    !autoSettings ||
                    !runAutoVelocityTask
                  ) {
                    return;
                  }
                  runAutoVelocityTask(() =>
                    applyVelocityMode(
                      project,
                      entry,
                      mode,
                      autoSettings,
                      onSelect,
                    ),
                  );
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
                  disabled={
                    !constraint || (showAutoVelocityMode && autoVelocityRunning)
                  }
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
            {constraintState?.minMaxWarning ? (
              <span
                className="auto-velocity-status auto-velocity-status--warning"
                title={minimumConflictWarningTitle}
              >
                Above max constraint
              </span>
            ) : null}
            {constraintState?.stale ? (
              <span className="auto-velocity-status">Stale</span>
            ) : constraintState?.autoWarning ? (
              <span className="auto-velocity-status auto-velocity-status--warning">
                Above auto
              </span>
            ) : null}
          </>
        ) : (
          <p className="ranged-constraint-controls__empty" role="note">
            Select a segment to edit its value.
          </p>
        )}
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
          disabled={
            !canAddMoreRanged(project, constraintKey) ||
            (showAutoVelocityMode && autoVelocityRunning)
          }
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
          disabled={!entry || (showAutoVelocityMode && autoVelocityRunning)}
          aria-label={`Delete ${selectedActionLabel}`}
          aria-keyshortcuts={entry ? "Delete Backspace" : undefined}
          title={`Delete ${selectedActionLabel}`}
        >
          <RemoveIcon size={16} />
        </SidebarIconButton>
        <SidebarActionButton
          onClick={() => {
            if (entry) {
              splitRangedConstraint(entry.index);
            }
          }}
          disabled={
            !constraint ||
            !canSplit(constraint) ||
            (showAutoVelocityMode && autoVelocityRunning)
          }
          aria-label={`Split ${selectedActionLabel}`}
        >
          Split
        </SidebarActionButton>
        {onOpenPopout ? (
          <SidebarIconButton
            className="constraint-popout-button"
            onClick={(event) => onOpenPopout(event.currentTarget)}
            aria-label={`Expand ${meta.label} editor`}
            title={`Open ${meta.label} in the expanded editor`}
          >
            <Maximize2 aria-hidden="true" size={15} />
          </SidebarIconButton>
        ) : null}
      </div>
    </div>
  );
}

function AutoVelocityWorkloadWarning({
  project,
  settings,
}: {
  project: ProjectDocument;
  settings: AutoVelocitySettings;
}) {
  const searchPlan = useMemo(
    () => autoRadiiCapSearchPlan(project.path, project.config, settings),
    [project, settings],
  );
  const largePath =
    searchPlan.evaluationBudget > autoConstraintLargePathWarningBudget;

  if (!largePath) {
    return null;
  }

  return (
    <p
      className="auto-velocity-workload-warning"
      data-testid="auto-velocity-workload-warning"
      role="note"
    >
      <WarningIcon aria-hidden="true" />
      <span>
        Large path — optimization may take longer. Up to{" "}
        {searchPlan.evaluationBudget} candidate evaluations are expected.
      </span>
    </p>
  );
}

function AutoVelocityStatusIndicator({
  status,
  running,
}: {
  status: AutoVelocityStatus;
  running: boolean;
}) {
  const isCurrent = autoVelocityStatusIsCurrent(status);
  const label = running
    ? "Generating…"
    : isCurrent
      ? "Up to date"
      : status.hasAutoConstraints
        ? "Path changed"
        : "Not generated";
  return (
    <span
      className={[
        "auto-velocity-status",
        running
          ? "auto-velocity-status--running"
          : isCurrent
            ? "auto-velocity-status--current"
            : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-busy={running}
      title={autoVelocityStatusTooltip(status, running)}
    >
      {label}
    </span>
  );
}

function AutoVelocityModeControl({
  mode,
  disabled,
  ariaLabel = "Velocity constraint mode",
  onModeChange,
}: {
  mode: "auto" | "manual" | null;
  disabled: boolean;
  ariaLabel?: string;
  onModeChange(mode: "auto" | "manual"): void;
}) {
  return (
    <div className="auto-velocity-mode" role="group" aria-label={ariaLabel}>
      {(["auto", "manual"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={[`is-${option}`, mode === option ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-pressed={mode === option}
          disabled={disabled}
          onClick={() => {
            if (mode === option) {
              return;
            }
            onModeChange(option);
          }}
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

function buildConstraintMenuSections(
  project: ProjectDocument,
): Array<{ id: string; label: string; items: AddConstraintMenuItem[] }> {
  return addConstraintMenuSections.flatMap((section) => {
    const items = section.keys.flatMap((key) =>
      buildConstraintMenuItem(project, key),
    );

    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

function buildConstraintMenuItem(
  project: ProjectDocument,
  key: ConstraintKey,
): AddConstraintMenuItem[] {
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
}

function hasAnyConstraint(project: ProjectDocument): boolean {
  return (
    project.path.ranged_constraints.length > 0 ||
    constraintKeys.some(
      (key) => !isRangedKey(key) && project.path.constraints[key] !== null,
    )
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

function splitRangedConstraint(index: number): void {
  projectStore
    .getState()
    .applyCommand(createSplitRangedConstraintCommand(index));
}

function runAfterBrowserPaint(task: () => void, onComplete: () => void): void {
  const runTask = () => {
    try {
      task();
    } finally {
      onComplete();
    }
  };

  if (typeof window === "undefined") {
    runTask();
    return;
  }

  window.requestAnimationFrame(() => {
    window.setTimeout(runTask, 0);
  });
}

function clearGeneratedConstraints(project: ProjectDocument): void {
  if (!canClearGeneratedConstraints(project)) {
    return;
  }

  projectStore
    .getState()
    .applyCommand(createClearGeneratedConstraintsCommand());
  selectionStore.getState().clearRangedConstraintSelection();
}

/**
 * Manual pins whatever the chip is showing — including the config default a
 * still-unset anchor displays. Auto hands the value back to the optimizer, which
 * re-seeds it on the next Generate or background sync; keeping the current
 * number meanwhile means the path never jumps to an unrelated radius.
 */
function setHandoffRadiusMode(
  chip: HandoffRadiusChip,
  mode: "auto" | "manual",
): void {
  projectStore.getState().applyCommand(
    createSetHandoffRadiusCommand(chip.elementIndex, storedHandoffState(chip), {
      radiusMeters: chip.effectiveValueMeters,
      source: mode,
    }),
  );
}

function pinHandoffRadius(chip: HandoffRadiusChip, radiusMeters: number): void {
  projectStore.getState().applyCommand(
    createSetHandoffRadiusCommand(chip.elementIndex, storedHandoffState(chip), {
      radiusMeters,
      source: "manual",
    }),
  );
}

function setHandoffRadiusModes(
  chips: readonly HandoffRadiusChip[],
  mode: "auto" | "manual",
): void {
  projectStore.getState().applyCommand(
    createSetHandoffRadiiCommand(
      chips.map((chip) => ({
        index: chip.elementIndex,
        previous: storedHandoffState(chip),
        next: {
          radiusMeters: chip.effectiveValueMeters,
          source: mode,
        },
      })),
      `Set ${chips.length} handoff radii ${mode}`,
    ),
  );
}

function pinHandoffRadii(
  chips: readonly HandoffRadiusChip[],
  radiusMeters: number,
): void {
  projectStore.getState().applyCommand(
    createSetHandoffRadiiCommand(
      chips.map((chip) => ({
        index: chip.elementIndex,
        previous: storedHandoffState(chip),
        next: { radiusMeters, source: "manual" },
      })),
      `Set ${chips.length} handoff radius values`,
    ),
  );
}

function clearHandoffRadii(chips: readonly HandoffRadiusChip[]): void {
  projectStore.getState().applyCommand(
    createSetHandoffRadiiCommand(
      chips.map((chip) => ({
        index: chip.elementIndex,
        previous: storedHandoffState(chip),
        next: { radiusMeters: null, source: null },
      })),
      `Clear ${chips.length} handoff radii`,
    ),
  );
}

function storedHandoffState(chip: HandoffRadiusChip): HandoffRadiusState {
  return { radiusMeters: chip.valueMeters, source: chip.source };
}

function handoffRadiusChipTitle(chip: HandoffRadiusChip): string {
  if (chip.inert) {
    return chip.ordinal === 1 ? startAnchorHandoffNote : finalAnchorHandoffNote;
  }

  switch (chip.state) {
    case "auto":
      return `Anchor ${chip.ordinal} · generated radius`;
    case "manual":
      return `Anchor ${chip.ordinal} · pinned radius`;
    case "unset":
      return `Anchor ${chip.ordinal} · unset, driving at the project default`;
  }
}

function applyVelocityMode(
  project: ProjectDocument,
  entry: RangedEntry,
  mode: "auto" | "manual",
  settings: AutoVelocitySettings,
  onSelect: (index: number) => void,
): void {
  applyVelocityModes(project, [entry], mode, settings, onSelect);
}

function applyVelocityModes(
  project: ProjectDocument,
  entries: readonly RangedEntry[],
  mode: "auto" | "manual",
  settings: AutoVelocitySettings,
  onSelect?: (index: number) => void,
): void {
  if (entries.length === 0) {
    return;
  }

  const total = domainLabelsForKey(project, autoVelocityKey).length;
  const existing = autoVelocityConstraintsByOrdinal(
    project.path.ranged_constraints,
    total,
  );
  const ordinalsByEntry = entries.map((entry) => ({
    entry,
    ordinals: ordinalsForConstraint(entry.constraint, total),
  }));
  const selectedOrdinals = new Set(
    ordinalsByEntry.flatMap(({ ordinals }) => ordinals),
  );
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
    for (const { entry, ordinals } of ordinalsByEntry) {
      for (const ordinal of ordinals) {
        existing.set(ordinal, {
          key: autoVelocityKey,
          value: entry.constraint.value,
          start_ordinal: ordinal,
          end_ordinal: ordinal,
        });
      }
    }
    replaceVelocityConstraints(
      project,
      autoVelocityConstraintsFromOrdinalMap(
        existing,
        total,
        settings.mergeToleranceMps,
      ),
      "Set manual velocity",
    );
    if (onSelect) {
      selectOrdinalAfterReplace(
        autoVelocityKey,
        ordinalsByEntry[0]?.ordinals[0],
        onSelect,
      );
    }
    return;
  }

  refreshExistingAutoVelocityCaps(existing, capsByOrdinal, metadata);
  for (const ordinal of selectedOrdinals) {
    const cap = capsByOrdinal.get(ordinal);
    if (cap) {
      existing.set(ordinal, autoVelocityConstraintForCap(cap, metadata));
    }
  }
  replaceVelocityConstraints(
    project,
    autoVelocityConstraintsFromOrdinalMap(
      existing,
      total,
      settings.mergeToleranceMps,
    ),
    "Set auto velocity",
  );
  if (onSelect) {
    selectOrdinalAfterReplace(
      autoVelocityKey,
      ordinalsByEntry[0]?.ordinals[0],
      onSelect,
    );
  }
}

function updateRangedConstraintValues(
  entries: readonly RangedEntry[],
  value: number,
): void {
  projectStore.getState().applyCommand(
    createUpdateRangedConstraintsCommand(
      entries.map((entry) => ({
        index: entry.index,
        previous: entry.constraint,
        next: {
          ...entry.constraint,
          value,
          source:
            entry.constraint.key === autoVelocityKey
              ? "manual"
              : entry.constraint.source,
          auto_velocity:
            entry.constraint.key === autoVelocityKey
              ? null
              : entry.constraint.auto_velocity,
        },
      })),
    ),
  );
}

function removeRangedConstraints(
  key: RangedConstraintKey,
  allEntries: readonly RangedEntry[],
  selectedEntries: readonly RangedEntry[],
): void {
  const selectedIndexes = new Set(selectedEntries.map((entry) => entry.index));
  projectStore.getState().applyCommand(
    createReplaceRangedConstraintsForKeyCommand(
      key,
      allEntries.map((entry) => entry.constraint),
      allEntries
        .filter((entry) => !selectedIndexes.has(entry.index))
        .map((entry) => entry.constraint),
      `Delete ${selectedEntries.length} ranged constraints`,
    ),
  );
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

function autoVelocityStatusTooltip(
  status: AutoVelocityStatus,
  running: boolean,
): string {
  if (running) {
    return "The optimizer is generating velocity constraints.";
  }

  if (autoVelocityStatusIsCurrent(status)) {
    return "Generated constraints match the current path and optimizer settings.";
  }
  if (status.hasAutoConstraints) {
    return "The path or optimizer settings changed after these constraints were generated.";
  }
  return "No generated velocity constraints are currently applied.";
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
): {
  stale: boolean;
  autoWarning: boolean;
  globalWarning: boolean;
  minMaxWarning: boolean;
} {
  const autoState = autoVelocityStateForConstraint(constraint, autoStatus);
  const globalLimit = globalLimitForRangedConstraint(project, constraint.key);
  const globalWarning =
    globalLimit !== null &&
    constraint.value > globalLimit + constraintWarningTolerance(constraint.key);
  const minMaxWarning = minimumExceedsPairedMaximum(project, constraint);

  return {
    stale: autoState.stale,
    autoWarning: autoState.warning,
    globalWarning,
    minMaxWarning,
  };
}

function warningTitleForConstraintState(state: {
  autoWarning: boolean;
  globalWarning: boolean;
  minMaxWarning: boolean;
}): string | undefined {
  if (state.minMaxWarning) {
    return minimumConflictWarningTitle;
  }

  if (state.globalWarning) {
    return "Above global value";
  }

  if (state.autoWarning) {
    return "Above auto value";
  }

  return undefined;
}

function globalLimitForRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
): number | null {
  if (isMinimumVelocityConstraintKey(key)) {
    return null;
  }

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

function minimumExceedsPairedMaximum(
  project: ProjectDocument,
  constraint: RangedConstraint,
): boolean {
  const maxKey = maximumKeyForMinimumKey(constraint.key);
  if (!maxKey) {
    return false;
  }

  const minValue = constraint.value;
  if (!Number.isFinite(minValue) || minValue <= 0) {
    return false;
  }

  const total = domainLabelsForKey(project, constraint.key).length;
  for (const ordinal of ordinalsForConstraint(constraint, total)) {
    const maxValue = pairedMaximumForOrdinal(project, maxKey, ordinal);
    if (
      maxValue !== null &&
      minValue > maxValue + constraintWarningTolerance(constraint.key)
    ) {
      return true;
    }
  }

  return false;
}

function pairedMaximumForOrdinal(
  project: ProjectDocument,
  maxKey: RangedConstraintKey,
  ordinal: number,
): number | null {
  const rangedValue = getRangedEntries(project, maxKey).find(({ constraint }) =>
    ordinalInRange(ordinal, constraint),
  )?.constraint.value;
  if (typeof rangedValue === "number" && Number.isFinite(rangedValue)) {
    return rangedValue;
  }

  const pathValue = project.path.constraints[maxKey];
  if (typeof pathValue === "number" && Number.isFinite(pathValue)) {
    return pathValue;
  }

  const configured = getDefaultOptionalConfigValue(project.config, maxKey);
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return configured;
  }

  const fallback = rangedMeta[maxKey].defaultValue;
  return Number.isFinite(fallback) ? fallback : null;
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

/**
 * Segment-bar labels are a type initial plus a per-type index (W1, T2, …),
 * which means nothing until someone explains it. Expand it for a tooltip.
 */
function describeDomainLabel(label: string): string {
  const index = label.slice(1);
  switch (label.charAt(0)) {
    case "W":
      return `Waypoint ${index}`;
    case "T":
      return `Translation target ${index}`;
    case "R":
      return `Rotation target ${index}`;
    case "E":
      return `Event trigger ${index}`;
    default:
      return label;
  }
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

  const estimatedWidth = Math.min(860, window.innerWidth - 32);
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

function isMinimumVelocityConstraintKey(
  key: RangedConstraintKey,
): key is "min_velocity_meters_per_sec" | "min_velocity_deg_per_sec" {
  return (
    key === "min_velocity_meters_per_sec" || key === "min_velocity_deg_per_sec"
  );
}

function maximumKeyForMinimumKey(
  key: RangedConstraintKey,
): RangedConstraintKey | null {
  if (key === "min_velocity_meters_per_sec") {
    return "max_velocity_meters_per_sec";
  }

  if (key === "min_velocity_deg_per_sec") {
    return "max_velocity_deg_per_sec";
  }

  return null;
}

function constraintIconType(
  key: ConstraintKey,
): "translation" | "waypoint" | "rotation" {
  if (
    key === "max_velocity_deg_per_sec" ||
    key === "min_velocity_deg_per_sec" ||
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
