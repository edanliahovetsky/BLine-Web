import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { getDefaultOptionalConfigValue } from '../../../core/config/projectConfig';
import { domainForKey } from '../../../core/constraints/rangedConstraints';
import type { ProjectDocument } from '../../../core/io/projectSchema';
import {
  constraintKeys,
  rangedConstraintKeys,
  terminalToleranceKeys,
  type ConstraintKey,
  type RangedConstraint,
  type RangedConstraintKey,
} from '../../../core/model/path';
import { projectStore } from '../../../state/projectStore';
import { ElementIcon, PlusIcon, RemoveIcon } from '../../icons';
import {
  createAddRangedConstraintCommand,
  createInsertRangedConstraintCommand,
  createRemoveRangedConstraintCommand,
  createSetScalarConstraintCommand,
  createSplitRangedConstraintCommand,
  createUpdateRangedConstraintCommand,
  createUpdateRangedConstraintsCommand,
} from '../sidebarCommands';

type RangedEntry = {
  constraint: RangedConstraint;
  index: number;
};

type RangeUpdate = {
  index: number;
  next: RangedConstraint;
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

const rangedMeta: Record<RangedConstraintKey, RangedMeta> = {
  max_velocity_meters_per_sec: {
    label: 'Max Velocity',
    unit: 'm/s',
    defaultValue: 4.5,
    step: 0.1,
    min: 0,
    max: 20,
  },
  max_acceleration_meters_per_sec2: {
    label: 'Max Acceleration',
    unit: 'm/s2',
    defaultValue: 12,
    step: 0.1,
    min: 0,
    max: 50,
  },
  max_velocity_deg_per_sec: {
    label: 'Max Rot Velocity',
    unit: 'deg/s',
    defaultValue: 600,
    step: 1,
    min: 0,
    max: 1440,
  },
  max_acceleration_deg_per_sec2: {
    label: 'Max Rot Acceleration',
    unit: 'deg/s2',
    defaultValue: 2000,
    step: 1,
    min: 0,
    max: 5000,
  },
};

const scalarMeta: Record<(typeof terminalToleranceKeys)[number], ScalarMeta> = {
  end_translation_tolerance_meters: {
    label: 'End Translation Tolerance',
    unit: 'm',
    defaultValue: 0.1,
    step: 0.01,
    min: 0,
    max: 10,
  },
  end_rotation_tolerance_deg: {
    label: 'End Rotation Tolerance',
    unit: 'deg',
    defaultValue: 5,
    step: 0.1,
    min: 0,
    max: 180,
  },
};

export function ConstraintEditor({ project }: { project: ProjectDocument | null }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [selectedByKey, setSelectedByKey] = useState<Partial<Record<RangedConstraintKey, number>>>({});
  const availableItems = useMemo(() => (project ? buildConstraintMenuItems(project) : []), [project]);
  const setSelectedForKey = (key: RangedConstraintKey, index: number) => {
    setSelectedByKey((selected) => ({ ...selected, [key]: index }));
  };

  return (
    <section className="inspector-section constraints-section" aria-labelledby="constraints-heading">
      <div className="inspector-section__header">
        <h2 id="constraints-heading">Constraints</h2>
        <details className="add-element-menu add-constraint-menu" open={menuOpen}>
          <summary
            className={project ? 'add-element-button' : 'add-element-button is-disabled'}
            role="button"
            onClick={(event) => {
              event.preventDefault();
              if (!project) {
                return;
              }
              setMenuOpen((open) => !open);
            }}
          >
            <PlusIcon size={18} /> Add constraint
          </summary>
          <div className="add-element-menu__panel" role="menu" aria-label="Add constraint">
            {availableItems.length === 0 ? (
              <p className="constraint-empty-state">All constraints are active.</p>
            ) : (
              availableItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="add-element-menu__item"
                  role="menuitem"
                  onClick={() => {
                    addConstraint(project, item.key);
                    setMenuOpen(false);
                  }}
                >
                  <ElementIcon type={constraintIconType(item.key)} size={22} />
                  <span>{item.label}</span>
                </button>
              ))
            )}
          </div>
        </details>
      </div>

      <div className="constraint-list">
        {project ? (
          <>
            {rangedConstraintKeys.map((key) => (
              <RangedConstraintCard
                key={key}
                project={project}
                constraintKey={key}
                selectedIndex={selectedByKey[key] ?? null}
                onSelect={(index) => setSelectedForKey(key, index)}
                onOpenPopout={() => setPopoutOpen(true)}
              />
            ))}

            <div className="constraint-terminal-group">
              {terminalToleranceKeys.map((key) =>
                project.path.constraints[key] !== null ? (
                  <ScalarConstraintRow key={key} project={project} constraintKey={key} />
                ) : null
              )}
            </div>

            {!hasAnyConstraint(project) ? (
              <p className="constraint-empty-state">No path constraints added.</p>
            ) : null}
          </>
        ) : (
          <p className="constraint-empty-state">Open or create a project to edit constraints.</p>
        )}
      </div>

      {popoutOpen && project ? (
        <ConstraintPopout
          project={project}
          selectedByKey={selectedByKey}
          onSelect={setSelectedForKey}
          onClose={() => setPopoutOpen(false)}
        />
      ) : null}
    </section>
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
  constraintKey: RangedConstraintKey;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onOpenPopout: () => void;
}): JSX.Element | null {
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(() => domainLabelsForKey(project, constraintKey), [project, constraintKey]);
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const selectedLocalIndex = selectedEntry ? entries.findIndex((entry) => entry.index === selectedEntry.index) : -1;
  const total = labels.length;

  if (entries.length === 0) {
    return null;
  }

  const selectedSegmentNumber = selectedLocalIndex >= 0 ? selectedLocalIndex + 1 : 1;

  return (
    <article className="constraint-card" data-testid={`constraint-card-${constraintKey}`}>
      <div className="constraint-card__header">
        <div>
          <h3>{meta.label}</h3>
          <span>
            {entries.length} {entries.length === 1 ? 'segment' : 'segments'} across {total}{' '}
            {total === 1 ? 'element' : 'elements'}
          </span>
        </div>
      </div>

      <ConstraintSegmentBar
        constraintKey={constraintKey}
        entries={entries}
        labels={labels}
        unit={meta.unit}
        selectedIndex={selectedEntry?.index ?? null}
        onSelect={onSelect}
        onRangesChange={(updates) => updateRangedConstraints(project, updates)}
        onGapDoubleClick={(start, end) => {
          insertRangedConstraint(project, constraintKey, start, end, defaultFor(project, constraintKey, meta.defaultValue));
        }}
      />

      {selectedEntry ? (
        <SelectedRangedConstraintControls
          project={project}
          constraintKey={constraintKey}
          entry={selectedEntry}
          segmentNumber={selectedSegmentNumber}
          onOpenPopout={onOpenPopout}
        />
      ) : null}
    </article>
  );
}

