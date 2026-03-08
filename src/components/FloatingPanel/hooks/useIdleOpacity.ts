import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
        const win = getCurrentWindow();
        const [cursorX, cursorY] = await invoke<[number, number]>("get_cursor_position");
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const scale = await win.scaleFactor();

        // Convert physical window bounds to logical.
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

  return isHovered;
}
