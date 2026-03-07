import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ViewMode, UserSettings } from "../lib/types";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

/**
 * Standalone Settings window that runs in its own Tauri WebviewWindow.
 * Reads/writes settings via invoke commands and emits "settings-changed"
 * events so the main FloatingPanel can update in real time.
 */
export function SettingsWindow() {
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [spaceNameFontSize, setSpaceNameFontSize] = useState(13);
  const [windowFontSize, setWindowFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState(
    '"Helvetica Neue", Helvetica, Arial, sans-serif',
  );
  const [suppressDock, setSuppressDock] = useState(false);
  const [toggleHotkey, setToggleHotkey] = useState("Option+S");
  const [lowOpacityWhenIdle, setLowOpacityWhenIdle] = useState(false);
  const [idleOpacity, setIdleOpacity] = useState(0.15);
  const [highlightRunningApps, setHighlightRunningApps] = useState(true);
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
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
        setViewMode((s.viewMode as ViewMode) || "compact");
        if (s.spaceNameFontSize) setSpaceNameFontSize(s.spaceNameFontSize);
        if (s.windowFontSize) setWindowFontSize(s.windowFontSize);
        if (s.fontFamily) setFontFamily(s.fontFamily);
        if (s.suppressDock != null) setSuppressDock(!!s.suppressDock);
        if (s.toggleHotkey) setToggleHotkey(s.toggleHotkey);
        if (s.lowOpacityWhenIdle != null) setLowOpacityWhenIdle(s.lowOpacityWhenIdle);
        if (s.idleOpacity != null) setIdleOpacity(s.idleOpacity);
        if (s.highlightRunningApps != null) setHighlightRunningApps(s.highlightRunningApps);
        if (s.orientation) setOrientation(s.orientation as "vertical" | "horizontal");
        feLog("info", `[SettingsWindow] State applied — lowOpacityWhenIdle=${s.lowOpacityWhenIdle} | suppressDock=${s.suppressDock} | highlightRunningApps=${s.highlightRunningApps} | idleOpacity=${s.idleOpacity} | orientation=${s.orientation}`);
      })
      .catch((err) => {
        feLog("error", `[SettingsWindow] Failed to load settings: ${err}`);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Listen for settings-changed events from the main window (e.g. inline
  // orientation toggle) so our UI stays in sync.
  useEffect(() => {
    const unlisten = listen<Partial<UserSettings>>("settings-changed", (event) => {
      const s = event.payload;
      if (s.orientation) setOrientation(s.orientation as "vertical" | "horizontal");
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
      feLog("info", `[SettingsWindow] settingsRef.current before merge: lowOpacityWhenIdle=${base?.lowOpacityWhenIdle}, suppressDock=${base?.suppressDock}, highlightRunningApps=${base?.highlightRunningApps}`);
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
        ...overrides,
      };
      feLog("info", `[SettingsWindow] Merged settings to save — lowOpacityWhenIdle=${merged.lowOpacityWhenIdle}, suppressDock=${merged.suppressDock}, highlightRunningApps=${merged.highlightRunningApps}, idleOpacity=${merged.idleOpacity}, orientation=${merged.orientation}`);
      settingsRef.current = merged;
      invoke("update_settings", { settings: merged }).catch((err) => {
        feLog("error", `[SettingsWindow] Failed to save settings: ${err}`);
      });
      emit("settings-changed", merged);
    },
    [viewMode, spaceNameFontSize, windowFontSize, fontFamily, toggleHotkey, lowOpacityWhenIdle, idleOpacity, highlightRunningApps, orientation],
  );

  // Log the full rendered settings state on every change so the terminal
  // always shows what the UI is currently displaying.
  useEffect(() => {
    if (!loaded) return;
    feLog("info", [
      `[SettingsWindow] Current display state:`,
      `  viewMode=${viewMode}`,
      `  spaceNameFontSize=${spaceNameFontSize}`,
      `  windowFontSize=${windowFontSize}`,
      `  fontFamily=${fontFamily}`,
      `  suppressDock=${suppressDock}`,
      `  toggleHotkey=${toggleHotkey}`,
      `  lowOpacityWhenIdle=${lowOpacityWhenIdle}`,
      `  idleOpacity=${idleOpacity}`,
      `  highlightRunningApps=${highlightRunningApps}`,
      `  orientation=${orientation}`,
    ].join("\n"));
  }, [loaded, viewMode, spaceNameFontSize, windowFontSize, fontFamily, suppressDock, toggleHotkey, lowOpacityWhenIdle, idleOpacity, highlightRunningApps, orientation]);

  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  if (!loaded) {
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
        fontFamily,
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* ── Appearance ──────────────────────────────── */}
        <SectionHeader first>Appearance</SectionHeader>

        <SettingRow label="View Mode">
          <StyledSelect
            value={viewMode}
            onChange={(val) => {
              const mode = val as ViewMode;
              setViewMode(mode);
              updateSetting({ viewMode: mode });
            }}
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
            value={String(spaceNameFontSize)}
            onChange={(val) => {
              const size = Number(val);
              setSpaceNameFontSize(size);
              updateSetting({ spaceNameFontSize: size });
            }}
            options={[10, 11, 12, 13, 14, 15, 16].map((n) => ({
              value: String(n),
              label: `${n}px`,
            }))}
          />
        </SettingRow>

        <SettingRow label="Window Name Size">
          <StyledSelect
            value={String(windowFontSize)}
            onChange={(val) => {
              const size = Number(val);
              setWindowFontSize(size);
              updateSetting({ windowFontSize: size });
            }}
            options={[9, 10, 11, 12, 13, 14].map((n) => ({
              value: String(n),
              label: `${n}px`,
            }))}
          />
        </SettingRow>

        <SettingRow label="Font">
          <StyledSelect
            value={fontFamily}
            onChange={(val) => {
              setFontFamily(val);
              updateSetting({ fontFamily: val });
            }}
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
            value={orientation}
            onChange={(val) => {
              const o = val as "vertical" | "horizontal";
              setOrientation(o);
              updateSetting({ orientation: o });
            }}
            options={[
              { value: "vertical", label: "Vertical" },
              { value: "horizontal", label: "Horizontal" },
            ]}
          />
        </SettingRow>

        {/* ── Behaviour ──────────────────────────────── */}
        <SectionHeader>Behaviour</SectionHeader>

        <SettingRow label="Suppress Dock">
          <ToggleSwitch
            checked={suppressDock}
            onChange={(next) => {
              setSuppressDock(next);
              updateSetting({ suppressDock: next });
              invoke("set_dock_suppressed", { suppress: next }).catch((err) =>
                feLog("error", `[SettingsWindow] Failed to set Dock suppressed: ${err}`),
              );
            }}
          />
        </SettingRow>

        <SettingRow label="Highlight Running Apps">
          <ToggleSwitch
            checked={highlightRunningApps}
            onChange={(next) => {
              setHighlightRunningApps(next);
              updateSetting({ highlightRunningApps: next });
            }}
          />
        </SettingRow>

        <SettingRow label="Low Opacity When Idle">
          <ToggleSwitch
            checked={lowOpacityWhenIdle}
            onChange={(next) => {
              setLowOpacityWhenIdle(next);
              updateSetting({ lowOpacityWhenIdle: next });
            }}
          />
        </SettingRow>

        {lowOpacityWhenIdle && (
          <SettingRow label="Idle Opacity">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.05}
                value={idleOpacity}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setIdleOpacity(val);
                  updateSetting({ idleOpacity: val });
                }}
                className="cursor-pointer"
                style={{ width: "80px", accentColor: "var(--accent-blue)" }}
              />
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)", minWidth: "30px" }}
              >
                {Math.round(idleOpacity * 100)}%
              </span>
            </div>
          </SettingRow>
        )}

        {/* ── Shortcuts ──────────────────────────────── */}
        <SectionHeader>Shortcuts</SectionHeader>

        <SettingRow label="Toggle Visibility">
          <HotkeyRecorder
            value={toggleHotkey}
            onChange={(next) => {
              setToggleHotkey(next);
              updateSetting({ toggleHotkey: next });
            }}
          />
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

