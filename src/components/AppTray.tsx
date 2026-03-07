import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppGroup, EntryType } from "../lib/types";
import { AppGroupCard } from "./AppGroupCard";

interface AppTrayProps {
  groups: AppGroup[];
  trayVisible: boolean;
  appIcons: Record<string, string>;
  badges: Record<string, string>;
  onToggleTray: () => void;
  onCreateGroup: (name: string) => Promise<AppGroup | null>;
  onDeleteGroup: (id: string) => void;
  onUpdateGroup: (group: AppGroup) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onAddApp: (groupId: string, bundleId: string, name: string, entryType?: EntryType) => void;
  onRemoveApp: (groupId: string, bundleId: string) => void;
  onReorderGroups: (orderedIds: string[]) => void;
  /** Bundle IDs of currently running apps. */
  runningBundleIds?: Set<string>;
  /** Panel orientation for layout adjustments. */
  orientation?: "vertical" | "horizontal";
}

export function AppTray({
  groups,
  trayVisible,
  appIcons,
  badges,
  onToggleTray,
  onCreateGroup,
  onDeleteGroup,
  onUpdateGroup,
  onToggleGroupCollapsed,
  onAddApp,
  onRemoveApp,
  onReorderGroups,
  runningBundleIds,
  orientation = "vertical",
}: AppTrayProps) {
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Drag-and-drop state for group reordering.
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Single listener for the "ctx-menu-remove" event emitted by the native
  // context menu handler.
  useEffect(() => {
    const unlisten = listen<{ groupId: string; bundleId: string }>("ctx-menu-remove", (event) => {
      onRemoveApp(event.payload.groupId, event.payload.bundleId);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onRemoveApp]);

  // Listen for "picker-add-app" events from the standalone picker window.
  useEffect(() => {
    const unlisten = listen<{ groupId: string; bundleId: string; name: string; entryType?: EntryType }>(
      "picker-add-app",
      (event) => {
        const { groupId, bundleId, name, entryType } = event.payload;
        onAddApp(groupId, bundleId, name, entryType);
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onAddApp]);

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await onCreateGroup(name);
    setNewGroupName("");
    setCreatingGroup(false);
  }, [newGroupName, onCreateGroup]);

  /** Open the app picker in a standalone window. */
  const handleOpenPicker = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;

      const pickerLabel = `app-picker-${Date.now()}`;
      // Bundle IDs already in THIS group (for the ✓ checkmark).
      const existingIds = group.apps.map((a) => a.bundleId).join(",");
      // Bundle IDs across ALL groups (for the "hide grouped" filter).
      const allGroupedIds = Array.from(
        new Set(groups.flatMap((g) => g.apps.map((a) => a.bundleId))),
      ).join(",");

      const params = new URLSearchParams({
        groupId: group.id,
        groupName: group.name,
        existingBundleIds: existingIds,
        allGroupedBundleIds: allGroupedIds,
      });

      const pickerWindow = new WebviewWindow(pickerLabel, {
        url: `/?${params.toString()}`,
        title: `Add Apps — ${group.name}`,
        width: 420,
        height: 520,
        minWidth: 320,
        minHeight: 300,
        resizable: true,
        decorations: false,
        transparent: true,
        center: true,
        alwaysOnTop: true,
      });

      pickerWindow.once("tauri://error", (e) => {
        invoke("log_from_frontend", { level: "error", message: `[AppTray] Failed to create picker window: ${e}` });
      });
    },
    [groups],
  );

  // Group drag handlers — with data-type discrimination to avoid
  // intercepting app-icon drags (which use "application/app-reorder").
  const handleGroupDragStart = useCallback(
    (e: React.DragEvent, groupId: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/group-reorder", groupId);
      setDragGroupId(groupId);
    },
    [],
  );

  const handleGroupDragOver = useCallback(
    (e: React.DragEvent, groupId: string) => {
      if (e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (groupId !== dragGroupId) {
        setDropTargetId(groupId);
      }
    },
    [dragGroupId],
  );

  const handleGroupDragEnter = useCallback(
    (e: React.DragEvent, groupId: string) => {
      if (e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (groupId !== dragGroupId) {
        setDropTargetId(groupId);
      }
    },
    [dragGroupId],
  );

  const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/app-reorder")) return;
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDropTargetId(null);
    }
  }, []);

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      if (e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      const sourceId = e.dataTransfer.getData("application/group-reorder");
      if (!sourceId || sourceId === targetId) {
        setDragGroupId(null);
        setDropTargetId(null);
        return;
      }

      const currentIds = groups.map((g) => g.id);
      const sourceIndex = currentIds.indexOf(sourceId);
      const targetIndex = currentIds.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const newOrder = [...currentIds];
      newOrder.splice(sourceIndex, 1);
      newOrder.splice(targetIndex, 0, sourceId);

      onReorderGroups(newOrder);
      setDragGroupId(null);
      setDropTargetId(null);
    },
    [groups, onReorderGroups],
  );

  const handleGroupDragEnd = useCallback(() => {
    dragCounterRef.current = 0;
    setDragGroupId(null);
    setDropTargetId(null);
  }, []);

  const isHorizontal = orientation === "horizontal";

  return (
    <>
      {/* Tray header / toggle */}
      <div
        className="flex items-center justify-between px-2 py-1.5 flex-shrink-0 cursor-pointer"
        style={{
          borderTop: isHorizontal ? "none" : "1px solid var(--panel-border)",
        }}
        onClick={onToggleTray}
      >
        <span
          className="text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Apps
        </span>
        <div className="flex items-center gap-1">
          {/* Group count */}
          {groups.length > 0 && (
            <span
              className="text-xs px-1 rounded"
              style={{
                color: "var(--text-muted)",
                background: "rgba(63, 63, 70, 0.4)",
                fontSize: "10px",
              }}
            >
              {groups.length}
            </span>
          )}
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: "12px",
              transition: "transform 0.15s ease",
              display: "inline-block",
              transform: trayVisible ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          >
            ▾
          </span>
        </div>
      </div>

      {/* Tray content */}
      {trayVisible && (
        <div
          className={isHorizontal ? "flex flex-row overflow-x-auto px-1 pb-1 gap-1" : "overflow-y-auto px-1 pb-1"}
          style={isHorizontal ? { flex: 1, minHeight: 0 } : undefined}
        >
          {/* Group list */}
          {groups.map((group, idx) => (
            <div
              key={group.id}
              className={isHorizontal ? "flex-shrink-0" : ""}
              onDragOver={(e) => handleGroupDragOver(e, group.id)}
              onDragEnter={(e) => handleGroupDragEnter(e, group.id)}
              onDragLeave={handleGroupDragLeave}
              onDrop={(e) => handleGroupDrop(e, group.id)}
              onDragEnd={handleGroupDragEnd}
              style={{
                opacity: dragGroupId === group.id ? 0.4 : 1,
                ...(isHorizontal
                  ? {
                      height: "100%",
                      borderRight:
                        idx < groups.length - 1
                          ? "1px solid var(--panel-border)"
                          : "none",
                      borderLeft:
                        dropTargetId === group.id && dragGroupId !== group.id
                          ? "2px solid var(--accent-blue)"
                          : "2px solid transparent",
                      paddingRight: "4px",
                    }
                  : {
                      borderTop:
                        dropTargetId === group.id && dragGroupId !== group.id
                          ? "2px solid var(--accent-blue)"
                          : "2px solid transparent",
                    }),
                transition: "opacity 0.15s ease",
              }}
            >
              <AppGroupCard
                group={group}
                appIcons={appIcons}
                badges={badges}
                onToggleCollapsed={onToggleGroupCollapsed}
                onDeleteGroup={onDeleteGroup}
                onUpdateGroup={onUpdateGroup}
                onOpenPicker={handleOpenPicker}
                onGroupDragStart={(e) => handleGroupDragStart(e, group.id)}
                runningBundleIds={runningBundleIds}
                orientation={orientation}
              />
            </div>
          ))}

          {/* Create group inline form */}
          {creatingGroup ? (
            <div className="flex items-center gap-1 px-1.5 py-1">
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onBlur={() => {
                  if (!newGroupName.trim()) setCreatingGroup(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                  if (e.key === "Escape") {
                    setNewGroupName("");
                    setCreatingGroup(false);
                  }
                }}
                placeholder="Group name…"
                className="flex-1 px-1.5 py-0.5 rounded outline-none text-xs"
                style={{
                  color: "var(--text-primary)",
                  background: "rgba(63, 63, 70, 0.6)",
                  border: "1px solid var(--accent-blue)",
                  minWidth: 0,
                }}
              />
              <button
                onClick={handleCreateGroup}
                className="text-xs cursor-pointer rounded px-1.5 py-0.5"
                style={{
                  color: "var(--accent-blue)",
                  background: "transparent",
                  border: "1px solid var(--accent-blue)",
                  fontSize: "10px",
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingGroup(true)}
              className="w-full text-left px-2 py-1 text-xs cursor-pointer rounded"
              style={{
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                fontSize: "11px",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--accent-blue)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--text-muted)")
              }
            >
              + New Group
            </button>
          )}
        </div>
      )}
    </>
  );
}
