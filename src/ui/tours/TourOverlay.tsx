import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStoreSelector } from "../../state/react";
import { captureElementCount, findTour } from "./tours";
import { tourStore, type TourStepPreparation } from "./tourStore";

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const spotlightPadding = 6;
const cardWidth = 272;
const cardGap = 14;
const viewportMargin = 12;
const fallbackCardHeight = 200;

export interface TourOverlayProps {
  /** Applies any editor state a step needs before it can be shown. */
  onPrepare(preparation: TourStepPreparation): void;
}

export function TourOverlay({ onPrepare }: TourOverlayProps) {
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
  const wantsTool = step?.prepare?.tool ?? null;
  const wantsSelectElement = step?.prepare?.selectElement ?? null;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const preparedStepRef = useRef<string | null>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [holes, setHoles] = useState<SpotlightRect[]>([]);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);
  const interactToken = step?.interact?.join("|") ?? "";

  // Put the editor into the state this step needs — once per step, so the
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
    if (wantsInspector === "open" || wantsTool || wantsSelectElement !== null) {
      onPrepare({
        inspector: wantsInspector ?? undefined,
        tool: wantsTool ?? undefined,
        selectElement: wantsSelectElement ?? undefined,
      });
    }
    captureElementCount();
  }, [
    activeTourId,
    onPrepare,
    stepIndex,
    wantsInspector,
    wantsSelectElement,
    wantsTool,
  ]);

  // Track where the spotlight and interaction holes sit, following layout.
  useEffect(() => {
    const measureTour = (id: string): SpotlightRect | null => {
      const element = document.querySelector<HTMLElement>(
        `[data-tour="${id}"]`,
      );
      if (!element) {
        return null;
      }

      const box = element.getBoundingClientRect();
      return {
        top: box.top - spotlightPadding,
        left: box.left - spotlightPadding,
        width: box.width + spotlightPadding * 2,
        height: box.height + spotlightPadding * 2,
      };
    };

    const measure = () => {
      // Concept steps have no target; drop any previous spotlight.
      setRect(stepTarget ? measureTour(stepTarget) : null);
      setHoles(
        interactToken
          ? interactToken
              .split("|")
              .map(measureTour)
              .filter((hole): hole is SpotlightRect => hole !== null)
          : [],
      );
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [interactToken, stepTarget]);

  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight;
    if (measured && measured !== cardHeight) {
      setCardHeight(measured);
    }
  }, [cardHeight, stepIndex, activeTourId]);

  // Action-driven steps advance as soon as the user does the thing.
  useEffect(() => {
    if (!activeTourId) {
      return;
    }

    const currentTour = findTour(activeTourId);
    const completeWhen = currentTour?.steps[stepIndex]?.completeWhen;
    if (!completeWhen) {
      return;
    }

    const interval = window.setInterval(() => {
      if (completeWhen()) {
        tourStore.getState().next(currentTour?.steps.length ?? 0);
      }
    }, 250);
    return () => window.clearInterval(interval);
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
          <button
            type="button"
            className="is-primary"
            disabled={actionGated}
            title={
              actionGated
                ? "Complete the highlighted action to continue"
                : undefined
            }
            onClick={() => tourStore.getState().next(stepCount)}
          >
            {actionGated ? "Try it" : isLastStep ? "Finish" : "Next"}
          </button>
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
  holes: readonly SpotlightRect[],
  viewportWidth: number,
  viewportHeight: number,
): SpotlightRect[] {
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

  const regions: SpotlightRect[] = [];
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
