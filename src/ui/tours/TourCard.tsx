import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useDialogFocusTrap } from "../app/useDialogFocusTrap";
import {
  eventKeyFieldForChip,
  insertEventKey,
  lessonTextParts,
  plainLessonText,
} from "./lessonKeyChips";
import type { TourCheckResult } from "./tourStore";

/** Lesson copy with backticked event keys rendered as insertable chips. */
export function LessonText({ text }: { text: string }) {
  return (
    <>
      {lessonTextParts(text).map((part, index) =>
        part.kind === "text" ? (
          part.text
        ) : (
          <KeyChip key={`${part.key}-${index}`} eventKey={part.key} />
        ),
      )}
    </>
  );
}

function KeyChip({ eventKey }: { eventKey: string }) {
  const [missed, setMissed] = useState(false);
  return (
    <button
      type="button"
      className={`tour-key-chip${missed ? " is-missed" : ""}`}
      data-testid="tour-key-chip"
      title={
        missed
          ? "Select an event, then click to fill its Lib Key"
          : `Insert ${eventKey} into the Lib Key field`
      }
      // Keep focus in the key field the learner is typing in.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const field = eventKeyFieldForChip();
        setMissed(!field);
        if (field) insertEventKey(field, eventKey);
      }}
    >
      {eventKey}
    </button>
  );
}

export function TourChecklist({
  items,
  reviewing,
}: {
  items: readonly TourCheckResult[];
  reviewing: boolean;
}) {
  return (
    <ul
      className="tour-card__checklist"
      aria-label="Requirements"
      aria-live="polite"
    >
      {items.map((item) => {
        const complete = reviewing || item.complete;
        return (
          <li
            key={item.label}
            className={complete ? "is-complete" : undefined}
            data-complete={complete}
          >
            <span className="tour-card__check-mark" aria-hidden="true">
              {complete ? "✓" : "○"}
            </span>
            <span>
              <span className="tour-card__check-label">
                <LessonText text={item.label} />
                <span className="visually-hidden">
                  {complete ? " — done" : " — not yet"}
                </span>
              </span>
              {!complete && item.hint ? (
                <small>
                  <LessonText text={item.hint} />
                </small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Header row: lesson name doubles as the drag handle. */
export function TourCardHeader({
  lessonTitle,
  stepIndex,
  stepCount,
  collapsed,
  onToggleCollapsed,
  onLeave,
  onDragStart,
}: {
  lessonTitle: string;
  stepIndex: number;
  stepCount: number;
  collapsed: boolean;
  onToggleCollapsed(): void;
  onLeave(): void;
  onDragStart(event: PointerEvent<HTMLElement>): void;
}) {
  return (
    <header className="tour-card__header">
      <span
        className="tour-card__handle"
        data-testid="tour-card-handle"
        title="Drag to move the lesson card"
        onPointerDown={onDragStart}
      >
        <span aria-hidden="true">🧭</span> {lessonTitle}
        <span className="tour-card__count" data-testid="tour-step-count">
          {stepIndex + 1} / {stepCount}
        </span>
      </span>
      <button
        type="button"
        className="tour-card__icon-button"
        aria-label={collapsed ? "Expand lesson card" : "Collapse lesson card"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse to the task"}
        onClick={onToggleCollapsed}
      >
        {collapsed ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronUp size={15} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="tour-card__icon-button"
        aria-label="Leave lesson"
        title="Leave lesson"
        data-testid="tour-leave"
        onClick={onLeave}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </header>
  );
}

export function WhyToggle({ text, token }: { text: string; token: string }) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  const open = openToken === token;
  return (
    <div className="tour-card__why">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpenToken(open ? null : token)}
      >
        Why?
      </button>
      {open ? (
        <p>
          <LessonText text={text} />
        </p>
      ) : null}
    </div>
  );
}

export function TourConfirmDialog({
  title,
  description,
  cancelLabel,
  confirmLabel,
  testId,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  testId: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLDivElement>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="tour-restart-backdrop">
      <div
        ref={dialogRef}
        className="tour-restart-dialog"
        data-tour="lesson-confirmation"
        data-testid={testId}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tour-confirm-title"
        aria-describedby="tour-confirm-description"
      >
        <h4 id="tour-confirm-title">{title}</h4>
        <p id="tour-confirm-description">{description}</p>
        <div className="tour-card__actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="is-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TourRecap({
  lessonTitle,
  recap,
  nextLesson,
  onNext,
  onAllLessons,
  onClose,
}: {
  lessonTitle: string;
  recap: readonly string[];
  nextLesson: { title: string } | null;
  onNext(): void;
  onAllLessons(): void;
  onClose(): void;
}) {
  // Focus stays in the editor, so Space plays the path instead of pressing
  // Next. Escape still closes the recap from anywhere.
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <section
      className="tour-card tour-recap"
      data-testid="tour-recap"
      role="dialog"
      aria-modal="false"
      aria-label={`${lessonTitle} complete`}
    >
      <header className="tour-card__header">
        <span className="tour-card__handle">
          <span aria-hidden="true">✅</span> {lessonTitle}
        </span>
        <button
          type="button"
          className="tour-card__icon-button"
          aria-label="Close recap"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <h4 className="tour-card__headline">Lesson complete</h4>
      <ul className="tour-recap__lines">
        {recap.map((line) => (
          <li key={line}>{plainLessonText(line)}</li>
        ))}
      </ul>
      <div className="tour-card__actions">
        <button type="button" onClick={onAllLessons}>
          All lessons
        </button>
        {nextLesson ? (
          <button
            type="button"
            className="is-primary"
            data-testid="tour-next-lesson"
            onClick={onNext}
          >
            Next: {nextLesson.title}
          </button>
        ) : null}
      </div>
    </section>
  );
}
