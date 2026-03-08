import { WindowItem } from "../../WindowItem";
import type { ViewMode, WindowInfo } from "../../../lib/types";

interface MinimizedSectionProps {
  minimizedWindows: WindowInfo[];
  minimizedCollapsed: boolean;
  onToggleCollapsed: () => void;
  viewMode: ViewMode;
  appIcons: Record<string, string>;
  spaceNameFontSize: number;
  windowFontSize: number;
  /** "horizontal" adjusts the header layout for a column-based view. */
  orientation?: "vertical" | "horizontal";
}

/**
 * The minimized windows section shown at the bottom (vertical) or as a column (horizontal).
 */
export function MinimizedSection({
  minimizedWindows,
  minimizedCollapsed,
  onToggleCollapsed,
  viewMode,
  appIcons,
  spaceNameFontSize,
  windowFontSize,
  orientation = "vertical",
}: MinimizedSectionProps) {
  if (minimizedWindows.length === 0) return null;

  if (orientation === "horizontal") {
    return (
      <div className="rounded-md mb-0.5 overflow-hidden">
        <div className="px-1.5 py-1">
          <div className="flex items-center gap-1 mb-0.5">
            <span
              className="flex-shrink-0"
              style={{ color: "var(--text-muted)", fontSize: "10px" }}
            >
              ⊖
            </span>
            <div className="flex-1" />
            <span
              className="text-xs flex-shrink-0 px-1 rounded"
              style={{
                color: "var(--text-muted)",
                background: "rgba(63, 63, 70, 0.4)",
                fontSize: "10px",
              }}
            >
              {minimizedWindows.length}
            </span>
            <button
              onClick={onToggleCollapsed}
              className="text-xs flex-shrink-0 cursor-pointer"
              style={{
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                width: "14px",
                textAlign: "center",
              }}
              title={minimizedCollapsed ? "Expand" : "Collapse"}
            >
              {minimizedCollapsed ? "▸" : "▾"}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span
              className="flex-1 text-left truncate"
              style={{
                color: "var(--text-muted)",
                fontSize: `${spaceNameFontSize}px`,
              }}
            >
              Minimized
            </span>
          </div>
        </div>
        {!minimizedCollapsed && viewMode !== "count" && (
          <div className="pb-1" style={{ paddingLeft: "20px" }}>
            {minimizedWindows.map((w) => (
              <WindowItem
                key={w.windowId}
                window={w}
                viewMode={viewMode}
                iconSrc={appIcons[w.bundleId]}
                fontSize={windowFontSize}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Vertical layout
  return (
    <div
      className="rounded-md mb-0.5 overflow-hidden"
      style={{ border: "1px solid transparent" }}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span
          className="flex-shrink-0"
          style={{ color: "var(--text-muted)", fontSize: "10px" }}
        >
          ⊖
        </span>
        <span
          className="flex-1 text-left truncate"
          style={{
            color: "var(--text-muted)",
            fontSize: `${spaceNameFontSize}px`,
          }}
        >
          Minimized
        </span>
        <span
          className="text-xs flex-shrink-0 px-1 rounded"
          style={{
            color: "var(--text-muted)",
            background: "rgba(63, 63, 70, 0.4)",
            fontSize: "10px",
          }}
        >
          {minimizedWindows.length}
        </span>
        <button
          onClick={onToggleCollapsed}
          className="text-xs flex-shrink-0 cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            width: "14px",
            textAlign: "center",
          }}
          title={minimizedCollapsed ? "Expand" : "Collapse"}
        >
          {minimizedCollapsed ? "▸" : "▾"}
        </button>
      </div>

      {/* Window list */}
      {!minimizedCollapsed && viewMode !== "count" && (
        <div className="pb-1" style={{ paddingLeft: "20px" }}>
          {minimizedWindows.map((w) => (
            <WindowItem
              key={w.windowId}
              window={w}
              viewMode={viewMode}
              iconSrc={appIcons[w.bundleId]}
              fontSize={windowFontSize}
            />
          ))}
        </div>
      )}
    </div>
  );
}
