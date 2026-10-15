import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useStoreSelector } from "../../state/react";
import { captureTourStepState, findTour, tours } from "./tours";
import { visibleTourRect, type TourRect } from "./tourGeometry";
import {
  tourStore,
  type TourFeedback,
  type TourStepPreparation,
} from "./tourStore";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import {
  assessTourStep,
  tourAllowsShortcut,
  tourAllowsTarget,
  tourControlledPopups,
  tourInteractionTargets,
} from "./tourInteraction";
import {
  LessonText,
  TourCardHeader,
  TourChecklist,
  TourConfirmDialog,
  TourRecap,
  WhyToggle,
} from "./TourCard";
import { trackEventKeyFields } from "./lessonKeyChips";

const cardWidth = 304;
const cardGap = 14;
const viewportMargin = 12;
const fallbackCardHeight = 200;
const showMeInterval = 1300;
const confirmationSelector = '[data-tour="lesson-confirmation"]';

export interface TourOverlayProps {
  /** Applies any editor state a step needs before it can be shown. */
  onPrepare(preparation: TourStepPreparation): void;
  /** Opens the course menu, e.g. from a finished lesson's recap. */
  onOpenLessons(): void;
  /** Starts another lesson, e.g. the recap's Next lesson. */
  onStartLesson(tourId: string): void;
  onRestartStep?(): void;
  onRestartLesson?(): void;
}

type Confirmation = "restart" | "leave";