// ─── Small presentational sub-components ─────────────────────────────────

function SectionHeader({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className="text-xs font-semibold mb-2"
      style={{
        color: "var(--text-muted)",
        letterSpacing: "0.05em",
        marginTop: first ? 0 : "14px",
        paddingBottom: "4px",
        borderBottom: "1px solid var(--panel-border)",
      }}
    >
      {children}
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ marginBottom: "6px", padding: "3px 6px" }}
    >
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function StyledSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="view-mode-select text-xs rounded px-1.5 py-0.5 outline-none cursor-pointer"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className="w-8 h-4 rounded-full"
        style={{
          background: checked
            ? "var(--accent-color, #3b82f6)"
            : "rgba(63, 63, 70, 0.6)",
        }}
      >
        <div
          className="absolute rounded-full transition-transform"
          style={{
            width: "12px",
            height: "12px",
            top: "2px",
            left: "2px",
            background: "#fff",
            transform: checked ? "translateX(16px)" : "translateX(0)",
          }}
        />
      </div>
    </label>
  );
}

// ─── Hotkey Recorder ─────────────────────────────────────────────────────

/** Map browser key event values to Tauri shortcut tokens.
 *
 * Uses `e.code` (physical key) instead of `e.key` so that modifier
 * combinations like Option+L produce "Option+L" rather than the
 * composed character ("¬" on macOS).
 */
