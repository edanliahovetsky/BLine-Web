import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocusTrap<T extends HTMLElement>(
  additionalFocusScope?: string,
) {
  const dialogRef = useRef<T | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    if (!dialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ...(additionalFocusScope
          ? (document
              .querySelector(additionalFocusScope)
              ?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
          : []),
      ].filter((element) => !element.hidden && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const eventRoot = additionalFocusScope ? document : dialog;
    eventRoot.addEventListener("keydown", handleKeyDown as EventListener);
    return () => {
      eventRoot.removeEventListener("keydown", handleKeyDown as EventListener);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [additionalFocusScope]);

  return dialogRef;
}
