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

  const cardRef = useRef<HTMLDivElement | null>(null);
  const preparedStepRef = useRef<string | null>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);

  // Put the editor into the state this step needs — once per step, so the
  // baseline for action-driven steps is not reset on every render.
  useEffect(() => {
    if (!stepTarget) {
      preparedStepRef.current = null;
      return;
    }

    const token = `${activeTourId ?? ""}:${stepIndex}`;
    if (preparedStepRef.current === token) {
      return;
    }

    preparedStepRef.current = token;
    if (wantsInspector === "open") {
      onPrepare({ inspector: "open" });
    }
    captureElementCount();
  }, [activeTourId, onPrepare, stepIndex, stepTarget, wantsInspector]);

  // Track where the spotlight should sit, following layout changes.
  useEffect(() => {
    const measure = () => {
      // Concept steps have no target; drop any previous spotlight.
      if (!stepTarget) {
        setRect(null);
        return;
      }

      const target = document.querySelector<HTMLElement>(
        `[data-tour="${stepTarget}"]`,
      );
      if (!target) {
        setRect(null);
        return;
      }

      const box = target.getBoundingClientRect();
      setRect({
        top: box.top - spotlightPadding,
        left: box.left - spotlightPadding,
        width: box.width + spotlightPadding * 2,
        height: box.height + spotlightPadding * 2,
      });
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stepTarget]);

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

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        tourStore.getState().exit();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        tourStore.getState().next(stepCount);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        tourStore.getState().back();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTourId, stepCount]);

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
            onClick={() => tourStore.getState().next(stepCount)}
          >
            {isLastStep ? "Finish" : "Next"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
