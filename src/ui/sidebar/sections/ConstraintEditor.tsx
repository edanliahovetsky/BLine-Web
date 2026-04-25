import { useState } from "react";
import { domainForKey } from "../../../core/constraints/rangedConstraints";
import type { ProjectDocument } from "../../../core/io/projectSchema";
import { getDefaultOptionalConfigValue } from "../../../core/config/projectConfig";
import {
  constraintKeys,
  rangedConstraintKeys,
  terminalToleranceKeys,
  type ConstraintKey,
  type RangedConstraint,
  type RangedConstraintKey
} from "../../../core/model/path";
import { projectStore } from "../../../state/projectStore";
import {
  createAddRangedConstraintCommand,
  createRemoveRangedConstraintCommand,
  createSetScalarConstraintCommand,
  createSplitRangedConstraintCommand,
  createUpdateRangedConstraintCommand
} from "../sidebarCommands";

interface ConstraintEditorProps {
  project: ProjectDocument | null;
}

const rangedMeta: Record<
  RangedConstraintKey,
  { label: string; unit: string; defaultValue: number }
> = {
  max_velocity_meters_per_sec: {
    label: "Max Velocity",
    unit: "m/s",
    defaultValue: 1
  },
  max_acceleration_meters_per_sec2: {
    label: "Max Acceleration",
    unit: "m/s2",
    defaultValue: 12
  },
  max_velocity_deg_per_sec: {
    label: "Max Rot Velocity",
    unit: "deg/s",
    defaultValue: 600
  },
  max_acceleration_deg_per_sec2: {
    label: "Max Rot Acceleration",
    unit: "deg/s2",
    defaultValue: 2000
  }
};

const scalarMeta: Record<
  ConstraintKey,
  { label: string; unit: string; defaultValue: number }
> = {
  max_velocity_meters_per_sec: {
    label: "Max Velocity",
    unit: "m/s",
    defaultValue: 4.5
  },
  max_acceleration_meters_per_sec2: {
    label: "Max Acceleration",
    unit: "m/s2",
    defaultValue: 12
  },
  max_velocity_deg_per_sec: {
    label: "Max Rot Velocity",
    unit: "deg/s",
    defaultValue: 600
  },
  max_acceleration_deg_per_sec2: {
    label: "Max Rot Acceleration",
    unit: "deg/s2",
    defaultValue: 2000
  },
  end_translation_tolerance_meters: {
    label: "End Translation Tol",
    unit: "m",
    defaultValue: 0.03
  },
  end_rotation_tolerance_deg: {
    label: "End Rotation Tol",
    unit: "deg",
    defaultValue: 2
  }
};

export function ConstraintEditor({ project }: ConstraintEditorProps) {
  return (
    <section className="inspector-section constraints-section">
      <header className="inspector-section__header">
        <h2>Path Constraints</h2>
        <AddConstraintMenu project={project} />
      </header>
      <div className="constraint-editor">
        {project ? (
          <>
            {rangedConstraintKeys.map((key) => (
              <RangedConstraintCard key={key} project={project} constraintKey={key} />
            ))}
            <div className="terminal-constraints">
              {terminalToleranceKeys.map((key) => (
                <ScalarConstraintRow key={key} project={project} constraintKey={key} />
              ))}
            </div>
          </>
        ) : (
          <div className="sidebar-empty-state">No project loaded</div>
        )}
      </div>
    </section>
  );
}

