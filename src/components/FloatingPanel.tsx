import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSpaceState } from "../hooks/useSpaceState";
import { useHotkeys } from "../hooks/useHotkeys";
import { useAppIcons } from "../hooks/useAppIcons";
import { useAppGroups } from "../hooks/useAppGroups";
import { SpaceCard } from "./SpaceCard";
import { AppTray } from "./AppTray";
import type { ViewMode, UserSettings, SpaceInfo } from "../lib/types";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

const COMPACT_WIDTH = 220;
const COMPACT_HEIGHT = 36;
const DEFAULT_EXPANDED_WIDTH = 280;
const DEFAULT_EXPANDED_HEIGHT = 400;
const DEFAULT_HORIZONTAL_WIDTH = 800;
const DEFAULT_HORIZONTAL_HEIGHT = 220;

export function FloatingPanel() {
  const { spaces, activeSpaceId, loading, setSpaceCollapsed, setSpaceLabel } =
    useSpaceState();

  // Collect unique bundle IDs and fetch their icons.
  const bundleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const space of spaces) {
      for (const w of space.windows) {
        if (w.bundleId) ids.add(w.bundleId);
      }
    }
    return Array.from(ids);
  }, [spaces]);
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
  // We derive a stable string key so the memo only recomputes when actual
  // bundle IDs change, not on every collapsed toggle.
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

  // Build an entry-type map so useAppIcons can fetch the right icon for each
  // entry type (app → get_app_icon, path → get_path_icon, url → static icon).
  const groupEntryTypes = useMemo(() => {
    const map: Record<string, import("../lib/types").EntryType> = {};
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

  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [spaceNameFontSize, setSpaceNameFontSize] = useState(13);
  const [windowFontSize, setWindowFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState('"Helvetica Neue", Helvetica, Arial, sans-serif');
  const [toggleHotkey, setToggleHotkey] = useState<string | undefined>("Option+S");
  const [lowOpacityWhenIdle, setLowOpacityWhenIdle] = useState(false);
  const [idleOpacity, setIdleOpacity] = useState(0.15);
  const [highlightRunningApps, setHighlightRunningApps] = useState(true);
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [traySplitPercent, setTraySplitPercent] = useState(30); // % of axis allocated to app tray
  const [isHovered, setIsHovered] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Divider drag state (not persisted — only the final split % is).
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Poll cursor position to detect hover even when the window is unfocused.
  // CSS :hover and JS mouseenter/mouseleave don't fire on unfocused macOS windows.
  useEffect(() => {
    if (!lowOpacityWhenIdle) return;

    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const win = getCurrentWindow();
        const [cursorX, cursorY] = await invoke<[number, number]>("get_cursor_position");
        const pos = await win.outerPosition();    // PhysicalPosition
        const size = await win.outerSize();       // PhysicalSize
        const scale = await win.scaleFactor();

        // Convert physical window bounds to logical (cursor coords are in logical/points on macOS).
        const wx = pos.x / scale;
        const wy = pos.y / scale;
        const ww = size.width / scale;
        const wh = size.height / scale;

        const inside =
          cursorX >= wx && cursorX <= wx + ww &&
          cursorY >= wy && cursorY <= wy + wh;

        setIsHovered(inside);
      } catch {
        // Silently ignore — window may be closing.
      }
    };

    const intervalId = setInterval(poll, 150);
    poll(); // Initial check.

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [lowOpacityWhenIdle]);

  // Register global hotkeys (Option+1-9 for space navigation, toggle visibility).
  useHotkeys(spaces, activeSpaceId, toggleHotkey);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Guard: prevent persistSettings from firing before settings have been loaded
  // from disk, which would overwrite real values with useState defaults.
  const settingsLoadedRef = useRef(false);

  // Remembered expanded sizes — stored in refs to avoid re-renders on every resize.
  const expandedSizeRef = useRef({ width: DEFAULT_EXPANDED_WIDTH, height: DEFAULT_EXPANDED_HEIGHT });
  const horizontalSizeRef = useRef({ width: DEFAULT_HORIZONTAL_WIDTH, height: DEFAULT_HORIZONTAL_HEIGHT });
  // Flag to suppress saving the compact-size resize triggered by handleCollapse.
  const ignoringResizeRef = useRef(false);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce timer for persisting window position on move.
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag to suppress onMoved saves during initial position restore.
  const ignoringMoveRef = useRef(true);

  /** Persist current settings to the backend. */
  const persistSettings = useCallback(
    (overrides: Partial<UserSettings> = {}) => {
      if (!settingsLoadedRef.current) {
        feLog("info", `[FloatingPanel] persistSettings — SKIPPED (settings not yet loaded), would-be overrides=[${Object.keys(overrides).join(",")}]`);
        return;
      }
      const merged: UserSettings = {
        viewMode,
        spaceViewModes: {},
        spaceNameFontSize,
        windowFontSize,
        expandedWidth: expandedSizeRef.current.width,
        expandedHeight: expandedSizeRef.current.height,
        expandedHorizontalWidth: horizontalSizeRef.current.width,
        expandedHorizontalHeight: horizontalSizeRef.current.height,
        fontFamily,
        // Include settings-window-managed fields so they aren't
        // reverted to serde defaults when Rust replaces the whole struct.
        toggleHotkey,
        lowOpacityWhenIdle,
        idleOpacity,
        highlightRunningApps,
        orientation,
        traySplitPercent,
        ...overrides,
      };
      const caller = new Error().stack?.split("\n")[2]?.trim() ?? "unknown";
      feLog("info", `[FloatingPanel] persistSettings — overrides=[${Object.keys(overrides).join(",")}], lowOpacityWhenIdle=${merged.lowOpacityWhenIdle}, suppressDock=${merged.suppressDock}, highlightRunningApps=${merged.highlightRunningApps}, idleOpacity=${merged.idleOpacity}, orientation=${merged.orientation}, caller=${caller}`);
      invoke("update_settings", { settings: merged }).catch((err) =>
        feLog("error", `[FloatingPanel] Failed to save settings: ${err}`),
      );
    },
    [viewMode, spaceNameFontSize, windowFontSize, fontFamily, toggleHotkey, lowOpacityWhenIdle, idleOpacity, highlightRunningApps, orientation, traySplitPercent],
  );

  // Load settings on mount — restore window position and size.
  useEffect(() => {
    feLog("info", "[FloatingPanel] Invoking get_settings...");
    invoke<UserSettings>("get_settings")
      .then(async (settings) => {
        feLog("info", `[FloatingPanel] get_settings returned: ${JSON.stringify(settings)}`);
        setViewMode((settings.viewMode as ViewMode) || "compact");
        if (settings.spaceNameFontSize) setSpaceNameFontSize(settings.spaceNameFontSize);
        if (settings.windowFontSize) setWindowFontSize(settings.windowFontSize);
        if (settings.expandedWidth) expandedSizeRef.current.width = settings.expandedWidth;
        if (settings.expandedHeight) expandedSizeRef.current.height = settings.expandedHeight;
        if (settings.expandedHorizontalWidth) horizontalSizeRef.current.width = settings.expandedHorizontalWidth;
        if (settings.expandedHorizontalHeight) horizontalSizeRef.current.height = settings.expandedHorizontalHeight;
        if (settings.fontFamily) setFontFamily(settings.fontFamily);
        if (settings.toggleHotkey) setToggleHotkey(settings.toggleHotkey);
        if (settings.lowOpacityWhenIdle != null) setLowOpacityWhenIdle(settings.lowOpacityWhenIdle);
        if (settings.idleOpacity != null) setIdleOpacity(settings.idleOpacity);
        if (settings.highlightRunningApps != null) setHighlightRunningApps(settings.highlightRunningApps);
        const restoredOrientation = (settings.orientation as "vertical" | "horizontal") || "vertical";
        setOrientation(restoredOrientation);
        if (settings.traySplitPercent != null) setTraySplitPercent(settings.traySplitPercent);
        feLog("info", `[FloatingPanel] Settings applied — lowOpacityWhenIdle=${settings.lowOpacityWhenIdle} | suppressDock=${settings.suppressDock} | highlightRunningApps=${settings.highlightRunningApps} | idleOpacity=${settings.idleOpacity} | orientation=${restoredOrientation}`);

        // Mark settings as loaded so persistSettings can start saving.
        settingsLoadedRef.current = true;

        // Restore window size and position from last session.
        const win = getCurrentWindow();
        const sizeRef = restoredOrientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
        const { width, height } = sizeRef.current;
        await win.setSize(new LogicalSize(width, height));

        if (settings.windowX != null && settings.windowY != null) {
          await win.setPosition(
            new PhysicalPosition(settings.windowX, settings.windowY),
          );
        }

        // Allow onMoved saves again after a brief settling period.
        setTimeout(() => { ignoringMoveRef.current = false; }, 500);

        // Restore suppress-dock setting and apply it.
        if (settings.suppressDock) {
          invoke("set_dock_suppressed", { suppress: true }).catch((err) =>
            feLog("error", `[FloatingPanel] Failed to suppress Dock: ${err}`),
          );
        }
      })
      .catch((err) =>
        feLog("error", `[FloatingPanel] Failed to load settings: ${err}`),
      );
  }, []);

  // Listen for settings changes from the standalone settings window.
  useEffect(() => {
    const unlisten = listen<UserSettings>("settings-changed", async (event) => {
      const s = event.payload;
      feLog("info", `[FloatingPanel] settings-changed event — lowOpacityWhenIdle=${s.lowOpacityWhenIdle}, suppressDock=${s.suppressDock}, highlightRunningApps=${s.highlightRunningApps}, idleOpacity=${s.idleOpacity}, orientation=${s.orientation}`);
      if (s.viewMode) setViewMode(s.viewMode as ViewMode);
      if (s.spaceNameFontSize) setSpaceNameFontSize(s.spaceNameFontSize);
      if (s.windowFontSize) setWindowFontSize(s.windowFontSize);
      if (s.fontFamily) setFontFamily(s.fontFamily);
      if (s.toggleHotkey !== undefined) setToggleHotkey(s.toggleHotkey || undefined);
      if (s.lowOpacityWhenIdle !== undefined) setLowOpacityWhenIdle(s.lowOpacityWhenIdle);
      if (s.idleOpacity !== undefined) setIdleOpacity(s.idleOpacity);
      if (s.highlightRunningApps !== undefined) setHighlightRunningApps(s.highlightRunningApps);
      if (s.traySplitPercent != null) setTraySplitPercent(s.traySplitPercent);
      if (s.orientation) {
        const newOrientation = s.orientation as "vertical" | "horizontal";
        setOrientation((prev) => {
          if (prev !== newOrientation && expanded) {
            ignoringResizeRef.current = true;

            const targetRef = newOrientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
            const currentRef = prev === "horizontal" ? horizontalSizeRef : expandedSizeRef;

            // If the target mode's dimensions are still at factory defaults
            // (never customised), initialise them by swapping the current
            // orientation's width ↔ height so the transition feels natural.
            const isAtDefaults =
              (newOrientation === "horizontal"
                && targetRef.current.width === DEFAULT_HORIZONTAL_WIDTH
                && targetRef.current.height === DEFAULT_HORIZONTAL_HEIGHT)
              || (newOrientation === "vertical"
                && targetRef.current.width === DEFAULT_EXPANDED_WIDTH
                && targetRef.current.height === DEFAULT_EXPANDED_HEIGHT);

            if (isAtDefaults) {
              targetRef.current = {
                width: currentRef.current.height,
                height: currentRef.current.width,
              };
            }

            const { width, height } = targetRef.current;
            getCurrentWindow()
              .setSize(new LogicalSize(width, height))
              .then(() => { setTimeout(() => { ignoringResizeRef.current = false; }, 200); });
          }
          return newOrientation;
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [expanded]);

  /** Open the settings window (singleton). */
  const handleOpenSettings = useCallback(async () => {
    // Avoid opening multiple settings windows.
    const existing = await WebviewWindow.getByLabel("settings");
    if (existing) {
      await existing.setFocus();
      return;
    }
    const settingsWindow = new WebviewWindow("settings", {
      url: "/",
      title: "Swavigator Settings",
      width: 380,
      height: 480,
      minWidth: 300,
      minHeight: 300,
      resizable: true,
      decorations: false,
      transparent: true,
      center: true,
      alwaysOnTop: true,
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
  }, [viewMode, persistSettings]);

  /** Toggle between vertical and horizontal orientation. */
  const handleToggleOrientation = useCallback(() => {
    const newOrientation = orientation === "vertical" ? "horizontal" : "vertical";
    persistSettings({ orientation: newOrientation });
    // Emit so our own listener handles dimension swap / resize,
    // and the settings window (if open) stays in sync.
    emit("settings-changed", { orientation: newOrientation });
  }, [orientation, persistSettings]);

  const handleExpand = useCallback(async () => {
    ignoringResizeRef.current = true;
    const win = getCurrentWindow();
    const sizeRef = orientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
    const { width, height } = sizeRef.current;
    await win.setSize(new LogicalSize(width, height));
    setExpanded(true);
    // Allow a brief window for the programmatic resize event to pass.
    setTimeout(() => { ignoringResizeRef.current = false; }, 200);
  }, [orientation]);

  const handleCollapse = useCallback(async () => {
    ignoringResizeRef.current = true;
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(COMPACT_WIDTH, COMPACT_HEIGHT));
    setExpanded(false);
    // Keep ignoring until we expand again.
  }, []);

  // Whether all spaces are currently collapsed.
  const allCollapsed = useMemo(
    () => spaces.length > 0 && spaces.every((s) => s.isCollapsed),
    [spaces],
  );

  const handleToggleAllSpaces = useCallback(() => {
    const newCollapsed = !allCollapsed;
    for (const s of spaces) {
      setSpaceCollapsed(s.displayId, s.spaceIndex, newCollapsed);
    }
  }, [allCollapsed, spaces, setSpaceCollapsed]);

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (prev) {
        setSearchQuery("");
      }
      return !prev;
    });
  }, []);

  // Listen for user-initiated resizes while expanded, debounce-persist the size.
  useEffect(() => {
    if (!expanded) return;

    const win = getCurrentWindow();
    const unlisten = win.onResized(async ({ payload: physicalSize }) => {
      if (ignoringResizeRef.current) return;

      // onResized gives PhysicalSize; convert to logical via scale factor.
      const scaleFactor = await win.scaleFactor();
      const w = Math.round(physicalSize.width / scaleFactor);
      const h = Math.round(physicalSize.height / scaleFactor);

      // Ignore if it matches the compact size (guard against stale events).
      if (w <= COMPACT_WIDTH && h <= COMPACT_HEIGHT) return;

      // Save to the correct ref for the current orientation.
      if (orientation === "horizontal") {
        horizontalSizeRef.current = { width: w, height: h };
      } else {
        expandedSizeRef.current = { width: w, height: h };
      }

      // Debounce the persist call so we don't hammer storage on every pixel.
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (orientation === "horizontal") {
          persistSettings({ expandedHorizontalWidth: w, expandedHorizontalHeight: h });
        } else {
          persistSettings({ expandedWidth: w, expandedHeight: h });
        }
      }, 500);
    });

    return () => {
      unlisten.then((fn) => fn());
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, [expanded, orientation, persistSettings]);

  // Listen for window moves and debounce-persist the position.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onMoved(({ payload: physicalPos }) => {
      // Skip saves during initial restore to prevent position drift.
      if (ignoringMoveRef.current) return;
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      moveTimerRef.current = setTimeout(() => {
        persistSettings({ windowX: physicalPos.x, windowY: physicalPos.y });
      }, 500);
    });

    return () => {
      unlisten.then((fn) => fn());
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, [persistSettings]);

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

  // Keep a ref to the latest split percent so the mouseup handler can persist
  // the final value without the effect re-registering on every pixel change.
  const traySplitRef = useRef(traySplitPercent);
  traySplitRef.current = traySplitPercent;

  // Handle divider dragging — global mousemove/mouseup while dragging.
  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      let pct: number;
      if (orientation === "horizontal") {
        // Tray is on the right — percentage measured from the right edge.
        pct = ((rect.right - e.clientX) / rect.width) * 100;
      } else {
        // Tray is on the bottom — percentage measured from the bottom edge.
        pct = ((rect.bottom - e.clientY) / rect.height) * 100;
      }

      // Clamp between 10% and 80%.
      pct = Math.max(10, Math.min(80, pct));
      setTraySplitPercent(pct);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      // Persist the final split using the ref for the latest value.
      persistSettings({ traySplitPercent: traySplitRef.current });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    // Prevent text selection while dragging.
    document.body.style.userSelect = "none";
    document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDraggingDivider, orientation, persistSettings]);

  // Focus the search input when it appears.
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Filter spaces and windows based on search query.
  const filteredSpaces = useMemo((): SpaceInfo[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return spaces;

    return spaces
      .map((space) => {
        const displayLabel = space.label || `Space ${space.spaceIndex}`;
        const spaceNameMatches = displayLabel.toLowerCase().includes(q);

        // If the space name matches, include it with all its windows.
        if (spaceNameMatches) return space;

        // Otherwise filter to only matching windows.
        const matchingWindows = space.windows.filter(
          (w) =>
            w.appName.toLowerCase().includes(q) ||
            w.title.toLowerCase().includes(q),
        );

        if (matchingWindows.length === 0) return null;

        return { ...space, windows: matchingWindows };
      })
      .filter((s): s is SpaceInfo => s !== null);
  }, [spaces, searchQuery]);

  // Summary counts for the compact view.
  const totalWindows = useMemo(
    () => spaces.reduce((sum, s) => sum + s.windows.length, 0),
    [spaces],
  );

  // Display metadata — only meaningful when multiple monitors are connected.
  // Maps each external display's UUID to a 1-based number so we can label
  // "External 1", "External 2", etc.
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

  const viewModeLabel: Record<ViewMode, string> = {
    compact: "◻",
    list: "☰",
    hybrid: "⊞",
    count: "#",
  };

  // ── Compact (collapsed) view ──────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        data-tauri-drag-region
        className="h-full flex items-center rounded-lg overflow-hidden cursor-grab relative"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          fontFamily,
        }}
      >
        {/* App initial — fixed to the left */}
        <span
          data-tauri-drag-region
          className="font-semibold pointer-events-none absolute"
          style={{ left: "10px", color: "var(--text-primary)" }}
        >
          S
        </span>

        {/* Centered summary */}
        <span
          data-tauri-drag-region
          className="text-xs pointer-events-none w-full text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--accent-blue)" }}>
            {spaces.length}
          </span>
          <span style={{ color: "var(--text-muted)" }}> spaces</span>
          {"  ·  "}
          <span style={{ color: "var(--accent-blue)" }}>
            {totalWindows}
          </span>
          <span style={{ color: "var(--text-muted)" }}> windows</span>
        </span>

        {/* Expand button — fixed to the right */}
        <button
          onClick={handleExpand}
          className="cursor-pointer absolute"
          style={{
            right: "8px",
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
          title="Expand"
        >
          +
        </button>
      </div>
    );
  }

  // ── Expanded view ─────────────────────────────────────────────────────
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
      {/* Title bar (draggable) */}
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
            onClick={handleOpenSettings}
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
            onClick={handleCollapse}
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

        {/* Title + content toolbar in one flex-wrap row; toolbar right-aligns near Settings/Collapse */}
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
            onClick={handleToggleSearch}
            className="rounded cursor-pointer"
            style={{
              color: showSearch
                ? "var(--accent-blue)"
                : "var(--text-muted)",
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
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6.5" cy="6.5" r="5" />
              <line x1="10" y1="10" x2="15" y2="15" />
            </svg>
          </button>

          {/* View mode toggle */}
          <button
            onClick={cycleViewMode}
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
            onClick={handleToggleAllSpaces}
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
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 6 8 2 12 6" />
                <polyline points="4 10 8 14 12 10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 2 8 6 12 2" />
                <polyline points="4 14 8 10 12 14" />
              </svg>
            )}
          </button>

          {/* Orientation toggle (vertical ↔ horizontal) */}
          <button
            onClick={handleToggleOrientation}
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
            title={orientation === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
          >
            {orientation === "vertical" ? (
              /* Portrait rectangle with horizontal outward arrows — click to go horizontal */
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="6" height="12" rx="1" />
                <polyline points="1 6 3 8 1 10" />
                <polyline points="15 6 13 8 15 10" />
              </svg>
            ) : (
              /* Landscape rectangle with vertical outward arrows — click to go vertical */
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="12" height="6" rx="1" />
                <polyline points="6 1 8 3 10 1" />
                <polyline points="6 15 8 13 10 15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Search bar (inline, toggled) */}
      {showSearch && (
        <div
          className="px-2 py-1.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--panel-border)" }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                setShowSearch(false);
              }
            }}
            placeholder="Filter spaces, apps, windows…"
            className="w-full text-xs rounded px-2 py-1 outline-none"
            style={{
              background: "rgba(63, 63, 70, 0.5)",
              color: "var(--text-primary)",
              border: "1px solid var(--panel-border)",
            }}
          />
        </div>
      )}

      {/* Space list + App Tray — arranged vertically or horizontally */}
      {orientation === "horizontal" ? (
        /* ── Horizontal layout: spaces side-by-side, app tray at right end ── */
        <div ref={containerRef} className="flex-1 flex flex-row overflow-hidden" style={{ minHeight: 0 }}>
          {/* Scrollable space columns — takes remaining width */}
          <div
            className="flex flex-row overflow-x-auto overflow-y-hidden"
            style={{ flex: `0 0 ${100 - traySplitPercent}%`, minWidth: 0 }}
          >
            {loading ? (
              <div
                className="text-xs px-2 py-2 flex-shrink-0"
                style={{ color: "var(--text-muted)" }}
              >
                Loading spaces…
              </div>
            ) : filteredSpaces.length === 0 ? (
              <div
                className="text-xs px-2 py-2 flex-shrink-0"
                style={{ color: "var(--text-muted)" }}
              >
                {searchQuery ? "No matches." : "No spaces detected."}
              </div>
            ) : (
              filteredSpaces.map((space, idx) => (
                <div
                  key={`${space.displayId}:${space.spaceIndex}`}
                  className="flex-shrink-0 overflow-y-auto"
                  style={{
                    minWidth: space.isCollapsed ? "auto" : "140px",
                    maxWidth: "260px",
                    borderRight:
                      idx < filteredSpaces.length - 1
                        ? "1px solid var(--panel-border)"
                        : "none",
                  }}
                >
                  <SpaceCard
                    space={space}
                    activeSpaceId={activeSpaceId}
                    viewMode={viewMode}
                    appIcons={appIcons}
                    spaceNameFontSize={spaceNameFontSize}
                    windowFontSize={windowFontSize}
                    totalDisplays={totalDisplays}
                    externalDisplayNumber={externalDisplayNumbers[space.displayId]}
                    orientation="horizontal"
                    onSetCollapsed={setSpaceCollapsed}
                    onSetLabel={setSpaceLabel}
                  />
                </div>
              ))
            )}
          </div>

          {/* Draggable divider — vertical bar */}
          <div
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingDivider(true); }}
            style={{
              width: "3px",
              cursor: "col-resize",
              background: isDraggingDivider ? "var(--accent-blue)" : "var(--panel-border)",
              flexShrink: 0,
              transition: isDraggingDivider ? "none" : "background 0.15s ease",
            }}
            onMouseEnter={(e) => { if (!isDraggingDivider) (e.currentTarget.style.background = "var(--text-muted)"); }}
            onMouseLeave={(e) => { if (!isDraggingDivider) (e.currentTarget.style.background = "var(--panel-border)"); }}
            title="Drag to resize"
          />

          {/* App tray column — percentage-based width */}
          <div
            className="overflow-hidden"
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flex: `0 0 calc(${traySplitPercent}% - 3px)`,
              minWidth: "60px",
            }}
          >
            <AppTray
              groups={groups}
              trayVisible={trayVisible}
              appIcons={groupAppIcons}
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
              orientation="horizontal"
            />
          </div>
        </div>
      ) : (
        /* ── Vertical layout: spaces stacked, app tray at bottom ── */
        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          {/* Space list — takes remaining height */}
          <div
            className="overflow-y-auto px-1 py-0.5"
            style={{ flex: `0 0 ${100 - traySplitPercent}%`, minHeight: 0 }}
          >
            {loading ? (
              <div
                className="text-xs px-2 py-2"
                style={{ color: "var(--text-muted)" }}
              >
                Loading spaces…
              </div>
            ) : filteredSpaces.length === 0 ? (
              <div
                className="text-xs px-2 py-2"
                style={{ color: "var(--text-muted)" }}
              >
                {searchQuery ? "No matches." : "No spaces detected."}
              </div>
            ) : (
              filteredSpaces.map((space) => (
                <SpaceCard
                  key={`${space.displayId}:${space.spaceIndex}`}
                  space={space}
                  activeSpaceId={activeSpaceId}
                  viewMode={viewMode}
                  appIcons={appIcons}
                  spaceNameFontSize={spaceNameFontSize}
                  windowFontSize={windowFontSize}
                  totalDisplays={totalDisplays}
                  externalDisplayNumber={externalDisplayNumbers[space.displayId]}
                  onSetCollapsed={setSpaceCollapsed}
                  onSetLabel={setSpaceLabel}
                />
              ))
            )}
          </div>

          {/* Draggable divider — horizontal bar */}
          <div
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingDivider(true); }}
            style={{
              height: "3px",
              cursor: "row-resize",
              background: isDraggingDivider ? "var(--accent-blue)" : "var(--panel-border)",
              flexShrink: 0,
              transition: isDraggingDivider ? "none" : "background 0.15s ease",
            }}
            onMouseEnter={(e) => { if (!isDraggingDivider) (e.currentTarget.style.background = "var(--text-muted)"); }}
            onMouseLeave={(e) => { if (!isDraggingDivider) (e.currentTarget.style.background = "var(--panel-border)"); }}
            title="Drag to resize"
          />

          {/* App Launcher Tray — percentage-based height */}
          <div
            className="overflow-hidden"
            style={{
              display: "flex",
              flexDirection: "column",
              flex: `0 0 calc(${traySplitPercent}% - 3px)`,
              minHeight: "30px",
            }}
          >
            <AppTray
              groups={groups}
              trayVisible={trayVisible}
              appIcons={groupAppIcons}
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
          </div>
        </div>
      )}
    </div>
  );
}
