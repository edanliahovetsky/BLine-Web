import type { SVGProps } from "react";
import type { AddableElementType } from "./sidebar/sidebarCommands";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

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
  ...props
}: IconProps & { type: AddableElementType }) {
  if (type === "event_trigger") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
        <path d="m13 2-8 12h6l-1 8 9-13h-6z" />
      </svg>
    );
  }

  if (type === "rotation") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
        <path d="M20 11a8 8 0 1 0-2.35 5.65" />
        <path d="M20 4v7h-7" />
      </svg>
    );
  }

  if (type === "translation") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
        <path d="M12 2v20M2 12h20" />
        <path d="m5 9-3 3 3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <circle cx="12" cy="12" r="7" />
    </svg>
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
