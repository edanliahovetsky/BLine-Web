import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useStoreSelector } from "../../state/react";
import { captureTourStepState, findTour } from "./tours";
import { visibleTourRect, type TourRect } from "./tourGeometry";
import { TourLab } from "./TourLab";
import { TourHandoff } from "./TourHandoff";
import { tourStore, type TourStepPreparation } from "./tourStore";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { useDialogFocusTrap } from "../app/useDialogFocusTrap";
import {
  assessTourStep,
  tourAllowsShortcut,
  tourAllowsTarget,
  tourInteractionTargets,
} from "./tourInteraction";

const cardWidth = 304;
const cardGap = 14;
const viewportMargin = 12;
const fallbackCardHeight = 200;
// Keep the hover treatment available without fading lesson instructions.
const tourHoverFadeEnabled = false;

export interface TourOverlayProps {
  /** Applies any editor state a step needs before it can be shown. */
  onPrepare(preparation: TourStepPreparation): void;
  /** Returns the learner to the course menu after a completed lesson. */
  onFinish(): void;
  onRestartStep?(): void;
  onRestartLesson?(): void;
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
  const wantsSelectSpeed = step?.prepare?.selectSpeed ?? null;
  const wantsReference = step?.captureReference ?? false;
  const wantsSimulation = step?.prepare?.simulation ?? null;
  const wantsPathHealth = step?.prepare?.pathHealth ?? null;
  const wantsNavigator = step?.prepare?.navigator ?? null;
  const wantsGhostPaths = step?.prepare?.showGhostPaths;
  const wantsAutoPlay = step?.prepare?.autoPlay;
  const wantsCloseMenus = step?.prepare?.closeMenus;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const restartLessonButtonRef = useRef<HTMLButtonElement>(null);
  const preparedStepRef = useRef<string | null>(null);
  const capturedStepTokens = useRef(new Set<string>());
  const [rect, setRect] = useState<TourRect | null>(null);
  const [visibleHoles, setVisibleHoles] = useState<TourRect[]>([]);
  const [feedbackState, setFeedback] = useState({ token: "", message: "" });
  const [hintState, setHintState] = useState({ token: "", count: 0 });
  const [labState, setLabState] = useState<{
    token: string;
    example: boolean;
  } | null>(null);
  const [restartConfirmationToken, setRestartConfirmationToken] = useState<
    string | null
  >(null);
  const stepToken = `${activeTourId}:${attemptId}:${stepIndex}`;
  const confirmingRestart = restartConfirmationToken === stepToken;
  const cancelRestart = useCallback(() => {
    setRestartConfirmationToken(null);
    // The card must stop being inert before its trigger can receive focus.
    window.requestAnimationFrame(() => restartLessonButtonRef.current?.focus());
  }, [setRestartConfirmationToken]);
  const feedback =
    feedbackState.token === stepToken ? feedbackState.message : "";
  const hintCount = hintState.token === stepToken ? hintState.count : 0;
  const lab = labState?.token === stepToken ? labState : null;
  const visibleToken = [
    "path-canvas",
    stepTarget,
    stepTarget?.endsWith("-menu-entry")
      ? stepTarget.replace(/-entry$/, "-panel")
      : null,
    ...(step?.visible ?? []),
    ...(step ? tourInteractionTargets(step) : []),
  ]
    .filter(Boolean)
    .join("|");
  const hintTarget = hintCount > 1 ? step?.hintTargets?.[0] : null;
  const [holes, setHoles] = useState<TourRect[]>([]);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);
  const interactToken = isReviewing
    ? ""
    : step
      ? tourInteractionTargets(step).join("|")
      : "";
  const actionComplete = completedSteps.includes(stepIndex);
  const lockInteractionOnComplete = step?.lockInteractionOnComplete ?? false;

  // Put the editor into the state this step needs once per step, so the
  // baseline for action-driven steps is not reset on every render.
  useEffect(() => {
    if (!activeTourId) {
      preparedStepRef.current = null;
      capturedStepTokens.current.clear();
      return;
    }

    const token = `${activeTourId}:${attemptId}:${stepIndex}`;
    if (preparedStepRef.current === token) {
      return;
    }

    preparedStepRef.current = token;
    const returningToExercise =
      !isReviewing && capturedStepTokens.current.has(token);
    if (
      wantsInspector ||
      wantsInspectorTab ||
      wantsTool ||
      wantsClearSelection ||
      wantsSelectElement !== null ||
      wantsSelectSpeed !== null ||
      wantsSimulation ||
      wantsPathHealth ||
      wantsNavigator ||
      wantsGhostPaths !== undefined ||
      wantsAutoPlay ||
      wantsCloseMenus
    ) {
      onPrepare({
        inspector: wantsInspector ?? undefined,
        inspectorTab:
          returningToExercise && stepTarget === "inspector-constraints"
            ? "constraints"
            : (wantsInspectorTab ?? undefined),
        tool: wantsTool ?? undefined,
        clearSelection: wantsClearSelection || undefined,
        selectElement: wantsSelectElement ?? undefined,
        selectSpeed: wantsSelectSpeed ?? undefined,
        simulation: returningToExercise
          ? undefined
          : (wantsSimulation ?? undefined),
        pathHealth: wantsPathHealth ?? undefined,
        navigator: wantsNavigator ?? undefined,
        showGhostPaths: wantsGhostPaths,
        autoPlay:
          !isReviewing && !returningToExercise ? wantsAutoPlay : undefined,
        closeMenus: wantsCloseMenus,
      });
    }
    const needsCapture = !isReviewing && !capturedStepTokens.current.has(token);
    if (needsCapture) {
      captureTourStepState();
      capturedStepTokens.current.add(token);
    }
    if (needsCapture && wantsReference) {
      const project = projectStore.getState().project;
      const path = activePathForProjectStore(projectStore.getState())?.path;
      if (project && path)
        tourStore.getState().captureReference({ path, config: project.config });
    }
  }, [
    activeTourId,
    attemptId,
    isReviewing,
    onPrepare,
    stepIndex,
    stepTarget,
    wantsInspector,
    wantsInspectorTab,
    wantsClearSelection,
    wantsSelectElement,
    wantsSelectSpeed,
    wantsReference,
    wantsSimulation,
    wantsPathHealth,
    wantsNavigator,
    wantsGhostPaths,
    wantsAutoPlay,
    wantsCloseMenus,
    wantsTool,
  ]);

  // Track where the spotlight and interaction holes sit, following layout.
  useEffect(() => {
    const measureTour = (id: string): TourRect | null => {
      const speedOrdinal =
        id === "lesson-corner-speed"
          ? 3
          : id === "lesson-pickup-speed"
            ? 2
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

      return visibleTourRect(element);
    };

    const measureTargets = (token: string) =>
      token
        .split("|")
        .flatMap((id) =>
          id === "path-breadcrumb" ? [id, "path-breadcrumb-menu"] : [id],
        )
        .map(measureTour)
        .filter((hole): hole is TourRect => hole !== null);

    const measure = () => {
      // Concept steps have no target; drop any previous spotlight.
      setRect(
        hintTarget
          ? measureTour(hintTarget)
          : stepTarget
            ? measureTour(stepTarget)
            : null,
      );
      setVisibleHoles(measureTargets(visibleToken));
      setHoles(
        interactToken && !(lockInteractionOnComplete && actionComplete)
          ? measureTargets(interactToken)
          : [],
      );
    };

    const frame = window.requestAnimationFrame(measure);
    const settleTimer = window.setInterval(measure, 350);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
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
      mutationObserver.disconnect();
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
    if (!currentStep) {
      return;
    }
    const update = () => {
      const result = assessTourStep(
        currentStep,
        activePathForProjectStore(projectStore.getState())?.path ?? null,
      );
      setFeedback((previous) =>
        previous.token === stepToken && previous.message === result.message
          ? previous
          : { token: stepToken, message: result.message },
      );
      tourStore.getState().setStepComplete(stepIndex, result.complete);
    };
    // Defer the first assessment until preparation has captured its baseline.
    const frame = window.requestAnimationFrame(update);
    const unsubscribeProject = projectStore.subscribe(update);
    const unsubscribeSelection = selectionStore.subscribe(update);
    const unsubscribeActions = tourStore.subscribe((state, previous) => {
      if (state.actions !== previous.actions) update();
    });
    const interval = window.setInterval(update, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      unsubscribeProject();
      unsubscribeSelection();
      unsubscribeActions();
    };
  }, [activeTourId, attemptId, isReviewing, stepIndex, stepToken]);

  useEffect(() => {
    if (!activeTourId || !step) return;
    const stopDisallowedInteraction = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        confirmingRestart &&
        !target?.closest('[data-tour="lesson-restart-confirmation"]')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!target || target.closest(".tour-layer")) return;
      const complete = assessTourStep(
        step,
        activePathForProjectStore(projectStore.getState())?.path ?? null,
      ).complete;
      if (
        !isReviewing &&
        !(step.lockInteractionOnComplete && complete) &&
        tourAllowsTarget(step, target) &&
        event.type !== "contextmenu"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = ["pointerdown", "click", "contextmenu"];
    for (const name of events)
      window.addEventListener(name, stopDisallowedInteraction, true);
    return () => {
      for (const name of events)
        window.removeEventListener(name, stopDisallowedInteraction, true);
    };
  }, [activeTourId, confirmingRestart, isReviewing, step]);

  useEffect(() => {
    if (!activeTourId || !step) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (confirmingRestart) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelRestart();
        } else if (
          !["Tab", "Enter", " "].includes(event.key) ||
          !(event.target instanceof Element) ||
          !event.target.closest('[data-tour="lesson-restart-confirmation"]')
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.key === "Escape") {
        if (lab) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setLabState(null);
          return;
        }
        // Let an editor popup consume Escape before the lesson sees it.
        if (
          document.querySelector(
            '[data-tour="constraint-popout"], [data-tour="element-add-menu"], [data-tour="element-link-menu"], [data-tour="element-type-menu"], [data-tour="project-navigator"], [data-tour="linked-elements-dialog"], [data-tour="settings-dialog"], .top-menu__panel, [data-tour="path-breadcrumb"] [role="listbox"], [role="dialog"][aria-label="Path health"]',
          )
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        tourStore.getState().exit();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const inCoach = !!target?.closest(".tour-layer");
      const editable = !!target?.closest(
        'input, textarea, select, [role="combobox"], [contenteditable="true"]',
      );
      const editorCommandInField =
        event.key === "F1" ||
        ((event.metaKey || event.ctrlKey) &&
          ![
            "a",
            "c",
            "v",
            "x",
            "z",
            "y",
            "arrowleft",
            "arrowright",
            "arrowup",
            "arrowdown",
            "backspace",
            "delete",
          ].includes(event.key.toLowerCase()));
      // The navigator owns history shortcuts while open. The coach shares that
      // workspace, so keyboard recovery must also work when it has focus.
      if (
        inCoach &&
        !editable &&
        !isReviewing &&
        document.querySelector('[data-tour="project-navigator"]') &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ["z", "y"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey || event.key.toLowerCase() === "y")
          projectStore.getState().redo();
        else projectStore.getState().undo();
        return;
      }
      if (
        editable &&
        !editorCommandInField &&
        (inCoach || (!isReviewing && target && tourAllowsTarget(step, target)))
      )
        return;
      // Tab navigation is safe; a focused shielded button still cannot be activated.
      if (event.key === "Tab") return;
      if (
        !isReviewing &&
        target?.closest(".navigator-resize-handle") &&
        tourAllowsTarget(step, target) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      if (
        inCoach &&
        [
          "Enter",
          " ",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key) &&
        target?.closest("button, input, select")
      )
        return;
      if (
        ["Enter", " "].includes(event.key) &&
        target?.closest("button") &&
        !isReviewing &&
        tourAllowsTarget(step, target)
      )
        return;
      if (lab) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const complete = assessTourStep(
        step,
        activePathForProjectStore(projectStore.getState())?.path ?? null,
      ).complete;
      if (!isReviewing && tourAllowsShortcut(step, event, complete)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTourId, confirmingRestart, cancelRestart, lab, isReviewing, step]);

  useEffect(() => {
    cardRef.current?.focus();
    if (stepTarget && stepTarget !== "path-canvas") {
      document
        .querySelector<HTMLElement>(`[data-tour="${stepTarget}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [stepIndex, activeTourId, stepTarget]);

  if (!tour || !step) {
    return null;
  }

  // Keep the mission and inspector visible while the coach occupies quiet space.
  const canvas = document
    .querySelector('[data-tour="path-canvas"]')
    ?.getBoundingClientRect();
  let cardLeft = (canvas?.left ?? 0) + 64;
  let cardTop = (canvas?.top ?? 40) + 18;
  const navigator = document
    .querySelector(
      '[data-tour="project-navigator"], [data-tour="linked-elements-dialog"]',
    )
    ?.getBoundingClientRect();
  if (
    rect &&
    stepTarget !== "path-canvas" &&
    !stepTarget?.startsWith("lesson-")
  ) {
    if (stepPlacement === "right") cardLeft = rect.left + rect.width + cardGap;
    else if (stepPlacement === "left")
      cardLeft = Math.min(cardLeft, rect.left - cardWidth - cardGap);
  }
  if (navigator) {
    cardLeft = navigator.right + cardGap;
    cardTop = 64;
  }
  if (document.querySelector('[data-tour="settings-dialog"]')) {
    cardLeft = viewportMargin;
    cardTop = 64;
  }
  const openMenus = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".top-menu__panel, .top-menu__submenu-panel",
    ),
  )
    .map((element) => element.getBoundingClientRect())
    .filter((bounds) => bounds.width > 0 && bounds.height > 0);
  if (openMenus.length) {
    const menuRight = Math.max(...openMenus.map((bounds) => bounds.right));
    const menuBottom = Math.max(...openMenus.map((bounds) => bounds.bottom));
    if (menuRight + cardGap + cardWidth < window.innerWidth - viewportMargin)
      cardLeft = menuRight + cardGap;
    else cardTop = menuBottom + cardGap;
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
  const actionGated = Boolean(
    step.check || step.completeWhen || step.elements || step.validate,
  );
  const handleNext = () => {
    if (
      !isReviewing &&
      !assessTourStep(
        step,
        activePathForProjectStore(projectStore.getState())?.path ?? null,
      ).complete
    )
      return;
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
    <div
      className="tour-layer"
      data-testid="tour-layer"
      data-tour-target={stepTarget ?? undefined}
    >
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
        ref={cardRef}
        className="tour-card"
        data-testid="tour-card"
        data-hover-fade={tourHoverFadeEnabled}
        inert={confirmingRestart}
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
            {stepIndex + 1} / {stepCount}
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
        {actionGated && (step.check || step.completeWhen || !actionComplete) ? (
          <div
            className={`tour-card__action-status ${
              actionComplete ? "is-complete" : ""
            }`}
            role="status"
          >
            <span aria-hidden="true">{actionComplete ? "✓" : "○"}</span>
            {isReviewing
              ? "Previously completed."
              : feedback
                ? feedback
                : actionComplete
                  ? "Done."
                  : "Complete the task to continue."}
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
            Compare runs
          </button>
        )}
        {step.handoff && <TourHandoff />}
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
        <div className="tour-card__recovery">
          {onRestartStep && (
            <button
              onClick={onRestartStep}
              title={
                step.canvasLesson
                  ? "Replay this animation"
                  : "Reset this exercise to its starting state"
              }
            >
              {step.canvasLesson ? "Replay" : "Restart step"}
            </button>
          )}
          {onRestartLesson && (
            <button
              ref={restartLessonButtonRef}
              onClick={() => setRestartConfirmationToken(stepToken)}
              title="Start this lesson again"
            >
              Restart lesson
            </button>
          )}
        </div>
        <div className="tour-card__actions">
          <button
            type="button"
            className="tour-card__skip"
            onClick={() => tourStore.getState().exit()}
          >
            Skip lesson
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
              {isLastStep ? "Finish" : "Continue"}
            </button>
          ) : null}
        </div>
      </section>
      {confirmingRestart && onRestartLesson && (
        <RestartLessonDialog
          onCancel={cancelRestart}
          onConfirm={() => {
            setRestartConfirmationToken(null);
            onRestartLesson();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function RestartLessonDialog({
  onCancel,
  onConfirm,
}: {
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
        data-tour="lesson-restart-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tour-restart-title"
        aria-describedby="tour-restart-description"
      >
        <h4 id="tour-restart-title">Restart this lesson?</h4>
        <p id="tour-restart-description">
          This resets your practice edits and returns to the first step.
        </p>
        <div className="tour-card__actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="is-primary" onClick={onConfirm}>
            Restart lesson
          </button>
        </div>
      </div>
    </div>
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
