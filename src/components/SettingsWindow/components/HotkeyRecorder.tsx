import { useState, useEffect, useRef } from "react";

/**
 * Map browser key event values to Tauri shortcut tokens.
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
    "MetaLeft",
    "MetaRight",
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight",
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

interface HotkeyRecorderProps {
  value: string;
  onChange: (val: string) => void;
}

/**
 * A keyboard shortcut recorder that captures key combinations.
 */
export function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
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
        title={
          recording
            ? "Press a key combination, or Escape to cancel."
            : "Click to record a new shortcut."
        }
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
