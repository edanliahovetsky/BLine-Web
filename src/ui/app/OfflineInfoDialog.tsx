import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { ActionButton } from "../controls";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./OfflineInfoDialog.css";

export function OfflineInfoDialog({ onClose }: { onClose(): void }) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [dialogRef]);

  return (
    <div
      className="config-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="offline-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-info-title"
        aria-describedby="offline-info-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header>
          <WifiOff aria-hidden="true" size={22} />
          <h2 id="offline-info-title">Using BLine offline</h2>
        </header>
        <div
          id="offline-info-description"
          className="offline-info-dialog__body"
        >
          <p>
            BLine automatically prepares for offline use while you’re online.
            Once ready, you can open this same address in the same browser on
            this device—even without internet.
          </p>
          <p>
            You can edit paths, run simulations, and save your work locally.
            Updates download automatically when you’re connected.
          </p>
          <p>Bookmark BLine so it’s easy to find. No installation needed.</p>
        </div>
        <footer>
          <ActionButton tone="primary" onClick={onClose}>
            Got it
          </ActionButton>
        </footer>
      </section>
    </div>
  );
}