function AddConstraintMenu({ project }: { project: ProjectDocument | null }) {
  return (
    <details className="add-element-menu add-constraint-menu">
      <summary
        aria-disabled={!project}
        className={!project ? "is-disabled" : undefined}
        role="button"
      >
        <span aria-hidden="true" className="icon-button-symbol">
          +
        </span>
        <span>Add constraint</span>
      </summary>
      {project ? (
        <div className="add-element-menu__panel" role="menu">
          {constraintKeys.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={(event) => {
                addConstraint(project, key);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{scalarMeta[key].label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function RangedConstraintCard({
  project,
  constraintKey
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
}) {
  const [popoutOpen, setPopoutOpen] = useState(false);
  const meta = rangedMeta[constraintKey];
  const constraints = project.path.ranged_constraints
    .map((constraint, index) => ({ constraint, index }))
    .filter(({ constraint }) => constraint.key === constraintKey);
  const total = domainForKey(constraintKey, project.path.path_elements).length;

  if (constraints.length === 0) {
    return null;
  }

  return (
    <div className="constraint-card" data-testid={`constraint-card-${constraintKey}`}>
      <div className="constraint-card__header">
        <strong>{meta.label}</strong>
        <button
          type="button"
          aria-label={`Add ${meta.label} segment`}
          onClick={() => addRangedConstraint(project, constraintKey)}
          disabled={total <= 0}
        >
          +
        </button>
        <button
          type="button"
          aria-label={`Open ${meta.label} editor`}
          onClick={() => setPopoutOpen(true)}
        >
          Pop
        </button>
      </div>
      <div
        className="constraint-segment-bar"
        style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(32px, 1fr))` }}
      >
        {Array.from({ length: Math.max(total, 1) }, (_, index) => {
          const ordinal = index + 1;
          const active = constraints.find(({ constraint }) =>
            ordinalInRange(ordinal, constraint)
          );
          return (
            <span
              key={ordinal}
              className={active ? "is-active" : undefined}
              data-testid={`constraint-cell-${constraintKey}-${ordinal}`}
            >
              {active ? formatValue(active.constraint.value, meta.unit) : ordinal}
            </span>
          );
        })}
      </div>
      {constraints.map(({ constraint, index }) => (
        <RangedConstraintRow
          key={`${constraint.key}-${index}`}
          project={project}
          constraint={constraint}
          index={index}
          unit={meta.unit}
          total={total}
        />
      ))}
      {popoutOpen ? (
        <ConstraintPopout
          project={project}
          constraintKey={constraintKey}
          label={meta.label}
          unit={meta.unit}
          total={total}
          constraints={constraints}
          onClose={() => setPopoutOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ConstraintPopout({
  project,
  constraintKey,
  label,
  unit,
  total,
  constraints,
  onClose
}: {
  project: ProjectDocument;
  constraintKey: RangedConstraintKey;
  label: string;
  unit: string;
  total: number;
  constraints: Array<{ constraint: RangedConstraint; index: number }>;
  onClose(): void;
}) {
  return (
    <div className="constraint-popout-backdrop" role="presentation">
      <div
        className="constraint-popout"
        role="dialog"
        aria-modal="true"
        aria-label={`${label} editor`}
      >
        <header className="constraint-popout__header">
          <strong>{label}</strong>
          <button type="button" aria-label={`Close ${label} editor`} onClick={onClose}>
            x
          </button>
        </header>
        <div
          className="constraint-segment-bar constraint-segment-bar--popout"
          style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(54px, 1fr))` }}
        >
          {Array.from({ length: Math.max(total, 1) }, (_, index) => {
            const ordinal = index + 1;
            const active = constraints.find(({ constraint }) =>
              ordinalInRange(ordinal, constraint)
            );
            return (
              <span key={ordinal} className={active ? "is-active" : undefined}>
                {active ? formatValue(active.constraint.value, unit) : ordinal}
              </span>
            );
          })}
        </div>
        <div className="constraint-popout__rows">
          {constraints.map(({ constraint, index }) => (
            <RangedConstraintRow
              key={`${constraint.key}-${index}`}
              project={project}
              constraint={constraint}
              index={index}
              unit={unit}
              total={total}
            />
          ))}
        </div>
        <footer className="constraint-popout__footer">
          <button
            type="button"
            onClick={() => addRangedConstraint(project, constraintKey)}
            disabled={total <= 0}
          >
            Add
          </button>
        </footer>
      </div>
    </div>
  );
}

function RangedConstraintRow({
  project,
  constraint,
  index,
  unit,
  total
}: {
  project: ProjectDocument;
  constraint: RangedConstraint;
  index: number;
  unit: string;
  total: number;
}) {
  return (
    <div className="constraint-row" data-testid={`ranged-constraint-row-${index}`}>
      <label>
        <span>Start</span>
        <input
          aria-label={`Constraint ${index + 1} start ordinal`}
          type="number"
          min={1}
          max={Math.max(total, 1)}
          step={1}
          value={constraint.start_ordinal}
          onChange={(event) =>
            updateRangedConstraint(project, index, {
              ...constraint,
              start_ordinal: parseOrdinal(event.currentTarget.value, constraint.start_ordinal, total)
            })
          }
        />
      </label>
      <label>
        <span>End</span>
        <input
          aria-label={`Constraint ${index + 1} end ordinal`}
          type="number"
          min={1}
          max={Math.max(total, 1)}
          step={1}
          value={constraint.end_ordinal}
          onChange={(event) =>
            updateRangedConstraint(project, index, {
              ...constraint,
              end_ordinal: parseOrdinal(event.currentTarget.value, constraint.end_ordinal, total)
            })
          }
        />
      </label>
      <input
        aria-label={`Constraint ${index + 1} value`}
        type="number"
        min={0}
        step={constraint.key.includes("deg") ? 1 : 0.001}
        value={formatInputValue(constraint.value)}
        onChange={(event) =>
          updateRangedConstraint(project, index, {
            ...constraint,
            value: parseNumber(event.currentTarget.value, constraint.value)
          })
        }
      />
      <span>{unit}</span>
      <button
        type="button"
        aria-label={`Split constraint ${index + 1}`}
        onClick={() => projectStore.getState().applyCommand(createSplitRangedConstraintCommand(index))}
        disabled={Math.abs(constraint.end_ordinal - constraint.start_ordinal) < 1}
      >
        Split
      </button>
      <button
        type="button"
        aria-label={`Delete constraint ${index + 1}`}
        onClick={() =>
          projectStore
            .getState()
            .applyCommand(createRemoveRangedConstraintCommand(index, constraint))
        }
      >
        -
      </button>
    </div>
  );
}

function ScalarConstraintRow({
  project,
  constraintKey
}: {
  project: ProjectDocument;
  constraintKey: ConstraintKey;
}) {
  const meta = scalarMeta[constraintKey];
  const value = project.path.constraints[constraintKey];

  return (
    <label className="constraint-scalar-row">
      <span>{meta.label}</span>
      <input
        aria-label={meta.label}
        type="number"
        min={0}
        step={constraintKey.includes("deg") ? 1 : 0.001}
        value={value === null ? "" : formatInputValue(value)}
        placeholder={formatInputValue(defaultFor(project, constraintKey, meta.defaultValue))}
        onChange={(event) => {
          const nextValue =
            event.currentTarget.value.trim() === ""
              ? null
              : parseNumber(event.currentTarget.value, meta.defaultValue);
          projectStore
            .getState()
            .applyCommand(
              createSetScalarConstraintCommand(constraintKey, value, nextValue)
            );
        }}
      />
      <span>{meta.unit}</span>
    </label>
  );
}

function addConstraint(project: ProjectDocument, key: ConstraintKey) {
  if (isRangedKey(key)) {
    addRangedConstraint(project, key);
    return;
  }

  const previous = project.path.constraints[key];
  const meta = scalarMeta[key];
  projectStore
    .getState()
    .applyCommand(
      createSetScalarConstraintCommand(
        key,
        previous,
        defaultFor(project, key, meta.defaultValue)
      )
    );
}

function addRangedConstraint(project: ProjectDocument, key: RangedConstraintKey) {
  const total = domainForKey(key, project.path.path_elements).length;
  if (total <= 0) {
    return;
  }

  const meta = rangedMeta[key];
  projectStore
    .getState()
    .applyCommand(
      createAddRangedConstraintCommand(
        key,
        defaultFor(project, key, meta.defaultValue),
        total
      )
    );
}

function updateRangedConstraint(
  project: ProjectDocument,
  index: number,
  next: RangedConstraint
) {
  const previous = project.path.ranged_constraints[index];
  if (!previous) {
    return;
  }

  projectStore
    .getState()
    .applyCommand(createUpdateRangedConstraintCommand(index, previous, next));
}

function ordinalInRange(ordinal: number, constraint: RangedConstraint): boolean {
  const start = Math.min(constraint.start_ordinal, constraint.end_ordinal);
  const end = Math.max(constraint.start_ordinal, constraint.end_ordinal);
  return start <= ordinal && ordinal <= end;
}

function defaultFor(
  project: ProjectDocument,
  key: ConstraintKey,
  fallback: number
): number {
  return getDefaultOptionalConfigValue(project.config, key) ?? fallback;
}

function isRangedKey(key: ConstraintKey): key is RangedConstraintKey {
  return (rangedConstraintKeys as readonly string[]).includes(key);
}

function formatInputValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatValue(value: number, unit: string): string {
  return `${formatInputValue(value)} ${unit}`;
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function parseOrdinal(value: string, fallback: number, total: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.trunc(parsed)), Math.max(total, 1));
}
