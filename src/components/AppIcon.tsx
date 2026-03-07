import { invoke } from "@tauri-apps/api/core";
import type { AppEntry } from "../lib/types";

interface AppIconProps {
  app: AppEntry;
  iconSrc?: string;
  badge?: string;
  groupId: string;
  /** Whether this app is currently running (has open windows). */
  isRunning?: boolean;
}

export function AppIcon({ app, iconSrc, badge, groupId, isRunning }: AppIconProps) {
  const entryType = app.entryType ?? "app";
  const isApp = entryType === "app";

  const handleClick = async () => {
    try {
      if (entryType === "path") {
        await invoke("open_path", { path: app.bundleId });
      } else if (entryType === "url") {
        await invoke("open_url", { url: app.bundleId });
      } else {
        await invoke("launch_app", { bundleId: app.bundleId });
      }
    } catch (err) {
      console.error("[AppIcon] Open failed:", err);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    invoke("show_app_context_menu", {
      appName: app.name,
      bundleId: app.bundleId,
      groupId,
      entryType,
    }).catch((err) => console.error("[AppIcon] Context menu failed:", err));
  };

  const runningBg = "rgba(34, 197, 94, 0.12)";
  const runningBorder = "1px solid rgba(34, 197, 94, 0.25)";
  // Only show running indicator for app entries.
  const showRunning = isApp && isRunning;

  // Fallback icon character for entries without a fetched icon.
  const fallbackChar = entryType === "url" ? "🔗" : entryType === "path" ? "📁" : app.name.charAt(0).toUpperCase();

  return (
    <button
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className="flex flex-col items-center gap-0.5 rounded cursor-pointer relative"
      style={{
        background: showRunning ? runningBg : "transparent",
        border: showRunning ? runningBorder : "1px solid transparent",
        padding: "3px 2px",
        width: "48px",
        minHeight: "44px",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--hover-bg)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = showRunning ? runningBg : "transparent")
      }
      title={app.name}
    >
      {/* Icon */}
      <div className="relative" style={{ width: "28px", height: "28px" }}>
        {iconSrc ? (
          <img
            src={iconSrc}
            alt={app.name}
            style={{ width: "28px", height: "28px" }}
          />
        ) : (
          <div
            className="rounded flex items-center justify-center"
            style={{
              width: "28px",
              height: "28px",
              background: "rgba(63, 63, 70, 0.6)",
              color: "var(--text-muted)",
              fontSize: "14px",
            }}
          >
            {fallbackChar}
          </div>
        )}

        {/* Badge count — only for app entries */}
        {isApp && badge && (
          <span
            className="absolute flex items-center justify-center rounded-full"
            style={{
              top: "-4px",
              right: "-6px",
              minWidth: "16px",
              height: "16px",
              padding: "0 3px",
              background: "#ef4444",
              color: "#fff",
              fontSize: "9px",
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {badge}
          </span>
        )}
      </div>

      {/* Name */}
      <span
        className="truncate w-full text-center"
        style={{
          color: "var(--text-secondary)",
          fontSize: "9px",
          lineHeight: "1.2",
        }}
      >
        {app.name}
      </span>
    </button>
  );
}
