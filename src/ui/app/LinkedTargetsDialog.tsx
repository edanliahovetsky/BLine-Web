import { useMemo, useState } from "react";
import { LinkedTargetsCanvas } from "../../canvas/LinkedTargetsCanvas";
import { elementColors } from "../../canvas/elementStyle";
import { activeProjectPath } from "../../core/model/editorNavigation";
import type {
  LinkedTarget,
  LinkedTargetKind,
  Project,
} from "../../core/model/project";
import {
  coordinateEditBounds,
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  type ResolvedFieldDefinition,
} from "../../core/field/fieldConfig";
import type { PathElement } from "../../core/model/path";
import {
  getPathElementLinkedTargetId,
  isElementCompatibleWithLinkedTarget,
  linkedTargetUseCount,
  nextLinkedTargetName,
} from "../../core/linkedTargets";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { LockIcon, PlusIcon, UnlockIcon } from "../icons";
import {
  CloseButton,
  NumberStepperControl,
  SelectControl,
  SwitchInput,
} from "../controls";
import "./LibraryDialog.css";
import "./LinkedTargetsDialog.css";

export interface LinkedTargetPickerRequest {
  pathId: string;
  elementIndex: number;
  element: PathElement;
}

export function LinkedTargetsDialog({
  linkRequest,
  project,
  field,
  onCancel,
  lessonMode = false,
}: {
  linkRequest?: LinkedTargetPickerRequest | null;
  project: Project;
  field: ResolvedFieldDefinition;
  onCancel(): void;
  lessonMode?: boolean;
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
    <div
      className={`config-dialog-backdrop${lessonMode ? " linked-lesson-backdrop" : ""}`}
      role="presentation"
    >
      <section
        className="library-dialog linked-targets-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={linkRequest ? "Choose Linked Element" : "Linked Elements"}
        data-testid="linked-targets-dialog"
        data-tour="linked-elements-dialog"
      >
        <header className="config-dialog__header">
          <strong>
            {linkRequest ? "Choose Linked Element" : "Linked Elements"}
          </strong>
          <CloseButton ariaLabel="Close linked elements" onClick={onCancel} />
        </header>

        <div className="library-dialog__utility-bar">
          {linkRequest || selectedTarget ? (
            <div className="library-dialog__selection-summary">
              <strong>
                {linkRequest
                  ? `Element ${linkRequest.elementIndex + 1}`
                  : selectedTarget?.display_name}
              </strong>
              <span>
                {linkRequest
                  ? `${pickerCompatibleTargets.length} compatible / ${project.linked_targets.length} total`
                  : `${activeUseCount} ${
                      activeUseCount === 1 ? "use" : "uses"
                    }`}
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="library-dialog__utility-button"
            aria-label="New Translation"
            onClick={() => createTarget("translation")}
          >
            <PlusIcon size={17} />
            <span>Translation</span>
          </button>
          <button
            type="button"
            className="library-dialog__utility-button"
            aria-label="New Waypoint"
            onClick={() => createTarget("waypoint")}
          >
            <PlusIcon size={17} />
            <span>Waypoint</span>
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
          <aside
            className="library-dialog__column linked-targets-dialog__list"
            aria-label="Elements"
          >
            <div className="library-dialog__column-header">
              <strong>Elements</strong>
              <span>{project.linked_targets.length}</span>
            </div>
            <div
              className="library-dialog__item-list"
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
                        "library-dialog__item",
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
                        {target.locked ? (
                          <span
                            className="linked-targets-dialog__locked"
                            role="img"
                            aria-label="Locked"
                            title="Locked"
                          >
                            <LockIcon size={12} />
                          </span>
                        ) : null}
                        {formatLinkedTargetKind(target.kind)} / {useCount}{" "}
                        {useCount === 1 ? "use" : "uses"}
                      </small>
                    </button>
                  );
                })
              ) : (
                <div className="library-dialog__empty">No linked elements</div>
              )}
            </div>
          </aside>

          <section
            className="library-dialog__column linked-targets-dialog__preview-column"
            aria-label="Linked element preview"
          >
            <div className="library-dialog__column-header">
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
            className="library-dialog__column linked-targets-dialog__details"
            aria-label="Linked element details"
          >
            <div className="library-dialog__column-header">
              <strong>Details</strong>
            </div>
            <div className="library-dialog__details-scroll">
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
                    aria-label="Delete Linked Element"
                    title={`Delete linked element ${selectedTarget.display_name}`}
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
                    Delete
                  </button>
                </div>
              ) : project.linked_targets.length > 0 ? (
                <div className="library-dialog__empty">Select an element.</div>
              ) : null}
            </div>
          </section>
        </div>

        {linkRequest ? (
          <footer className="config-dialog__footer library-dialog__footer">
            <button
              type="button"
              className="primary-dialog-action linked-targets-dialog__link-selected"
              disabled={!selectedTarget || !selectedTargetCompatible}
              onClick={linkSelectedTarget}
            >
              Link Selected
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </footer>
        ) : null}
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
