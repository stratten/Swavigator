import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { ViewMode, UserSettings } from "../../../lib/types";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

export interface SettingsState {
  viewMode: ViewMode;
  spaceNameFontSize: number;
  windowFontSize: number;
  fontFamily: string;
  suppressDock: boolean;
  toggleHotkey: string;
  lowOpacityWhenIdle: boolean;
  idleOpacity: number;
  highlightRunningApps: boolean;
  orientation: "vertical" | "horizontal";
  showMinimized: boolean;
  dockMode: boolean;
  dockTriggerSize: number;
  dockTriggerOpacity: number;
  dockHideDelay: number;
  enableTodos: boolean;
  loaded: boolean;
}

export interface UseSettingsReturn {
  state: SettingsState;
  setViewMode: (mode: ViewMode) => void;
  setSpaceNameFontSize: (size: number) => void;
  setWindowFontSize: (size: number) => void;
  setFontFamily: (font: string) => void;
  setSuppressDock: (suppress: boolean) => void;
  setToggleHotkey: (hotkey: string) => void;
  setLowOpacityWhenIdle: (enabled: boolean) => void;
  setIdleOpacity: (opacity: number) => void;
  setHighlightRunningApps: (enabled: boolean) => void;
  setOrientation: (orientation: "vertical" | "horizontal") => void;
  setShowMinimized: (show: boolean) => void;
  setDockMode: (enabled: boolean) => void;
  setDockTriggerSize: (size: number) => void;
  setDockTriggerOpacity: (opacity: number) => void;
  setDockHideDelay: (delay: number) => void;
  setEnableTodos: (enabled: boolean) => void;
  updateSetting: (overrides: Partial<UserSettings>) => void;
}

/**
 * Manages settings state, persistence, and synchronization with the main window.
 */
