import { WifiOff } from "lucide-react";
import { detectEnvironmentCapabilities } from "../../env/capabilities";
import { useControlTooltip } from "../controls";

const description = "BLine is running from this browser’s offline copy.";

/** `lesson` shows the icon in place so the offline lesson can point at it. */
export function OfflineIndicator({ lesson = false }: { lesson?: boolean }) {
  const { triggerProps, tooltip } = useControlTooltip(description);
  const servedOffline =
    import.meta.env.PROD &&
    detectEnvironmentCapabilities().shell === "browser-web" &&
    document.querySelector<HTMLMetaElement>('meta[name="bline-offline"]')
      ?.content === "true";

  if (!servedOffline && !lesson) return null;
  return (
    <>
      <span
        {...triggerProps}
        className="workspace-status__offline"
        data-testid="offline-indicator"
        data-tour="offline-indicator"
        role="img"
        aria-label={description}
        tabIndex={0}
      >
        <WifiOff size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      {tooltip}
    </>
  );
}
