import { memo, useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { CSSProperties, FocusEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { SpaceInfo, ViewMode } from "../lib/types";
import { WindowItem } from "./WindowItem";

interface SpaceCardProps {
  space: SpaceInfo;
  activeSpaceId: number;
  viewMode: ViewMode;
  appIcons: Record<string, string>;
  spaceNameFontSize: number;
  windowFontSize: number;
  /** Total number of displays detected. Indicator hidden when 1. */
  totalDisplays: number;
  /** 1-based number for external displays (undefined for built-in). */
  externalDisplayNumber?: number;
  /** Panel orientation for layout adjustments. */
  orientation?: "vertical" | "horizontal";
  /** Number of incomplete to-do items for this space. */
  todoCount?: number;
  /** Whether the tasks feature is enabled. */
  enableTodos?: boolean;
  /** Whether space names should render in bold. */
  spaceNameBold?: boolean;
  onSetCollapsed: (spaceId: number, collapsed: boolean) => void;
  onSetLabel: (spaceId: number, label: string) => void;
  onSetSpaceNameColor: (spaceId: number, color: string | null) => void;
}

function windowsEqual(
  prev: SpaceCardProps["space"]["windows"],
  next: SpaceCardProps["space"]["windows"],
) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.windowId !== b.windowId ||
      a.title !== b.title ||
      a.appName !== b.appName ||
      a.bundleId !== b.bundleId ||
      a.isMinimized !== b.isMinimized
    ) {
      return false;
    }
  }
  return true;
}

function spaceCardPropsEqual(prev: SpaceCardProps, next: SpaceCardProps) {
  const prevIsActive = prev.space.spaceId === prev.activeSpaceId;
  const nextIsActive = next.space.spaceId === next.activeSpaceId;
  return (
    prevIsActive === nextIsActive &&
    prev.viewMode === next.viewMode &&
    prev.appIcons === next.appIcons &&
    prev.spaceNameFontSize === next.spaceNameFontSize &&
    prev.windowFontSize === next.windowFontSize &&
    prev.totalDisplays === next.totalDisplays &&
    prev.externalDisplayNumber === next.externalDisplayNumber &&
    prev.orientation === next.orientation &&
    prev.todoCount === next.todoCount &&
    prev.enableTodos === next.enableTodos &&
    prev.spaceNameBold === next.spaceNameBold &&
    prev.onSetCollapsed === next.onSetCollapsed &&
    prev.onSetLabel === next.onSetLabel &&
    prev.onSetSpaceNameColor === next.onSetSpaceNameColor &&
    prev.space.spaceId === next.space.spaceId &&
    prev.space.spaceIndex === next.space.spaceIndex &&
    prev.space.displayId === next.space.displayId &&
    prev.space.label === next.space.label &&
    prev.space.spaceNameColor === next.space.spaceNameColor &&
    prev.space.isActive === next.space.isActive &&
    prev.space.isVisible === next.space.isVisible &&
    prev.space.isCollapsed === next.space.isCollapsed &&
    prev.space.isBuiltinDisplay === next.space.isBuiltinDisplay &&
    windowsEqual(prev.space.windows, next.space.windows)
  );
}

export const SpaceCard = memo(SpaceCardComponent, spaceCardPropsEqual);

/** Tiny laptop silhouette (built-in display). */
const LaptopIcon = () => (
  <svg width="12" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="0.5" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
    <path d="M0 9h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

/** Tiny external monitor silhouette. */
const MonitorIcon = () => (
  <svg width="12" height="11" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="0.5" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 9.5v1.5M9 9.5v1.5M4 11.5h6" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" />
  </svg>
);

const DEFAULT_SPACE_NAME_COLOR = "#3b82f6";

function normalizeColorInput(color?: string | null) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_SPACE_NAME_COLOR;
}

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

