import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  FocusEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import type {
  Project,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import { ChevronDownIcon } from "../icons";
import { formatShortcut, type ShortcutBinding } from "./editorCommands";

export type TopMenuId =
  | "project"
  | "path"
  | "edit"
  | "view"
  | "help"
  | "actions";

interface TopMenuSubmenuContextValue {
  activeSubmenuId: string | null;
  closeDelayMs: number;
  setActiveSubmenuId(id: string | null): void;
}

const TopMenuSubmenuContext = createContext<TopMenuSubmenuContextValue | null>(
  null,
);

export function ToolbarPathNavigator({
  project,
  activeGroup,
  activePath,
  visiblePaths,
  onSelectGroup,
  onSelectPath,
}: {
  project: Project | null;
  activeGroup: ProjectPathGroup | null;
  activePath: ProjectPath | null;
  visiblePaths: ProjectPath[];
  onSelectGroup(groupId: string | null): void;
  onSelectPath(pathId: string): void;
}) {
  const collectionValue = activeGroup?.group_id ?? "__all_paths__";
  const collectionLabel = activeGroup?.display_name ?? "All Paths";
  const collectionOptions = [
    { label: "All Paths", value: "__all_paths__" },
    ...(project?.path_groups.map((group) => ({
      label: group.display_name,
      value: group.group_id,
    })) ?? []),
  ];
  const pathOptions =
    visiblePaths.length > 0
      ? visiblePaths.map((path) => ({
          label: path.display_name,
          value: path.path_id,
        }))
      : [{ label: "No paths", value: "__no_path__" }];
  const pathValue = activePath?.path_id ?? "__no_path__";
  const pathLabel = activePath?.display_name ?? "No paths";

  return (
    <div
      className="path-toolbar-navigator"
      data-testid="path-toolbar-nav"
      data-tour="path-breadcrumb"
    >
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--collection"
        style={toolbarSelectWidthStyle(collectionLabel, 14, 26)}
      >
        <ToolbarSelectControl
          ariaLabel="Toolbar collection"
          value={collectionValue}
          disabled={!project}
          options={collectionOptions}
          onChange={(value) =>
            onSelectGroup(value === "__all_paths__" ? null : value)
          }
        />
      </div>
      <span className="path-toolbar-navigator__separator" aria-hidden="true">
        /
      </span>
      <div
        className="path-toolbar-navigator__field path-toolbar-navigator__field--path"
        style={toolbarSelectWidthStyle(pathLabel, 15, 34)}
      >
        <ToolbarSelectControl
          ariaLabel="Toolbar path"
          value={pathValue}
          disabled={visiblePaths.length === 0}
          options={pathOptions}
          onChange={(value) => {
            if (value !== "__no_path__") {
              onSelectPath(value);
            }
          }}
        />
      </div>
    </div>
  );
}

interface ToolbarSelectOption<T extends string> {
  label: string;
  value: T;
}

function ToolbarSelectControl<T extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange(value: T): void;
  options: readonly ToolbarSelectOption<T>[];
  value: T;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectRelativeOption = (direction: 1 | -1) => {
    if (options.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const nextIndex =
      (currentIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];
    if (nextOption) {
      onChange(nextOption.value);
    }
  };

  return (
    <div
      className={`toolbar-select-control${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="toolbar-select-control__button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            selectRelativeOption(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <span className="toolbar-select-control__value">
          {selectedOption?.label ?? ""}
        </span>
        <span className="toolbar-select-control__indicator" aria-hidden="true">
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {open ? (
        <div
          className="toolbar-select-control__menu"
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} options`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={[
                "toolbar-select-control__option",
                option.value === value ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toolbarSelectWidthStyle(label: string, minCh: number, maxCh: number) {
  const widthCh = Math.max(minCh, Math.min(maxCh, label.length + 7));

  return {
    "--path-toolbar-field-width": `${widthCh}ch`,
  } as CSSProperties;
}

export function TopMenuButton({
  id,
  label,
  active = false,
  disabled = false,
  triggerRef,
  openTopMenu,
  setOpenTopMenu,
  onBeforeOpen,
  align = "start",
  children,
}: {
  id: TopMenuId;
  label: string;
  active?: boolean;
  disabled?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  openTopMenu: TopMenuId | null;
  setOpenTopMenu(menu: TopMenuId | null): void;
  onBeforeOpen?: () => Promise<unknown> | void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const open = openTopMenu === id;
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const submenuCloseDelayMs = id === "project" ? 220 : 100;
  const className = [
    "top-menu",
    `top-menu--${id}`,
    align === "end" ? "top-menu--align-end" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        className={active ? "is-active" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setActiveSubmenuId(null);
          if (!open) {
            void onBeforeOpen?.();
          }
          setOpenTopMenu(open ? null : id);
        }}
      >
        {label}
      </button>
      {open ? (
        <TopMenuSubmenuContext.Provider
          value={{
            activeSubmenuId,
            closeDelayMs: submenuCloseDelayMs,
            setActiveSubmenuId,
          }}
        >
          <div
            className="top-menu__panel"
            role="menu"
            data-testid={`top-menu-${id}`}
          >
            {children}
          </div>
        </TopMenuSubmenuContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuSubmenu({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const submenuId = useId();
  const submenuContext = useContext(TopMenuSubmenuContext);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const activeSubmenuIdRef = useRef<string | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const open = submenuContext
    ? submenuContext.activeSubmenuId === submenuId
    : localOpen;
  const closeDelayMs = submenuContext?.closeDelayMs ?? 100;
  const setActiveSubmenuId = submenuContext?.setActiveSubmenuId;

  useEffect(() => {
    activeSubmenuIdRef.current = submenuContext?.activeSubmenuId ?? null;
  }, [submenuContext?.activeSubmenuId]);

  const setSubmenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (setActiveSubmenuId) {
        if (nextOpen) {
          setActiveSubmenuId(submenuId);
          return;
        }

        if (activeSubmenuIdRef.current === submenuId) {
          setActiveSubmenuId(null);
        }
        return;
      }

      setLocalOpen(nextOpen);
    },
    [setActiveSubmenuId, submenuId],
  );

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePlacement = useCallback(() => {
    const rect = submenuRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const viewportMargin = 8;
    const flyoutGap = 6;
    const width = Math.min(
      266,
      Math.max(160, window.innerWidth - viewportMargin * 2),
    );
    const rightSpace =
      window.innerWidth - viewportMargin - rect.right - flyoutGap;
    const leftSpace = rect.left - viewportMargin - flyoutGap;
    const shouldOpenLeft = rightSpace < width && leftSpace > rightSpace;
    const idealLeft = shouldOpenLeft
      ? rect.left - flyoutGap - width
      : rect.right + flyoutGap;
    const left = Math.min(
      Math.max(viewportMargin, idealLeft),
      window.innerWidth - width - viewportMargin,
    );
    const top = Math.max(
      viewportMargin,
      Math.min(rect.top - 4, window.innerHeight - 128),
    );
    const maxHeight = Math.max(120, window.innerHeight - top - viewportMargin);

    setPlacement({
      left,
      maxHeight,
      top,
      width,
    });
  }, []);

  const openSubmenu = useCallback(() => {
    clearCloseTimer();
    updatePlacement();
    setSubmenuOpen(true);
  }, [clearCloseTimer, setSubmenuOpen, updatePlacement]);

  const getSubmenuPointerZone = useCallback((x: number, y: number) => {
    const triggerRect = submenuRef.current?.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    const bridgePadding = 4;
    const surfacePadding = 1;

    if (triggerRect && pointInsideRect(x, y, triggerRect, surfacePadding)) {
      return "surface";
    }

    if (panelRect && pointInsideRect(x, y, panelRect, surfacePadding)) {
      return "surface";
    }

    if (!triggerRect || !panelRect) {
      return "outside";
    }

    const horizontalGap =
      panelRect.left >= triggerRect.right
        ? { left: triggerRect.right, right: panelRect.left }
        : triggerRect.left >= panelRect.right
          ? { left: panelRect.right, right: triggerRect.left }
          : {
              left: Math.min(triggerRect.left, panelRect.left),
              right: Math.max(triggerRect.right, panelRect.right),
            };
    const bridgeRect = {
      bottom: Math.max(triggerRect.bottom, panelRect.bottom) + bridgePadding,
      left: horizontalGap.left - bridgePadding,
      right: horizontalGap.right + bridgePadding,
      top: Math.min(triggerRect.top, panelRect.top) - bridgePadding,
    };

    if (
      x >= bridgeRect.left &&
      x <= bridgeRect.right &&
      y >= bridgeRect.top &&
      y <= bridgeRect.bottom
    ) {
      return "bridge";
    }

    return "outside";
  }, []);

  const isSubmenuHovered = useCallback(() => {
    return Boolean(
      submenuRef.current?.matches(":hover") ||
      panelRef.current?.matches(":hover"),
    );
  }, []);

  const closeSubmenu = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const pointerPosition = pointerPositionRef.current;
      const pointerZone = pointerPosition
        ? getSubmenuPointerZone(pointerPosition.x, pointerPosition.y)
        : "outside";
      if (isSubmenuHovered() || pointerZone === "surface") {
        clearCloseTimer();
        return;
      }

      setSubmenuOpen(false);
    }, closeDelayMs);
  }, [
    clearCloseTimer,
    closeDelayMs,
    getSubmenuPointerZone,
    isSubmenuHovered,
    setSubmenuOpen,
  ]);

  const isInsideSubmenu = useCallback((target: EventTarget | null) => {
    return (
      target instanceof Node &&
      (Boolean(submenuRef.current?.contains(target)) ||
        Boolean(panelRef.current?.contains(target)))
    );
  }, []);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (isInsideSubmenu(event.relatedTarget)) {
      return;
    }

    closeSubmenu();
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    pointerPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    closeSubmenu();
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleReposition = () => updatePlacement();
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      pointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      const pointerZone = getSubmenuPointerZone(event.clientX, event.clientY);

      if (isInsideSubmenu(event.target) || pointerZone === "surface") {
        clearCloseTimer();
        return;
      }

      closeSubmenu();
    };
    const handlePointerOut = (event: globalThis.PointerEvent) => {
      if (event.relatedTarget !== null) {
        return;
      }

      pointerPositionRef.current = null;
      closeSubmenu();
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerout", handlePointerOut, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerout", handlePointerOut, true);
    };
  }, [
    clearCloseTimer,
    closeSubmenu,
    getSubmenuPointerZone,
    isInsideSubmenu,
    open,
    updatePlacement,
  ]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <div
      ref={submenuRef}
      className={`top-menu__submenu${open ? " is-open" : ""}`}
      role="none"
      onBlur={handleBlur}
      onFocus={openSubmenu}
      onPointerEnter={openSubmenu}
      onPointerLeave={handlePointerLeave}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="top-menu__item"
        onClick={openSubmenu}
      >
        <span className="top-menu__item-label">{label}</span>
        <span className="top-menu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && placement
        ? createPortal(
            <div
              ref={panelRef}
              className="top-menu__submenu-panel"
              role="menu"
              data-testid={testId}
              style={placement}
              onBlur={handleBlur}
              onFocus={openSubmenu}
              onPointerEnter={openSubmenu}
              onPointerLeave={handlePointerLeave}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuAction({
  label,
  shortcut,
  disabled = false,
  onAction,
}: {
  label: string;
  shortcut?: ShortcutBinding;
  disabled?: boolean;
  onAction(): void;
}) {
  const shortcutLabel = shortcut ? formatShortcut(shortcut) : "";
  return (
    <button
      type="button"
      role="menuitem"
      className="top-menu__item"
      disabled={disabled}
      onClick={onAction}
    >
      <span className="top-menu__item-label">{label}</span>
      {shortcutLabel ? <kbd>{shortcutLabel}</kbd> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="top-menu__label">{children}</div>;
}

function pointInsideRect(
  x: number,
  y: number,
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  padding = 0,
): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  );
}
