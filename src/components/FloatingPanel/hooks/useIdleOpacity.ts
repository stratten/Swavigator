import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type CursorWindowState = {
  inside: boolean;
};

/**
 * Polls cursor position to detect hover even when the window is unfocused.
 * CSS :hover and JS mouseenter/mouseleave don't fire on unfocused macOS windows.
 */
export function useIdleOpacity(lowOpacityWhenIdle: boolean): boolean {
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!lowOpacityWhenIdle) return;

    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const state = await invoke<CursorWindowState>("get_cursor_window_state");
        setIsHovered(state.inside);
      } catch {
        // Silently ignore — window may be closing.
      }
    };

    const intervalId = setInterval(poll, 300);
    poll(); // Initial check.

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [lowOpacityWhenIdle]);

  return isHovered;
}
