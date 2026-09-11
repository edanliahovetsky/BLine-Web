import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** Anchor a portaled menu without clipping it inside the inspector's scrollers. */
export function useFloatingMenu(width: number) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;

    const place = () => {
      const padding = 8;
      const gap = 6;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = Math.min(width, window.innerWidth - padding * 2);
      const below = window.innerHeight - rect.bottom - gap - padding;
      const above = rect.top - gap - padding;
      const showBelow = below >= panel.scrollHeight || below >= above;
      const maxHeight = Math.max(0, showBelow ? below : above);
      const height = Math.min(panel.scrollHeight, maxHeight);
      setPosition({
        position: "fixed",
        zIndex: 1000,
        width: panelWidth,
        minWidth: 0,
        maxHeight,
        overflowY: "auto",
        left: Math.max(
          padding,
          Math.min(rect.left, window.innerWidth - panelWidth - padding),
        ),
        right: "auto",
        top: showBelow ? rect.bottom + gap : rect.top - gap - height,
      });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    panel
      .querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
      ?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return { open, setOpen, triggerRef, panelRef, position };
}
