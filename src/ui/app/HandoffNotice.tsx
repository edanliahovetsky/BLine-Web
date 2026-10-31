import { useEffect, useRef, useState } from "react";
import type { HandoffOutcome } from "../../platform/originHandoff";

/** Explains, once, what happened when BLine moved to bline.run. */
export function HandoffNotice({ outcome }: { outcome: HandoffOutcome }) {
  const [open, setOpen] = useState(outcome.kind !== "none");
  const primaryRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  if (!open || outcome.kind === "none") return null;
  const dismiss = () => setOpen(false);

  let title: string;
  let message: string;
  let retry: { label: string; href?: string } | null = null;
  if (outcome.kind === "arrived") {
    title = "BLine moved to bline.run";
    message = `Your projects came with you from ${outcome.from}. The old address now opens bline.run.`;
  } else if (outcome.kind === "arrival-failed") {
    title = "Your projects didn’t arrive";
    message = outcome.from
      ? `${outcome.reason} They are still saved at ${outcome.from}.`
      : outcome.reason;
    retry = outcome.retryUrl
      ? { label: "Try again", href: outcome.retryUrl }
      : null;
  } else {
    title = "BLine moved to bline.run";
    message = `Your projects couldn’t be moved automatically. ${outcome.reason} They are still saved here; try again, or export the project folder and import it at bline.run.`;
    retry = { label: "Try again" };
  }

  return (
    <div
      className="config-dialog-backdrop mobile-warning-backdrop"
      role="presentation"
    >
      <section
        className="mobile-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-notice-title"
        aria-describedby="handoff-notice-description"
        data-testid="handoff-notice"
        data-outcome={outcome.kind}
      >
        <header className="mobile-warning-dialog__header">
          <h2 id="handoff-notice-title">{title}</h2>
        </header>
        <p id="handoff-notice-description">{message}</p>
        <footer className="mobile-warning-dialog__footer">
          {retry?.href ? (
            <a
              ref={(node) => {
                primaryRef.current = node;
              }}
              className="mobile-warning-dialog__action"
              href={retry.href}
            >
              {retry.label}
            </a>
          ) : retry ? (
            <button
              ref={(node) => {
                primaryRef.current = node;
              }}
              type="button"
              className="mobile-warning-dialog__action"
              onClick={() => location.reload()}
            >
              {retry.label}
            </button>
          ) : null}
          <button
            ref={(node) => {
              if (!retry) primaryRef.current = node;
            }}
            type="button"
            className="mobile-warning-dialog__action"
            onClick={dismiss}
          >
            {outcome.kind === "source-failed"
              ? "Keep working here"
              : "Continue"}
          </button>
        </footer>
      </section>
    </div>
  );
}
