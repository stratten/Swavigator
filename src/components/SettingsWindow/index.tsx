import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useSettings } from "./hooks/useSettings";
import { SectionHeader, SettingRow, StyledSelect, ToggleSwitch } from "./components/FormControls";
import { HotkeyRecorder } from "./components/HotkeyRecorder";

/**
 * Standalone Settings window that runs in its own Tauri WebviewWindow.
 * Reads/writes settings via invoke commands and emits "settings-changed"
 * events so the main FloatingPanel can update in real time.
 */
export function SettingsWindow() {
  const {
    state,
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
  } = useSettings();

  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  if (!state.loaded) {
    return (
      <div
        className="h-full flex items-center justify-center rounded-lg"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          color: "var(--text-muted)",
          fontSize: "13px",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col rounded-lg overflow-hidden"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        fontFamily: state.fontFamily,
      }}
    >
      {/* Title bar */}
      <div
        data-tauri-drag-region
        className="flex items-center py-2 px-4 flex-shrink-0 cursor-grab"
        style={{ borderBottom: "1px solid var(--panel-border)" }}
      >
        <span
          data-tauri-drag-region
          className="font-semibold flex-1"
          style={{ color: "var(--text-primary)", fontSize: "13px" }}
        >
          Settings
        </span>
        <button
          onClick={handleClose}
          className="cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 4px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* ── Appearance ──────────────────────────────── */}
        <SectionHeader first>Appearance</SectionHeader>

        <SettingRow label="View Mode">
          <StyledSelect
            value={state.viewMode}
            onChange={(val) => setViewMode(val as "compact" | "list" | "hybrid" | "count")}
            options={[
              { value: "compact", label: "Compact" },
              { value: "list", label: "List" },
              { value: "hybrid", label: "Hybrid" },
              { value: "count", label: "Count Only" },
            ]}
          />
        </SettingRow>

        <SettingRow label="Space Name Size">
          <StyledSelect
            value={String(state.spaceNameFontSize)}
            onChange={(val) => setSpaceNameFontSize(Number(val))}
            options={[10, 11, 12, 13, 14, 15, 16].map((n) => ({
              value: String(n),
              label: `${n}px`,
            }))}
          />
        </SettingRow>

        <SettingRow label="Window Name Size">
          <StyledSelect
            value={String(state.windowFontSize)}
            onChange={(val) => setWindowFontSize(Number(val))}
            options={[9, 10, 11, 12, 13, 14].map((n) => ({
              value: String(n),
              label: `${n}px`,
            }))}
          />
        </SettingRow>

        <SettingRow label="Font">
          <StyledSelect
            value={state.fontFamily}
            onChange={setFontFamily}
            options={[
              {
                value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                label: "Helvetica Neue",
              },
              {
                value:
                  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", sans-serif',
                label: "SF Pro",
              },
              {
                value: '"Avenir Next", Avenir, sans-serif',
                label: "Avenir Next",
              },
              {
                value: 'Menlo, Monaco, "Courier New", monospace',
                label: "Menlo",
              },
              {
                value: '"SF Mono", SFMono-Regular, Menlo, monospace',
                label: "SF Mono",
              },
              {
                value: 'Georgia, "Times New Roman", serif',
                label: "Georgia",
              },
              {
                value: '"Gill Sans", "Gill Sans MT", sans-serif',
                label: "Gill Sans",
              },
              {
                value: 'Futura, "Trebuchet MS", sans-serif',
                label: "Futura",
              },
              {
                value: "system-ui, -apple-system, sans-serif",
                label: "System Default",
              },
            ]}
          />
        </SettingRow>

        <SettingRow label="Orientation">
          <StyledSelect
            value={state.orientation}
            onChange={(val) => setOrientation(val as "vertical" | "horizontal")}
            options={[
              { value: "vertical", label: "Vertical" },
              { value: "horizontal", label: "Horizontal" },
            ]}
          />
        </SettingRow>

        {/* ── Behavior ───────────────────────────────── */}
        <SectionHeader>Behavior</SectionHeader>

        <SettingRow label="Show Minimized Windows">
          <ToggleSwitch checked={state.showMinimized} onChange={setShowMinimized} />
        </SettingRow>

        <SettingRow label="Suppress Dock">
          <ToggleSwitch checked={state.suppressDock} onChange={setSuppressDock} />
        </SettingRow>

        <SettingRow label="Highlight Running Apps">
          <ToggleSwitch checked={state.highlightRunningApps} onChange={setHighlightRunningApps} />
        </SettingRow>

        <SettingRow label="Low Opacity When Idle">
          <ToggleSwitch checked={state.lowOpacityWhenIdle} onChange={setLowOpacityWhenIdle} />
        </SettingRow>

        {state.lowOpacityWhenIdle && (
          <SettingRow label="Idle Opacity">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.05}
                value={state.idleOpacity}
                onChange={(e) => setIdleOpacity(parseFloat(e.target.value))}
                className="cursor-pointer"
                style={{ width: "80px", accentColor: "var(--accent-blue)" }}
              />
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)", minWidth: "30px" }}
              >
                {Math.round(state.idleOpacity * 100)}%
              </span>
            </div>
          </SettingRow>
        )}

        {/* ── Shortcuts ──────────────────────────────── */}
        <SectionHeader>Shortcuts</SectionHeader>

        <SettingRow label="Toggle Visibility">
          <HotkeyRecorder value={state.toggleHotkey} onChange={setToggleHotkey} />
        </SettingRow>

        {/* Hints */}
        <div
          className="mt-4 text-xs"
          style={{ color: "var(--text-muted)", fontSize: "10px" }}
        >
          Click ✎ next to a space name in the main panel to rename it.
        </div>
      </div>
    </div>
  );
}
