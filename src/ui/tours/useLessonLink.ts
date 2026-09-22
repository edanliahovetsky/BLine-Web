import { useEffect, useRef } from "react";
import { findTour } from "./tours";

/** Opens a documentation link through the same guarded session as the lesson picker. */
export function useLessonLink({
  canStart,
  start,
  onUnavailable,
}: {
  canStart(): boolean;
  start(id: string): boolean;
  onUnavailable(): void;
}) {
  const requestedLesson = useRef<string | null | undefined>(undefined);

  // Retry on editor updates, including when loading, saving, or a dialog ends.
  useEffect(() => {
    if (requestedLesson.current === undefined) {
      requestedLesson.current = new URL(window.location.href).searchParams.get(
        "lesson",
      );
    }
    const id = requestedLesson.current;
    if (id === null || !canStart()) return;

    const unavailable = findTour(id) === null;
    if (!unavailable && !start(id)) return;

    requestedLesson.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("lesson");
    // Consume only this request so refresh cannot restart a completed lesson.
    window.history.replaceState(window.history.state, "", url);
    if (unavailable) onUnavailable();
  });
}
