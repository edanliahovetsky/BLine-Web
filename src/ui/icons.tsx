import type { SVGProps } from "react";
import type { AddableElementType } from "./sidebar/sidebarCommands";

type IconProps = SVGProps<SVGSVGElement>;

export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...iconProps(props)}>
      <path d="M12 5v14M5 12h14" />
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

function iconProps(props: IconProps): IconProps {
  return {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    ...props
  };
}
