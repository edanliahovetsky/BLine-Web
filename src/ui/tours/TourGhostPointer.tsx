import { useEffect, useState } from "react";
import { MousePointer2 } from "lucide-react";

const travelMs = 700;
const lingerMs = 2200;

/**
 * Show me's pointer: it glides from the Show me button to the next control,
 * clicks, then fades. When the learner moves on, it glides from where it last
 * pointed to the new stop.
 */
export function TourGhostPointer({
  to,
  stop,
}: {
  to: { x: number; y: number };
  /** Changes when the pointer should travel and click again. */
  stop: string;
}) {
  const [origin] = useState(() => {
    const button = document
      .querySelector('[data-testid="tour-show-me"]')
      ?.getBoundingClientRect();
    return button
      ? { x: button.left + button.width / 2, y: button.top + button.height / 2 }
      : to;
  });
  const [departed, setDeparted] = useState(false);
  const [phase, setPhase] = useState({
    stop,
    arrived: false,
    hidden: false,
  });
  if (phase.stop !== stop) setPhase({ stop, arrived: false, hidden: false });

  // Render once at the button so the first move animates from there.
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => setDeparted(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const arrive = window.setTimeout(
      () =>
        setPhase((current) =>
          current.stop === stop ? { ...current, arrived: true } : current,
        ),
      travelMs,
    );
    const hide = window.setTimeout(
      () =>
        setPhase((current) =>
          current.stop === stop ? { ...current, hidden: true } : current,
        ),
      travelMs + lingerMs,
    );
    return () => {
      window.clearTimeout(arrive);
      window.clearTimeout(hide);
    };
  }, [stop]);

  const at = departed ? to : origin;
  return (
    <div
      className={`tour-ghost${phase.arrived ? " is-arrived" : ""}${
        phase.hidden ? " is-hidden" : ""
      }`}
      data-testid="tour-ghost"
      aria-hidden="true"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <span className="tour-ghost__ripple" />
      <MousePointer2 className="tour-ghost__cursor" size={22} />
    </div>
  );
}
