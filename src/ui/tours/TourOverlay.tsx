import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStoreSelector } from "../../state/react";
import { captureTourStepState, findTour } from "./tours";
import { paddedViewportRect, type TourRect } from "./tourGeometry";
import { tourStore, type TourStepPreparation } from "./tourStore";

const cardWidth = 272;
const cardGap = 14;
const viewportMargin = 12;
const fallbackCardHeight = 200;

export interface TourOverlayProps {
  /** Applies any editor state a step needs before it can be shown. */
  onPrepare(preparation: TourStepPreparation): void;
  /** Returns the learner to the course menu after a completed lesson. */
  onFinish(): void;
}

export function TourOverlay({ onFinish, onPrepare }: TourOverlayProps) {
  const activeTourId = useStoreSelector(
    tourStore,
    (state) => state.activeTourId,
  );
  const stepIndex = useStoreSelector(tourStore, (state) => state.stepIndex);
  const tour = findTour(activeTourId);
  const step = tour?.steps[stepIndex] ?? null;
  const stepCount = tour?.steps.length ?? 0;
  const stepTarget = step?.target ?? null;
  const stepPlacement = step?.placement ?? "below";
  const wantsInspector = step?.prepare?.inspector ?? null;
  const wantsInspectorTab = step?.prepare?.inspectorTab ?? null;
  const wantsTool = step?.prepare?.tool ?? null;
  const wantsClearSelection = step?.prepare?.clearSelection ?? false;
  const wantsSelectElement = step?.prepare?.selectElement ?? null;
  const wantsSimulation = step?.prepare?.simulation ?? null;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const preparedStepRef = useRef<string | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [holes, setHoles] = useState<TourRect[]>([]);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);
  const [completedActionToken, setCompletedActionToken] = useState<
    string | null
  >(null);
  const interactToken = step?.interact?.join("|") ?? "";
  const stepToken = activeTourId ? `${activeTourId}:${stepIndex}` : null;
  const actionComplete = completedActionToken === stepToken;

  // Put the editor into the state this step needs once per step, so the
  // baseline for action-driven steps is not reset on every render.
  useEffect(() => {
    if (!activeTourId) {
      preparedStepRef.current = null;
      return;
    }

    const token = `${activeTourId}:${stepIndex}`;
    if (preparedStepRef.current === token) {
      return;
    }

    preparedStepRef.current = token;
    if (
      wantsInspector === "open" ||
      wantsInspectorTab ||
      wantsTool ||
      wantsClearSelection ||
      wantsSelectElement !== null ||
      wantsSimulation
    ) {
      onPrepare({
        inspector: wantsInspector ?? undefined,
        inspectorTab: wantsInspectorTab ?? undefined,
        tool: wantsTool ?? undefined,
        clearSelection: wantsClearSelection || undefined,
        selectElement: wantsSelectElement ?? undefined,
        simulation: wantsSimulation ?? undefined,
      });
    }
    captureTourStepState();
  }, [
    activeTourId,
    onPrepare,
    stepIndex,
    wantsInspector,
    wantsInspectorTab,
    wantsClearSelection,
    wantsSelectElement,
    wantsSimulation,
    wantsTool,
  ]);

  // Track where the spotlight and interaction holes sit, following layout.
  useEffect(() => {
    const measureTour = (id: string): TourRect | null => {
      const element = document.querySelector<HTMLElement>(
        `[data-tour="${id}"]`,
      );
      if (!element) {
        return null;
      }

      return paddedViewportRect(
        element.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      );
    };

    const measure = () => {
      // Concept steps have no target; drop any previous spotlight.
      setRect(stepTarget ? measureTour(stepTarget) : null);
      setHoles(
        interactToken
          ? interactToken
              .split("|")
              .map(measureTour)
              .filter((hole): hole is TourRect => hole !== null)
          : [],
      );
    };

    const frame = window.requestAnimationFrame(measure);
    const settleTimer = window.setTimeout(measure, 320);
    const resizeObserver = new ResizeObserver(measure);
    document
      .querySelectorAll<HTMLElement>("[data-tour]")
      .forEach((element) => resizeObserver.observe(element));
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("transitionend", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("transitionend", measure, true);
    };
  }, [interactToken, stepTarget]);

  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight;
    if (measured && measured !== cardHeight) {
      setCardHeight(measured);
    }
  }, [actionComplete, cardHeight, stepIndex, activeTourId]);

  // Verify action-driven steps against live editor state. Some advance right
  // away; practice-heavy steps leave the control open until the learner is
  // ready to continue.
  useEffect(() => {
    if (!activeTourId) {
      return;
    }

    const currentTour = findTour(activeTourId);
    const currentStep = currentTour?.steps[stepIndex];
    const completeWhen = currentStep?.completeWhen;
    if (!completeWhen) {
      return;
    }

    let advanceTimer: number | null = null;
    const interval = window.setInterval(() => {
      if (completeWhen()) {
        window.clearInterval(interval);
        setCompletedActionToken(`${activeTourId}:${stepIndex}`);
        if (
          currentStep?.advance !== "manual" &&
          stepIndex < (currentTour?.steps.length ?? 0) - 1
        ) {
          advanceTimer = window.setTimeout(() => {
            tourStore.getState().next(currentTour?.steps.length ?? 0);
          }, 450);
        }
      }
    }, 250);
    return () => {
      window.clearInterval(interval);
      if (advanceTimer !== null) {
        window.clearTimeout(advanceTimer);
      }
    };
  }, [activeTourId, stepIndex]);

  useEffect(() => {
    if (!activeTourId) {
      return;
    }

    // Arrow keys are deliberately left alone: the editor uses them to nudge
    // the selected element, which lessons themselves teach.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        tourStore.getState().exit();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTourId]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [stepIndex, activeTourId]);

  if (!tour || !step) {
    return null;
  }

  // Concept steps have no target: the card sits centered over the scrim.
  let cardLeft = (window.innerWidth - cardWidth) / 2;
  let cardTop = (window.innerHeight - cardHeight) / 2;

  if (rect) {
    if (stepPlacement === "right") {
      cardLeft = rect.left + rect.width + cardGap;
      cardTop = rect.top;
    } else if (stepPlacement === "left") {
      cardLeft = rect.left - cardWidth - cardGap;
      cardTop = rect.top;
    } else if (stepPlacement === "above") {
      cardLeft = rect.left + rect.width / 2 - cardWidth / 2;
      cardTop = rect.top - cardHeight - cardGap;
    } else {
      cardLeft = rect.left + rect.width / 2 - cardWidth / 2;
      cardTop = rect.top + rect.height + cardGap;
    }
  }

  cardLeft = Math.max(
    viewportMargin,
    Math.min(cardLeft, window.innerWidth - cardWidth - viewportMargin),
  );
  cardTop = Math.max(
    viewportMargin,
    Math.min(cardTop, window.innerHeight - cardHeight - viewportMargin),
  );

  const isLastStep = stepIndex === stepCount - 1;
  const actionGated = Boolean(step.completeWhen);
  const handleNext = () => {
    if (isLastStep) {
      tourStore.getState().finish();
      onFinish();
      return;
    }
    tourStore.getState().next(stepCount);
  };

  // Everything outside the step's allowed controls is shielded from clicks;
  // the gaps between these regions are the only spots where pointer events
  // pass through to the editor.
  const shieldRegions = computeShieldRegions(
    holes,
    window.innerWidth,
    window.innerHeight,
  );

  return createPortal(
    <div className="tour-layer" data-testid="tour-layer">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
      ) : (
        <div className="tour-scrim" />
      )}
      {shieldRegions.map((region, index) => (
        <div
          key={`shield-${index}`}
          className="tour-shield-region"
          aria-hidden="true"
          style={{
            top: `${region.top}px`,
            left: `${region.left}px`,
            width: `${region.width}px`,
            height: `${region.height}px`,
          }}
        />
      ))}
      <section
        ref={cardRef}
        className="tour-card"
        data-testid="tour-card"
        role="dialog"
        aria-modal="false"
        aria-label={`${tour.title}: step ${stepIndex + 1} of ${stepCount}`}
        tabIndex={-1}
        style={{ top: `${cardTop}px`, left: `${cardLeft}px` }}
      >
        <div className="tour-card__meta">
          <span>
            <span aria-hidden="true">🧭</span> {tour.title}
          </span>
          <span data-testid="tour-step-count">
            Step {stepIndex + 1} of {stepCount}
          </span>
        </div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        {step.task ? (
          <div className="tour-card__task">
            <span>Task</span>
            <strong>{step.task}</strong>
          </div>
        ) : null}
        {actionGated ? (
          <div
            className={`tour-card__action-status ${
              actionComplete ? "is-complete" : ""
            }`}
            role="status"
          >
            <span aria-hidden="true">{actionComplete ? "✓" : "○"}</span>
            {actionComplete
              ? step.advance === "manual"
                ? "Done. Keep experimenting or continue."
                : "Done"
              : "Waiting for this action"}
          </div>
        ) : null}
        {isLastStep && (!actionGated || actionComplete) ? (
          <p className="tour-card__completion">{tour.completionMessage}</p>
        ) : null}
        {step.keys && step.keys.length > 0 ? (
          <div className="tour-card__keys">
            {step.keys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </div>
        ) : null}
        <div className="tour-card__progress" aria-hidden="true">
          {tour.steps.map((tourStep, index) => (
            <i
              key={`${tourStep.title}-${index}`}
              className={index <= stepIndex ? "is-done" : ""}
            />
          ))}
        </div>
        <div className="tour-card__actions">
          <button
            type="button"
            className="tour-card__skip"
            onClick={() => tourStore.getState().exit()}
          >
            Skip tour
          </button>
          <button
            type="button"
            disabled={stepIndex === 0}
            onClick={() => tourStore.getState().back()}
          >
            Back
          </button>
          {!actionGated ||
          (actionComplete && (isLastStep || step.advance === "manual")) ? (
            <button type="button" className="is-primary" onClick={handleNext}>
              {isLastStep ? "Finish" : "Next"}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Cover the viewport minus the interaction holes with plain rectangles.
 * Horizontal bands are cut at every hole edge; within a band, the stretches
 * not occupied by a hole become shield regions.
 */
function computeShieldRegions(
  holes: readonly TourRect[],
  viewportWidth: number,
  viewportHeight: number,
): TourRect[] {
  if (holes.length === 0) {
    return [{ top: 0, left: 0, width: viewportWidth, height: viewportHeight }];
  }

  const yEdges = [
    ...new Set([
      0,
      viewportHeight,
      ...holes.flatMap((hole) => [
        clampTo(hole.top, viewportHeight),
        clampTo(hole.top + hole.height, viewportHeight),
      ]),
    ]),
  ].sort((a, b) => a - b);

  const regions: TourRect[] = [];
  for (let band = 0; band < yEdges.length - 1; band += 1) {
    const top = yEdges[band];
    const bottom = yEdges[band + 1];
    if (bottom <= top) {
      continue;
    }

    const bandHoles = holes
      .filter((hole) => hole.top < bottom && hole.top + hole.height > top)
      .map((hole) => ({
        start: clampTo(hole.left, viewportWidth),
        end: clampTo(hole.left + hole.width, viewportWidth),
      }))
      .sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const hole of bandHoles) {
      if (hole.start > cursor) {
        regions.push({
          top,
          left: cursor,
          width: hole.start - cursor,
          height: bottom - top,
        });
      }
      cursor = Math.max(cursor, hole.end);
    }
    if (cursor < viewportWidth) {
      regions.push({
        top,
        left: cursor,
        width: viewportWidth - cursor,
        height: bottom - top,
      });
    }
  }

  return regions;
}

function clampTo(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}
