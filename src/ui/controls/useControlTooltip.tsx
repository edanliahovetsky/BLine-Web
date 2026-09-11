import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import "./ControlTooltip.css";

/** Keep explanations available to keyboard users when the visible label is an icon. */
export function useControlTooltip(text: string) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = () => {
    clearTimer();
    setPosition(null);
  };
  const show = (target: HTMLElement) => {
    clearTimer();
    const rect = target.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const below = rect.bottom + 100 < window.innerHeight;
    setPosition({
      left: Math.max(
        8,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - 8,
        ),
      ),
      width,
      ...(below
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    });
  };
  const hideSoon = () => {
    clearTimer();
    timer.current = setTimeout(hide, 120);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [position]);

  return {
    triggerProps: {
      "aria-describedby": position ? id : undefined,
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.matches(":focus-visible"))
          show(event.currentTarget);
      },
      onBlur: hide,
      onMouseEnter: (event: MouseEvent<HTMLElement>) => {
        clearTimer();
        const target = event.currentTarget;
        timer.current = setTimeout(() => show(target), 500);
      },
      onMouseLeave: hideSoon,
      onPointerDown: hide,
    },
    tooltip: position
      ? createPortal(
          <div
            id={id}
            role="tooltip"
            className="bline-control-tooltip"
            style={position}
            onMouseEnter={clearTimer}
            onMouseLeave={hideSoon}
          >
            {text}
          </div>,
          document.body,
        )
      : null,
  };
}