function SpaceCardComponent({ space, activeSpaceId, viewMode, appIcons, spaceNameFontSize, windowFontSize, totalDisplays, externalDisplayNumber, orientation = "vertical", todoCount = 0, enableTodos = true, spaceNameBold = false, onSetCollapsed, onSetLabel, onSetSpaceNameColor }: SpaceCardProps) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(space.label);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [flashError, setFlashError] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuPos, setActionMenuPos] = useState({ left: 0, top: 0 });
  const [headerWidth, setHeaderWidth] = useState<number | null>(null);
  const [labelClipped, setLabelClipped] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelTextRef = useRef<HTMLSpanElement>(null);

  const triggerNavigationFailureFlash = useCallback(() => {
    setFlashError(true);
    if (flashTimeoutRef.current != null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setFlashError(false);
      flashTimeoutRef.current = null;
    }, 700);
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync draft when label changes externally.
  useEffect(() => {
    if (!editing) {
      setLabelDraft(space.label);
    }
  }, [space.label, editing]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // Always show the space number for Mission Control reference.
  // Format: "X · Label" or "X · Desktop" for consistency.
  const displayLabel = `${space.spaceIndex} · ${space.label || "Desktop"}`;
  const spaceNameColor = space.spaceNameColor || "var(--accent-blue)";
  const colorInputValue = normalizeColorInput(space.spaceNameColor);
  const spaceNameFontWeight = spaceNameBold ? 700 : 400;
  const actionsShouldOverflow = headerWidth != null && headerWidth < 135 && !editing;

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;

    const updateWidth = () => setHeaderWidth(node.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [orientation, space.isCollapsed]);

  useEffect(() => {
    const node = labelTextRef.current;
    if (!node || editing) {
      setLabelClipped(false);
      return;
    }

    const updateClipped = () => {
      setLabelClipped(node.scrollWidth > node.clientWidth + 1);
    };
    updateClipped();
    const observer = new ResizeObserver(updateClipped);
    observer.observe(node);
    return () => observer.disconnect();
  }, [displayLabel, editing, orientation, space.isCollapsed, spaceNameFontSize, spaceNameBold]);

  const handleNavigateToSpace = async () => {
    if (space.isActive) return;
    try {
      // Pick the first window title in the target space for window-based nav.
      const windowTitle =
        space.windows.length > 0 ? space.windows[0].title : null;
      await invoke("navigate_to_space", {
        spaceIndex: space.spaceIndex,
        currentSpaceId: activeSpaceId,
        targetSpaceId: space.spaceId,
        windowTitle,
      });
      invoke("resign_focus").catch(() => {});
    } catch (err) {
      feLog("error", `[SpaceCard] navigate_to_space failed: ${err}`);
      triggerNavigationFailureFlash();
    }
  };

  const handleToggleCollapse = () => {
    onSetCollapsed(space.spaceId, !space.isCollapsed);
  };

  const commitLabel = () => {
    setEditing(false);
    const trimmed = labelDraft.trim();
    if (trimmed === space.label) {
      return;
    }
    onSetLabel(space.spaceId, trimmed);
  };

  const handleSpaceNameColorChange = (color: string) => {
    onSetSpaceNameColor(space.spaceId, color);
  };

  const handleClearSpaceNameColor = () => {
    onSetSpaceNameColor(space.spaceId, null);
  };

  const renderSpaceLabelButton = () => (
    <button
      onClick={handleNavigateToSpace}
      className="flex-1 text-left cursor-pointer"
      style={{
        color: spaceNameColor,
        background: "transparent",
        border: "none",
        fontSize: `${spaceNameFontSize}px`,
        fontWeight: spaceNameFontWeight,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
        paddingRight: labelClipped ? "5px" : 0,
      }}
      title="Click to navigate"
    >
      <span
        ref={labelTextRef}
        style={{
          display: "block",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {displayLabel}
      </span>
      {labelClipped && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 0,
            top: "2px",
            bottom: "2px",
            width: "1px",
            background: "currentColor",
            opacity: 0.8,
            pointerEvents: "none",
          }}
        />
      )}
    </button>
  );

  const handleEditControlBlur = (event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof HTMLElement &&
      nextTarget.dataset.spaceEditControl === "true"
    ) {
      return;
    }
    commitLabel();
  };

  const renderEditControls = () => (
    <>
      <input
        ref={inputRef}
        data-space-edit-control="true"
        value={labelDraft}
        onChange={(e) => setLabelDraft(e.target.value)}
        onBlur={handleEditControlBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitLabel();
          if (e.key === "Escape") {
            setLabelDraft(space.label);
            setEditing(false);
          }
        }}
        className="flex-1 px-1 py-0 rounded outline-none"
        style={{
          color: "var(--text-primary)",
          background: "rgba(63, 63, 70, 0.6)",
          border: "1px solid var(--accent-blue)",
          fontSize: `${spaceNameFontSize}px`,
          fontWeight: spaceNameFontWeight,
          minWidth: 0,
        }}
      />
      <input
        type="color"
        data-space-edit-control="true"
        value={colorInputValue}
        onChange={(e) => handleSpaceNameColorChange(e.target.value)}
        onBlur={handleEditControlBlur}
        title="Space name color"
        className="flex-shrink-0 cursor-pointer"
        style={{
          width: "18px",
          height: "18px",
          padding: 0,
          border: "none",
          background: "transparent",
        }}
      />
      {space.spaceNameColor && (
        <button
          data-space-edit-control="true"
          onMouseDown={(e) => e.preventDefault()}
          onBlur={handleEditControlBlur}
          onClick={handleClearSpaceNameColor}
          title="Reset color"
          className="flex-shrink-0 cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "11px",
            lineHeight: 1,
            padding: "1px",
          }}
        >
          ×
        </button>
      )}
    </>
  );

  const handleOpenTodos = useCallback(async () => {
    const windowLabel = `space-todo-${space.spaceId}`;
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setFocus();
      return;
    }
    const params = new URLSearchParams();
    params.set("spaceId", String(space.spaceId));
    const displayName = space.label
      ? `Desktop ${space.spaceIndex} \u2013 ${space.label}`
      : `Desktop ${space.spaceIndex}`;
    params.set("spaceName", displayName);
    new WebviewWindow(windowLabel, {
      url: `/?${params.toString()}`,
      title: `To-Dos — ${displayName}`,
      width: 340,
      height: 420,
      resizable: true,
      decorations: false,
      transparent: true,
      center: true,
      alwaysOnTop: true,
    });
  }, [space.spaceId, space.label, space.spaceIndex]);

  const isActive = space.spaceId === activeSpaceId;

  const actionButtonStyle: CSSProperties = {
    color: "var(--text-muted)",
    background: "transparent",
    border: "none",
    fontSize: "11px",
    lineHeight: 1,
    padding: "1px",
  };

  const renderRenameButton = () => (
    !editing && (
      <button
        onClick={() => setEditing(true)}
        className="flex-shrink-0 cursor-pointer"
        style={actionButtonStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        title="Rename or color space"
      >
        ✎
      </button>
    )
  );

  const renderTodoButton = () => (
    enableTodos && (
      <button
        onClick={handleOpenTodos}
        className="flex-shrink-0 cursor-pointer"
        style={{
          ...actionButtonStyle,
          color: todoCount > 0 ? "var(--accent-blue)" : "var(--text-muted)",
          position: "relative",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = todoCount > 0 ? "var(--accent-blue)" : "var(--text-muted)")}
        title={todoCount > 0 ? `${todoCount} open to-do${todoCount !== 1 ? "s" : ""}` : "To-dos"}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 5 11 9 5" />
          <line x1="11" y1="4" x2="15" y2="4" />
          <line x1="11" y1="8" x2="15" y2="8" />
          <line x1="11" y1="12" x2="15" y2="12" />
          <line x1="2" y1="4" x2="5" y2="4" />
          <line x1="2" y1="12" x2="5" y2="12" />
        </svg>
        {todoCount > 0 && (
          <span style={{
            position: "absolute",
            top: "-4px",
            right: "-5px",
            background: "var(--accent-blue)",
            color: "#fff",
            fontSize: "7px",
            fontWeight: 700,
            lineHeight: "10px",
            minWidth: "10px",
            height: "10px",
            borderRadius: "5px",
            padding: "0 2px",
            textAlign: "center",
            pointerEvents: "none",
          }}>
            {todoCount > 99 ? "99+" : todoCount}
          </span>
        )}
      </button>
    )
  );

  const renderWindowCount = () => (
    <span
      className="text-xs flex-shrink-0 px-1 rounded"
      style={{
        color: "var(--text-muted)",
        background: space.windows.length > 0 ? "rgba(63, 63, 70, 0.4)" : "transparent",
        fontSize: "10px",
      }}
    >
      {space.windows.length > 0 ? space.windows.length : ""}
    </span>
  );

  const renderCollapseButton = () => (
    <button
      onClick={handleToggleCollapse}
      className="text-xs flex-shrink-0 cursor-pointer"
      style={{
        color: "var(--text-muted)",
        background: "transparent",
        border: "none",
        lineHeight: 1,
        width: "13px",
        height: "14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
      title={space.isCollapsed ? "Expand" : "Collapse"}
    >
      {space.isCollapsed ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 6 8 2 12 6" />
          <polyline points="4 10 8 14 12 10" />
        </svg>
      ) : (
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 2 8 6 12 2" />
          <polyline points="4 14 8 10 12 14" />
        </svg>
      )}
    </button>
  );

  const renderOverflowActions = () => (
    <div className="relative flex-shrink-0">
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const menuWidth = 128;
          const margin = 4;
          setActionMenuPos({
            left: Math.max(margin, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - margin)),
            top: Math.min(rect.bottom + 2, window.innerHeight - margin),
          });
          setActionMenuOpen((prev) => !prev);
        }}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "13px",
          height: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        title="Space actions"
      >
        ▾
      </button>
      {actionMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActionMenuOpen(false)} />
          <div
            className="fixed z-50 rounded shadow-lg py-1"
            style={{
              left: `${actionMenuPos.left}px`,
              top: `${actionMenuPos.top}px`,
              minWidth: "128px",
              background: "rgb(39, 39, 42)",
              border: "1px solid var(--panel-border)",
              paddingLeft: "2px",
              paddingRight: "2px",
            }}
          >
            <button
              onClick={() => {
                setActionMenuOpen(false);
                setEditing(true);
              }}
              className="w-full text-left px-3 py-1 text-xs cursor-pointer"
              style={{ color: "var(--text-primary)", background: "transparent", border: "none" }}
            >
              Rename / Color
            </button>
            {enableTodos && (
              <button
                onClick={() => {
                  setActionMenuOpen(false);
                  handleOpenTodos();
                }}
                className="w-full text-left px-3 py-1 text-xs cursor-pointer"
                style={{ color: "var(--text-primary)", background: "transparent", border: "none" }}
              >
                To-dos{todoCount > 0 ? ` (${todoCount})` : ""}
              </button>
            )}
            <div className="px-3 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Windows: {space.windows.length}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderActionGroup = () => (
    <div
      className="flex items-center flex-shrink-0"
      style={{ gap: "3px" }}
    >
      {actionsShouldOverflow ? (
        <>
          {renderCollapseButton()}
          {renderOverflowActions()}
        </>
      ) : (
        <>
          {renderRenameButton()}
          {renderTodoButton()}
          {renderWindowCount()}
          {renderCollapseButton()}
        </>
      )}
    </div>
  );

  // Sort windows by appName so windows from the same application appear
  // consecutively, while each window remains its own full entry.
  const sortedWindows = useMemo(
    () =>
      [...space.windows].sort((a, b) =>
        a.appName.localeCompare(b.appName, undefined, { sensitivity: "base" })
      ),
    [space.windows]
  );

  return (
    <div
      className="rounded-md mb-0.5 overflow-hidden"
      style={{
        background: flashError
          ? "var(--error-flash-bg)"
          : isActive
            ? "var(--active-space-bg)"
            : "transparent",
        border: flashError
          ? "1px solid var(--error-flash-border)"
          : isActive
            ? "1px solid var(--active-space-border)"
            : "1px solid transparent",
        transition: "background 200ms ease, border-color 200ms ease",
      }}
    >
      {/* Header */}
      {orientation === "horizontal" && space.isCollapsed ? (
        /* ── Horizontal collapsed: two-row header so columns can be narrower ── */
        <div
          className="px-1.5 py-1"
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuPos({ x: e.clientX, y: e.clientY });
            setShowContextMenu(true);
          }}
        >
          {/* Row 1: active dot, monitor, controls */}
          <div ref={headerRef} className="flex items-center gap-1 mb-0.5">
            {/* Active/visible indicator */}
            {space.isVisible && (
              <span
                className="flex-shrink-0 rounded-full"
                style={{
                  width: "7px",
                  height: "7px",
                  background: "var(--accent-green)",
                }}
              />
            )}

            {/* Monitor indicator */}
            {totalDisplays > 1 && (
              <span
                className="flex-shrink-0 flex items-center gap-px"
                title={
                  space.isBuiltinDisplay
                    ? "Built-in display"
                    : externalDisplayNumber != null
                      ? `External display ${externalDisplayNumber}`
                      : "External display"
                }
                style={{
                  color: "var(--text-muted)",
                  opacity: 0.75,
                }}
              >
                {space.isBuiltinDisplay ? <LaptopIcon /> : <MonitorIcon />}
                {!space.isBuiltinDisplay && externalDisplayNumber != null && totalDisplays > 2 && (
                  <span style={{ fontSize: "8px", lineHeight: 1 }}>
                    {externalDisplayNumber}
                  </span>
                )}
              </span>
            )}

            {/* Spacer to push controls right */}
            <div className="flex-1" />

            {renderActionGroup()}
          </div>

          {/* Row 2: space name */}
          <div className="flex items-center gap-1">
            {editing ? (
              renderEditControls()
            ) : (
            renderSpaceLabelButton()
            )}
          </div>
        </div>
      ) : (
        /* ── Vertical mode: single-row header ── */
        <div
          ref={headerRef}
          className="flex items-center gap-1 px-1.5 py-1"
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuPos({ x: e.clientX, y: e.clientY });
            setShowContextMenu(true);
          }}
        >
          {space.isVisible && (
            <span
              className="flex-shrink-0 rounded-full"
              style={{
                width: "7px",
                height: "7px",
                background: "var(--accent-green)",
              }}
            />
          )}

          {totalDisplays > 1 && (
            <span
              className="flex-shrink-0 flex items-center gap-px"
              title={
                space.isBuiltinDisplay
                  ? "Built-in display"
                  : externalDisplayNumber != null
                    ? `External display ${externalDisplayNumber}`
                    : "External display"
              }
              style={{
                color: "var(--text-muted)",
                opacity: 0.75,
              }}
            >
              {space.isBuiltinDisplay ? <LaptopIcon /> : <MonitorIcon />}
              {!space.isBuiltinDisplay && externalDisplayNumber != null && totalDisplays > 2 && (
                <span style={{ fontSize: "8px", lineHeight: 1 }}>
                  {externalDisplayNumber}
                </span>
              )}
            </span>
          )}

          {editing ? (
            renderEditControls()
          ) : (
            renderSpaceLabelButton()
          )}

          {renderActionGroup()}
        </div>
      )}

      {/* Right-click context menu */}
      {showContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowContextMenu(false)}
          />
          <div
            className="fixed z-50 rounded shadow-lg py-1"
            style={{
              left: `${contextMenuPos.x}px`,
              top: `${contextMenuPos.y}px`,
              background: "rgb(39, 39, 42)",
              border: "1px solid var(--panel-border)",
              minWidth: "140px",
              paddingLeft: "2px",
              paddingRight: "2px",
            }}
          >
            <button
              onClick={() => {
                setShowContextMenu(false);
                setEditing(true);
              }}
              className="w-full text-left px-3 py-1 text-xs cursor-pointer"
              style={{
                color: "var(--text-primary)",
                background: "transparent",
                border: "none",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--hover-bg)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              Rename Space
            </button>
            {!isActive && (
              <button
                onClick={async () => {
                  setShowContextMenu(false);
                  feLog("info", `[SpaceCard] Close space requested for space ${space.spaceIndex}`);
                  try {
                    await invoke("close_space", { spaceIndex: space.spaceIndex });
                    feLog("info", `[SpaceCard] close_space invoke returned for space ${space.spaceIndex}`);
                  } catch (err) {
                    feLog("error", `[SpaceCard] close_space failed: ${err}`);
                  }
                }}
                className="w-full text-left px-3 py-1 text-xs cursor-pointer"
                style={{
                  color: "#ef4444",
                  background: "transparent",
                  border: "none",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--hover-bg)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                Close Space (experimental)
              </button>
            )}
          </div>
        </>
      )}

      {/* Window list sorted by app (if not collapsed and not in count-only mode) */}
      {!space.isCollapsed && viewMode !== "count" && sortedWindows.length > 0 && (
        <div className="pb-1" style={{ paddingLeft: "20px" }}>
          {sortedWindows.map((w) => (
            <WindowItem
              key={w.windowId}
              window={w}
              viewMode={viewMode}
              iconSrc={appIcons[w.bundleId]}
              fontSize={windowFontSize}
              onNavigationFailed={triggerNavigationFailureFlash}
            />
          ))}
        </div>
      )}
    </div>
  );
}
