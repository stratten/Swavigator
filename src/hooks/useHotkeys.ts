import { useEffect, useRef } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SpaceInfo } from "../lib/types";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

/**
 * Registers global hotkeys for space navigation and window toggling.
 *
 * Option+1 through Option+9 navigate to spaces 1-9.
 * The configurable toggle hotkey shows/hides the panel.
 */
export function useHotkeys(
  spaces: SpaceInfo[],
  activeSpaceId: number,
  toggleHotkey?: string,
) {
  const spacesRef = useRef(spaces);
  const activeRef = useRef(activeSpaceId);

  // Track the currently-registered toggle shortcut so cleanup is always correct,
  // even across React strict-mode double-mounts or async race conditions.
  const registeredToggleRef = useRef<string | null>(null);

  // Keep refs current.
  spacesRef.current = spaces;
  activeRef.current = activeSpaceId;

  // Space navigation shortcuts.
  useEffect(() => {
    const shortcuts: string[] = [];

    async function registerShortcuts() {
      for (let i = 1; i <= 9; i++) {
        const shortcut = `Option+${i}`;
        try {
          // Attempt to unregister first in case it's already registered
          // (e.g., React strict-mode double-mount or HMR).
          await unregister(shortcut).catch(() => {});
          await register(shortcut, (event) => {
            if (event.state === "Pressed") {
              handleSpaceNav(i);
            }
          });
          shortcuts.push(shortcut);
        } catch {
          // Expected during HMR — the previous registration hasn't been
          // released yet. The old handler is still active, so the hotkey
          // continues to work. Silently ignore.
        }
      }
    }

    async function handleSpaceNav(spaceIndex: number) {
      const currentSpaces = spacesRef.current;
      const currentActive = activeRef.current;

      const target = currentSpaces.find(
        (s) => s.spaceIndex === spaceIndex,
      );
      if (!target) return;
      if (target.spaceId === currentActive) return;

      try {
        const windowTitle =
          target.windows.length > 0 ? target.windows[0].title : null;
        await invoke("navigate_to_space", {
          spaceIndex: target.spaceIndex,
          currentSpaceId: currentActive,
          targetSpaceId: target.spaceId,
          windowTitle,
        });
        invoke("resign_focus").catch(() => {});
      } catch (err) {
        feLog(
          "error",
          `[useHotkeys] navigate_to_space(${spaceIndex}) failed: ${err}`,
        );
      }
    }

    registerShortcuts();

    return () => {
      for (const s of shortcuts) {
        unregister(s).catch(() => {});
      }
    };
  }, []);

  // Toggle-visibility hotkey — re-register whenever the key binding changes.
  useEffect(() => {
    if (!toggleHotkey) return;

    let cancelled = false;

    async function registerToggle() {
      // Always unregister the previously-registered shortcut first,
      // regardless of whether it's the same or different.
      const prev = registeredToggleRef.current;
      if (prev) {
        feLog("info", `[useHotkeys] Unregistering old toggle shortcut: "${prev}"`);
        try {
          await unregister(prev);
        } catch {
          // May not have been registered — that's fine.
        }
        registeredToggleRef.current = null;
      }

      // If the effect was cleaned up while we were awaiting, bail.
      if (cancelled) return;

      feLog("info", `[useHotkeys] Registering toggle shortcut: "${toggleHotkey}"`);
      try {
        // Also try to unregister the new shortcut itself in case it's already
        // registered from a previous mount cycle.
        await unregister(toggleHotkey!).catch(() => {});
        await register(toggleHotkey!, (event) => {
          if (event.state === "Pressed") {
            handleToggle();
          }
        });
        registeredToggleRef.current = toggleHotkey!;
        feLog("info", `[useHotkeys] Successfully registered toggle shortcut: "${toggleHotkey}"`);
      } catch {
        // Expected during HMR — the old registration is still active.
      }
    }

    async function handleToggle() {
      const win = getCurrentWindow();
      const visible = await win.isVisible();
      if (visible) {
        await win.hide();
        invoke("resign_focus").catch(() => {});
      } else {
        await win.show();
        await win.setFocus();
      }
    }

    registerToggle();

    return () => {
      cancelled = true;
      // Eagerly unregister on cleanup so no stale shortcut remains.
      const current = registeredToggleRef.current;
      if (current) {
        feLog("info", `[useHotkeys] Cleanup: unregistering toggle shortcut: "${current}"`);
        unregister(current).catch(() => {});
        registeredToggleRef.current = null;
      }
    };
  }, [toggleHotkey]);
}
