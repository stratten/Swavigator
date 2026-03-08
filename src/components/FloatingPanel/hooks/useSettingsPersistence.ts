import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import type { ViewMode, UserSettings } from "../../../lib/types";
import {
  DEFAULT_EXPANDED_WIDTH,
  DEFAULT_EXPANDED_HEIGHT,
  DEFAULT_HORIZONTAL_WIDTH,
  DEFAULT_HORIZONTAL_HEIGHT,
} from "../constants";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

export interface SettingsState {
  viewMode: ViewMode;
  spaceNameFontSize: number;
  windowFontSize: number;
  fontFamily: string;
  toggleHotkey: string | undefined;
  lowOpacityWhenIdle: boolean;
  idleOpacity: number;
  highlightRunningApps: boolean;
  orientation: "vertical" | "horizontal";
  traySplitPercent: number;
  showMinimized: boolean;
}

export interface UseSettingsPersistenceReturn {
  settings: SettingsState;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  setSpaceNameFontSize: React.Dispatch<React.SetStateAction<number>>;
  setWindowFontSize: React.Dispatch<React.SetStateAction<number>>;
  setFontFamily: React.Dispatch<React.SetStateAction<string>>;
  setToggleHotkey: React.Dispatch<React.SetStateAction<string | undefined>>;
  setLowOpacityWhenIdle: React.Dispatch<React.SetStateAction<boolean>>;
  setIdleOpacity: React.Dispatch<React.SetStateAction<number>>;
  setHighlightRunningApps: React.Dispatch<React.SetStateAction<boolean>>;
  setOrientation: React.Dispatch<React.SetStateAction<"vertical" | "horizontal">>;
  setTraySplitPercent: React.Dispatch<React.SetStateAction<number>>;
  setShowMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  persistSettings: (overrides?: Partial<UserSettings>) => void;
  expandedSizeRef: React.MutableRefObject<{ width: number; height: number }>;
  horizontalSizeRef: React.MutableRefObject<{ width: number; height: number }>;
  settingsLoadedRef: React.MutableRefObject<boolean>;
  ignoringMoveRef: React.MutableRefObject<boolean>;
  handleToggleOrientation: () => void;
}

export function useSettingsPersistence(
  expanded: boolean,
): UseSettingsPersistenceReturn {
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [spaceNameFontSize, setSpaceNameFontSize] = useState(13);
  const [windowFontSize, setWindowFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState('"Helvetica Neue", Helvetica, Arial, sans-serif');
  const [toggleHotkey, setToggleHotkey] = useState<string | undefined>("Option+S");
  const [lowOpacityWhenIdle, setLowOpacityWhenIdle] = useState(false);
  const [idleOpacity, setIdleOpacity] = useState(0.15);
  const [highlightRunningApps, setHighlightRunningApps] = useState(true);
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [traySplitPercent, setTraySplitPercent] = useState(30);
  const [showMinimized, setShowMinimized] = useState(true);

  // Guard: prevent persistSettings from firing before settings have been loaded.
  const settingsLoadedRef = useRef(false);

  // Remembered expanded sizes.
  const expandedSizeRef = useRef({ width: DEFAULT_EXPANDED_WIDTH, height: DEFAULT_EXPANDED_HEIGHT });
  const horizontalSizeRef = useRef({ width: DEFAULT_HORIZONTAL_WIDTH, height: DEFAULT_HORIZONTAL_HEIGHT });

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
        toggleHotkey,
        lowOpacityWhenIdle,
        idleOpacity,
        highlightRunningApps,
        orientation,
        traySplitPercent,
        showMinimized,
        ...overrides,
      };
      const caller = new Error().stack?.split("\n")[2]?.trim() ?? "unknown";
      feLog("info", `[FloatingPanel] persistSettings — overrides=[${Object.keys(overrides).join(",")}], lowOpacityWhenIdle=${merged.lowOpacityWhenIdle}, suppressDock=${merged.suppressDock}, highlightRunningApps=${merged.highlightRunningApps}, idleOpacity=${merged.idleOpacity}, orientation=${merged.orientation}, caller=${caller}`);
      invoke("update_settings", { settings: merged }).catch((err) =>
        feLog("error", `[FloatingPanel] Failed to save settings: ${err}`),
      );
    },
    [viewMode, spaceNameFontSize, windowFontSize, fontFamily, toggleHotkey, lowOpacityWhenIdle, idleOpacity, highlightRunningApps, orientation, traySplitPercent, showMinimized],
  );

  // Load settings on mount.
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
        if (settings.showMinimized != null) setShowMinimized(settings.showMinimized);
        feLog("info", `[FloatingPanel] Settings applied — lowOpacityWhenIdle=${settings.lowOpacityWhenIdle} | suppressDock=${settings.suppressDock} | highlightRunningApps=${settings.highlightRunningApps} | showMinimized=${settings.showMinimized} | orientation=${restoredOrientation}`);

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
      if (s.showMinimized !== undefined) setShowMinimized(s.showMinimized);
      if (s.orientation) {
        const newOrientation = s.orientation as "vertical" | "horizontal";
        setOrientation((prev) => {
          if (prev !== newOrientation && expanded) {
            const targetRef = newOrientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
            const currentRef = prev === "horizontal" ? horizontalSizeRef : expandedSizeRef;

            // If the target mode's dimensions are still at factory defaults,
            // initialize them by swapping the current width ↔ height.
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
              .catch(() => {});
          }
          return newOrientation;
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [expanded]);

  /** Toggle between vertical and horizontal orientation. */
  const handleToggleOrientation = useCallback(() => {
    const newOrientation = orientation === "vertical" ? "horizontal" : "vertical";
    persistSettings({ orientation: newOrientation });
    emit("settings-changed", { orientation: newOrientation });
  }, [orientation, persistSettings]);

  return {
    settings: {
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
    },
    setViewMode,
    setSpaceNameFontSize,
    setWindowFontSize,
    setFontFamily,
    setToggleHotkey,
    setLowOpacityWhenIdle,
    setIdleOpacity,
    setHighlightRunningApps,
    setOrientation,
    setTraySplitPercent,
    setShowMinimized,
    persistSettings,
    expandedSizeRef,
    horizontalSizeRef,
    settingsLoadedRef,
    ignoringMoveRef,
    handleToggleOrientation,
  };
}
