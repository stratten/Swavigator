import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SpaceStatePayload, SpaceInfo, WindowInfo } from "../lib/types";

/** Log to the terminal via the Rust backend. */
function feLog(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {});
}

/**
 * Hook that subscribes to the backend polling loop and provides
 * the latest space/window state to the UI, with optimistic local
 * updates for collapse and label changes.
 */
export function useSpaceState() {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number>(0);
  const [minimizedWindows, setMinimizedWindows] = useState<WindowInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Track pending optimistic overrides by spaceId so they persist across poll
  // cycles until the backend catches up.
  const pendingOverrides = useRef<
    Map<number, { label?: string; isCollapsed?: boolean }>
  >(new Map());

  const applyPayload = useCallback((payload: SpaceStatePayload) => {
    let updatedSpaces = payload.spaces;

    // Merge any pending optimistic overrides into the incoming data.
    if (pendingOverrides.current.size > 0) {
      updatedSpaces = payload.spaces.map((s) => {
        const override = pendingOverrides.current.get(s.spaceId);
        if (!override) return s;

        // If the backend now matches the override, clear it.
        const backendMatchesLabel =
          override.label === undefined || s.label === override.label;
        const backendMatchesCollapsed =
          override.isCollapsed === undefined ||
          s.isCollapsed === override.isCollapsed;

        if (backendMatchesLabel && backendMatchesCollapsed) {
          pendingOverrides.current.delete(s.spaceId);
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
    setMinimizedWindows(payload.minimizedWindows ?? []);
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
    (spaceId: number, collapsed: boolean) => {
      pendingOverrides.current.set(spaceId, {
        ...pendingOverrides.current.get(spaceId),
        isCollapsed: collapsed,
      });

      // Update local state immediately.
      setSpaces((prev) =>
        prev.map((s) =>
          s.spaceId === spaceId ? { ...s, isCollapsed: collapsed } : s,
        ),
      );

      // Fire-and-forget to backend.
      invoke("set_space_collapsed", { spaceId, collapsed }).catch((err) => {
        console.error("[useSpaceState] set_space_collapsed failed:", err);
        pendingOverrides.current.delete(spaceId);
      });
    },
    [],
  );

  /** Optimistically update a space's label. */
  const setSpaceLabel = useCallback(
    (spaceId: number, label: string) => {
      feLog("info", `[useSpaceState] setSpaceLabel called — spaceId=${spaceId}, label='${label}'`);
      
      pendingOverrides.current.set(spaceId, {
        ...pendingOverrides.current.get(spaceId),
        label,
      });
      feLog("info", `[useSpaceState] setSpaceLabel — added to pendingOverrides`);

      // Update local state immediately.
      setSpaces((prev) =>
        prev.map((s) => (s.spaceId === spaceId ? { ...s, label } : s)),
      );
      feLog("info", `[useSpaceState] setSpaceLabel — updated local state`);

      // Fire-and-forget to backend.
      feLog("info", `[useSpaceState] setSpaceLabel — invoking set_space_label command`);
      invoke("set_space_label", { spaceId, label })
        .then(() => {
          feLog("info", `[useSpaceState] setSpaceLabel — invoke succeeded`);
        })
        .catch((err) => {
          feLog("error", `[useSpaceState] set_space_label failed: ${err}`);
          pendingOverrides.current.delete(spaceId);
        });
    },
    [],
  );

  return { spaces, activeSpaceId, minimizedWindows, loading, setSpaceCollapsed, setSpaceLabel };
}
