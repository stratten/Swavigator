import { useState, useEffect, useRef } from "react";
import type { UserSettings } from "../../../lib/types";

/**
 * Manages the draggable divider between the space list and app tray.
 */
export function useDividerDrag(
  orientation: "vertical" | "horizontal",
  traySplitPercent: number,
  setTraySplitPercent: React.Dispatch<React.SetStateAction<number>>,
  persistSettings: (overrides?: Partial<UserSettings>) => void,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  // Keep a ref to the latest split percent so the mouseup handler can persist
  // the final value without the effect re-registering on every pixel change.
  const traySplitRef = useRef(traySplitPercent);
  traySplitRef.current = traySplitPercent;

  // Handle divider dragging — global mousemove/mouseup while dragging.
  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      let pct: number;
      if (orientation === "horizontal") {
        // Tray is on the right — percentage measured from the right edge.
        pct = ((rect.right - e.clientX) / rect.width) * 100;
      } else {
        // Tray is on the bottom — percentage measured from the bottom edge.
        pct = ((rect.bottom - e.clientY) / rect.height) * 100;
      }

      // Clamp between 10% and 80%.
      pct = Math.max(10, Math.min(80, pct));
      setTraySplitPercent(pct);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      // Persist the final split using the ref for the latest value.
      persistSettings({ traySplitPercent: traySplitRef.current });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    // Prevent text selection while dragging.
    document.body.style.userSelect = "none";
    document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDraggingDivider, orientation, persistSettings, setTraySplitPercent, containerRef]);

  const startDragging = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  return {
    isDraggingDivider,
    startDragging,
  };
}
