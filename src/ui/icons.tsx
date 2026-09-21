import type { SVGProps } from "react";
import type { AddableElementType } from "./sidebar/sidebarCommands";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function HandoffRadiusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="m12 12 5.5-5.5" />
    </svg>
  );
}

export function HandoffProgressIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 4v16M3 12h18m-3-3 3 3-3 3" />
    </svg>
  );
}

export function SplitSegmentIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M3 8h6v8H3zM15 8h6v8h-6zM12 4v16" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function FilePlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function OpenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M5 12h12" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="m16 3 5 5L8 21H3v-5z" />
      <path d="m14 5 5 5" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m6 6 1 16h10l1-16" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 21V9" />
      <path d="m7 14 5-5 5 5" />
      <path d="M5 3h14" />
    </svg>
  );
}

export function RemoveIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M10.4 13.6a4 4 0 0 1 0-5.7l1.4-1.4a4 4 0 1 1 5.7 5.7l-1.1 1.1" />
      <path d="M13.6 10.4a4 4 0 0 1 0 5.7l-1.4 1.4a4 4 0 1 1-5.7-5.7l1.1-1.1" />
      <path d="m9.5 14.5 5-5" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function UnlockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.6-1.8" />
    </svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M5 5v14" />
      <path d="m19 6-9 6 9 6V6Z" />
    </svg>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M19 5v14" />
      <path d="m5 6 9 6-9 6V6Z" />
    </svg>
  );
}

export function CurveIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M4 18C7 6 16 6 20 14" />
      <circle cx="4" cy="18" r="1.8" />
      <circle cx="20" cy="14" r="1.8" />
    </svg>
  );
}

export function ElementIcon({
  type,
  legacyAppearance = false,
  ...props
}: IconProps & {
  type: AddableElementType;
  legacyAppearance?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <ElementSymbol type={type} legacyAppearance={legacyAppearance} />
    </svg>
  );
}

/** The same forward-facing waypoint in both states; only the wheel arrows reverse. */
export function TankPreviewDirectionIcon({
  direction,
  legacyAppearance = false,
  ...props
}: IconProps & {
  direction: "forward" | "backward";
  legacyAppearance?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <g transform="translate(3 3) scale(.75)">
        <ElementSymbol type="waypoint" legacyAppearance={legacyAppearance} />
      </g>
      <g
        strokeWidth={1.5}
        transform={direction === "backward" ? "rotate(180 12 12)" : undefined}
      >
        <path d="M2.5 19V5m-1.5 2.5L2.5 5 4 7.5M21.5 19V5M20 7.5 21.5 5 23 7.5" />
      </g>
    </svg>
  );
}

export function ElementBadge({
  type,
  legacyAppearance = false,
}: {
  type: AddableElementType;
  legacyAppearance?: boolean;
}) {
  return (
    <span aria-hidden="true" className={`element-type-mark type-${type}`}>
      <svg viewBox="0 0 22 22" {...iconProps({ size: 22 })}>
        {/* Paint the circle and symbol together to keep their centers aligned. */}
        <circle
          cx="11"
          cy="11"
          r="11"
          fill="var(--element-badge-color)"
          stroke="none"
        />
        <g transform={`translate(4 4) scale(${14 / 24})`}>
          <ElementSymbol type={type} legacyAppearance={legacyAppearance} />
        </g>
      </svg>
    </span>
  );
}

function ElementSymbol({
  type,
  legacyAppearance,
}: {
  type: AddableElementType;
  legacyAppearance: boolean;
}) {
  if (type === "event_trigger") {
    return <path d="m13 2-8 12h6l-1 8 9-13h-6z" />;
  }

  if (type === "rotation") {
    return (
      <>
        <path d="M20 11a8 8 0 1 0-2.35 5.65" />
        <path d="M20 4v7h-7" transform="rotate(10 20 11)" />
      </>
    );
  }

  if (type === "translation") {
    return (
      <>
        <circle cx="12" cy="12" r="6" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </>
    );
  }

  if (legacyAppearance) {
    return (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="m12 8.5 3.5 7h-7z" strokeWidth={1.5} />
      </>
    );
  }

  return (
    <>
      <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="4" r="1.8" fill="currentColor" stroke="none" />
    </>
  );
}

function iconProps({
  size,
  width,
  height,
  ...props
}: IconProps): SVGProps<SVGSVGElement> {
  const iconSize = size ?? 18;

  return {
    fill: "none",
    height: height ?? iconSize,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    width: width ?? iconSize,
    ...props,
  };
}
