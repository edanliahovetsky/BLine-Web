import { useCallback, useEffect, useRef, type RefObject } from "react";

interface UseCanvasInteractionActivityInput {
  containerRef: RefObject<HTMLElement | null>;
  semanticActive: boolean;
  onChange?: (active: boolean) => void;
}

export function useCanvasInteractionActivity({
  containerRef,
  semanticActive,
  onChange,
}: UseCanvasInteractionActivityInput): void {
  const pointerActiveRef = useRef(false);
  const semanticActiveRef = useRef(semanticActive);
  const emittedActiveRef = useRef<boolean | null>(null);

  const emit = useCallback(
    (active: boolean) => {
      if (emittedActiveRef.current === active) {
        return;
      }

      emittedActiveRef.current = active;
      onChange?.(active);
    },
    [onChange],
  );

  useEffect(() => {
    semanticActiveRef.current = semanticActive;
    emit(pointerActiveRef.current || semanticActive);
  }, [emit, semanticActive]);

  useEffect(() => {
    const startPointerInteraction = (
      event: PointerEvent | MouseEvent | TouchEvent,
    ) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !containerRef.current?.contains(target)) {
        return;
      }

      pointerActiveRef.current = true;
      emit(true);
    };

    const stopPointerInteraction = () => {
      if (!pointerActiveRef.current) {
        return;
      }

      pointerActiveRef.current = false;
      emit(semanticActiveRef.current);
    };

    window.addEventListener("pointerdown", startPointerInteraction, true);
    window.addEventListener("mousedown", startPointerInteraction, true);
    window.addEventListener("touchstart", startPointerInteraction, true);
    window.addEventListener("pointerup", stopPointerInteraction, true);
    window.addEventListener("mouseup", stopPointerInteraction, true);
    window.addEventListener("touchend", stopPointerInteraction, true);
    window.addEventListener("pointercancel", stopPointerInteraction, true);
    window.addEventListener("touchcancel", stopPointerInteraction, true);
    window.addEventListener("blur", stopPointerInteraction);

    return () => {
      window.removeEventListener("pointerdown", startPointerInteraction, true);
      window.removeEventListener("mousedown", startPointerInteraction, true);
      window.removeEventListener("touchstart", startPointerInteraction, true);
      window.removeEventListener("pointerup", stopPointerInteraction, true);
      window.removeEventListener("mouseup", stopPointerInteraction, true);
      window.removeEventListener("touchend", stopPointerInteraction, true);
      window.removeEventListener("pointercancel", stopPointerInteraction, true);
      window.removeEventListener("touchcancel", stopPointerInteraction, true);
      window.removeEventListener("blur", stopPointerInteraction);
    };
  }, [containerRef, emit]);
}
