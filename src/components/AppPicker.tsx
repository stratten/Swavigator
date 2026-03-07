import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppIcons } from "../hooks/useAppIcons";
import type { DiscoverableApp } from "../lib/types";

type Tab = "dock" | "running" | "installed";

interface AppPickerProps {
  groupId: string;
  existingBundleIds: string[];
  onAddApp: (groupId: string, bundleId: string, name: string) => void;
  onClose: () => void;
}

export function AppPicker({
  groupId,
  existingBundleIds,
  onAddApp,
  onClose,
}: AppPickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("dock");
  const [dockApps, setDockApps] = useState<DiscoverableApp[]>([]);
  const [runningApps, setRunningApps] = useState<DiscoverableApp[]>([]);
  const [installedApps, setInstalledApps] = useState<DiscoverableApp[]>([]);
  const [loadingDock, setLoadingDock] = useState(false);
  const [loadingRunning, setLoadingRunning] = useState(false);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Load dock apps on mount.
  useEffect(() => {
    setLoadingDock(true);
    invoke<DiscoverableApp[]>("get_dock_apps")
      .then(setDockApps)
      .catch((err) => console.error("[AppPicker] Dock apps failed:", err))
      .finally(() => setLoadingDock(false));

    setLoadingRunning(true);
    invoke<DiscoverableApp[]>("get_running_apps")
      .then(setRunningApps)
      .catch((err) => console.error("[AppPicker] Running apps failed:", err))
      .finally(() => setLoadingRunning(false));
  }, []);

  // Lazy-load installed apps when that tab is selected.
  useEffect(() => {
    if (activeTab === "installed" && installedApps.length === 0 && !loadingInstalled) {
      setLoadingInstalled(true);
      invoke<DiscoverableApp[]>("get_installed_apps")
        .then(setInstalledApps)
        .catch((err) => console.error("[AppPicker] Installed apps failed:", err))
        .finally(() => setLoadingInstalled(false));
    }
  }, [activeTab, installedApps.length, loadingInstalled]);

  // Focus search on tab change.
  useEffect(() => {
    if (searchRef.current) {
      searchRef.current.focus();
    }
  }, [activeTab]);

  const currentApps = useMemo(() => {
    let list: DiscoverableApp[] = [];
    switch (activeTab) {
      case "dock":
        list = dockApps;
        break;
      case "running":
        list = runningApps;
        break;
      case "installed":
        list = installedApps;
        break;
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.bundleId.toLowerCase().includes(q)
      );
    }

    return list;
  }, [activeTab, dockApps, runningApps, installedApps, search]);

  // Collect bundle IDs from the current visible list and fetch their icons.
  const visibleBundleIds = useMemo(
    () => currentApps.map((a) => a.bundleId),
    [currentApps]
  );
  const pickerIcons = useAppIcons(visibleBundleIds);

  const isLoading =
    (activeTab === "dock" && loadingDock) ||
    (activeTab === "running" && loadingRunning) ||
    (activeTab === "installed" && loadingInstalled);

  const tabStyle = (tab: Tab) => ({
    color: activeTab === tab ? "var(--accent-blue)" : "var(--text-muted)",
    background: activeTab === tab ? "rgba(59, 130, 246, 0.15)" : "transparent",
    border: "none",
    fontSize: "11px",
    padding: "3px 8px",
    borderRadius: "4px",
    cursor: "pointer" as const,
    fontWeight: activeTab === tab ? (600 as const) : (400 as const),
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0, 0, 0, 0.4)" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-50 rounded-lg shadow-xl flex flex-col"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "260px",
          maxHeight: "340px",
          background: "rgb(30, 30, 34)",
          border: "1px solid var(--panel-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--panel-border)" }}
        >
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Add Apps
          </span>
          <button
            onClick={onClose}
            className="cursor-pointer"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "none",
              fontSize: "14px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 px-2 py-1.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--panel-border)" }}
        >
          <button onClick={() => setActiveTab("dock")} style={tabStyle("dock")}>
            Dock
          </button>
          <button
            onClick={() => setActiveTab("running")}
            style={tabStyle("running")}
          >
            Running
          </button>
          <button
            onClick={() => setActiveTab("installed")}
            style={tabStyle("installed")}
          >
            Installed
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 flex-shrink-0">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search apps…"
            className="w-full text-xs rounded px-2 py-1 outline-none"
            style={{
              background: "rgba(63, 63, 70, 0.5)",
              color: "var(--text-primary)",
              border: "1px solid var(--panel-border)",
            }}
          />
        </div>

        {/* App list */}
        <div className="flex-1 overflow-y-auto px-1 pb-1">
          {isLoading ? (
            <div
              className="text-xs px-2 py-2"
              style={{ color: "var(--text-muted)" }}
            >
              Loading…
            </div>
          ) : currentApps.length === 0 ? (
            <div
              className="text-xs px-2 py-2"
              style={{ color: "var(--text-muted)" }}
            >
              {search ? "No matches." : "No apps found."}
            </div>
          ) : (
            currentApps.map((app) => {
              const alreadyAdded = existingBundleIds.includes(app.bundleId);
              return (
                <button
                  key={app.bundleId}
                  onClick={() => {
                    if (!alreadyAdded) {
                      onAddApp(groupId, app.bundleId, app.name);
                    }
                  }}
                  disabled={alreadyAdded}
                  className="flex items-center gap-2 w-full text-left px-2 py-1 rounded text-xs cursor-pointer"
                  style={{
                    background: "transparent",
                    border: "none",
                    opacity: alreadyAdded ? 0.4 : 1,
                    cursor: alreadyAdded ? "default" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!alreadyAdded)
                      e.currentTarget.style.background = "var(--hover-bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {pickerIcons[app.bundleId] ? (
                    <img
                      src={pickerIcons[app.bundleId]}
                      alt=""
                      className="flex-shrink-0"
                      style={{ width: "20px", height: "20px" }}
                    />
                  ) : (
                    <span
                      className="flex-shrink-0 rounded flex items-center justify-center"
                      style={{
                        width: "20px",
                        height: "20px",
                        background: "rgba(63, 63, 70, 0.5)",
                        color: "var(--text-muted)",
                        fontSize: "11px",
                      }}
                    >
                      {app.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className="truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {app.name}
                    </div>
                    <div
                      className="truncate"
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "9px",
                      }}
                    >
                      {app.bundleId}
                    </div>
                  </div>
                  {alreadyAdded && (
                    <span
                      className="flex-shrink-0"
                      style={{
                        color: "var(--accent-green)",
                        fontSize: "11px",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
