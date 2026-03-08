import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiscoverableAppWithIcon, UserSettings } from "../../../lib/types";
import devLog from "../../../lib/log";

export type Tab = "dock" | "running" | "installed" | "all";

interface UseAppPickerParams {
  groupId: string;
  groupName: string;
  initialExisting: string[];
  allGroupedBundleIds: Set<string>;
}

export interface UseAppPickerReturn {
  // State
  existingBundleIds: string[];
  setExistingBundleIds: React.Dispatch<React.SetStateAction<string[]>>;
  allApps: DiscoverableAppWithIcon[];
  loading: boolean;
  activeTab: Tab;
  setActiveTab: React.Dispatch<React.SetStateAction<Tab>>;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  searchRef: React.RefObject<HTMLInputElement | null>;
  justAdded: Set<string>;
  setJustAdded: React.Dispatch<React.SetStateAction<Set<string>>>;
  hideGrouped: boolean;
  setHideGrouped: React.Dispatch<React.SetStateAction<boolean>>;
  // Derived
  currentApps: DiscoverableAppWithIcon[];
  addedCount: number;
}

export function useAppPicker({
  groupId,
  groupName,
  initialExisting,
  allGroupedBundleIds,
}: UseAppPickerParams): UseAppPickerReturn {
  const [existingBundleIds, setExistingBundleIds] = useState<string[]>(initialExisting);
  const [allApps, setAllApps] = useState<DiscoverableAppWithIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("dock");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [hideGrouped, setHideGrouped] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Log mount info.
  useEffect(() => {
    devLog.info(
      `[AppPickerWindow] Mounted. groupId=${groupId} groupName="${groupName}" existing=${initialExisting.length} allGrouped=${allGroupedBundleIds.size}`
    );
  }, [groupId, groupName, initialExisting.length, allGroupedBundleIds.size]);

  // Load the hideGroupedApps preference from settings.
  useEffect(() => {
    invoke<UserSettings>("get_settings")
      .then((settings) => {
        setHideGrouped(settings.hideGroupedApps ?? true);
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to load settings: ${err}`))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Persist the preference when it changes (skip initial load).
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!settingsLoaded) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    invoke<UserSettings>("get_settings")
      .then((current) => {
        invoke("update_settings", {
          settings: { ...current, hideGroupedApps: hideGrouped },
        });
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to persist hideGrouped: ${err}`));
  }, [hideGrouped, settingsLoaded]);

  // Fetch all discoverable apps (with icons) in one call.
  useEffect(() => {
    devLog.info("[AppPickerWindow] Fetching all discoverable apps…");
    const t0 = performance.now();
    setLoading(true);
    invoke<DiscoverableAppWithIcon[]>("get_all_discoverable_apps")
      .then((apps) => {
        devLog.info(
          `[AppPickerWindow] Received ${apps.length} apps in ${(performance.now() - t0).toFixed(0)}ms`
        );
        setAllApps(apps);
      })
      .catch((err) => devLog.error(`[AppPickerWindow] Failed to load apps: ${err}`))
      .finally(() => setLoading(false));
  }, []);

  // Focus search input on tab change.
  useEffect(() => {
    if (searchRef.current) {
      searchRef.current.focus();
    }
  }, [activeTab]);

  // Build the set of bundle IDs to hide (allGrouped + any newly added in this session).
  const groupedSet = useMemo(() => {
    const set = new Set(allGroupedBundleIds);
    for (const id of existingBundleIds) {
      set.add(id);
    }
    return set;
  }, [allGroupedBundleIds, existingBundleIds]);

  // Filter apps based on tab, hideGrouped, and search.
  const currentApps = useMemo(() => {
    let list = allApps;

    if (activeTab !== "all") {
      list = list.filter((a) => a.sources.includes(activeTab));
    }

    if (hideGrouped) {
      list = list.filter((a) => !groupedSet.has(a.bundleId));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allApps, activeTab, search, hideGrouped, groupedSet]);

  const addedCount = existingBundleIds.length - initialExisting.length;

  return {
    existingBundleIds,
    setExistingBundleIds,
    allApps,
    loading,
    activeTab,
    setActiveTab,
    search,
    setSearch,
    searchRef,
    justAdded,
    setJustAdded,
    hideGrouped,
    setHideGrouped,
    currentApps,
    addedCount,
  };
}
