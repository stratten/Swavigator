import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SpaceStatePayload, SpaceInfo } from "../lib/types";

/**
 * Hook that subscribes to the backend polling loop and provides
 * the latest space/window state to the UI, with optimistic local
 * updates for collapse and label changes.
 */
export function useSpaceState() {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Track pending optimistic overrides so they persist across poll cycles
  // until the backend catches up.
  const pendingOverrides = useRef<
    Map<string, { label?: string; isCollapsed?: boolean }>
  >(new Map());

  const applyPayload = useCallback((payload: SpaceStatePayload) => {
    let updatedSpaces = payload.spaces;

    // Merge any pending optimistic overrides into the incoming data.
    if (pendingOverrides.current.size > 0) {
      updatedSpaces = payload.spaces.map((s) => {
        const key = `${s.displayId}:${s.spaceIndex}`;
        const override = pendingOverrides.current.get(key);
        if (!override) return s;

        // If the backend now matches the override, clear it.
        const backendMatchesLabel =
          override.label === undefined || s.label === override.label;
        const backendMatchesCollapsed =
          override.isCollapsed === undefined ||
          s.isCollapsed === override.isCollapsed;

        if (backendMatchesLabel && backendMatchesCollapsed) {
          pendingOverrides.current.delete(key);
          return s;
        }

        return {
          ...s,
          ...(override.label !== undefined ? { label: override.label } : {}),
          ...(override.isCollapsed !== undefined
            ? { isCollapsed: override.isCollapsed }
            : {}),
        };
      });
    }

    setSpaces(updatedSpaces);
    setActiveSpaceId(payload.activeSpaceId);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial fetch.
    invoke<SpaceStatePayload>("get_space_state")
      .then(applyPayload)
      .catch((err) => {
        console.error("[useSpaceState] Initial fetch failed:", err);
        setLoading(false);
      });

    // Subscribe to polling updates.
    const unlisten = listen<SpaceStatePayload>(
      "space-state-update",
      (event) => {
        applyPayload(event.payload);
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyPayload]);

  /** Optimistically update a space's collapsed state. */
  const setSpaceCollapsed = useCallback(
    (displayId: string, spaceIndex: number, collapsed: boolean) => {
      const key = `${displayId}:${spaceIndex}`;
      pendingOverrides.current.set(key, {
        ...pendingOverrides.current.get(key),
        isCollapsed: collapsed,
      });

      // Update local state immediately.
      setSpaces((prev) =>
        prev.map((s) =>
          s.displayId === displayId && s.spaceIndex === spaceIndex
            ? { ...s, isCollapsed: collapsed }
            : s,
        ),
      );

      // Fire-and-forget to backend.
      invoke("set_space_collapsed", { displayId, spaceIndex, collapsed }).catch(
        (err) => {
          console.error("[useSpaceState] set_space_collapsed failed:", err);
          pendingOverrides.current.delete(key);
        },
      );
    },
    [],
  );

  /** Optimistically update a space's label. */
  const setSpaceLabel = useCallback(
    (displayId: string, spaceIndex: number, label: string) => {
      const key = `${displayId}:${spaceIndex}`;
      pendingOverrides.current.set(key, {
        ...pendingOverrides.current.get(key),
        label,
      });

      // Update local state immediately.
      setSpaces((prev) =>
        prev.map((s) =>
          s.displayId === displayId && s.spaceIndex === spaceIndex
            ? { ...s, label }
            : s,
        ),
      );

      // Fire-and-forget to backend.
      invoke("set_space_label", { displayId, spaceIndex, label }).catch(
        (err) => {
          console.error("[useSpaceState] set_space_label failed:", err);
          pendingOverrides.current.delete(key);
        },
      );
    },
    [],
  );

  return { spaces, activeSpaceId, loading, setSpaceCollapsed, setSpaceLabel };
}
