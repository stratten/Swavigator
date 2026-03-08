import type { ViewMode } from "../../../lib/types";

interface TitleBarProps {
  viewMode: ViewMode;
  showSearch: boolean;
  allCollapsed: boolean;
  orientation: "vertical" | "horizontal";
  onOpenSettings: () => void;
  onCollapse: () => void;
  onToggleSearch: () => void;
  onCycleViewMode: () => void;
  onToggleAllSpaces: () => void;
  onToggleOrientation: () => void;
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
  onOpenSettings,
  onCollapse,
  onToggleSearch,
  onCycleViewMode,
  onToggleAllSpaces,
  onToggleOrientation,
}: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex-shrink-0 cursor-grab"
      style={{
        borderBottom: "1px solid var(--panel-border)",
        paddingLeft: "10px",
        paddingRight: "8px",
        paddingTop: "8px",
        paddingBottom: "8px",
        position: "relative",
      }}
    >
      {/* Settings & Collapse — absolutely pinned to the top-right */}
      <div
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          zIndex: 1,
        }}
      >
        {/* Settings (opens standalone window) */}
        <button
          onClick={onOpenSettings}
          className="rounded cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px",
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
            fontSize: "13px",
            lineHeight: 1,
            padding: "2px",
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
      </div>

      {/* Title + content toolbar in one flex-wrap row */}
      <div
        data-tauri-drag-region
        className="flex flex-wrap items-center gap-2"
        style={{ paddingRight: "50px" }}
      >
        <span
          data-tauri-drag-region
          className="font-semibold pointer-events-none"
          style={{ color: "var(--text-primary)", fontSize: "13px" }}
        >
          Swavigator
        </span>

        {/* Spacer pushes toolbar buttons to the right */}
        <span style={{ flex: 1 }} />

        {/* Search toggle */}
        <button
          onClick={onToggleSearch}
          className="rounded cursor-pointer"
          style={{
            color: showSearch ? "var(--accent-blue)" : "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "14px",
            lineHeight: 1,
            padding: "2px",
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

        {/* View mode toggle */}
        <button
          onClick={onCycleViewMode}
          className="rounded cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "15px",
            lineHeight: 1,
            padding: "2px",
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
            fontSize: "14px",
            lineHeight: 1,
            padding: "2px",
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
            fontSize: "14px",
            lineHeight: 1,
            padding: "2px",
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
            /* Portrait rectangle with horizontal outward arrows */
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
            /* Landscape rectangle with vertical outward arrows */
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
      </div>
    </div>
  );
}