export function useSettings(): UseSettingsReturn {
  const [viewMode, setViewModeState] = useState<ViewMode>("compact");
  const [spaceNameFontSize, setSpaceNameFontSizeState] = useState(13);
  const [windowFontSize, setWindowFontSizeState] = useState(12);
  const [fontFamily, setFontFamilyState] = useState(
    '"Helvetica Neue", Helvetica, Arial, sans-serif',
  );
  const [suppressDock, setSuppressDockState] = useState(false);
  const [toggleHotkey, setToggleHotkeyState] = useState("Option+S");
  const [lowOpacityWhenIdle, setLowOpacityWhenIdleState] = useState(false);
  const [idleOpacity, setIdleOpacityState] = useState(0.15);
  const [highlightRunningApps, setHighlightRunningAppsState] = useState(true);
  const [orientation, setOrientationState] = useState<"vertical" | "horizontal">("vertical");
  const [showMinimized, setShowMinimizedState] = useState(true);
  const [dockMode, setDockModeState] = useState(false);
  const [dockTriggerSize, setDockTriggerSizeState] = useState(8);
  const [dockTriggerOpacity, setDockTriggerOpacityState] = useState(0.02);
  const [dockHideDelay, setDockHideDelayState] = useState(800);
  const [enableTodos, setEnableTodosState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // Keep a ref to the full settings object for partial updates.
  const settingsRef = useRef<UserSettings | null>(null);

  // Load settings on mount.
  useEffect(() => {
    feLog("info", "[SettingsWindow] Invoking get_settings...");
    invoke<UserSettings>("get_settings")
      .then((s) => {
        feLog("info", `[SettingsWindow] get_settings returned: ${JSON.stringify(s)}`);
        settingsRef.current = s;
        setViewModeState((s.viewMode as ViewMode) || "compact");
        if (s.spaceNameFontSize) setSpaceNameFontSizeState(s.spaceNameFontSize);
        if (s.windowFontSize) setWindowFontSizeState(s.windowFontSize);
        if (s.fontFamily) setFontFamilyState(s.fontFamily);
        if (s.suppressDock != null) setSuppressDockState(!!s.suppressDock);
        if (s.toggleHotkey) setToggleHotkeyState(s.toggleHotkey);
        if (s.lowOpacityWhenIdle != null) setLowOpacityWhenIdleState(s.lowOpacityWhenIdle);
        if (s.idleOpacity != null) setIdleOpacityState(s.idleOpacity);
        if (s.highlightRunningApps != null) setHighlightRunningAppsState(s.highlightRunningApps);
        if (s.orientation) setOrientationState(s.orientation as "vertical" | "horizontal");
        if (s.showMinimized != null) setShowMinimizedState(s.showMinimized);
        if (s.dockMode != null) setDockModeState(s.dockMode);
        if (s.dockTriggerSize != null) setDockTriggerSizeState(s.dockTriggerSize);
        if (s.dockTriggerOpacity != null) setDockTriggerOpacityState(s.dockTriggerOpacity);
        if (s.dockHideDelay != null) setDockHideDelayState(s.dockHideDelay);
        if (s.enableTodos != null) setEnableTodosState(s.enableTodos);
        feLog(
          "info",
          `[SettingsWindow] State applied — lowOpacityWhenIdle=${s.lowOpacityWhenIdle} | suppressDock=${s.suppressDock} | highlightRunningApps=${s.highlightRunningApps} | showMinimized=${s.showMinimized} | orientation=${s.orientation} | dockMode=${s.dockMode}`,
        );
      })
      .catch((err) => {
        feLog("error", `[SettingsWindow] Failed to load settings: ${err}`);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Listen for settings-changed events from the main window.
  // Must update BOTH React state AND settingsRef so that subsequent
  // updateSetting() calls don't emit stale values back to the main panel.
  useEffect(() => {
    const unlisten = listen<Partial<UserSettings>>("settings-changed", (event) => {
      const s = event.payload;
      if (settingsRef.current) {
        settingsRef.current = { ...settingsRef.current, ...s };
      }
      if (s.orientation) setOrientationState(s.orientation as "vertical" | "horizontal");
      if (s.dockMode !== undefined) setDockModeState(s.dockMode);
      if (s.dockTriggerSize != null) setDockTriggerSizeState(s.dockTriggerSize);
      if (s.dockTriggerOpacity != null) setDockTriggerOpacityState(s.dockTriggerOpacity);
      if (s.dockHideDelay != null) setDockHideDelayState(s.dockHideDelay);
      if (s.enableTodos !== undefined) setEnableTodosState(s.enableTodos);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  /** Persist a partial settings update and notify the main window. */
  const updateSetting = useCallback(
    (overrides: Partial<UserSettings>) => {
      feLog("info", `[SettingsWindow] updateSetting called with overrides: ${JSON.stringify(overrides)}`);
      const base = settingsRef.current;
      feLog(
        "info",
        `[SettingsWindow] settingsRef.current before merge: lowOpacityWhenIdle=${base?.lowOpacityWhenIdle}, suppressDock=${base?.suppressDock}, highlightRunningApps=${base?.highlightRunningApps}`,
      );
      const merged: UserSettings = {
        viewMode: base?.viewMode ?? viewMode,
        spaceViewModes: base?.spaceViewModes ?? {},
        spaceNameFontSize: base?.spaceNameFontSize ?? spaceNameFontSize,
        windowFontSize: base?.windowFontSize ?? windowFontSize,
        expandedWidth: base?.expandedWidth ?? 280,
        expandedHeight: base?.expandedHeight ?? 400,
        expandedHorizontalWidth: base?.expandedHorizontalWidth ?? 800,
        expandedHorizontalHeight: base?.expandedHorizontalHeight ?? 220,
        fontFamily: base?.fontFamily ?? fontFamily,
        windowX: base?.windowX,
        windowY: base?.windowY,
        suppressDock: base?.suppressDock,
        hideGroupedApps: base?.hideGroupedApps,
        toggleHotkey: base?.toggleHotkey ?? toggleHotkey,
        lowOpacityWhenIdle: base?.lowOpacityWhenIdle ?? lowOpacityWhenIdle,
        idleOpacity: base?.idleOpacity ?? idleOpacity,
        highlightRunningApps: base?.highlightRunningApps ?? highlightRunningApps,
        orientation: base?.orientation ?? orientation,
        traySplitPercent: base?.traySplitPercent ?? 30,
        showMinimized: base?.showMinimized ?? showMinimized,
        dockMode: base?.dockMode ?? dockMode,
        dockTriggerSize: base?.dockTriggerSize ?? dockTriggerSize,
        dockTriggerOpacity: base?.dockTriggerOpacity ?? dockTriggerOpacity,
        dockHideDelay: base?.dockHideDelay ?? dockHideDelay,
        enableTodos: base?.enableTodos ?? enableTodos,
        ...overrides,
      };
      feLog(
        "info",
        `[SettingsWindow] Merged settings to save — lowOpacityWhenIdle=${merged.lowOpacityWhenIdle}, suppressDock=${merged.suppressDock}, highlightRunningApps=${merged.highlightRunningApps}, showMinimized=${merged.showMinimized}, orientation=${merged.orientation}`,
      );
      settingsRef.current = merged;
      invoke("update_settings", { settings: merged }).catch((err) => {
        feLog("error", `[SettingsWindow] Failed to save settings: ${err}`);
      });
      emit("settings-changed", merged);
    },
    [viewMode, spaceNameFontSize, windowFontSize, fontFamily, toggleHotkey, lowOpacityWhenIdle, idleOpacity, highlightRunningApps, orientation, showMinimized, dockMode, dockTriggerSize, dockTriggerOpacity, dockHideDelay, enableTodos],
  );

  // Wrapped setters that also persist.
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      updateSetting({ viewMode: mode });
    },
    [updateSetting],
  );

  const setSpaceNameFontSize = useCallback(
    (size: number) => {
      setSpaceNameFontSizeState(size);
      updateSetting({ spaceNameFontSize: size });
    },
    [updateSetting],
  );

  const setWindowFontSize = useCallback(
    (size: number) => {
      setWindowFontSizeState(size);
      updateSetting({ windowFontSize: size });
    },
    [updateSetting],
  );

  const setFontFamily = useCallback(
    (font: string) => {
      setFontFamilyState(font);
      updateSetting({ fontFamily: font });
    },
    [updateSetting],
  );

  const setSuppressDock = useCallback(
    (suppress: boolean) => {
      setSuppressDockState(suppress);
      updateSetting({ suppressDock: suppress });
      invoke("set_dock_suppressed", { suppress }).catch((err) =>
        feLog("error", `[SettingsWindow] Failed to set Dock suppressed: ${err}`),
      );
    },
    [updateSetting],
  );

  const setToggleHotkey = useCallback(
    (hotkey: string) => {
      setToggleHotkeyState(hotkey);
      updateSetting({ toggleHotkey: hotkey });
    },
    [updateSetting],
  );

  const setLowOpacityWhenIdle = useCallback(
    (enabled: boolean) => {
      setLowOpacityWhenIdleState(enabled);
      updateSetting({ lowOpacityWhenIdle: enabled });
    },
    [updateSetting],
  );

  const setIdleOpacity = useCallback(
    (opacity: number) => {
      setIdleOpacityState(opacity);
      updateSetting({ idleOpacity: opacity });
    },
    [updateSetting],
  );

  const setHighlightRunningApps = useCallback(
    (enabled: boolean) => {
      setHighlightRunningAppsState(enabled);
      updateSetting({ highlightRunningApps: enabled });
    },
    [updateSetting],
  );

  const setOrientation = useCallback(
    (o: "vertical" | "horizontal") => {
      setOrientationState(o);
      updateSetting({ orientation: o });
    },
    [updateSetting],
  );

  const setShowMinimized = useCallback(
    (show: boolean) => {
      setShowMinimizedState(show);
      updateSetting({ showMinimized: show });
    },
    [updateSetting],
  );

  const setDockMode = useCallback(
    (enabled: boolean) => {
      setDockModeState(enabled);
      updateSetting({ dockMode: enabled });
    },
    [updateSetting],
  );

  const setDockTriggerSize = useCallback(
    (size: number) => {
      setDockTriggerSizeState(size);
      updateSetting({ dockTriggerSize: size });
    },
    [updateSetting],
  );

  const setDockTriggerOpacity = useCallback(
    (opacity: number) => {
      setDockTriggerOpacityState(opacity);
      updateSetting({ dockTriggerOpacity: opacity });
    },
    [updateSetting],
  );

  const setDockHideDelay = useCallback(
    (delay: number) => {
      setDockHideDelayState(delay);
      updateSetting({ dockHideDelay: delay });
    },
    [updateSetting],
  );

  const setEnableTodos = useCallback(
    (enabled: boolean) => {
      setEnableTodosState(enabled);
      updateSetting({ enableTodos: enabled });
    },
    [updateSetting],
  );

  return {
    state: {
      viewMode,
      spaceNameFontSize,
      windowFontSize,
      fontFamily,
      suppressDock,
      toggleHotkey,
      lowOpacityWhenIdle,
      idleOpacity,
      highlightRunningApps,
      orientation,
      showMinimized,
      dockMode,
      dockTriggerSize,
      dockTriggerOpacity,
      dockHideDelay,
      enableTodos,
      loaded,
    },
    setViewMode,
    setSpaceNameFontSize,
    setWindowFontSize,
    setFontFamily,
    setSuppressDock,
    setToggleHotkey,
    setLowOpacityWhenIdle,
    setIdleOpacity,
    setHighlightRunningApps,
    setOrientation,
    setShowMinimized,
    setDockMode,
    setDockTriggerSize,
    setDockTriggerOpacity,
    setDockHideDelay,
    setEnableTodos,
    updateSetting,
  };
}
