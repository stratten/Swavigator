import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { SpaceInfo } from "../../../lib/types";

export interface UseSearchFilterReturn {
  showSearch: boolean;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredSpaces: SpaceInfo[];
  handleToggleSearch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Manages search state and filters spaces/windows based on the query.
 */
export function useSearchFilter(spaces: SpaceInfo[]): UseSearchFilterReturn {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (prev) {
        setSearchQuery("");
      }
      return !prev;
    });
  }, []);

  // Focus the search input when it appears.
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Filter spaces and windows based on search query.
  const filteredSpaces = useMemo((): SpaceInfo[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return spaces;

    return spaces
      .map((space) => {
        const displayLabel = space.label || `Space ${space.spaceIndex}`;
        const spaceNameMatches = displayLabel.toLowerCase().includes(q);

        // If the space name matches, include it with all its windows.
        if (spaceNameMatches) return space;

        // Otherwise filter to only matching windows.
        const matchingWindows = space.windows.filter(
          (w) =>
            w.appName.toLowerCase().includes(q) ||
            w.title.toLowerCase().includes(q),
        );

        if (matchingWindows.length === 0) return null;

        return { ...space, windows: matchingWindows };
      })
      .filter((s): s is SpaceInfo => s !== null);
  }, [spaces, searchQuery]);

  return {
    showSearch,
    searchQuery,
    setSearchQuery,
    filteredSpaces,
    handleToggleSearch,
    searchInputRef,
  };
}
