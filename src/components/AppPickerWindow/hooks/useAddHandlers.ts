import { useState, useEffect, useRef, useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import devLog from "../../../lib/log";

interface UseAddHandlersParams {
  groupId: string;
  setExistingBundleIds: React.Dispatch<React.SetStateAction<string[]>>;
  setJustAdded: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseAddHandlersReturn {
  handleAddApp: (bundleId: string, name: string) => void;
  handleBrowse: () => Promise<void>;
  handleBrowseFolder: () => Promise<void>;
  // URL input state
  showUrlInput: boolean;
  setShowUrlInput: React.Dispatch<React.SetStateAction<boolean>>;
  urlValue: string;
  setUrlValue: React.Dispatch<React.SetStateAction<string>>;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  handleAddUrl: () => void;
}

export function useAddHandlers({
  groupId,
  setExistingBundleIds,
  setJustAdded,
}: UseAddHandlersParams): UseAddHandlersReturn {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Focus URL input when shown.
  useEffect(() => {
    if (showUrlInput && urlInputRef.current) {
      urlInputRef.current.focus();
    }
  }, [showUrlInput]);

  // Helper to trigger flash feedback for a bundle ID.
  const flashAdded = useCallback(
    (id: string) => {
      setJustAdded((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setJustAdded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 600);
    },
    [setJustAdded]
  );

  const handleAddApp = useCallback(
    (bundleId: string, name: string) => {
      if (!groupId) {
        devLog.warn("[AppPickerWindow] No groupId — cannot add app.");
        return;
      }
      devLog.info(`[AppPickerWindow] Adding app: ${bundleId} "${name}" to group: ${groupId}`);
      setExistingBundleIds((prev) => [...prev, bundleId]);
      flashAdded(bundleId);
      emit("picker-add-app", { groupId, bundleId, name });
    },
    [groupId, setExistingBundleIds, flashAdded]
  );

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        directory: false,
        title: "Select files or folders to add",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const name = p.split("/").pop() || p;
        devLog.info(`[AppPickerWindow] Adding path entry: ${p}`);
        setExistingBundleIds((prev) => [...prev, p]);
        flashAdded(p);
        emit("picker-add-app", { groupId, bundleId: p, name, entryType: "path" });
      }
    } catch (err) {
      devLog.error(`[AppPickerWindow] Browse failed: ${err}`);
    }
  }, [groupId, setExistingBundleIds, flashAdded]);

  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        directory: true,
        title: "Select folders to add",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const name = p.split("/").pop() || p;
        devLog.info(`[AppPickerWindow] Adding folder entry: ${p}`);
        setExistingBundleIds((prev) => [...prev, p]);
        flashAdded(p);
        emit("picker-add-app", { groupId, bundleId: p, name, entryType: "path" });
      }
    } catch (err) {
      devLog.error(`[AppPickerWindow] Browse folder failed: ${err}`);
    }
  }, [groupId, setExistingBundleIds, flashAdded]);

  const handleAddUrl = useCallback(() => {
    const url = urlValue.trim();
    if (!url) return;
    let name: string;
    try {
      name = new URL(url).hostname;
    } catch {
      name = url;
    }
    devLog.info(`[AppPickerWindow] Adding URL entry: ${url}`);
    setExistingBundleIds((prev) => [...prev, url]);
    flashAdded(url);
    emit("picker-add-app", { groupId, bundleId: url, name, entryType: "url" });
    setUrlValue("");
    setShowUrlInput(false);
  }, [groupId, urlValue, setExistingBundleIds, flashAdded]);

  return {
    handleAddApp,
    handleBrowse,
    handleBrowseFolder,
    showUrlInput,
    setShowUrlInput,
    urlValue,
    setUrlValue,
    urlInputRef,
    handleAddUrl,
  };
}
