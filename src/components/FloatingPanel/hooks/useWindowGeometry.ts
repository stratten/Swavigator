import { useEffect, useCallback, useRef } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { UserSettings } from "../../../lib/types";
import { COMPACT_WIDTH, COMPACT_HEIGHT } from "../constants";

/**
 * Manages window resize and move events, persisting size/position changes.
 */
export function useWindowGeometry(
  expanded: boolean,
  orientation: "vertical" | "horizontal",
  expandedSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  horizontalSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  ignoringMoveRef: React.MutableRefObject<boolean>,
  persistSettings: (overrides?: Partial<UserSettings>) => void,
) {
  // Flag to suppress saving the compact-size resize triggered by handleCollapse.
  const ignoringResizeRef = useRef(false);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExpand = useCallback(async () => {
    ignoringResizeRef.current = true;
    const win = getCurrentWindow();
    const sizeRef = orientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
    const { width, height } = sizeRef.current;
    await win.setSize(new LogicalSize(width, height));
    // Allow a brief window for the programmatic resize event to pass.
    setTimeout(() => { ignoringResizeRef.current = false; }, 200);
  }, [orientation, expandedSizeRef, horizontalSizeRef]);

  const handleCollapse = useCallback(async () => {
    ignoringResizeRef.current = true;
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(COMPACT_WIDTH, COMPACT_HEIGHT));
    // Keep ignoring until we expand again.
  }, []);

  // Listen for user-initiated resizes while expanded, debounce-persist the size.
  useEffect(() => {
    if (!expanded) return;

    const win = getCurrentWindow();
    const unlisten = win.onResized(async ({ payload: physicalSize }) => {
      if (ignoringResizeRef.current) return;

      const scaleFactor = await win.scaleFactor();
      const w = Math.round(physicalSize.width / scaleFactor);
      const h = Math.round(physicalSize.height / scaleFactor);

      // Ignore if it matches the compact size.
      if (w <= COMPACT_WIDTH && h <= COMPACT_HEIGHT) return;

      // Save to the correct ref for the current orientation.
      if (orientation === "horizontal") {
        horizontalSizeRef.current = { width: w, height: h };
      } else {
        expandedSizeRef.current = { width: w, height: h };
      }

      // Debounce the persist call.
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
  }, [expanded, orientation, persistSettings, expandedSizeRef, horizontalSizeRef]);

  // Listen for window moves and debounce-persist the position.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onMoved(({ payload: physicalPos }) => {
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
  }, [persistSettings, ignoringMoveRef]);

  return {
    handleExpand,
    handleCollapse,
    ignoringResizeRef,
  };
}
