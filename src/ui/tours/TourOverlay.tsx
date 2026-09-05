import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStoreSelector } from "../../state/react";
import { captureTourStepState, findTour } from "./tours";
import { paddedViewportRect, type TourRect } from "./tourGeometry";
import { TourLab } from "./TourLab";
import { KeepPracticeCopy, TourHandoff } from "./TourHandoff";
import { tourStore, type TourStepPreparation } from "./tourStore";

const cardWidth = 304;
const cardGap = 14;
const viewportMargin = 12;
const fallbackCardHeight = 200;

export interface TourOverlayProps {
  /** Applies any editor state a step needs before it can be shown. */
  onPrepare(preparation: TourStepPreparation): void;
  /** Returns the learner to the course menu after a completed lesson. */
  onFinish(): void;
  onRestartStep(): void;
  onRestartLesson(): void;
}

export function TourOverlay({
  onFinish,
  onPrepare,
  onRestartStep,
  onRestartLesson,
}: TourOverlayProps) {
  const activeTourId = useStoreSelector(
    tourStore,
    (state) => state.activeTourId,
  );
  const stepIndex = useStoreSelector(tourStore, (state) => state.stepIndex);
  const attemptId = useStoreSelector(tourStore, (state) => state.attemptId);
  const furthestStepIndex = useStoreSelector(
    tourStore,
    (state) => state.furthestStepIndex,
  );
  const completedSteps = useStoreSelector(
    tourStore,
    (state) => state.completedStepIndexes,
  );
  const isReviewing = stepIndex < furthestStepIndex;
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
  const wantsPathHealth = step?.prepare?.pathHealth ?? null;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const preparedStepRef = useRef<string | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [visibleHoles, setVisibleHoles] = useState<TourRect[]>([]);
  const [feedback, setFeedback] = useState("");
  const [hidden, setHidden] = useState(false);
  const [hintState, setHintState] = useState({ token: "", count: 0 });
  const [labState, setLabState] = useState<{
    token: string;
    example: boolean;
  } | null>(null);
  const stepToken = `${activeTourId}:${attemptId}:${stepIndex}`;
  const hintCount = hintState.token === stepToken ? hintState.count : 0;
  const lab = labState?.token === stepToken ? labState : null;
  const visibleToken = [
    "path-canvas",
    stepTarget,
    ...(step?.visible ?? []),
    ...(step?.interact ?? []),
  ]
    .filter(Boolean)
    .join("|");
  const hintTarget = hintCount > 1 ? step?.hintTargets?.[0] : null;
  const [holes, setHoles] = useState<TourRect[]>([]);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);
  const interactToken = isReviewing ? "" : (step?.interact?.join("|") ?? "");
  const actionComplete = completedSteps.includes(stepIndex);
  const lockInteractionOnComplete = step?.lockInteractionOnComplete ?? false;

  // Put the editor into the state this step needs once per step, so the
  // baseline for action-driven steps is not reset on every render.
  useEffect(() => {
    if (!activeTourId) {
      preparedStepRef.current = null;
      return;
    }

    const token = `${activeTourId}:${attemptId}:${stepIndex}`;
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
      wantsSimulation ||
      wantsPathHealth
    ) {
      onPrepare({
        inspector: wantsInspector ?? undefined,
        inspectorTab: wantsInspectorTab ?? undefined,
        tool: wantsTool ?? undefined,
        clearSelection: wantsClearSelection || undefined,
        selectElement: wantsSelectElement ?? undefined,
        simulation: wantsSimulation ?? undefined,
        pathHealth: wantsPathHealth ?? undefined,
      });
    }
    if (!isReviewing) captureTourStepState();
  }, [
    activeTourId,
    attemptId,
    isReviewing,
    onPrepare,
    stepIndex,
    wantsInspector,
    wantsInspectorTab,
    wantsClearSelection,
    wantsSelectElement,
    wantsSimulation,
    wantsPathHealth,
    wantsTool,
  ]);

  // Track where the spotlight and interaction holes sit, following layout.
  useEffect(() => {
    const measureTour = (id: string): TourRect | null => {
      const speedOrdinal =
        id === "lesson-corner-speed"
          ? 3
          : id === "lesson-delivery-speed"
            ? 4
            : null;
      const element = speedOrdinal
        ? (Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
            ),
          ).find(
            (candidate) =>
              Number(candidate.dataset.rangeStart) <= speedOrdinal &&
              Number(candidate.dataset.rangeEnd) >= speedOrdinal,
          ) ??
          document.querySelector<HTMLElement>(
            `[data-testid="constraint-cell-max_velocity_meters_per_sec-${speedOrdinal}"]`,
          ))
        : id === "lesson-health-dialog"
          ? document.querySelector<HTMLElement>(
              '[role="dialog"][aria-label="Path health"]',
            )
          : document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
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
      setRect(
        hintTarget
          ? measureTour(hintTarget)
          : stepTarget
            ? measureTour(stepTarget)
            : null,
      );
      setVisibleHoles(
        visibleToken
          .split("|")
          .map(measureTour)
          .filter((hole): hole is TourRect => hole !== null),
      );
      setHoles(
        interactToken && !(lockInteractionOnComplete && actionComplete)
          ? interactToken
              .split("|")
              .map(measureTour)
              .filter((hole): hole is TourRect => hole !== null)
          : [],
      );
    };

    const frame = window.requestAnimationFrame(measure);
    const settleTimer = window.setInterval(measure, 350);
    const resizeObserver = new ResizeObserver(measure);
    document
      .querySelectorAll<HTMLElement>("[data-tour]")
      .forEach((element) => resizeObserver.observe(element));
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("transitionend", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(settleTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("transitionend", measure, true);
    };
  }, [
    actionComplete,
    interactToken,
    lockInteractionOnComplete,
    stepTarget,
    visibleToken,
    hintTarget,
  ]);

  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight;
    if (measured && measured !== cardHeight) {
      setCardHeight(measured);
    }
  }, [
    actionComplete,
    cardHeight,
    stepIndex,
    activeTourId,
    hintCount,
    hidden,
    feedback,
  ]);

  // Verify action-driven steps against live editor state. Completing an action
  // unlocks Continue and may close one-shot interaction holes.
  useEffect(() => {
    if (!activeTourId || isReviewing) {
      return;
    }

    const currentTour = findTour(activeTourId);
    const currentStep = currentTour?.steps[stepIndex];
    const completeWhen = currentStep?.check
      ? () => currentStep.check!().complete
      : currentStep?.completeWhen;
    if (!completeWhen) {
      return;
    }

    const interval = window.setInterval(() => {
      const result = currentStep?.check?.();
      setFeedback(result?.message ?? "");
      tourStore
        .getState()
        .setStepComplete(stepIndex, result?.complete ?? completeWhen());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeTourId, attemptId, isReviewing, stepIndex]);

  useEffect(() => {
    const completeWhen = step?.check
      ? () => step.check!().complete
      : step?.completeWhen;
    if (
      !activeTourId ||
      isReviewing ||
      !lockInteractionOnComplete ||
      !completeWhen
    ) {
      return;
    }

    const stopCompletedInteraction = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest(".tour-card")) {
        return;
      }
      if (!completeWhen()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      tourStore.getState().setStepComplete(stepIndex, true);
    };

    window.addEventListener("pointerdown", stopCompletedInteraction, true);
    return () =>
      window.removeEventListener("pointerdown", stopCompletedInteraction, true);
  }, [activeTourId, isReviewing, lockInteractionOnComplete, step, stepIndex]);

  useEffect(() => {
    if (!activeTourId) {
      return;
    }

    // Arrow keys are deliberately left alone: the editor uses them to nudge
    // the selected element, which lessons themselves teach.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (lab) setLabState(null);
        else tourStore.getState().exit();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTourId, lab]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [stepIndex, activeTourId]);

  if (!tour || !step) {
    return null;
  }

  // Keep the mission and inspector visible while the coach occupies quiet space.
  const canvas = document
    .querySelector('[data-tour="path-canvas"]')
    ?.getBoundingClientRect();
  let cardLeft = (canvas?.left ?? 0) + 64;
  let cardTop = (canvas?.top ?? 40) + 18;
  if (
    rect &&
    stepTarget !== "path-canvas" &&
    !stepTarget?.startsWith("lesson-")
  ) {
    if (stepPlacement === "right") cardLeft = rect.left + rect.width + cardGap;
    else if (stepPlacement === "left")
      cardLeft = Math.min(cardLeft, rect.left - cardWidth - cardGap);
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
  const actionGated = Boolean(step.check || step.completeWhen);
  const handleNext = () => {
    if (actionGated && !actionComplete && !isReviewing) return;
    tourStore.getState().setStepComplete(stepIndex, true);
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
      {computeShieldRegions(
        visibleHoles,
        window.innerWidth,
        window.innerHeight,
      ).map((region, index) => (
        <div
          key={`scrim-${index}`}
          className="tour-scrim-region"
          style={{
            top: region.top,
            left: region.left,
            width: region.width,
            height: region.height,
          }}
        />
      ))}
      {rect && stepTarget !== "path-canvas" && (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
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
      <button
        className="tour-visibility"
        onClick={() => setHidden(!hidden)}
        style={{ left: cardLeft, top: Math.max(8, cardTop - 30) }}
      >
        {hidden ? "Show instructions" : "Hide instructions"} · Practice only
      </button>
      {lab && <div className="tour-lab-backdrop" />}
      {lab && (step.experiment || step.demo) && (
        <TourLab
          key={`${stepToken}:${lab.example}`}
          kind={(lab.example ? step.demo : step.experiment)!}
          example={lab.example}
          onClose={() => setLabState(null)}
        />
      )}
      <section
        hidden={hidden}
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
        <p>{step.describe?.() ?? step.body}</p>
        {step.task ? (
          <div className="tour-card__task">
            <span>{step.phase ?? "Task"}</span>
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
            {isReviewing
              ? "Previously completed. Your later work is preserved."
              : feedback && step.check
                ? feedback
                : actionComplete
                  ? lockInteractionOnComplete
                    ? "Done. Continue to the next step."
                    : "Done. Keep experimenting or continue."
                  : "Waiting for this action"}
          </div>
        ) : null}
        {(step.hints?.length || step.demo) && (
          <div className="tour-card__hints">
            <button
              onClick={() =>
                setHintState({ token: stepToken, count: hintCount + 1 })
              }
            >
              {hintCount ? "More help" : "Get a hint"}
            </button>
            {step.hints?.slice(0, hintCount).map((hint) => (
              <p key={hint}>{hint}</p>
            ))}
            {hintCount >= 2 && step.demo && (
              <button
                onClick={() => setLabState({ token: stepToken, example: true })}
              >
                Show worked example
              </button>
            )}
          </div>
        )}
        {step.experiment && (
          <button
            className="tour-card__experiment"
            onClick={() => setLabState({ token: stepToken, example: false })}
          >
            Compare your path
          </button>
        )}
        {step.handoff && <TourHandoff />}
        {isLastStep && (
          <div className="tour-card__copy">
            <KeepPracticeCopy />
            <p>Reopen the copy with Import Project Archive after the lesson.</p>
          </div>
        )}
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
        <div className="tour-card__progress" aria-label="Lesson progress">
          {tour.steps.map((tourStep, index) => (
            <button
              type="button"
              disabled={index > furthestStepIndex}
              aria-label={`Review step ${index + 1}: ${tourStep.title}`}
              aria-current={index === stepIndex ? "step" : undefined}
              title={tourStep.title}
              onClick={() => tourStore.getState().goTo(index)}
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
          {!actionGated || actionComplete || isReviewing ? (
            <button type="button" className="is-primary" onClick={handleNext}>
              {isLastStep ? "Finish" : "Next"}
            </button>
          ) : null}
        </div>
        <div className="tour-card__recovery">
          <button type="button" onClick={onRestartStep}>
            Restart exercise
          </button>
          <button type="button" onClick={onRestartLesson}>
            Restart lesson
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
