import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WindowInfo, ViewMode } from "../lib/types";

interface WindowItemProps {
  window: WindowInfo;
  viewMode: ViewMode;
  iconSrc?: string;
  /** Font size in px for window/app name text. */
  fontSize?: number;
  /** When true, this item is rendered under an app-group header; icon and
   *  app name are omitted because the header already shows them. */
  grouped?: boolean;
  /** Optional callback when navigation fails. */
  onNavigationFailed?: () => void;
}

export function WindowItem({
  window,
  viewMode,
  iconSrc,
  fontSize = 12,
  grouped = false,
  onNavigationFailed,
}: WindowItemProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClick = async () => {
    try {
      await invoke("navigate_to_window", {
        appName: window.appName,
        windowTitle: window.title,
      });
      invoke("resign_focus").catch(() => {});
    } catch (err) {
      invoke("log_from_frontend", { level: "error", message: `[WindowItem] Navigation failed: ${err}` }).catch(() => {});
      onNavigationFailed?.();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCloseWindow = async () => {
    setContextMenu(null);
    try {
      await invoke("close_window", {
        appName: window.appName,
        windowTitle: window.title,
      });
    } catch (err) {
      invoke("log_from_frontend", { level: "error", message: `[WindowItem] Close window failed: ${err}` }).catch(() => {});
    }
  };

  // Close context menu on click outside or Escape.
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  // Full display string for list/hybrid modes and tooltips.
  const displayTitle =
    window.title && window.title !== window.appName
      ? `${window.appName} — ${window.title}`
      : window.appName;

  // Shared context menu overlay.
  const contextMenuOverlay = contextMenu && (
    <div
      ref={menuRef}
      className="fixed z-50 rounded shadow-lg py-1"
      style={{
        left: contextMenu.x,
        top: contextMenu.y,
        background: "rgb(39, 39, 42)",
        border: "1px solid var(--panel-border)",
        minWidth: "120px",
        paddingLeft: "2px",
        paddingRight: "2px",
      }}
    >
      <button
        onClick={handleCloseWindow}
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
        Close Window
      </button>
    </div>
  );

  if (viewMode === "compact") {
    // When grouped, show only the window title (or a dash for untitled).
    const compactLabel = grouped
      ? (window.title && window.title !== window.appName ? window.title : "—")
      : window.appName;
    return (
      <>
        <button
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors cursor-pointer w-full text-left"
          style={{
            background: "transparent",
            border: "none",
            fontSize: `${fontSize}px`,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover-bg)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title={displayTitle}
        >
          {!grouped && iconSrc && (
            <img
              src={iconSrc}
              alt=""
              className="flex-shrink-0"
              style={{ width: "14px", height: "14px" }}
            />
          )}
          <span
            className="truncate flex-1"
            style={{ color: grouped ? "var(--text-secondary)" : "var(--text-primary)" }}
          >
            {compactLabel}
          </span>
          {window.isMinimized && (
            <span
              className="flex-shrink-0"
              style={{ color: "var(--text-muted)", fontSize: "10px" }}
            >
              ⊖
            </span>
          )}
        </button>
        {contextMenuOverlay}
      </>
    );
  }

  // "hybrid" mode: app name + window title inline on one line.
  // When grouped, only show the window title (app name is in the header).
  if (viewMode === "hybrid") {
    const hasDistinctTitle = window.title && window.title !== window.appName;
    return (
      <>
        <button
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors cursor-pointer w-full text-left"
          style={{
            background: "transparent",
            border: "none",
            fontSize: `${fontSize}px`,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover-bg)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title={displayTitle}
        >
          {!grouped && iconSrc && (
            <img
              src={iconSrc}
              alt=""
              className="flex-shrink-0"
              style={{ width: "14px", height: "14px" }}
            />
          )}
          {!grouped && (
            <span
              className="flex-shrink-0"
              style={{ color: "var(--text-primary)" }}
            >
              {window.appName}
            </span>
          )}
          {grouped ? (
            <span
              className="truncate flex-1 min-w-0"
              style={{ color: "var(--text-secondary)" }}
            >
              {hasDistinctTitle ? window.title : "—"}
            </span>
          ) : (
            hasDistinctTitle && (
              <span
                className="truncate flex-1 min-w-0"
                style={{ color: "var(--text-secondary)" }}
              >
                — {window.title}
              </span>
            )
          )}
          {window.isMinimized && (
            <span
              className="flex-shrink-0"
              style={{ color: "var(--text-muted)", fontSize: "10px" }}
            >
              ⊖
            </span>
          )}
        </button>
        {contextMenuOverlay}
      </>
    );
  }

  // "list" mode: app name (bold, first line) + window title (muted, second line).
  // When grouped, only show the window title in a single-line layout.
  if (grouped) {
    const listLabel =
      window.title && window.title !== window.appName ? window.title : "—";
    return (
      <>
        <button
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors cursor-pointer w-full text-left"
          style={{
            background: "transparent",
            border: "none",
            fontSize: `${fontSize}px`,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--hover-bg)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title={displayTitle}
        >
          <span
            className="truncate flex-1"
            style={{ color: "var(--text-secondary)" }}
          >
            {listLabel}
          </span>
          {window.isMinimized && (
            <span
              className="flex-shrink-0"
              style={{ color: "var(--text-muted)", fontSize: "10px" }}
            >
              ⊖
            </span>
          )}
        </button>
        {contextMenuOverlay}
      </>
    );
  }

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="flex items-start gap-1.5 px-1.5 py-1 rounded transition-colors cursor-pointer w-full text-left"
        style={{
          background: "transparent",
          border: "none",
          fontSize: `${fontSize}px`,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--hover-bg)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
        title={displayTitle}
      >
        {iconSrc && (
          <img
            src={iconSrc}
            alt=""
            className="flex-shrink-0 mt-0.5"
            style={{ width: "14px", height: "14px" }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center">
            <span
              className="truncate flex-1"
              style={{ color: "var(--text-primary)" }}
            >
              {window.appName}
            </span>
            {window.isMinimized && (
              <span
                className="flex-shrink-0 ml-1"
                style={{ color: "var(--text-muted)", fontSize: "10px" }}
              >
                ⊖
              </span>
            )}
          </div>
          {window.title && window.title !== window.appName && (
            <span
              className="truncate block"
              style={{ color: "var(--text-secondary)" }}
            >
              {window.title}
            </span>
          )}
        </div>
      </button>
      {contextMenuOverlay}
    </>
  );
}
