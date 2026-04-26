import type { ReactNode } from "react";

import { ChevronDownIcon } from "../icons";

interface SidebarSectionProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  meta?: string;
  onToggle(): void;
  open: boolean;
  overlay?: ReactNode;
  sectionId: string;
  title: string;
}

export function SidebarSection({
  actions,
  children,
  className,
  meta,
  onToggle,
  open,
  overlay,
  sectionId,
  title
}: SidebarSectionProps) {
  const bodyId = `sidebar-section-${sectionId}-body`;

  return (
    <section
      className={["inspector-section", className, open ? "" : "is-collapsed"]
        .filter(Boolean)
        .join(" ")}
      aria-label={title}
    >
      <header className="inspector-section__header">
        <div className="sidebar-section-heading">
          <button
            type="button"
            className="sidebar-section-toggle"
            aria-label={open ? "Collapse section" : "Expand section"}
            aria-controls={bodyId}
            aria-expanded={open}
            data-testid={`sidebar-section-${sectionId}-toggle`}
            onClick={onToggle}
          >
            <ChevronDownIcon size={15} />
            <span className="sidebar-section-title">{title}</span>
          </button>
          {meta ? <span className="sidebar-section-meta">{meta}</span> : null}
        </div>
        {actions ? <div className="sidebar-section-actions">{actions}</div> : null}
      </header>
      <div
        id={bodyId}
        className="sidebar-section__body"
        data-testid={bodyId}
        hidden={!open}
      >
        {children}
      </div>
      {overlay}
    </section>
  );
}
