import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SurfaceSummary } from "../lib/types";

/**
 * Shared store for the Windows tab. It lives at module level, outside React, so
 * the last result is available the instant the tab (or the whole panel) mounts
 * again. Components show the cached list immediately and a refresh replaces it
 * in the background (stale-while-revalidate).
 */

export type SurfaceSort = "total" | "memory";

interface SurfaceStore {
  surfaces: SurfaceSummary[];
  icons: Record<string, string>;
  error: string | null;
  loaded: boolean;
  sort: SurfaceSort;
}

const POLL_INTERVAL_MS = 4000;
const SORT_STORAGE_KEY = "swavigator.surfaceSort";

function readStoredSort(): SurfaceSort {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === "memory" ? "memory" : "total";
  } catch {
    return "total";
  }
}

let store: SurfaceStore = {
  surfaces: [],
  icons: {},
  error: null,
  loaded: false,
  sort: readStoredSort(),
};

const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastRefreshAt = 0;
/** Bundle IDs whose icons were already requested (or are being requested). */
const requestedIcons = new Set<string>();

function update(patch: Partial<SurfaceStore>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function loadIcons(surfaces: SurfaceSummary[]) {
  const missing = surfaces
    .map((s) => s.bundleId)
    .filter((id) => id && !requestedIcons.has(id));
  if (missing.length === 0) return;
  missing.forEach((id) => requestedIcons.add(id));
  try {
    const fetched = await invoke<Record<string, string>>("get_app_icons", { bundleIds: missing });
    update({ icons: { ...store.icons, ...fetched } });
  } catch {
    // Allow a retry on the next refresh.
    missing.forEach((id) => requestedIcons.delete(id));
  }
}

/** Fetch a fresh census. Concurrent callers share one request. */
export function refreshWindowSurfaces(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const surfaces = await invoke<SurfaceSummary[]>("get_window_surfaces");
      lastRefreshAt = Date.now();
      update({ surfaces, error: null, loaded: true });
      void loadIcons(surfaces);
    } catch (err) {
      update({ error: String(err) });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    // The panel is hidden and shown rather than destroyed: skip work while hidden.
    if (isPageVisible()) void refreshWindowSurfaces();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function onVisibilityOrFocus() {
  if (isPageVisible() && Date.now() - lastRefreshAt > 500) void refreshWindowSurfaces();
}

export function setSurfaceSort(sort: SurfaceSort) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // Persistence is best-effort.
  }
  update({ sort });
}

/** Subscribe to the shared surface list; polling runs only while something is subscribed. */
export function useWindowSurfaces() {
  const snapshot = useSyncExternalStore(subscribe, () => store);

  useEffect(() => {
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    startPolling();
    // Refresh right away, but only if the cached data is not already fresh.
    if (Date.now() - lastRefreshAt > 1000) void refreshWindowSurfaces();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      if (listeners.size === 0) stopPolling();
    };
  }, []);

  return snapshot;
}
