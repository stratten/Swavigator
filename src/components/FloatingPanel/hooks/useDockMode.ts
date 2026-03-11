import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { DEFAULT_DOCK_TRIGGER_SIZE, DEFAULT_DOCK_HIDE_DELAY } from "../constants";

type Edge = "left" | "right" | "top" | "bottom";

export interface UseDockModeReturn {
  isDockExpanded: boolean;
  dockModeActive: boolean;
}

/**
 * Determines which screen edge the window's center is closest to.
 */
function detectNearestEdge(
  wx: number, wy: number, ww: number, wh: number,
  mx: number, my: number, mw: number, mh: number,
): Edge {
  const centerX = wx + ww / 2;
  const centerY = wy + wh / 2;

  const distLeft = centerX - mx;
  const distRight = (mx + mw) - centerX;
  const distTop = centerY - my;
  const distBottom = (my + mh) - centerY;

  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distTop) return "top";
  return "bottom";
}

/**
 * Manages dock-mode auto-show/hide behavior.
 *
 * When collapsed, the window becomes a thin strip spanning the full length of
 * the nearest screen edge. When the cursor enters the strip, the panel expands
 * back to its remembered position and size. A configurable delay prevents
 * accidental re-collapse when the cursor briefly leaves the panel.
 */
export function useDockMode(
  dockMode: boolean,
  dockTriggerSize: number,
  dockHideDelay: number,
  orientation: "vertical" | "horizontal",
  expandedSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  horizontalSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  ignoringResizeRef: React.MutableRefObject<boolean>,
  ignoringMoveRef: React.MutableRefObject<boolean>,
): UseDockModeReturn {
  const [isDockExpanded, setIsDockExpanded] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResizingRef = useRef(false);

  // Remember which edge we collapsed to.
  const dockedEdgeRef = useRef<Edge>("left");
  // Cache monitor bounds and menu bar inset (logical px).
  const monitorBoundsRef = useRef<{ x: number; y: number; w: number; h: number; menuBarH: number }>({ x: 0, y: 0, w: 1920, h: 1080, menuBarH: 25 });

  const triggerSize = dockTriggerSize || DEFAULT_DOCK_TRIGGER_SIZE;
  const hideDelay = dockHideDelay || DEFAULT_DOCK_HIDE_DELAY;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const collapseToDock = useCallback(async () => {
    if (isResizingRef.current) return;
    isResizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) return;

      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const size = await win.outerSize();

      // Window bounds in logical pixels.
      const wx = pos.x / scale;
      const wy = pos.y / scale;
      const ww = size.width / scale;
      const wh = size.height / scale;

      // Monitor bounds in logical pixels.
      const mx = monitor.position.x / scale;
      const my = monitor.position.y / scale;
      const mw = monitor.size.width / scale;
      const mh = monitor.size.height / scale;

      const edge = detectNearestEdge(wx, wy, ww, wh, mx, my, mw, mh);
      dockedEdgeRef.current = edge;

      // Query the macOS menu bar height so we don't place the panel behind it.
      let menuBarH = 25;
      try {
        menuBarH = await invoke<number>("get_menu_bar_height");
      } catch { /* use fallback */ }
      monitorBoundsRef.current = { x: mx, y: my, w: mw, h: mh, menuBarH };

      // Usable area starts below the menu bar.
      const usableY = my + menuBarH;
      const usableH = mh - menuBarH;

      let stripW: number, stripH: number, stripX: number, stripY: number;

      switch (edge) {
        case "left":
          stripW = triggerSize;
          stripH = usableH;
          stripX = mx;
          stripY = usableY;
          break;
        case "right":
          stripW = triggerSize;
          stripH = usableH;
          stripX = mx + mw - triggerSize;
          stripY = usableY;
          break;
        case "top":
          stripW = mw;
          stripH = triggerSize;
          stripX = mx;
          stripY = usableY;
          break;
        case "bottom":
          stripW = mw;
          stripH = triggerSize;
          stripX = mx;
          stripY = my + mh - triggerSize;
          break;
      }

      await win.setSize(new LogicalSize(stripW, stripH));
      await win.setPosition(new LogicalPosition(stripX, stripY));
    } catch {
      // Window may be closing.
    } finally {
      isResizingRef.current = false;
    }
  }, [triggerSize]);

  const expandFromDock = useCallback(async () => {
    if (isResizingRef.current) return;
    isResizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const sizeRef = orientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
      const savedSize = sizeRef.current;
      const edge = dockedEdgeRef.current;
      const m = monitorBoundsRef.current;

      // Usable area starts below the menu bar.
      const usableY = m.y + m.menuBarH;
      const usableH = m.h - m.menuBarH;

      // Span the full usable screen along the docked edge, using only the
      // saved dimension for depth (perpendicular to the edge).
      let px: number, py: number, ew: number, eh: number;
      switch (edge) {
        case "left":
          px = m.x;
          py = usableY;
          ew = savedSize.width;
          eh = usableH;
          break;
        case "right":
          px = m.x + m.w - savedSize.width;
          py = usableY;
          ew = savedSize.width;
          eh = usableH;
          break;
        case "top":
          px = m.x;
          py = usableY;
          ew = m.w;
          eh = savedSize.height;
          break;
        case "bottom":
          px = m.x;
          py = m.y + m.h - savedSize.height;
          ew = m.w;
          eh = savedSize.height;
          break;
      }

      await win.setPosition(new LogicalPosition(px, py));
      await win.setSize(new LogicalSize(ew, eh));
    } catch {
      // Window may be closing.
    } finally {
      isResizingRef.current = false;
    }
  }, [orientation, expandedSizeRef, horizontalSizeRef]);

  // Suppress all resize/move persistence while dock mode is active.
  // The strip dimensions and edge-snapped positions are programmatic and must
  // never overwrite the user's real expanded size or window position.
  useEffect(() => {
    if (dockMode) {
      ignoringResizeRef.current = true;
      ignoringMoveRef.current = true;
    }
    return () => {
      // When dock mode turns off (or component unmounts), allow persistence
      // again after a settling period for any trailing async resize/move events.
      if (dockMode) {
        setTimeout(() => {
          ignoringResizeRef.current = false;
          ignoringMoveRef.current = false;
        }, 500);
      }
    };
  }, [dockMode, ignoringResizeRef, ignoringMoveRef]);

  // When dock mode is toggled on, collapse immediately.
  // When toggled off, expand back from the edge.
  useEffect(() => {
    if (!dockMode) {
      expandFromDock();
      setIsDockExpanded(false);
      clearHideTimer();
      return;
    }

    setIsDockExpanded(false);
    collapseToDock();
  }, [dockMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cursor polling loop.
  useEffect(() => {
    if (!dockMode) return;

    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const win = getCurrentWindow();
        const [cursorX, cursorY] = await invoke<[number, number]>("get_cursor_position");
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const scale = await win.scaleFactor();

        const wx = pos.x / scale;
        const wy = pos.y / scale;
        const ww = size.width / scale;
        const wh = size.height / scale;

        const inside =
          cursorX >= wx && cursorX <= wx + ww &&
          cursorY >= wy && cursorY <= wy + wh;

        setIsDockExpanded((prevExpanded) => {
          if (!prevExpanded && inside && !isResizingRef.current) {
            clearHideTimer();
            expandFromDock();
            return true;
          }

          if (prevExpanded && !inside && !isResizingRef.current) {
            if (!hideTimerRef.current) {
              hideTimerRef.current = setTimeout(() => {
                hideTimerRef.current = null;
                setIsDockExpanded(false);
                collapseToDock();
              }, hideDelay);
            }
            return true;
          }

          if (prevExpanded && inside) {
            clearHideTimer();
            return true;
          }

          return prevExpanded;
        });
      } catch {
        // Silently ignore — window may be closing.
      }
    };

    const intervalId = setInterval(poll, 100);
    poll();

    return () => {
      active = false;
      clearInterval(intervalId);
      clearHideTimer();
    };
  }, [dockMode, hideDelay, clearHideTimer, expandFromDock, collapseToDock]);

  return {
    isDockExpanded,
    dockModeActive: dockMode,
  };
}
