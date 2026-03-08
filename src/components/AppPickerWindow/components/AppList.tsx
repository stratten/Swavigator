import type { DiscoverableAppWithIcon } from "../../../lib/types";

interface AppListProps {
  loading: boolean;
  currentApps: DiscoverableAppWithIcon[];
  search: string;
  hideGrouped: boolean;
  existingBundleIds: string[];
  justAdded: Set<string>;
  onAddApp: (bundleId: string, name: string) => void;
}

export function AppList({
  loading,
  currentApps,
  search,
  hideGrouped,
  existingBundleIds,
  justAdded,
  onAddApp,
}: AppListProps) {
  if (loading) {
    return (
      <div className="text-sm px-3 py-4" style={{ color: "var(--text-muted)" }}>
        Loading apps…
      </div>
    );
  }

  if (currentApps.length === 0) {
    return (
      <div className="text-sm px-3 py-4" style={{ color: "var(--text-muted)" }}>
        {search
          ? "No matches."
          : hideGrouped
            ? "All apps are already in a group."
            : "No apps found."}
      </div>
    );
  }

  return (
    <>
      {currentApps.map((app) => {
        const alreadyAdded = existingBundleIds.includes(app.bundleId);
        const wasJustAdded = justAdded.has(app.bundleId);

        return (
          <button
            key={app.bundleId}
            onClick={() => {
              if (!alreadyAdded) {
                onAddApp(app.bundleId, app.name);
              }
            }}
            disabled={alreadyAdded}
            className="flex items-center gap-3 w-full text-left px-3 py-1.5 rounded text-sm"
            style={{
              background: wasJustAdded ? "rgba(34, 197, 94, 0.15)" : "transparent",
              border: "none",
              opacity: alreadyAdded ? 0.4 : 1,
              cursor: alreadyAdded ? "default" : "pointer",
              transition: "background 0.3s ease, opacity 0.3s ease",
            }}
            onMouseEnter={(e) => {
              if (!alreadyAdded && !wasJustAdded) {
                e.currentTarget.style.background = "var(--hover-bg)";
              }
            }}
            onMouseLeave={(e) => {
              if (!wasJustAdded) {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            {app.icon ? (
              <img
                src={app.icon}
                alt=""
                className="flex-shrink-0"
                style={{ width: "24px", height: "24px" }}
              />
            ) : (
              <span
                className="flex-shrink-0 rounded flex items-center justify-center"
                style={{
                  width: "24px",
                  height: "24px",
                  background: "rgba(63, 63, 70, 0.5)",
                  color: "var(--text-muted)",
                  fontSize: "13px",
                }}
              >
                {app.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate" style={{ color: "var(--text-primary)" }}>
                {app.name}
              </div>
              <div
                className="truncate"
                style={{ color: "var(--text-muted)", fontSize: "10px" }}
              >
                {app.bundleId}
              </div>
            </div>
            {alreadyAdded && (
              <span
                className="flex-shrink-0"
                style={{ color: "var(--accent-green, #22c55e)", fontSize: "13px" }}
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
