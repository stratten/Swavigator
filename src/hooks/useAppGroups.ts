import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppGroup, AppBadge, EntryType } from "../lib/types";

export function useAppGroups() {
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [trayVisible, setTrayVisible] = useState(false);
  const [badges, setBadges] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Load groups and tray visibility on mount.
  useEffect(() => {
    Promise.all([
      invoke<AppGroup[]>("get_app_groups"),
      invoke<boolean>("get_app_tray_visible"),
    ])
      .then(([loadedGroups, visible]) => {
        setGroups(loadedGroups);
        setTrayVisible(visible);
      })
      .catch((err) => console.error("[useAppGroups] Failed to load:", err))
      .finally(() => setLoading(false));
  }, []);

  // Derive a stable key of app names so badge polling doesn't re-trigger on
  // every collapsed toggle (which changes the groups array reference but not
  // the actual list of apps).
  const appNamesKey = useMemo(() => {
    const names = new Set<string>();
    for (const g of groups) {
      for (const a of g.apps) {
        names.add(a.name);
      }
    }
    return Array.from(names).sort().join("\0");
  }, [groups]);

  // Poll badge counts every 5 seconds when tray is visible.
  useEffect(() => {
    if (!trayVisible || !appNamesKey) return;

    const appNames = appNamesKey.split("\0");

    const fetchBadges = async () => {
      try {
        const results = await invoke<AppBadge[]>("get_app_badge_counts", {
          appNames,
        });
        const badgeMap: Record<string, string> = {};
        for (const r of results) {
          if (r.badge) {
            badgeMap[r.bundleId] = r.badge;
          }
        }
        setBadges(badgeMap);
      } catch {
        // Badge reading is best-effort.
      }
    };

    fetchBadges();
    const interval = setInterval(fetchBadges, 5000);
    return () => clearInterval(interval);
  }, [trayVisible, appNamesKey]);

  const toggleTrayVisible = useCallback(() => {
    const next = !trayVisible;
    setTrayVisible(next);
    invoke("set_app_tray_visible", { visible: next }).catch((err) =>
      console.error("[useAppGroups] Failed to set tray visibility:", err)
    );
  }, [trayVisible]);

  const createGroup = useCallback(async (name: string) => {
    try {
      const group = await invoke<AppGroup>("create_app_group", { name });
      setGroups((prev) => [...prev, group]);
      return group;
    } catch (err) {
      console.error("[useAppGroups] Failed to create group:", err);
      return null;
    }
  }, []);

  const deleteGroup = useCallback((id: string) => {
    // Optimistic: remove from state immediately.
    setGroups((prev) => prev.filter((g) => g.id !== id));
    invoke("delete_app_group", { id }).catch((err) =>
      console.error("[useAppGroups] Failed to delete group:", err)
    );
  }, []);

  const updateGroup = useCallback((group: AppGroup) => {
    // Optimistic: update state immediately.
    setGroups((prev) => prev.map((g) => (g.id === group.id ? group : g)));
    invoke("update_app_group", { group }).catch((err) =>
      console.error("[useAppGroups] Failed to update group:", err)
    );
  }, []);

  const addAppToGroup = useCallback(
    (groupId: string, bundleId: string, name: string, entryType?: EntryType) => {
      const et = entryType ?? "app";
      // Optimistic: add to state immediately.
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          if (g.apps.some((a) => a.bundleId === bundleId)) return g;
          return { ...g, apps: [...g.apps, { bundleId, name, entryType: et }] };
        })
      );
      invoke("add_app_to_group", { groupId, bundleId, name, entryType: et }).catch((err) =>
        console.error("[useAppGroups] Failed to add entry:", err)
      );
    },
    []
  );

  const removeAppFromGroup = useCallback(
    (groupId: string, bundleId: string) => {
      // Optimistic: remove from state immediately.
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          return {
            ...g,
            apps: g.apps.filter((a) => a.bundleId !== bundleId),
          };
        })
      );
      invoke("remove_app_from_group", { groupId, bundleId }).catch((err) =>
        console.error("[useAppGroups] Failed to remove app:", err)
      );
    },
    []
  );

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      setGroups((prev) => {
        const updated = prev.map((g) =>
          g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
        );
        // Persist collapsed state immediately so it survives process kills.
        const collapsedMap: Record<string, boolean> = {};
        for (const g of updated) {
          collapsedMap[g.id] = g.collapsed;
        }
        invoke("batch_update_group_collapsed", { collapsedMap }).catch(() => {});
        return updated;
      });
    },
    []
  );

  const reorderGroups = useCallback((orderedIds: string[]) => {
    // Optimistic: reorder state immediately.
    setGroups((prev) => {
      const map = new Map(prev.map((g) => [g.id, g]));
      return orderedIds
        .map((id) => map.get(id))
        .filter((g): g is AppGroup => g !== undefined);
    });
    invoke("reorder_app_groups", { orderedIds }).catch((err) =>
      console.error("[useAppGroups] Failed to reorder groups:", err)
    );
  }, []);

  // Keep a ref to the latest groups so the flush callback always reads
  // current state without needing to be recreated on every groups change.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  /** Batch-persist the collapsed state of all groups in a single disk write.
   *  Intended to be called once on app close rather than on every toggle. */
  const flushCollapsedState = useCallback(() => {
    const collapsedMap: Record<string, boolean> = {};
    for (const g of groupsRef.current) {
      collapsedMap[g.id] = g.collapsed;
    }
    return invoke("batch_update_group_collapsed", { collapsedMap }).catch((err) =>
      console.error("[useAppGroups] Failed to flush collapsed state:", err)
    );
  }, []);

  return {
    groups,
    trayVisible,
    badges,
    loading,
    toggleTrayVisible,
    createGroup,
    deleteGroup,
    updateGroup,
    addAppToGroup,
    removeAppFromGroup,
    toggleGroupCollapsed,
    reorderGroups,
    flushCollapsedState,
  };
}
