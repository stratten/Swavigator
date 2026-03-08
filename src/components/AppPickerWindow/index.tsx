import { useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppPicker, type Tab } from "./hooks/useAppPicker";
import { useAddHandlers } from "./hooks/useAddHandlers";
import { AppList } from "./components/AppList";
import { Footer } from "./components/Footer";
import { UrlInputRow } from "./components/UrlInputRow";

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
  const allGroupedBundleIds = useMemo(() => {
    const raw = params.get("allGroupedBundleIds") ?? "";
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  }, [params]);

  const picker = useAppPicker({
    groupId,
    groupName,
    initialExisting,
    allGroupedBundleIds,
  });

  const handlers = useAddHandlers({
    groupId,
    setExistingBundleIds: picker.setExistingBundleIds,
    setJustAdded: picker.setJustAdded,
  });

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const tabStyle = (tab: Tab) => ({
    color: picker.activeTab === tab ? "var(--accent-blue)" : "var(--text-muted)",
    background:
      picker.activeTab === tab ? "rgba(59, 130, 246, 0.15)" : "transparent",
    border: "none",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "4px",
    cursor: "pointer" as const,
    fontWeight: picker.activeTab === tab ? (600 as const) : (400 as const),
  });

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
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center justify-between gap-1 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--panel-border)" }}
      >
        <div className="flex gap-1">
          <button onClick={() => picker.setActiveTab("dock")} style={tabStyle("dock")}>
            Dock
          </button>
          <button onClick={() => picker.setActiveTab("running")} style={tabStyle("running")}>
            Running
          </button>
          <button onClick={() => picker.setActiveTab("installed")} style={tabStyle("installed")}>
            Installed
          </button>
          <button onClick={() => picker.setActiveTab("all")} style={tabStyle("all")}>
            All
          </button>
        </div>
      </div>

      {/* Search + hide-grouped toggle row */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <input
          ref={picker.searchRef}
          autoFocus
          value={picker.search}
          onChange={(e) => picker.setSearch(e.target.value)}
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
            checked={picker.hideGrouped}
            onChange={(e) => picker.setHideGrouped(e.target.checked)}
            style={{ accentColor: "var(--accent-blue)", cursor: "pointer" }}
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
        <AppList
          loading={picker.loading}
          currentApps={picker.currentApps}
          search={picker.search}
          hideGrouped={picker.hideGrouped}
          existingBundleIds={picker.existingBundleIds}
          justAdded={picker.justAdded}
          onAddApp={handlers.handleAddApp}
        />
      </div>

      {/* URL input row (conditionally shown) */}
      {handlers.showUrlInput && (
        <UrlInputRow
          urlValue={handlers.urlValue}
          setUrlValue={handlers.setUrlValue}
          urlInputRef={handlers.urlInputRef}
          onAddUrl={handlers.handleAddUrl}
          onCancel={() => {
            handlers.setShowUrlInput(false);
            handlers.setUrlValue("");
          }}
        />
      )}

      {/* Footer */}
      <Footer
        currentAppsCount={picker.currentApps.length}
        search={picker.search}
        addedCount={picker.addedCount}
        onBrowseFolder={handlers.handleBrowseFolder}
        onBrowse={handlers.handleBrowse}
        onShowUrlInput={() => handlers.setShowUrlInput(true)}
        onClose={handleClose}
      />
    </div>
  );
}
