import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type { DiscoverableAppWithIcon, UserSettings } from "../lib/types";
import devLog from "../lib/log";

type Tab = "dock" | "running" | "installed" | "all";

/**
 * Standalone App Picker that runs in its own window.
 * Receives the target group context via URL query parameters.
 * Emits "picker-add-app" events back to the main window when the user selects an app.
 */
export function AppPickerWindow() {
  // Read group context from URL query params (set by the main window).
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const groupId = params.get("groupId") ?? "";
  const groupName = params.get("groupName") ?? "Group";
  const initialExisting = useMemo(() => {
    const raw = params.get("existingBundleIds") ?? "";
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [params]);
  // All bundle IDs across every group (for filtering).
  const allGroupedBundleIds = useMemo(() => {
    const raw = params.get("allGroupedBundleIds") ?? "";
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  }, [params]);

  const [existingBundleIds, setExistingBundleIds] = useState<string[]>(initialExisting);
  const [allApps, setAllApps] = useState<DiscoverableAppWithIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("dock");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Track recently-added apps for brief visual flash feedback.
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  // "Hide apps already in a group" toggle — loaded from settings, persisted on change.
  const [hideGrouped, setHideGrouped] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    devLog.info(`[AppPickerWindow] Mounted. groupId=${groupId} groupName="${groupName}" existing=${initialExisting.length} allGrouped=${allGroupedBundleIds.size}`);
  }, [groupId, groupName, initialExisting.length, allGroupedBundleIds.size]);

  // Load the hideGroupedApps preference from settings.
  useEffect(() => {
    invoke<UserSettings>("get_settings")
      .then((settings) => {
        // Default to true if the field isn't set.
        setHideGrouped(settings.hideGroupedApps ?? true);
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to load settings: ${err}`))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Persist the preference when it changes (skip the initial load).
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!settingsLoaded) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    invoke<UserSettings>("get_settings")
      .then((current) => {
        invoke("update_settings", {
          settings: { ...current, hideGroupedApps: hideGrouped },
        });
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to persist hideGrouped: ${err}`));
  }, [hideGrouped, settingsLoaded]);

  // Fetch all discoverable apps (with icons) in one call.
  useEffect(() => {
    devLog.info("[AppPickerWindow] Fetching all discoverable apps…");
    const t0 = performance.now();
    setLoading(true);
    invoke<DiscoverableAppWithIcon[]>("get_all_discoverable_apps")
      .then((apps) => {
        devLog.info(`[AppPickerWindow] Received ${apps.length} apps in ${(performance.now() - t0).toFixed(0)}ms`);
        setAllApps(apps);
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to load apps: ${err}`))
      .finally(() => setLoading(false));
  }, []);

  // Focus search input on tab change.
  useEffect(() => {
    if (searchRef.current) {
      searchRef.current.focus();
    }
  }, [activeTab]);

  // Build the set of bundle IDs to hide (allGrouped + any newly added in this session).
  const groupedSet = useMemo(() => {
    const set = new Set(allGroupedBundleIds);
    for (const id of existingBundleIds) {
      set.add(id);
    }
    return set;
  }, [allGroupedBundleIds, existingBundleIds]);

  const currentApps = useMemo(() => {
    let list = allApps;

    if (activeTab !== "all") {
      list = list.filter((a) => a.sources.includes(activeTab));
    }

    // Hide apps already in any group (unless toggle is off).
    if (hideGrouped) {
      list = list.filter((a) => !groupedSet.has(a.bundleId));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.bundleId.toLowerCase().includes(q),
      );
    }

    return list;
  }, [allApps, activeTab, search, hideGrouped, groupedSet]);

  const handleAddApp = useCallback(
    (bundleId: string, name: string) => {
      if (!groupId) {
        devLog.warn("[AppPickerWindow] No groupId — cannot add app.");
        return;
      }
      devLog.info(`[AppPickerWindow] Adding app: ${bundleId} "${name}" to group: ${groupId}`);
      // Optimistic: mark as added immediately.
      setExistingBundleIds((prev) => [...prev, bundleId]);
      // Brief flash feedback.
      setJustAdded((prev) => new Set(prev).add(bundleId));
      setTimeout(() => {
        setJustAdded((prev) => {
          const next = new Set(prev);
          next.delete(bundleId);
          return next;
        });
      }, 600);
      // Emit to main window.
      emit("picker-add-app", { groupId, bundleId, name });
    },
    [groupId],
  );

  // ---- Browse for file/folder ----
  const handleBrowse = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        directory: false,
        // Allow selecting both files and directories.
        title: "Select files or folders to add",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const name = p.split("/").pop() || p;
        devLog.info(`[AppPickerWindow] Adding path entry: ${p}`);
        setExistingBundleIds((prev) => [...prev, p]);
        setJustAdded((prev) => new Set(prev).add(p));
        setTimeout(() => {
          setJustAdded((prev) => {
            const next = new Set(prev);
            next.delete(p);
            return next;
          });
        }, 600);
        emit("picker-add-app", { groupId, bundleId: p, name, entryType: "path" });
      }
    } catch (err) {
      devLog.error(`[AppPickerWindow] Browse failed: ${err}`);
    }
  }, [groupId]);

  // Browse specifically for folders.
  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        directory: true,
        title: "Select folders to add",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const name = p.split("/").pop() || p;
        devLog.info(`[AppPickerWindow] Adding folder entry: ${p}`);
        setExistingBundleIds((prev) => [...prev, p]);
        setJustAdded((prev) => new Set(prev).add(p));
        setTimeout(() => {
          setJustAdded((prev) => {
            const next = new Set(prev);
            next.delete(p);
            return next;
          });
        }, 600);
        emit("picker-add-app", { groupId, bundleId: p, name, entryType: "path" });
      }
    } catch (err) {
      devLog.error(`[AppPickerWindow] Browse folder failed: ${err}`);
    }
  }, [groupId]);

  // ---- Add URL ----
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showUrlInput && urlInputRef.current) {
      urlInputRef.current.focus();
    }
  }, [showUrlInput]);

  const handleAddUrl = useCallback(() => {
    const url = urlValue.trim();
    if (!url) return;
    // Derive a display name from the URL.
    let name: string;
    try {
      name = new URL(url).hostname;
    } catch {
      name = url;
    }
    devLog.info(`[AppPickerWindow] Adding URL entry: ${url}`);
    setExistingBundleIds((prev) => [...prev, url]);
    setJustAdded((prev) => new Set(prev).add(url));
    setTimeout(() => {
      setJustAdded((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }, 600);
    emit("picker-add-app", { groupId, bundleId: url, name, entryType: "url" });
    setUrlValue("");
    setShowUrlInput(false);
  }, [groupId, urlValue]);

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const tabStyle = (tab: Tab) => ({
    color: activeTab === tab ? "var(--accent-blue)" : "var(--text-muted)",
    background:
      activeTab === tab ? "rgba(59, 130, 246, 0.15)" : "transparent",
    border: "none",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "4px",
    cursor: "pointer" as const,
    fontWeight: activeTab === tab ? (600 as const) : (400 as const),
  });

  const addedCount = existingBundleIds.length - initialExisting.length;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        borderRadius: "10px",
        padding: "2px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", sans-serif',
      }}
    >
      {/* Title bar (draggable) */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 cursor-grab"
        style={{ borderBottom: "1px solid var(--panel-border)" }}
      >
        <span
          data-tauri-drag-region
          className="font-semibold pointer-events-none flex-1"
          style={{ color: "var(--text-primary)", fontSize: "14px" }}
        >
          Add Apps — {groupName}
        </span>
        <button
          onClick={handleClose}
          className="cursor-pointer rounded"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 6px",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--text-muted)")
          }
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Tabs + hide-grouped toggle */}
      <div
        className="flex items-center justify-between gap-1 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--panel-border)" }}
      >
        <div className="flex gap-1">
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
          <button onClick={() => setActiveTab("all")} style={tabStyle("all")}>
            All
          </button>
        </div>
      </div>

      {/* Search + hide-grouped toggle row */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      >
        <input
          ref={searchRef}
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleClose();
          }}
          placeholder="Search apps…"
          className="flex-1 text-sm rounded px-3 py-1.5 outline-none"
          style={{
            background: "rgba(63, 63, 70, 0.5)",
            color: "var(--text-primary)",
            border: "1px solid var(--panel-border)",
          }}
        />
        <label
          className="flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          title="Hide apps that are already assigned to any group."
        >
          <input
            type="checkbox"
            checked={hideGrouped}
            onChange={(e) => setHideGrouped(e.target.checked)}
            style={{
              accentColor: "var(--accent-blue)",
              cursor: "pointer",
            }}
          />
          <span
            className="text-xs whitespace-nowrap select-none"
            style={{ color: "var(--text-muted)" }}
          >
            Hide grouped
          </span>
        </label>
      </div>

      {/* App list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div
            className="text-sm px-3 py-4"
            style={{ color: "var(--text-muted)" }}
          >
            Loading apps…
          </div>
        ) : currentApps.length === 0 ? (
          <div
            className="text-sm px-3 py-4"
            style={{ color: "var(--text-muted)" }}
          >
            {search
              ? "No matches."
              : hideGrouped
                ? "All apps are already in a group."
                : "No apps found."}
          </div>
        ) : (
          currentApps.map((app) => {
            const alreadyAdded = existingBundleIds.includes(app.bundleId);
            const wasJustAdded = justAdded.has(app.bundleId);
            return (
              <button
                key={app.bundleId}
                onClick={() => {
                  if (!alreadyAdded) {
                    handleAddApp(app.bundleId, app.name);
                  }
                }}
                disabled={alreadyAdded}
                className="flex items-center gap-3 w-full text-left px-3 py-1.5 rounded text-sm"
                style={{
                  background: wasJustAdded
                    ? "rgba(34, 197, 94, 0.15)"
                    : "transparent",
                  border: "none",
                  opacity: alreadyAdded ? 0.4 : 1,
                  cursor: alreadyAdded ? "default" : "pointer",
                  transition: "background 0.3s ease, opacity 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  if (!alreadyAdded && !wasJustAdded)
                    e.currentTarget.style.background = "var(--hover-bg)";
                }}
                onMouseLeave={(e) => {
                  if (!wasJustAdded)
                    e.currentTarget.style.background = "transparent";
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
                      fontSize: "10px",
                    }}
                  >
                    {app.bundleId}
                  </div>
                </div>
                {alreadyAdded && (
                  <span
                    className="flex-shrink-0"
                    style={{
                      color: "var(--accent-green, #22c55e)",
                      fontSize: "13px",
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

      {/* URL input row (conditionally shown) */}
      {showUrlInput && (
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--panel-border)" }}
        >
          <input
            ref={urlInputRef}
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddUrl();
              if (e.key === "Escape") {
                setShowUrlInput(false);
                setUrlValue("");
              }
            }}
            placeholder="https://example.com"
            className="flex-1 text-sm rounded px-3 py-1.5 outline-none"
            style={{
              background: "rgba(63, 63, 70, 0.5)",
              color: "var(--text-primary)",
              border: "1px solid var(--panel-border)",
            }}
          />
          <button
            onClick={handleAddUrl}
            className="cursor-pointer rounded px-3 py-1"
            style={{
              color: "var(--accent-blue)",
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid var(--accent-blue)",
              fontSize: "12px",
            }}
          >
            Add
          </button>
          <button
            onClick={() => {
              setShowUrlInput(false);
              setUrlValue("");
            }}
            className="cursor-pointer rounded px-2 py-1"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "none",
              fontSize: "12px",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderTop: "1px solid var(--panel-border)" }}
      >
        <span
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {currentApps.length} app{currentApps.length !== 1 ? "s" : ""}
          {search ? " matching" : ""}
          {addedCount > 0 && (
            <span style={{ color: "var(--accent-green, #22c55e)", marginLeft: "8px" }}>
              +{addedCount} added
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleBrowseFolder}
            className="cursor-pointer rounded px-2.5 py-1"
            style={{
              color: "var(--text-secondary)",
              background: "rgba(63, 63, 70, 0.4)",
              border: "1px solid var(--panel-border)",
              fontSize: "11px",
            }}
            title="Add a folder from Finder."
          >
            📁 Folder…
          </button>
          <button
            onClick={handleBrowse}
            className="cursor-pointer rounded px-2.5 py-1"
            style={{
              color: "var(--text-secondary)",
              background: "rgba(63, 63, 70, 0.4)",
              border: "1px solid var(--panel-border)",
              fontSize: "11px",
            }}
            title="Add a file from Finder."
          >
            📄 File…
          </button>
          <button
            onClick={() => setShowUrlInput(true)}
            className="cursor-pointer rounded px-2.5 py-1"
            style={{
              color: "var(--text-secondary)",
              background: "rgba(63, 63, 70, 0.4)",
              border: "1px solid var(--panel-border)",
              fontSize: "11px",
            }}
            title="Add a URL bookmark."
          >
            🔗 URL…
          </button>
          <button
            onClick={handleClose}
            className="cursor-pointer rounded px-3 py-1"
            style={{
              color: "var(--accent-blue)",
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid var(--accent-blue)",
              fontSize: "12px",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
