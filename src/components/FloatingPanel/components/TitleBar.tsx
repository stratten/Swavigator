import type { ViewMode } from "../../../lib/types";

interface TitleBarProps {
  viewMode: ViewMode;
  showSearch: boolean;
  allCollapsed: boolean;
  orientation: "vertical" | "horizontal";
  dockMode?: boolean;
  totalTodoCount?: number;
  enableTodos?: boolean;
  onOpenSettings: () => void;
  onOpenAllTodos: () => void;
  onCollapse: () => void;
  onToggleSearch: () => void;
  onCycleViewMode: () => void;
  onToggleAllSpaces: () => void;
  onToggleOrientation: () => void;
  onToggleDockMode?: () => void;
}

const viewModeLabel: Record<ViewMode, string> = {
  compact: "◻",
  list: "☰",
  hybrid: "⊞",
  count: "#",
};

/**
 * The title bar / header of the expanded floating panel.
 */
export function TitleBar({
  viewMode,
  showSearch,
  allCollapsed,
  orientation,
  dockMode = false,
  totalTodoCount = 0,
  enableTodos = true,
  onOpenSettings,
  onOpenAllTodos,
  onCollapse,
  onToggleSearch,
  onCycleViewMode,
  onToggleAllSpaces,
  onToggleOrientation,
  onToggleDockMode,
}: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex flex-wrap items-center flex-shrink-0 cursor-grab"
      style={{
        borderBottom: "1px solid var(--panel-border)",
        paddingLeft: "10px",
        paddingRight: "8px",
        paddingTop: "8px",
        paddingBottom: "8px",
        gap: "8px",
      }}
    >
      <span
        data-tauri-drag-region
        className="font-semibold pointer-events-none"
        style={{ color: "var(--text-primary)", fontSize: "13px" }}
      >
        Swavigator
      </span>

      {/* Spacer pushes toolbar buttons to the right */}
      <span data-tauri-drag-region style={{ flex: 1 }} />

      {/* All To-Dos (hidden when tasks feature is disabled) */}
      {enableTodos && (
        <button
          onClick={onOpenAllTodos}
          className="rounded cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            lineHeight: 1,
            padding: "2px",
            paddingRight: totalTodoCount > 0 ? "8px" : "2px",
            position: "relative",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--text-muted)")
          }
          title="All To-Dos"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2 8 5 11 9 5" />
            <line x1="11" y1="4" x2="15" y2="4" />
            <line x1="11" y1="8" x2="15" y2="8" />
            <line x1="11" y1="12" x2="15" y2="12" />
            <line x1="2" y1="4" x2="5" y2="4" />
            <line x1="2" y1="12" x2="5" y2="12" />
          </svg>
          {totalTodoCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-4px",
                right: "-2px",
                background: "var(--accent-blue)",
                color: "#fff",
                fontSize: "8px",
                fontWeight: 700,
                lineHeight: "12px",
                minWidth: "12px",
                height: "12px",
                borderRadius: "6px",
                padding: "0 2px",
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              {totalTodoCount > 99 ? "99+" : totalTodoCount}
            </span>
          )}
        </button>
      )}

      {/* View mode toggle */}
      <button
        onClick={onCycleViewMode}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          fontSize: "15px",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title={`View: ${viewMode}. Click to cycle.`}
      >
        {viewModeLabel[viewMode]}
      </button>

      {/* Expand / Collapse all spaces */}
      <button
        onClick={onToggleAllSpaces}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title={allCollapsed ? "Expand all spaces" : "Collapse all spaces"}
      >
        {allCollapsed ? (
          <svg
            width="14"
            height="14"
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
            width="14"
            height="14"
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

      {/* Orientation toggle (vertical ↔ horizontal) */}
      <button
        onClick={onToggleOrientation}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title={
          orientation === "vertical"
            ? "Switch to horizontal layout"
            : "Switch to vertical layout"
        }
      >
        {orientation === "vertical" ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="2" width="6" height="12" rx="1" />
            <polyline points="1 6 3 8 1 10" />
            <polyline points="15 6 13 8 15 10" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="5" width="12" height="6" rx="1" />
            <polyline points="6 1 8 3 10 1" />
            <polyline points="6 15 8 13 10 15" />
          </svg>
        )}
      </button>

      {/* Dock mode (pin) toggle */}
      {onToggleDockMode && (
        <button
          onClick={onToggleDockMode}
          className="rounded cursor-pointer"
          style={{
            color: dockMode ? "var(--accent-blue)" : "var(--text-muted)",
            background: "transparent",
            border: "none",
            lineHeight: 1,
            width: "18px",
            height: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = dockMode
              ? "var(--accent-blue)"
              : "var(--text-muted)")
          }
          title={dockMode ? "Docked (auto-hide). Click to unpin." : "Free-floating. Click to dock."}
        >
          {dockMode ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: "rotate(45deg)" }}
            >
              <line x1="8" y1="1" x2="8" y2="9" />
              <path d="M4 9h8l-1-3H5L4 9z" />
              <line x1="8" y1="9" x2="8" y2="15" />
              <circle cx="8" cy="1" r="1" fill="currentColor" stroke="none" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="1" x2="8" y2="9" />
              <path d="M4 9h8l-1-3H5L4 9z" />
              <line x1="8" y1="9" x2="8" y2="15" />
              <circle cx="8" cy="1" r="1" fill="currentColor" stroke="none" />
            </svg>
          )}
        </button>
      )}

      {/* Settings (opens standalone window) */}
      <button
        onClick={onOpenSettings}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          fontSize: "16px",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title="Settings"
      >
        ⚙
      </button>

      {/* Collapse button */}
      <button
        onClick={onCollapse}
        className="rounded cursor-pointer"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          fontSize: "13px",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title="Collapse to compact view"
      >
        —
      </button>

      {/* Search toggle — last in source order so it wraps to a second row first */}
      <button
        onClick={onToggleSearch}
        className="rounded cursor-pointer"
        style={{
          color: showSearch ? "var(--accent-blue)" : "var(--text-muted)",
          background: "transparent",
          border: "none",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = showSearch
            ? "var(--accent-blue)"
            : "var(--text-muted)")
        }
        title="Search / Filter"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6.5" cy="6.5" r="5" />
          <line x1="10" y1="10" x2="15" y2="15" />
        </svg>
      </button>
    </div>
  );
}
