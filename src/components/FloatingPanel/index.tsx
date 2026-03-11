import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSpaceState } from "../../hooks/useSpaceState";
import { useHotkeys } from "../../hooks/useHotkeys";
import { useAppIcons } from "../../hooks/useAppIcons";
import { useAppGroups } from "../../hooks/useAppGroups";
import type { ViewMode, TodoItem } from "../../lib/types";

// Local hooks
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { useWindowGeometry } from "./hooks/useWindowGeometry";
import { useDividerDrag } from "./hooks/useDividerDrag";
import { useIdleOpacity } from "./hooks/useIdleOpacity";
import { useSearchFilter } from "./hooks/useSearchFilter";
import { useDockMode } from "./hooks/useDockMode";

// Local components
import { CompactView } from "./components/CompactView";
import { TitleBar } from "./components/TitleBar";
import { SearchBar } from "./components/SearchBar";
import { HorizontalLayout } from "./components/HorizontalLayout";
import { VerticalLayout } from "./components/VerticalLayout";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

export function FloatingPanel() {
  const { spaces, activeSpaceId, minimizedWindows, loading, setSpaceCollapsed, setSpaceLabel } =
    useSpaceState();

  // Collect unique bundle IDs and fetch their icons.
  const bundleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const space of spaces) {
      for (const w of space.windows) {
        if (w.bundleId) ids.add(w.bundleId);
      }
    }
    for (const w of minimizedWindows) {
      if (w.bundleId) ids.add(w.bundleId);
    }
    return Array.from(ids);
  }, [spaces, minimizedWindows]);
  const appIcons = useAppIcons(bundleIds);

  // Set of currently running bundle IDs (for the running-app indicator).
  const runningBundleIds = useMemo(() => new Set(bundleIds), [bundleIds]);

  // App groups state.
  const {
    groups,
    trayVisible,
    badges,
    toggleTrayVisible,
    createGroup,
    deleteGroup,
    updateGroup,
    addAppToGroup,
    removeAppFromGroup,
    toggleGroupCollapsed,
    reorderGroups,
    flushCollapsedState,
  } = useAppGroups();

  // Collect bundle IDs from app groups for icon fetching.
  const groupBundleIdKey = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) {
      for (const app of group.apps) {
        if (app.bundleId) ids.add(app.bundleId);
      }
    }
    return Array.from(ids).sort().join(",");
  }, [groups]);

  const groupBundleIds = useMemo(
    () => (groupBundleIdKey ? groupBundleIdKey.split(",") : []),
    [groupBundleIdKey],
  );

  const groupEntryTypes = useMemo(() => {
    const map: Record<string, import("../../lib/types").EntryType> = {};
    for (const group of groups) {
      for (const app of group.apps) {
        if (app.entryType && app.entryType !== "app") {
          map[app.bundleId] = app.entryType;
        }
      }
    }
    return map;
  }, [groups]);

  const groupAppIcons = useAppIcons(groupBundleIds, groupEntryTypes);

  // Expanded/collapsed panel state.
  const [expanded, setExpanded] = useState(true);

  // Minimized-windows section collapsed state (local, not persisted).
  const [minimizedCollapsed, setMinimizedCollapsed] = useState(false);

  // Container ref for divider drag calculations.
  const containerRef = useRef<HTMLDivElement>(null);

  // ─── Settings Persistence ───────────────────────────────────────────────
  const {
    settings,
    setViewMode,
    setTraySplitPercent,
    persistSettings,
    expandedSizeRef,
    horizontalSizeRef,
    ignoringMoveRef,
    handleToggleOrientation,
  } = useSettingsPersistence(expanded);

  const {
    viewMode,
    spaceNameFontSize,
    windowFontSize,
    fontFamily,
    toggleHotkey,
    lowOpacityWhenIdle,
    idleOpacity,
    highlightRunningApps,
    orientation,
    traySplitPercent,
    showMinimized,
    dockMode,
    dockTriggerSize,
    dockTriggerOpacity,
    dockHideDelay,
    enableTodos,
  } = settings;

  // Filter minimized windows based on setting.
  const displayedMinimizedWindows = showMinimized ? minimizedWindows : [];

  // ─── Window Geometry (Resize/Move) ──────────────────────────────────────
  const { handleExpand, handleCollapse, ignoringResizeRef } = useWindowGeometry(
    expanded,
    orientation,
    expandedSizeRef,
    horizontalSizeRef,
    ignoringMoveRef,
    persistSettings,
  );

  // ─── Dock Mode (Auto-Show on Hover) ────────────────────────────────────
  const { isDockExpanded, dockModeActive } = useDockMode(
    dockMode,
    dockTriggerSize,
    dockHideDelay,
    orientation,
    expandedSizeRef,
    horizontalSizeRef,
    ignoringResizeRef,
    ignoringMoveRef,
  );

  // ─── Divider Drag ───────────────────────────────────────────────────────
  const { isDraggingDivider, startDragging } = useDividerDrag(
    orientation,
    traySplitPercent,
    setTraySplitPercent,
    persistSettings,
    containerRef,
  );

  // ─── Idle Opacity (Hover Detection) ─────────────────────────────────────
  const isHovered = useIdleOpacity(lowOpacityWhenIdle);

  // ─── Search / Filter ────────────────────────────────────────────────────
  const {
    showSearch,
    searchQuery,
    setSearchQuery,
    filteredSpaces,
    handleToggleSearch,
    searchInputRef,
  } = useSearchFilter(spaces);

  // ─── Hotkeys ────────────────────────────────────────────────────────────
  useHotkeys(spaces, activeSpaceId, toggleHotkey);

  // ─── Derived State ──────────────────────────────────────────────────────
  const totalWindows = useMemo(
    () => spaces.reduce((sum, s) => sum + s.windows.length, 0),
    [spaces],
  );

  const allCollapsed = useMemo(
    () => spaces.length > 0 && spaces.every((s) => s.isCollapsed),
    [spaces],
  );

  const { totalDisplays, externalDisplayNumbers } = useMemo(() => {
    const seen = new Set<string>();
    const externalIds: string[] = [];
    for (const s of spaces) {
      if (!seen.has(s.displayId)) {
        seen.add(s.displayId);
        if (!s.isBuiltinDisplay) externalIds.push(s.displayId);
      }
    }
    const numMap: Record<string, number> = {};
    externalIds.forEach((id, idx) => (numMap[id] = idx + 1));
    return { totalDisplays: seen.size, externalDisplayNumbers: numMap };
  }, [spaces]);

  // ─── Space To-Do Counts ─────────────────────────────────────────────────
  const [todoCounts, setTodoCounts] = useState<Record<number, number>>({});

  const totalTodoCount = useMemo(
    () => Object.values(todoCounts).reduce((sum, c) => sum + c, 0),
    [todoCounts],
  );

  const loadTodoCounts = useCallback(async () => {
    try {
      const allTodos: Record<string, TodoItem[]> = await invoke("get_all_space_todos");
      const counts: Record<number, number> = {};
      for (const [id, items] of Object.entries(allTodos)) {
        const incomplete = items.filter((t) => !t.completed).length;
        if (incomplete > 0) counts[Number(id)] = incomplete;
      }
      setTodoCounts(counts);
    } catch {
      // Silently ignore — non-critical
    }
  }, []);

  useEffect(() => {
    loadTodoCounts();
  }, [loadTodoCounts]);

  useEffect(() => {
    const unlisten = listen("todos-changed", () => {
      loadTodoCounts();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadTodoCounts]);

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleOpenAllTodos = useCallback(async () => {
    const existing = await WebviewWindow.getByLabel("todos-overview");
    if (existing) {
      await existing.setFocus();
      return;
    }
    const todosWindow = new WebviewWindow("todos-overview", {
      url: "/",
      title: "All To-Dos",
      width: 380,
      height: 500,
      minWidth: 280,
      minHeight: 300,
      resizable: true,
      decorations: false,
      transparent: true,
      center: true,
      alwaysOnTop: true,
      visibleOnAllWorkspaces: true,
    });
    todosWindow.once("tauri://error", (e) => {
      feLog("error", `[FloatingPanel] Failed to create todos-overview window: ${e}`);
    });
  }, []);

  const handleOpenSettings = useCallback(async () => {
    const existing = await WebviewWindow.getByLabel("settings");
    if (existing) {
      await existing.setFocus();
      return;
    }
    const settingsWindow = new WebviewWindow("settings", {
      url: "/",
      title: "Swavigator Settings",
      width: 380,
      height: 620,
      minWidth: 300,
      minHeight: 300,
      resizable: true,
      decorations: false,
      transparent: true,
      center: true,
      alwaysOnTop: true,
      visibleOnAllWorkspaces: true,
    });
    settingsWindow.once("tauri://error", (e) => {
      feLog("error", `[FloatingPanel] Failed to create settings window: ${e}`);
    });
  }, []);

  const cycleViewMode = useCallback(() => {
    const modes: ViewMode[] = ["compact", "list", "hybrid", "count"];
    const nextIndex = (modes.indexOf(viewMode) + 1) % modes.length;
    const next = modes[nextIndex];
    setViewMode(next);
    persistSettings({ viewMode: next });
  }, [viewMode, setViewMode, persistSettings]);

  const handleToggleAllSpaces = useCallback(() => {
    const newCollapsed = !allCollapsed;
    for (const s of spaces) {
      setSpaceCollapsed(s.spaceId, newCollapsed);
    }
  }, [allCollapsed, spaces, setSpaceCollapsed]);

  const doExpand = useCallback(async () => {
    await handleExpand();
    setExpanded(true);
  }, [handleExpand]);

  const doCollapse = useCallback(async () => {
    await handleCollapse();
    setExpanded(false);
  }, [handleCollapse]);

  // Flush app group collapsed state to disk when the window is about to close.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async () => {
      await flushCollapsedState();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [flushCollapsedState]);

  // ─── Dock Mode: Trigger Strip ───────────────────────────────────────────
  if (dockModeActive && !isDockExpanded) {
    return (
      <div
        className="h-full w-full"
        style={{
          opacity: dockTriggerOpacity,
          background: "var(--panel-bg)",
          borderRadius: "4px",
          transition: "opacity 0.15s ease",
        }}
      />
    );
  }

  // ─── Compact View ───────────────────────────────────────────────────────
  if (!expanded && !dockModeActive) {
    return (
      <CompactView
        fontFamily={fontFamily}
        spacesCount={spaces.length}
        totalWindows={totalWindows}
        onExpand={doExpand}
      />
    );
  }

  // ─── Expanded View ──────────────────────────────────────────────────────
  return (
    <div
      className="h-full flex flex-col rounded-lg overflow-hidden"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        fontFamily,
        opacity: lowOpacityWhenIdle && !isHovered ? idleOpacity : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      <TitleBar
        viewMode={viewMode}
        showSearch={showSearch}
        allCollapsed={allCollapsed}
        orientation={orientation}
        totalTodoCount={enableTodos ? totalTodoCount : 0}
        enableTodos={enableTodos}
        onOpenSettings={handleOpenSettings}
        onOpenAllTodos={handleOpenAllTodos}
        onCollapse={doCollapse}
        onToggleSearch={handleToggleSearch}
        onCycleViewMode={cycleViewMode}
        onToggleAllSpaces={handleToggleAllSpaces}
        onToggleOrientation={handleToggleOrientation}
      />

      {showSearch && (
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClose={handleToggleSearch}
          inputRef={searchInputRef}
        />
      )}

      {orientation === "horizontal" ? (
        <HorizontalLayout
          containerRef={containerRef}
          loading={loading}
          filteredSpaces={filteredSpaces}
          minimizedWindows={displayedMinimizedWindows}
          minimizedCollapsed={minimizedCollapsed}
          onToggleMinimizedCollapsed={() => setMinimizedCollapsed((prev) => !prev)}
          searchQuery={searchQuery}
          activeSpaceId={activeSpaceId}
          viewMode={viewMode}
          appIcons={appIcons}
          spaceNameFontSize={spaceNameFontSize}
          windowFontSize={windowFontSize}
          totalDisplays={totalDisplays}
          externalDisplayNumbers={externalDisplayNumbers}
          traySplitPercent={traySplitPercent}
          isDraggingDivider={isDraggingDivider}
          onStartDragging={startDragging}
          onSetSpaceCollapsed={setSpaceCollapsed}
          onSetSpaceLabel={setSpaceLabel}
          todoCounts={todoCounts}
          enableTodos={enableTodos}
          groups={groups}
          trayVisible={trayVisible}
          groupAppIcons={groupAppIcons}
          badges={badges}
          onToggleTray={toggleTrayVisible}
          onCreateGroup={createGroup}
          onDeleteGroup={deleteGroup}
          onUpdateGroup={updateGroup}
          onToggleGroupCollapsed={toggleGroupCollapsed}
          onAddApp={addAppToGroup}
          onRemoveApp={removeAppFromGroup}
          onReorderGroups={reorderGroups}
          runningBundleIds={highlightRunningApps ? runningBundleIds : undefined}
        />
      ) : (
        <VerticalLayout
          containerRef={containerRef}
          loading={loading}
          filteredSpaces={filteredSpaces}
          minimizedWindows={displayedMinimizedWindows}
          minimizedCollapsed={minimizedCollapsed}
          onToggleMinimizedCollapsed={() => setMinimizedCollapsed((prev) => !prev)}
          searchQuery={searchQuery}
          activeSpaceId={activeSpaceId}
          viewMode={viewMode}
          appIcons={appIcons}
          spaceNameFontSize={spaceNameFontSize}
          windowFontSize={windowFontSize}
          totalDisplays={totalDisplays}
          externalDisplayNumbers={externalDisplayNumbers}
          traySplitPercent={traySplitPercent}
          isDraggingDivider={isDraggingDivider}
          onStartDragging={startDragging}
          onSetSpaceCollapsed={setSpaceCollapsed}
          onSetSpaceLabel={setSpaceLabel}
          todoCounts={todoCounts}
          enableTodos={enableTodos}
          groups={groups}
          trayVisible={trayVisible}
          groupAppIcons={groupAppIcons}
          badges={badges}
          onToggleTray={toggleTrayVisible}
          onCreateGroup={createGroup}
          onDeleteGroup={deleteGroup}
          onUpdateGroup={updateGroup}
          onToggleGroupCollapsed={toggleGroupCollapsed}
          onAddApp={addAppToGroup}
          onRemoveApp={removeAppFromGroup}
          onReorderGroups={reorderGroups}
          runningBundleIds={highlightRunningApps ? runningBundleIds : undefined}
        />
      )}
    </div>
  );
}