function ConstraintPopout({
  project,
  selectedByKey,
  onSelect,
  onClose,
}: {
  project: ProjectDocument;
  selectedByKey: Partial<Record<RangedConstraintKey, number>>;
  onSelect: (key: RangedConstraintKey, index: number) => void;
  onClose: () => void;
}): JSX.Element {
  const activeKeys = rangedConstraintKeys.filter((key) => getRangedEntries(project, key).length > 0);

  return (
    <div className="constraint-popout-backdrop" role="presentation">
      <div className="constraint-popout" role="dialog" aria-modal="true" aria-label="Constraint Editor">
        <div className="constraint-popout__header">
          <div>
            <h2>Constraint Editor</h2>
            <span>Ranged constraints</span>
          </div>
          <button type="button" className="dialog-close-button" onClick={onClose} aria-label="Close Constraint Editor">
            x
          </button>
        </div>

        <div className="constraint-popout__content">
          {activeKeys.length === 0 ? (
            <p className="constraint-empty-state">No ranged constraints defined.</p>
          ) : (
            activeKeys.map((key) => (
              <PopoutConstraintPanel
                key={key}
                project={project}
                constraintKey={key}
                selectedIndex={selectedByKey[key] ?? null}
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
  onSelect,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}): JSX.Element {
  const meta = rangedMeta[constraintKey];
  const entries = getRangedEntries(project, constraintKey);
  const labels = useMemo(() => domainLabelsForKey(project, constraintKey), [project, constraintKey]);
  const selectedEntry = chooseSelectedEntry(entries, selectedIndex);
  const selectedLocalIndex = selectedEntry ? entries.findIndex((entry) => entry.index === selectedEntry.index) : -1;
  const segmentNumber = selectedLocalIndex >= 0 ? selectedLocalIndex + 1 : 1;

  return (
    <article className="constraint-popout-card">
      <div className="constraint-popout-card__header">
        <div>
          <h3>{meta.label}</h3>
          <span>
            {entries.length} {entries.length === 1 ? 'segment' : 'segments'}
          </span>
        </div>
      </div>

      <ConstraintSegmentBar
        constraintKey={constraintKey}
        entries={entries}
        labels={labels}
        unit={meta.unit}
        selectedIndex={selectedEntry?.index ?? null}
        onSelect={onSelect}
        onRangesChange={(updates) => updateRangedConstraints(project, updates)}
        onGapDoubleClick={(start, end) => {
          insertRangedConstraint(project, constraintKey, start, end, defaultFor(project, constraintKey, meta.defaultValue));
        }}
        density="popout"
      />

      {selectedEntry ? (
        <SelectedRangedConstraintControls
          project={project}
          constraintKey={constraintKey}
          entry={selectedEntry}
          segmentNumber={segmentNumber}
          compact={false}
        />
      ) : null}
    </article>
  );
}

function ConstraintSegmentBar({
  constraintKey,
  entries,
  labels,
  unit,
  selectedIndex,
  onSelect,
  onRangesChange,
  onGapDoubleClick,
  density = 'sidebar',
}: {
  constraintKey: RangedConstraintKey;
  entries: RangedEntry[];
  labels: string[];
  unit: string;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onRangesChange: (updates: RangeUpdate[]) => void;
  onGapDoubleClick: (start: number, end: number) => void;
  density?: 'sidebar' | 'popout';
}): JSX.Element {
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
    const segmentIndex = boundary?.segmentIndex ?? hitTestSegment(displayedEntries, x, metrics.cellWidth);

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
          mode: 'boundary',
          originalEntries: cloneEntries(displayedEntries),
          segmentIndex,
          side: boundary.side,
        }
      : {
          changed: false,
          entries: workingEntries,
          mode: 'segment',
          originalEntries: cloneEntries(displayedEntries),
          segmentIndex,
          offset: clickOrdinal - selectedEntry.constraint.start_ordinal,
          width: selectedEntry.constraint.end_ordinal - selectedEntry.constraint.start_ordinal,
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
        total
      );
      const nextEntries =
        drag.mode === 'boundary'
          ? dragBoundary(drag.entries, drag.segmentIndex, drag.side, nextOrdinal, total)
          : dragWholeSegment(drag.entries, drag.segmentIndex, nextOrdinal, drag.offset, drag.width, total);

      drag.entries = nextEntries;
      drag.changed = true;
      setDraftEntries(nextEntries);
      moveEvent.preventDefault();
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);

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

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar || total <= 0) {
      return;
    }

    const metrics = segmentBarMetrics(bar, total);
    const ordinal = xToOrdinal(event.clientX - metrics.left + bar.scrollLeft, metrics.cellWidth, total);
    const gap = contiguousGap(displayedEntries, total, ordinal);
    if (gap) {
      onGapDoubleClick(gap.start, gap.end);
    }
  };

  return (
    <div
      ref={barRef}
      className={`ranged-segment-bar ranged-segment-bar--${density}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(54px, 1fr))` }}
      role="listbox"
      aria-label={`${meta.label} segments`}
      tabIndex={0}
      onMouseDown={startDrag}
      onDoubleClick={handleDoubleClick}
    >
      {labels.map((label, ordinalIndex) => {
        const ordinal = ordinalIndex + 1;
        const entry = displayedEntries.find(({ constraint }) => ordinalInRange(ordinal, constraint));

        return (
          <div
            key={`${constraintKey}-${ordinal}`}
            className={['ranged-segment-ordinal', ordinal === total ? 'is-last' : ''].filter(Boolean).join(' ')}
            style={{ gridColumn: ordinal, gridRow: 1 }}
            data-testid={`constraint-cell-${constraintKey}-${ordinal}`}
            aria-hidden="true"
          >
            <span>{label}</span>
            <span className="visually-hidden">
              {entry ? `${formatValue(entry.constraint.value)} ${unit}` : 'Open'}
            </span>
          </div>
        );
      })}

      {labels.map((label, ordinalIndex) => {
        const ordinal = ordinalIndex + 1;
        const entry = displayedEntries.find(({ constraint }) => ordinalInRange(ordinal, constraint));

        if (entry) {
          return null;
        }

        return (
          <div
            key={`${constraintKey}-gap-${ordinal}`}
            className={['ranged-segment-gap', ordinal === total ? 'is-last' : ''].filter(Boolean).join(' ')}
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
        const segmentNumber = entries.findIndex((candidate) => candidate.index === entry.index) + 1;

        return (
          <div
            key={`${constraintKey}-range-${entry.index}`}
            className={[
              'ranged-segment-range',
              selected ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ gridColumn: `${Math.min(start, end)} / ${Math.max(start, end) + 1}`, gridRow: 2 }}
            data-testid={`constraint-range-${constraintKey}-${entry.index}`}
            role="option"
            aria-selected={selected}
            aria-label={`Select ${meta.label} segment ${segmentNumber}`}
          >
            <span className="ranged-segment-range__label">{rangeLabel(labels, constraint)}</span>
            <span className="ranged-segment-range__value">
              {formatValue(constraint.value)} {unit}
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
      mode: 'boundary';
      originalEntries: RangedEntry[];
      segmentIndex: number;
      side: 'start' | 'end';
    }
  | {
      changed: boolean;
      entries: RangedEntry[];
      mode: 'segment';
      originalEntries: RangedEntry[];
      segmentIndex: number;
      offset: number;
      width: number;
    };

function segmentBarMetrics(bar: HTMLDivElement, total: number): { cellWidth: number; left: number } {
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
  cellWidth: number
): { segmentIndex: number; side: 'start' | 'end' } | null {
  const hitWidth = 8;
  for (const [segmentIndex, { constraint }] of entries.entries()) {
    const startX = (constraint.start_ordinal - 1) * cellWidth;
    const endX = constraint.end_ordinal * cellWidth;
    if (Math.abs(x - startX) <= hitWidth / 2) {
      return { segmentIndex, side: 'start' };
    }
    if (Math.abs(x - endX) <= hitWidth / 2) {
      return { segmentIndex, side: 'end' };
    }
  }

  return null;
}

function hitTestSegment(entries: RangedEntry[], x: number, cellWidth: number): number {
  return entries.findIndex(({ constraint }) => {
    const startX = (constraint.start_ordinal - 1) * cellWidth;
    const endX = constraint.end_ordinal * cellWidth;
    return x >= startX && x < endX;
  });
}

function dragBoundary(
  entries: RangedEntry[],
  segmentIndex: number,
  side: 'start' | 'end',
  ordinal: number,
  total: number
): RangedEntry[] {
  const nextEntries = cloneEntries(entries);
  const entry = nextEntries[segmentIndex];
  if (!entry) {
    return entries;
  }

  const segment = entry.constraint;
  const adjacentIndex = findAdjacentSegment(nextEntries, segmentIndex, side);

  if (side === 'start') {
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
        if (other.end_ordinal < segment.end_ordinal && other.end_ordinal >= nextStart) {
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
        if (other.start_ordinal > segment.start_ordinal && other.start_ordinal <= nextEnd) {
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
  total: number
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

function findAdjacentSegment(entries: RangedEntry[], segmentIndex: number, side: 'start' | 'end'): number {
  const segment = entries[segmentIndex]?.constraint;
  if (!segment) {
    return -1;
  }

  return entries.findIndex(({ constraint }, index) => {
    if (index === segmentIndex) {
      return false;
    }

    if (side === 'start') {
      return constraint.end_ordinal === segment.start_ordinal - 1;
    }

    return constraint.start_ordinal === segment.end_ordinal + 1;
  });
}

function changedRangeUpdates(originalEntries: RangedEntry[], nextEntries: RangedEntry[]): RangeUpdate[] {
  return nextEntries.flatMap((nextEntry) => {
    const original = originalEntries.find((entry) => entry.index === nextEntry.index);
    if (
      !original ||
      (original.constraint.start_ordinal === nextEntry.constraint.start_ordinal &&
        original.constraint.end_ordinal === nextEntry.constraint.end_ordinal)
    ) {
      return [];
    }

    return [{ index: nextEntry.index, next: nextEntry.constraint }];
  });
}

function SelectedRangedConstraintControls({
  project,
  constraintKey,
  entry,
  segmentNumber,
  onOpenPopout,
  compact = true,
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  entry: RangedEntry;
  segmentNumber: number;
  onOpenPopout?: () => void;
  compact?: boolean;
}): JSX.Element {
  const meta = rangedMeta[constraintKey];
  const constraint = entry.constraint;

  return (
    <div
      className={compact ? 'ranged-constraint-controls' : 'ranged-constraint-controls ranged-constraint-controls--wide'}
      data-testid={`ranged-constraint-row-${segmentNumber}`}
    >
      <label className="ranged-constraint-controls__value">
        <span>Value</span>
        <div className="constraint-value-input">
          <input
            type="number"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            aria-label={`Constraint ${segmentNumber} value`}
            value={formatInputValue(constraint.value)}
            onChange={(event) => {
              updateRangedConstraint(project, entry.index, {
                ...constraint,
                value: parseNumber(event.target.value, constraint.value),
              });
            }}
          />
          <span>{meta.unit}</span>
        </div>
      </label>
      <div className="ranged-constraint-controls__actions">
        <button
          type="button"
          className="constraint-action-button"
          onClick={() => addRangedConstraint(project, constraintKey)}
          disabled={!canAddMoreRanged(project, constraintKey)}
          aria-label={`Add ${meta.label} segment`}
          title="Add segment"
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          className="constraint-action-button"
          onClick={() => deleteRangedConstraint(project, entry.index)}
          aria-label={`Delete constraint ${segmentNumber}`}
        >
          <RemoveIcon size={16} />
        </button>
        <button
          type="button"
          className="constraint-action-button"
          onClick={() => splitRangedConstraint(project, entry.index)}
          disabled={!canSplit(constraint)}
          aria-label={`Split constraint ${segmentNumber}`}
        >
          Split
        </button>
        {onOpenPopout ? (
          <button
            type="button"
            className="constraint-action-button constraint-popout-button"
            onClick={onOpenPopout}
            aria-label={`Open ${meta.label} editor`}
            title="Open editor"
          >
            Open
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ScalarConstraintRow({
  project,
  constraintKey,
}: {
  project: ProjectDocument;
  constraintKey: (typeof terminalToleranceKeys)[number];
}): JSX.Element {
  const meta = scalarMeta[constraintKey];
  const currentValue = project.path.constraints[constraintKey];
  const value = currentValue ?? defaultFor(project, constraintKey, meta.defaultValue);

  return (
    <div className="scalar-constraint-row">
      <label className="scalar-constraint-row__label">
        <span>{meta.label}</span>
      </label>
      <div className="constraint-value-input">
        <input
          type="number"
          min={meta.min}
          max={meta.max}
          step={meta.step}
          aria-label={meta.label}
          value={formatInputValue(value)}
          onChange={(event) => {
            projectStore.getState().applyCommand(
              createSetScalarConstraintCommand(
                constraintKey,
                currentValue,
                parseNumber(event.target.value, value)
              )
            );
          }}
        />
        <span>{meta.unit}</span>
      </div>
      <button
        type="button"
        className="constraint-action-button"
        onClick={() => {
          projectStore.getState().applyCommand(createSetScalarConstraintCommand(constraintKey, currentValue, null));
        }}
        aria-label={`Remove ${meta.label}`}
      >
        <RemoveIcon size={16} />
      </button>
    </div>
  );
}

function buildConstraintMenuItems(project: ProjectDocument): Array<{ key: ConstraintKey; label: string }> {
  return constraintKeys.flatMap((key) => {
    if (isRangedKey(key)) {
      const active = getRangedEntries(project, key).length > 0;

      if (!active) {
        return [{ key, label: rangedMeta[key].label }];
      }

      return canAddMoreRanged(project, key) ? [{ key, label: `${rangedMeta[key].label} (+)` }] : [];
    }

    if (project.path.constraints[key] !== null) {
      return [];
    }

    return [{ key, label: scalarMeta[key].label }];
  });
}

function hasAnyConstraint(project: ProjectDocument): boolean {
  return (
    project.path.ranged_constraints.length > 0 ||
    constraintKeys.some((key) => !isRangedKey(key) && project.path.constraints[key] !== null)
  );
}

function addConstraint(project: ProjectDocument, key: ConstraintKey): void {
  if (isRangedKey(key)) {
    addRangedConstraint(project, key);
    return;
  }

  projectStore.getState().applyCommand(
    createSetScalarConstraintCommand(
      key,
      project.path.constraints[key],
      defaultFor(project, key, scalarMeta[key].defaultValue)
    )
  );
}

function addRangedConstraint(project: ProjectDocument, key: RangedConstraintKey): void {
  projectStore.getState().applyCommand(
    createAddRangedConstraintCommand(
      key,
      defaultFor(project, key, rangedMeta[key].defaultValue),
      domainLabelsForKey(project, key).length
    )
  );
}

function insertRangedConstraint(
  project: ProjectDocument,
  key: RangedConstraintKey,
  startOrdinal: number,
  endOrdinal: number,
  value: number
): void {
  const total = domainLabelsForKey(project, key).length;
  const start = clampOrdinal(startOrdinal, total);
  const end = clampOrdinal(endOrdinal, total);

  projectStore.getState().applyCommand(
    createInsertRangedConstraintCommand({
      key,
      value,
      start_ordinal: Math.min(start, end),
      end_ordinal: Math.max(start, end),
    })
  );
}

function updateRangedConstraint(project: ProjectDocument, index: number, next: RangedConstraint): void {
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
        normalizeRangedConstraint(project, index, next, previous, total)
      )
    );
}

function updateRangedConstraints(project: ProjectDocument, updates: RangeUpdate[]): void {
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
    projectStore.getState().applyCommand(createUpdateRangedConstraintsCommand(commandUpdates));
  }
}

function deleteRangedConstraint(project: ProjectDocument, index: number): void {
  const constraint = project.path.ranged_constraints[index];
  if (constraint) {
    projectStore.getState().applyCommand(createRemoveRangedConstraintCommand(index, constraint));
  }
}

function splitRangedConstraint(project: ProjectDocument, index: number): void {
  projectStore.getState().applyCommand(createSplitRangedConstraintCommand(index));
}

function getRangedEntries(project: ProjectDocument, key: RangedConstraintKey): RangedEntry[] {
  return project.path.ranged_constraints
    .map((constraint, index) => ({ constraint, index }))
    .filter(({ constraint }) => constraint.key === key)
    .sort((left, right) => left.constraint.start_ordinal - right.constraint.start_ordinal);
}

function chooseSelectedEntry(entries: RangedEntry[], selectedIndex: number | null): RangedEntry | null {
  if (entries.length === 0) {
    return null;
  }

  return entries.find((entry) => entry.index === selectedIndex) ?? entries[0];
}

function domainLabelsForKey(project: ProjectDocument, key: RangedConstraintKey): string[] {
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
      case 'translation':
        return `T${counts.translation}`;
      case 'waypoint':
        return `W${counts.waypoint}`;
      case 'rotation':
        return `R${counts.rotation}`;
      case 'event_trigger':
        return `E${counts.event_trigger}`;
      default:
        return `${counts[element.type]}`;
    }
  });
}

function canAddMoreRanged(project: ProjectDocument, key: RangedConstraintKey): boolean {
  const total = domainLabelsForKey(project, key).length;

  if (total <= 0) {
    return false;
  }

  const entries = getRangedEntries(project, key);
  const covered = new Set<number>();

  for (const { constraint } of entries) {
    for (let ordinal = constraint.start_ordinal; ordinal <= constraint.end_ordinal; ordinal += 1) {
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

function contiguousGap(entries: RangedEntry[], total: number, ordinal: number): { start: number; end: number } | null {
  if (entries.some(({ constraint }) => ordinalInRange(ordinal, constraint))) {
    return null;
  }

  let start = ordinal;
  let end = ordinal;

  while (start > 1 && !entries.some(({ constraint }) => ordinalInRange(start - 1, constraint))) {
    start -= 1;
  }

  while (end < total && !entries.some(({ constraint }) => ordinalInRange(end + 1, constraint))) {
    end += 1;
  }

  return { start, end };
}

function ordinalInRange(ordinal: number, constraint: RangedConstraint): boolean {
  return ordinal >= constraint.start_ordinal && ordinal <= constraint.end_ordinal;
}

function rangeLabel(labels: string[], constraint: RangedConstraint): string {
  const startLabel = labels[constraint.start_ordinal - 1] ?? String(constraint.start_ordinal);
  const endLabel = labels[constraint.end_ordinal - 1] ?? String(constraint.end_ordinal);

  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`;
}

function canSplit(constraint: RangedConstraint): boolean {
  return constraint.end_ordinal > constraint.start_ordinal;
}

function normalizeRangedConstraint(
  project: ProjectDocument,
  index: number,
  constraint: RangedConstraint,
  previous: RangedConstraint,
  total: number
): RangedConstraint {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  const [lowerBound, upperBound] = editableRangeBounds(project, index, previous, total);
  const boundedStart = clamp(start, lowerBound, upperBound);
  const boundedEnd = clamp(end, lowerBound, upperBound);

  return {
    ...constraint,
    start_ordinal: Math.min(boundedStart, boundedEnd),
    end_ordinal: Math.max(boundedStart, boundedEnd),
  };
}

function normalizeRangedConstraintBounds(constraint: RangedConstraint, total: number): RangedConstraint {
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
  total: number
): [number, number] {
  let lowerBound = 1;
  let upperBound = Math.max(1, total);

  for (const { constraint, index: siblingIndex } of getRangedEntries(project, previous.key)) {
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

function defaultFor(project: ProjectDocument, key: ConstraintKey, fallback: number): number {
  const configured = getDefaultOptionalConfigValue(project.config, key);
  return typeof configured === 'number' ? configured : fallback;
}

function isRangedKey(key: ConstraintKey): key is RangedConstraintKey {
  return rangedConstraintKeys.includes(key as RangedConstraintKey);
}

function constraintIconType(key: ConstraintKey): 'translation' | 'waypoint' | 'rotation' {
  if (key === 'max_velocity_deg_per_sec' || key === 'max_acceleration_deg_per_sec2') {
    return 'rotation';
  }

  if (key === 'end_translation_tolerance_meters' || key === 'end_rotation_tolerance_deg') {
    return 'waypoint';
  }

  return 'translation';
}

function formatInputValue(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.000';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
