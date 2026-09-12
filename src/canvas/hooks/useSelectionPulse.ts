import { useEffect, useState } from "react";

/** Animate selection ink only, keeping the shape still during edits or reduced motion. */
export function useSelectionPulse(
  selected: boolean,
  interacting: boolean,
): number {
  const [pulse, setPulse] = useState(0.5);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!selected || interacting || reducedMotion) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      setPulse(
        (Math.sin(((performance.now() - start) / 1800) * Math.PI * 2) + 1) / 2,
      );
    }, 40);
    return () => window.clearInterval(timer);
  }, [selected, interacting, reducedMotion]);
  return !selected || interacting || reducedMotion ? 0.5 : pulse;
}
