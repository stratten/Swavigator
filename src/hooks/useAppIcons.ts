import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EntryType } from "../lib/types";

/**
 * Caches icons (base64 data URIs) by entry ID.
 * For app entries, fetches via get_app_icon (bundle ID lookup).
 * For path entries, fetches via get_path_icon (file/folder icon).
 * For URL entries, uses a static globe data URI.
 *
 * @param bundleIds  - List of entry IDs to fetch icons for.
 * @param entryTypes - Optional map of entryId → EntryType. IDs not in the
 *                     map (or with type "app") use the default app icon fetch.
 */
export function useAppIcons(
  bundleIds: string[],
  entryTypes?: Record<string, EntryType>,
) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const pendingRef = useRef<Set<string>>(new Set());

  const fetchIcon = useCallback(
    async (id: string) => {
      if (!id || pendingRef.current.has(id)) return;
      pendingRef.current.add(id);

      const type = entryTypes?.[id] ?? "app";

      try {
        let dataUri: string;

        if (type === "path") {
          dataUri = await invoke<string>("get_path_icon", { path: id });
        } else if (type === "url") {
          // Static globe/link icon for URL entries.
          dataUri = URL_ICON_DATA_URI;
        } else {
          dataUri = await invoke<string>("get_app_icon", { bundleId: id });
        }

        setIcons((prev) => ({ ...prev, [id]: dataUri }));
      } catch {
        // Mark as failed so we don't retry endlessly.
        setIcons((prev) => ({ ...prev, [id]: "" }));
      }
    },
    [entryTypes],
  );

  useEffect(() => {
    for (const bid of bundleIds) {
      if (bid && !(bid in icons) && !pendingRef.current.has(bid)) {
        fetchIcon(bid);
      }
    }
  }, [bundleIds, icons, fetchIcon]);

  return icons;
}

/** A simple 32×32 SVG globe icon encoded as a data URI for URL entries. */
const URL_ICON_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">' +
      '<circle cx="16" cy="16" r="14" stroke="#94a3b8" stroke-width="1.5"/>' +
      '<ellipse cx="16" cy="16" rx="7" ry="14" stroke="#94a3b8" stroke-width="1.5"/>' +
      '<line x1="2" y1="16" x2="30" y2="16" stroke="#94a3b8" stroke-width="1.5"/>' +
      '<line x1="5" y1="8" x2="27" y2="8" stroke="#94a3b8" stroke-width="1"/>' +
      '<line x1="5" y1="24" x2="27" y2="24" stroke="#94a3b8" stroke-width="1"/>' +
      "</svg>",
  );
