/** A single macOS Space as tracked by the backend. */
export interface SpaceInfo {
  /** Internal macOS space ID (stable within a session). */
  spaceId: number;
  /** 1-based index of this space on its display. */
  spaceIndex: number;
  /** Display UUID this space belongs to. */
  displayId: string;
  /** User-assigned label (empty string if not set). */
  label: string;
  /** Whether this is the currently active (focused) space. */
  isActive: boolean;
  /** Whether this space is the currently visible (frontmost) space on its display. */
  isVisible: boolean;
  /** Whether this space's window list is collapsed in the UI. */
  isCollapsed: boolean;
  /** Whether this space belongs to the built-in (laptop) display. */
  isBuiltinDisplay: boolean;
  /** Windows present in this space. */
  windows: WindowInfo[];
}

/** A single application window within a space. */
export interface WindowInfo {
  /** macOS window ID. */
  windowId: number;
  /** Window title. */
  title: string;
  /** Owning application name. */
  appName: string;
  /** Owning application's bundle identifier. */
  bundleId: string;
  /** Whether the window is minimized. */
  isMinimized: boolean;
  /** The space this window belongs to. */
  spaceId: number;
}

/** Full state payload emitted by the backend polling loop. */
export interface SpaceStatePayload {
  /** All spaces across all displays. */
  spaces: SpaceInfo[];
  /** The currently active space ID. */
  activeSpaceId: number;
  /** Windows that are currently minimized (not on any space). */
  minimizedWindows: WindowInfo[];
  /** Timestamp of this snapshot. */
  timestamp: number;
}

/** Visualization modes for window display. */
export type ViewMode = "compact" | "list" | "hybrid" | "count";

// ---------------------------------------------------------------------------
// Space To-Dos
// ---------------------------------------------------------------------------

/** A single to-do item within a space's checklist. */
export interface TodoItem {
  /** Unique identifier (UUID). */
  id: string;
  /** To-do text. */
  text: string;
  /** Whether this item has been completed. */
  completed: boolean;
}

// ---------------------------------------------------------------------------
// App Groups / Launcher
// ---------------------------------------------------------------------------

/** Entry type discriminator for group entries. */
export type EntryType = "app" | "path" | "url";

/** A single entry within an app group (application, folder/file, or URL). */
export interface AppEntry {
  /**
   * Unique identifier for this entry.
   * - app:  macOS bundle identifier (e.g. "com.apple.mail").
   * - path: absolute file path (e.g. "/Users/me/Downloads").
   * - url:  full URL string (e.g. "https://example.com").
   */
  bundleId: string;
  /** Cached display name. */
  name: string;
  /** Entry type — defaults to "app" when absent (backward-compatible). */
  entryType?: EntryType;
}

/** A user-defined group of applications. */
export interface AppGroup {
  /** Unique identifier (UUID). */
  id: string;
  /** User-assigned group name. */
  name: string;
  /** Ordered list of apps in this group. */
  apps: AppEntry[];
  /** Whether this group is collapsed in the UI. */
  collapsed: boolean;
}

/** Minimal info about a discoverable application (dock, installed, running). */
export interface DiscoverableApp {
  /** macOS bundle identifier. */
  bundleId: string;
  /** Display name. */
  name: string;
}

/** A discoverable app with its icon pre-fetched (returned by get_all_discoverable_apps). */
export interface DiscoverableAppWithIcon {
  /** macOS bundle identifier. */
  bundleId: string;
  /** Display name. */
  name: string;
  /** Base64 data URI for the app icon (empty string if unavailable). */
  icon: string;
  /** Sources this app was discovered from: "dock", "running", "installed". */
  sources: string[];
}

/** Badge count result for a single app. */
export interface AppBadge {
  /** The app name (used as key for matching). */
  bundleId: string;
  /** Badge text (number or symbol). Empty if no badge. */
  badge: string;
}

/** User preferences stored on disk. */
export interface UserSettings {
  /** Default view mode for all spaces. */
  viewMode: ViewMode;
  /** Per-space view mode overrides keyed by "displayId:spaceIndex". */
  spaceViewModes: Record<string, ViewMode>;
  /** Font size (px) for space name labels. */
  spaceNameFontSize: number;
  /** Font size (px) for window/app name text. */
  windowFontSize: number;
  /** Remembered expanded window width (logical px). */
  expandedWidth: number;
  /** Remembered expanded window height (logical px). */
  expandedHeight: number;
  /** Font family CSS value. */
  fontFamily: string;
  /** Remembered window X position (physical pixels). */
  windowX?: number;
  /** Remembered window Y position (physical pixels). */
  windowY?: number;
  /** Whether the macOS Dock is suppressed from appearing. */
  suppressDock?: boolean;
  /** Whether the App Picker hides apps already in any group (default true). */
  hideGroupedApps?: boolean;
  /** Global hotkey to toggle Swavigator visibility (e.g. "Option+S"). */
  toggleHotkey?: string;
  /** Whether the panel should become nearly transparent when not hovered. */
  lowOpacityWhenIdle?: boolean;
  /** Opacity level (0–1) when idle mode is active. Default 0.15. */
  idleOpacity?: number;
  /** Whether to show a running indicator on launcher apps with open windows. */
  highlightRunningApps?: boolean;
  /** Panel orientation: "vertical" (default) or "horizontal". */
  orientation?: "vertical" | "horizontal";
  /** Remembered expanded window width for horizontal mode (logical px). */
  expandedHorizontalWidth?: number;
  /** Remembered expanded window height for horizontal mode (logical px). */
  expandedHorizontalHeight?: number;
  /** Percentage of space allocated to the app tray (0–100). Default 30. */
  traySplitPercent?: number;
  /** Whether to show the Minimized windows section. Default true. */
  showMinimized?: boolean;
  /** Whether dock mode (auto-show on hover) is enabled. */
  dockMode?: boolean;
  /** Size in pixels of the trigger strip when dock mode is collapsed. */
  dockTriggerSize?: number;
  /** Opacity of the trigger strip (0–1). Nearly invisible by default. */
  dockTriggerOpacity?: number;
  /** Delay in ms before the panel hides after the cursor leaves. */
  dockHideDelay?: number;
  /** Whether the per-space Tasks feature is enabled. Default true. */
  enableTodos?: boolean;
}
