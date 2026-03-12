import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import type { UserSettings } from "../../../lib/types";
import { DEFAULT_DOCK_TRIGGER_SIZE, DEFAULT_DOCK_HIDE_DELAY } from "../constants";

type Edge = "left" | "right" | "top" | "bottom";

export interface UseDockModeReturn {
  isDockExpanded: boolean;
  dockModeActive: boolean;
}

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

/** Query monitor bounds and menu bar height. Returns logical-pixel values. */
async function queryMonitorBounds(scale: number) {
  const monitor = await currentMonitor();
  if (!monitor) return null;

  const mx = monitor.position.x / scale;
  const my = monitor.position.y / scale;
  const mw = monitor.size.width / scale;
  const mh = monitor.size.height / scale;

  let menuBarH = 25;
  try {
    menuBarH = await invoke<number>("get_menu_bar_height");
  } catch { /* use fallback */ }

  return { x: mx, y: my, w: mw, h: mh, menuBarH };
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
  dockEdge: Edge,
  dockTriggerSize: number,
  dockHideDelay: number,
  orientation: "vertical" | "horizontal",
  expandedSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  horizontalSizeRef: React.MutableRefObject<{ width: number; height: number }>,
  ignoringResizeRef: React.MutableRefObject<boolean>,
  ignoringMoveRef: React.MutableRefObject<boolean>,
  persistSettings: (overrides?: Partial<UserSettings>) => void,
): UseDockModeReturn {
  const [isDockExpanded, setIsDockExpanded] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResizingRef = useRef(false);

  const dockedEdgeRef = useRef<Edge>(dockEdge);

  // Track whether dock mode has ever been active in this session.
  // Prevents the initial render (dockMode=false) from calling expandFromDock.
  const hadDockModeRef = useRef(false);

  useEffect(() => {
    dockedEdgeRef.current = dockEdge;
  }, [dockEdge]);

  const triggerSize = dockTriggerSize || DEFAULT_DOCK_TRIGGER_SIZE;
  const hideDelay = dockHideDelay || DEFAULT_DOCK_HIDE_DELAY;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /**
   * Collapse the panel to a thin trigger strip along `dockedEdgeRef.current`.
   * When `detectEdge` is true, the nearest edge is determined from the current
   * window position and persisted. Pass false on startup (use saved edge) and
   * when re-collapsing after a hover expansion.
   */
  const collapseToDock = useCallback(async (detectEdge = false) => {
    if (isResizingRef.current) return;
    isResizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const bounds = await queryMonitorBounds(scale);
      if (!bounds) return;

      if (detectEdge) {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const wx = pos.x / scale;
        const wy = pos.y / scale;
        const ww = size.width / scale;
        const wh = size.height / scale;
        const edge = detectNearestEdge(wx, wy, ww, wh, bounds.x, bounds.y, bounds.w, bounds.h);
        dockedEdgeRef.current = edge;
        persistSettings({ dockEdge: edge });
      }

      const edge = dockedEdgeRef.current;
      const usableY = bounds.y + bounds.menuBarH;
      const usableH = bounds.h - bounds.menuBarH;

      let stripW: number, stripH: number, stripX: number, stripY: number;
      switch (edge) {
        case "left":
          stripW = triggerSize;
          stripH = usableH;
          stripX = bounds.x;
          stripY = usableY;
          break;
        case "right":
          stripW = triggerSize;
          stripH = usableH;
          stripX = bounds.x + bounds.w - triggerSize;
          stripY = usableY;
          break;
        case "top":
          stripW = bounds.w;
          stripH = triggerSize;
          stripX = bounds.x;
          stripY = usableY;
          break;
        case "bottom":
          stripW = bounds.w;
          stripH = triggerSize;
          stripX = bounds.x;
          stripY = bounds.y + bounds.h - triggerSize;
          break;
      }

      await win.setSize(new LogicalSize(stripW, stripH));
      await win.setPosition(new LogicalPosition(stripX, stripY));
    } catch {
      // Window may be closing.
    } finally {
      isResizingRef.current = false;
    }
  }, [triggerSize, persistSettings]);

  /**
   * Expand the panel from its docked edge. Queries monitor bounds fresh
   * every time to avoid stale menu-bar-height or monitor-size caches.
   */
  const expandFromDock = useCallback(async () => {
    if (isResizingRef.current) return;
    isResizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const bounds = await queryMonitorBounds(scale);
      if (!bounds) return;

      const sizeRef = orientation === "horizontal" ? horizontalSizeRef : expandedSizeRef;
      const savedSize = sizeRef.current;
      const edge = dockedEdgeRef.current;

      const usableY = bounds.y + bounds.menuBarH;
      const usableH = bounds.h - bounds.menuBarH;

      let px: number, py: number, ew: number, eh: number;
      switch (edge) {
        case "left":
          px = bounds.x;
          py = usableY;
          ew = savedSize.width;
          eh = usableH;
          break;
        case "right":
          px = bounds.x + bounds.w - savedSize.width;
          py = usableY;
          ew = savedSize.width;
          eh = usableH;
          break;
        case "top":
          px = bounds.x;
          py = usableY;
          ew = bounds.w;
          eh = savedSize.height;
          break;
        case "bottom":
          px = bounds.x;
          py = bounds.y + bounds.h - savedSize.height;
          ew = bounds.w;
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
  useEffect(() => {
    if (dockMode) {
      ignoringResizeRef.current = true;
      ignoringMoveRef.current = true;
    }
    return () => {
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
      // Only expand if we were previously docked — prevents the initial
      // render (dockMode=false by default) from calling expandFromDock and
      // blocking collapseToDock via isResizingRef.
      if (hadDockModeRef.current) {
        expandFromDock();
        hadDockModeRef.current = false;
      }
      setIsDockExpanded(false);
      clearHideTimer();
      return;
    }

    // First time dockMode becomes true = startup restore → use persisted edge.
    // Subsequent transitions = user toggled dock on → detect nearest edge.
    const isStartup = !hadDockModeRef.current;
    hadDockModeRef.current = true;
    setIsDockExpanded(false);
    collapseToDock(!isStartup);
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
                collapseToDock(false);
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