export function TourOverlay({
  onOpenLessons,
  onStartLesson,
  onPrepare,
  onRestartStep,
  onRestartLesson,
}: TourOverlayProps) {
  const activeTourId = useStoreSelector(
    tourStore,
    (state) => state.activeTourId,
  );
  const finishedTourId = useStoreSelector(
    tourStore,
    (state) => state.finishedTourId,
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
  const wantsInspector = step?.prepare?.inspector ?? null;
  const wantsInspectorTab = step?.prepare?.inspectorTab ?? null;
  const wantsTool = step?.prepare?.tool ?? null;
  const wantsClearSelection = step?.prepare?.clearSelection ?? false;
  const wantsSelectElement = step?.prepare?.selectElement ?? null;
  const wantsSelectSpeed = step?.prepare?.selectSpeed ?? null;
  const wantsSimulation = step?.prepare?.simulation ?? null;
  const wantsPathHealth = step?.prepare?.pathHealth ?? null;
  const wantsNavigator = step?.prepare?.navigator ?? null;
  const wantsGhostPaths = step?.prepare?.showGhostPaths;
  const wantsAutoPlay = step?.prepare?.autoPlay;
  const wantsCloseMenus = step?.prepare?.closeMenus;

  const cardRef = useRef<HTMLElement | null>(null);
  const restartLessonButtonRef = useRef<HTMLButtonElement>(null);
  const preparedStepRef = useRef<string | null>(null);
  const capturedStepTokens = useRef(new Set<string>());
  const [rect, setRect] = useState<TourRect | null>(null);
  const [visibleHoles, setVisibleHoles] = useState<TourRect[]>([]);
  const [feedbackState, setFeedback] = useState<{
    token: string;
    result: TourFeedback;
  }>({ token: "", result: { complete: false, message: "" } });
  const [confirmation, setConfirmation] = useState<{
    token: string;
    kind: Confirmation;
  } | null>(null);
  const [showMeState, setShowMeState] = useState<{
    token: string;
    index: number;
  } | null>(null);
  const [collapsedTour, setCollapsedTour] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{
    tourId: string;
    left: number;
    top: number;
  } | null>(null);
  const stepToken = `${activeTourId}:${attemptId}:${stepIndex}`;
  const confirming =
    confirmation?.token === stepToken ? confirmation.kind : null;
  const collapsed = !!activeTourId && collapsedTour === activeTourId;
  const cancelConfirmation = useCallback(
    (kind: Confirmation) => {
      setConfirmation(null);
      // The card must stop being inert before its trigger can receive focus.
      window.requestAnimationFrame(() =>
        (kind === "restart"
          ? restartLessonButtonRef.current
          : cardRef.current?.querySelector<HTMLElement>(
              '[data-testid="tour-leave"]',
            )
        )?.focus(),
      );
    },
    [setConfirmation],
  );
  const requestLeave = useCallback(
    () => setConfirmation({ token: stepToken, kind: "leave" }),
    [setConfirmation, stepToken],
  );
  const feedbackResult =
    feedbackState.token === stepToken ? feedbackState.result : null;
  const feedback = feedbackResult?.message ?? "";
  const showMeTargets =
    step?.showMe ??
    (stepTarget && stepTarget !== "path-canvas" ? [stepTarget] : []);
  const showMeIndex =
    showMeState?.token === stepToken ? showMeState.index : null;
  const showMeTarget =
    showMeIndex === null ? null : (showMeTargets[showMeIndex] ?? null);
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
  const [holes, setHoles] = useState<TourRect[]>([]);
  const [cardHeight, setCardHeight] = useState(fallbackCardHeight);
  const interactToken = isReviewing
    ? ""
    : step
      ? tourInteractionTargets(step).join("|")
      : "";
  const actionComplete = completedSteps.includes(stepIndex);
  const lockInteractionOnComplete = step?.lockInteractionOnComplete ?? false;

  useEffect(
    () => (activeTourId ? trackEventKeyFields() : undefined),
    [activeTourId],
  );

  // Step through each Show me target, then return to the step's spotlight.
  useEffect(() => {
    if (showMeIndex === null) return;
    const timer = window.setTimeout(() => {
      setShowMeState((current) =>
        current && current.index + 1 < showMeTargets.length
          ? { ...current, index: current.index + 1 }
          : null,
      );
    }, showMeInterval);
    return () => window.clearTimeout(timer);
  }, [showMeIndex, showMeTargets.length]);

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
    if (!isReviewing && !capturedStepTokens.current.has(token)) {
      captureTourStepState();
      capturedStepTokens.current.add(token);
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
          : id === "lesson-lib-key"
            ? (document
                .querySelector<HTMLElement>(
                  '[data-testid="property-editor"] input[aria-label="Lib Key"]',
                )
                ?.closest<HTMLElement>(".property-row") ?? null)
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
        showMeTarget
          ? measureTour(showMeTarget)
          : stepTarget && stepTarget !== "path-canvas"
            ? measureTour(stepTarget)
            : null,
      );
      setVisibleHoles(measureTargets(visibleToken));
      setHoles(
        interactToken && step && !(lockInteractionOnComplete && actionComplete)
          ? [
              ...measureTargets(interactToken),
              ...tourControlledPopups(step)
                .map(visibleTourRect)
                .filter((hole): hole is TourRect => hole !== null),
            ]
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
    step,
    stepTarget,
    visibleToken,
    showMeTarget,
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
    collapsed,
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
      const result = assessTourStep(currentStep);
      setFeedback((previous) =>
        previous.token === stepToken &&
        JSON.stringify(previous.result) === JSON.stringify(result)
          ? previous
          : { token: stepToken, result },
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
      if (confirming && !target?.closest(confirmationSelector)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!target || target.closest(".tour-layer")) return;
      const complete = assessTourStep(step).complete;
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
  }, [activeTourId, confirming, isReviewing, step]);

  useEffect(() => {
    if (!activeTourId || !step) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (confirming) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelConfirmation(confirming);
        } else if (
          !["Tab", "Enter", " "].includes(event.key) ||
          !(event.target instanceof Element) ||
          !event.target.closest(confirmationSelector)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.key === "Escape") {
        // Let an editor popup consume Escape before the lesson sees it.
        if (
          document.querySelector(
            '[data-tour="constraint-popout"], [data-tour="element-add-menu"], [data-tour="element-link-menu"], [data-tour="element-type-menu"], [data-tour="event-key-menu"], [data-tour="event-key-options"], [data-tour="project-navigator"], [data-tour="linked-elements-dialog"], [data-tour="settings-dialog"]:not([data-walkthrough]), .top-menu__panel, [data-tour="path-breadcrumb"] [role="listbox"], [role="dialog"][aria-label="Path health"]',
          )
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestLeave();
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
      const complete = assessTourStep(step).complete;
      if (!isReviewing && tourAllowsShortcut(step, event, complete)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeTourId,
    confirming,
    cancelConfirmation,
    requestLeave,
    isReviewing,
    step,
  ]);

  useEffect(() => {
    // A short lesson card may have been scrolled down to Continue. Start each
    // new step at its instructions rather than retaining the previous scroll.
    if (cardRef.current) cardRef.current.scrollTop = 0;
    cardRef.current?.focus();
    if (stepTarget && stepTarget !== "path-canvas") {
      document
        .querySelector<HTMLElement>(`[data-tour="${stepTarget}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [stepIndex, activeTourId, stepTarget]);

  if (!tour || !step) {
    const finished = findTour(finishedTourId);
    if (!finished) return null;
    const nextIndex = tours.indexOf(finished) + 1;
    const nextLesson = tours[nextIndex] ?? null;
    const close = () => tourStore.getState().dismissRecap();
    return createPortal(
      <div className="tour-layer tour-layer--recap">
        <TourRecap
          lessonTitle={finished.title}
          recap={finished.recap}
          nextLesson={nextLesson}
          onClose={close}
          onAllLessons={() => {
            close();
            onOpenLessons();
          }}
          onNext={() => {
            close();
            if (nextLesson) onStartLesson(nextLesson.id);
          }}
        />
      </div>,
      document.body,
    );
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
  if (navigator) {
    cardLeft = navigator.right + cardGap;
    cardTop = 64;
  }
  if (
    step.settingsSection ||
    document.querySelector('[data-tour="settings-dialog"]')
  ) {
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
  // A card the learner moved stays where they put it for the whole lesson.
  if (dragged?.tourId === activeTourId) {
    cardLeft = dragged.left;
    cardTop = dragged.top;
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
  const actionGated = Boolean(step.check || step.checks);
  const canContinue = !actionGated || actionComplete || isReviewing;
  const handleNext = () => {
    if (!isReviewing && !assessTourStep(step).complete) return;
    tourStore.getState().setStepComplete(stepIndex, true);
    if (isLastStep) {
      tourStore.getState().finish();
      return;
    }
    tourStore.getState().next(stepCount);
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !activeTourId) return;
    const card = cardRef.current?.getBoundingClientRect();
    if (!card) return;
    event.preventDefault();
    const offsetX = event.clientX - card.left;
    const offsetY = event.clientY - card.top;
    const move = (moveEvent: PointerEvent) =>
      setDragged({
        tourId: activeTourId,
        left: moveEvent.clientX - offsetX,
        top: moveEvent.clientY - offsetY,
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const headline = step.task ?? step.title;
  const items = feedbackResult?.items;
  const status = isReviewing
    ? "Previously completed."
    : feedback || (actionComplete ? "Done." : "Complete the task to continue.");

  // Everything outside the step's allowed controls is shielded from clicks;
  // the gaps between these regions are the only spots where pointer events
  // pass through to the editor.
  const shieldRegions = computeShieldRegions(
    holes,
    window.innerWidth,
    window.innerHeight,
  );
  const continueButton = canContinue ? (
    <button
      type="button"
      className="is-primary"
      data-testid="tour-continue"
      onClick={handleNext}
    >
      {isLastStep ? "Finish" : "Continue"}
    </button>
  ) : null;

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
      {rect && (
        <div
          className="tour-spotlight"
          data-testid="tour-spotlight"
          data-show-me={showMeTarget ?? undefined}
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span
            key={`${stepToken}:${showMeIndex ?? "step"}`}
            className="tour-spotlight__pulse"
          />
        </div>
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
        className={`tour-card${collapsed ? " is-collapsed" : ""}${
          dragged?.tourId === activeTourId ? " is-moved" : ""
        }`}
        data-testid="tour-card"
        data-step-title={step.title}
        inert={!!confirming}
        role="dialog"
        aria-modal="false"
        aria-label={`${tour.title}: step ${stepIndex + 1} of ${stepCount}`}
        tabIndex={-1}
        style={{ top: `${cardTop}px`, left: `${cardLeft}px` }}
      >
        <TourCardHeader
          lessonTitle={tour.title}
          stepIndex={stepIndex}
          stepCount={stepCount}
          collapsed={collapsed}
          onToggleCollapsed={() =>
            setCollapsedTour(collapsed ? null : activeTourId)
          }
          onLeave={requestLeave}
          onDragStart={startDrag}
        />
        <h4 className="tour-card__headline" data-testid="tour-headline">
          {actionGated ? (
            <span
              className={`tour-card__headline-mark${canContinue ? " is-complete" : ""}`}
              aria-hidden="true"
            >
              {canContinue ? "✓" : "○"}
            </span>
          ) : null}
          <span>
            <LessonText text={headline} />
          </span>
        </h4>
        {collapsed ? (
          continueButton ? (
            <div className="tour-card__actions">{continueButton}</div>
          ) : null
        ) : (
          <>
            {step.task ? (
              <p className="tour-card__step-title">{step.title}</p>
            ) : null}
            <p className="tour-card__body">
              <LessonText text={step.body} />
            </p>
            {step.keys?.length ? (
              <div className="tour-card__keys" aria-label="Keys">
                {step.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </div>
            ) : null}
            {items ? (
              <TourChecklist items={items} reviewing={isReviewing} />
            ) : step.check ? (
              <div
                className={`tour-card__action-status ${
                  canContinue ? "is-complete" : ""
                }`}
                role="status"
              >
                <span aria-hidden="true">{canContinue ? "✓" : "○"}</span>
                <span>
                  <LessonText text={status} />
                </span>
              </div>
            ) : null}
            {step.why || showMeTargets.length > 0 ? (
              <div className="tour-card__aids">
                {showMeTargets.length > 0 ? (
                  <button
                    type="button"
                    className="tour-card__show-me"
                    data-testid="tour-show-me"
                    aria-pressed={showMeIndex !== null}
                    onClick={() =>
                      setShowMeState({ token: stepToken, index: 0 })
                    }
                  >
                    Show me
                  </button>
                ) : null}
                {step.why ? (
                  <WhyToggle text={step.why} token={stepToken} />
                ) : null}
              </div>
            ) : null}
            {step.resource ? (
              <a
                className="tour-card__resource"
                href={step.resource.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {step.resource.label} ↗
              </a>
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
            <div className="tour-card__footer">
              <div className="tour-card__recovery">
                {onRestartStep && (
                  <button
                    type="button"
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
                    type="button"
                    ref={restartLessonButtonRef}
                    onClick={() =>
                      setConfirmation({ token: stepToken, kind: "restart" })
                    }
                    title="Start this lesson again"
                  >
                    Restart lesson
                  </button>
                )}
              </div>
              <div className="tour-card__actions">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onClick={() => tourStore.getState().back()}
                >
                  Back
                </button>
                {continueButton}
              </div>
            </div>
          </>
        )}
      </section>
      {confirming === "restart" && onRestartLesson && (
        <TourConfirmDialog
          testId="tour-restart-confirmation"
          title="Restart this lesson?"
          description="This resets your practice edits and returns to the first step."
          cancelLabel="Cancel"
          confirmLabel="Restart lesson"
          onCancel={() => cancelConfirmation("restart")}
          onConfirm={() => {
            setConfirmation(null);
            onRestartLesson();
          }}
        />
      )}
      {confirming === "leave" && (
        <TourConfirmDialog
          testId="tour-leave-confirmation"
          title="Leave this lesson?"
          description={`Your original project comes back. Reopen ${tour.title} from Lessons to resume at step ${stepIndex + 1}.`}
          cancelLabel="Keep going"
          confirmLabel="Leave lesson"
          onCancel={() => cancelConfirmation("leave")}
          onConfirm={() => {
            setConfirmation(null);
            tourStore.getState().exit();
          }}
        />
      )}
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
