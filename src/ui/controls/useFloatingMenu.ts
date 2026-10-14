import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

// Transparent rather than hidden, so a menu can still focus its first item.
const unplacedPosition: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  opacity: 0,
  pointerEvents: "none",
};

/** Anchor a portaled menu without clipping it inside the inspector's scrollers. */
export function useFloatingMenu<T extends HTMLElement = HTMLElement>(
  width: number | "trigger",
  focusOnOpen = true,
  align: "start" | "center" = "start",
  heightLimit = Number.POSITIVE_INFINITY,
  minWidth = 0,
) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<T | null>(null);
  /** Optional element to place against instead of the trigger. */
  const anchorRef = useRef<HTMLElement | null>(null);
  // Until it is measured, keep a portaled panel out of the document flow so it
  // cannot extend or scroll the page.
  const [position, setPosition] = useState<CSSProperties>(unplacedPosition);
  // Some owners mount the panel after opening (e.g. once matches exist), so
  // placement follows the mounted element rather than only the open flag.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [panelRef] = useState<RefObject<HTMLDivElement | null>>(() => {
    let node: HTMLDivElement | null = null;
    return {
      get current() {
        return node;
      },
      set current(next) {
        node = next;
        setPanel(next);
      },
    };
  });

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger || !panel) return;

    const place = () => {
      const padding = 8;
      const gap = 6;
      const rect = (anchorRef.current ?? trigger).getBoundingClientRect();
      const panelWidth = Math.min(
        Math.max(width === "trigger" ? rect.width : width, minWidth),
        window.innerWidth - padding * 2,
      );
      const below = window.innerHeight - rect.bottom - gap - padding;
      const above = rect.top - gap - padding;
      const contentHeight =
        panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      const preferredHeight = Math.min(contentHeight, heightLimit);
      const showBelow = below >= preferredHeight || below >= above;
      const maxHeight = Math.max(
        0,
        Math.min(heightLimit, showBelow ? below : above),
      );
      const height = Math.min(contentHeight, maxHeight);
      setPosition({
        position: "fixed",
        zIndex: 1000,
        width: panelWidth,
        minWidth: 0,
        maxHeight,
        overflowY: "auto",
        left: Math.max(
          padding,
          Math.min(
            align === "center"
              ? rect.left + (rect.width - panelWidth) / 2
              : rect.left,
            window.innerWidth - panelWidth - padding,
          ),
        ),
        right: "auto",
        top: showBelow ? rect.bottom + gap : rect.top - gap - height,
      });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    // An anchor can grow while open, e.g. when a hint appears beneath a field.
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    if (focusOnOpen) {
      panel
        .querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        )
        ?.focus({ preventScroll: true });
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, panel, width, focusOnOpen, align, heightLimit, minWidth]);

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
  }, [open, panelRef]);

  return { open, setOpen, triggerRef, anchorRef, panelRef, position };
}