function keyEventToTauriShortcut(e: KeyboardEvent): string | null {
  // Must have at least one modifier.
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return null;

  // Ignore bare modifier presses.
  const bareModifierCodes = new Set([
    "MetaLeft", "MetaRight",
    "ControlLeft", "ControlRight",
    "AltLeft", "AltRight",
    "ShiftLeft", "ShiftRight",
    "CapsLock",
  ]);
  if (bareModifierCodes.has(e.code)) return null;

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Option");
  if (e.shiftKey) parts.push("Shift");

  // Derive the logical key name from the physical key code.
  const code = e.code;
  let key: string | null = null;

  // Letter keys: "KeyA" → "A", "KeyZ" → "Z"
  if (/^Key[A-Z]$/.test(code)) {
    key = code.slice(3); // already uppercase
  }
  // Digit keys: "Digit0" → "0", "Digit9" → "9"
  else if (/^Digit[0-9]$/.test(code)) {
    key = code.slice(5);
  }
  // Numpad digits: "Numpad0" → "0"
  else if (/^Numpad[0-9]$/.test(code)) {
    key = code.slice(6);
  }
  // Function keys: "F1" → "F1", "F12" → "F12"
  else if (/^F\d{1,2}$/.test(code)) {
    key = code;
  }
  // Special keys
  else {
    const codeMap: Record<string, string> = {
      Space: "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Escape: "Escape",
      Enter: "Enter",
      NumpadEnter: "Enter",
      Backspace: "Backspace",
      Delete: "Delete",
      Tab: "Tab",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backquote: "`",
    };
    key = codeMap[code] ?? null;
  }

  if (!key) return null;

  parts.push(key);
  return parts.join("+");
}

/** Pretty-print a Tauri shortcut string for display. */
function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace("CommandOrControl", "⌘")
    .replace("Option", "⌥")
    .replace("Shift", "⇧")
    .replace("Space", "Space")
    .replace(/\+/g, " ");
}

function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use a document-level keydown listener while recording.
  // This avoids issues with button focus being lost (onBlur) when
  // modifier keys are pressed, and works regardless of focus state.
  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording.
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }

      const combo = keyEventToTauriShortcut(e);
      if (combo) {
        onChange(combo);
        setRecording(false);
      }
    };

    // Click outside the recorder cancels recording.
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setRecording(false);
      }
    };

    // Attach at the document level with capture to get events before
    // anything else can intercept them.
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handleClickOutside, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [recording, onChange]);

  return (
    <div ref={containerRef} className="flex items-center gap-1.5">
      <button
        onClick={() => setRecording(true)}
        className="text-xs rounded px-2 py-0.5 outline-none cursor-pointer"
        style={{
          color: recording ? "var(--accent-blue)" : "var(--text-primary)",
          background: "rgba(63, 63, 70, 0.4)",
          border: recording
            ? "1px solid var(--accent-blue)"
            : "1px solid var(--panel-border)",
          minWidth: "80px",
          textAlign: "center",
          transition: "border-color 0.2s ease",
        }}
        title={recording ? "Press a key combination, or Escape to cancel." : "Click to record a new shortcut."}
      >
        {recording ? "Press keys…" : formatShortcutDisplay(value)}
      </button>
      {value && !recording && (
        <button
          onClick={() => onChange("")}
          className="text-xs cursor-pointer rounded"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "10px",
            padding: "2px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title="Clear shortcut"
        >
          ✕
        </button>
      )}
    </div>
  );
}
