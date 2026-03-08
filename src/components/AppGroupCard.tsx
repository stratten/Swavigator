import { useState, useRef, useEffect, useCallback } from "react";
import type { AppGroup } from "../lib/types";
import { AppIcon } from "./AppIcon";

interface AppGroupCardProps {
  group: AppGroup;
  appIcons: Record<string, string>;
  badges: Record<string, string>;
  onToggleCollapsed: (groupId: string) => void;
  onDeleteGroup: (id: string) => void;
  onUpdateGroup: (group: AppGroup) => void;
  onOpenPicker: (groupId: string) => void;
  onGroupDragStart: (e: React.DragEvent) => void;
  /** Bundle IDs of currently running apps. */
  runningBundleIds?: Set<string>;
  /** Panel orientation for layout adjustments. */
  orientation?: "vertical" | "horizontal";
}

export function AppGroupCard({
  group,
  appIcons,
  badges,
  onToggleCollapsed,
  onDeleteGroup,
  onUpdateGroup,
  onOpenPicker,
  onGroupDragStart,
  runningBundleIds,
  orientation = "vertical",
}: AppGroupCardProps) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // In horizontal mode, compute the exact number of icon columns based on
  // the measured container height, then derive an explicit grid width.
  const ICON_SIZE = 48;
  const ICON_GAP = 1;
  const HEADER_HEIGHT = 26; // matches paddingTop on the grid
  const GRID_PAD_X = 4; // 2px left + 2px right
  const [computedGridWidth, setComputedGridWidth] = useState<number | null>(null);

  useEffect(() => {
    if (orientation !== "horizontal" || group.collapsed || group.apps.length === 0) {
      setComputedGridWidth(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;

    const compute = () => {
      const cardHeight = el.clientHeight;
      const availableHeight = cardHeight - HEADER_HEIGHT - 6; // 6px ≈ pb-1.5
      const rows = Math.max(1, Math.floor((availableHeight + ICON_GAP) / (ICON_SIZE + ICON_GAP)));
      const cols = Math.ceil(group.apps.length / rows);
      const width = cols * ICON_SIZE + Math.max(0, cols - 1) * ICON_GAP + GRID_PAD_X;
      setComputedGridWidth(width);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation, group.collapsed, group.apps.length]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setNameDraft(group.name);
    }
  }, [group.name, editing]);

  const commitName = () => {
    setEditing(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== group.name) {
      onUpdateGroup({ ...group, name: trimmed });
    }
  };

  // App reordering via drag-and-drop within the grid.
  const [dragAppId, setDragAppId] = useState<string | null>(null);
  const [dropAppTarget, setDropAppTarget] = useState<string | null>(null);

  const handleAppDragStart = useCallback(
    (e: React.DragEvent, bundleId: string) => {
      e.stopPropagation(); // Don't trigger group drag.
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/app-reorder", bundleId);
      setDragAppId(bundleId);
    },
    []
  );

  const handleAppDragOver = useCallback(
    (e: React.DragEvent, bundleId: string) => {
      if (!e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (bundleId !== dragAppId) {
        setDropAppTarget(bundleId);
      }
    },
    [dragAppId]
  );

  const handleAppDrop = useCallback(
    (e: React.DragEvent, targetBundleId: string) => {
      if (!e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.stopPropagation();
      const sourceBundleId = e.dataTransfer.getData("application/app-reorder");
      if (!sourceBundleId || sourceBundleId === targetBundleId) {
        setDragAppId(null);
        setDropAppTarget(null);
        return;
      }

      const apps = [...group.apps];
      const sourceIndex = apps.findIndex((a) => a.bundleId === sourceBundleId);
      const targetIndex = apps.findIndex((a) => a.bundleId === targetBundleId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const [moved] = apps.splice(sourceIndex, 1);
      apps.splice(targetIndex, 0, moved);

      onUpdateGroup({ ...group, apps });
      setDragAppId(null);
      setDropAppTarget(null);
    },
    [group, onUpdateGroup]
  );

  const handleAppDragEnd = useCallback(() => {
    setDragAppId(null);
    setDropAppTarget(null);
  }, []);

  const handleAppDragEnter = useCallback(
    (e: React.DragEvent, bundleId: string) => {
      if (!e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.stopPropagation();
      if (bundleId !== dragAppId) {
        setDropAppTarget(bundleId);
      }
    },
    [dragAppId]
  );

  // Grid-level fallback so drops landing in gaps between icons still trigger
  // the app reorder (moves the dragged item to the end of the list).
  const handleGridDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const handleGridDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/app-reorder")) return;
      e.preventDefault();
      e.stopPropagation();
      const sourceBundleId = e.dataTransfer.getData("application/app-reorder");
      if (!sourceBundleId) {
        setDragAppId(null);
        setDropAppTarget(null);
        return;
      }

      const apps = [...group.apps];
      const sourceIndex = apps.findIndex((a) => a.bundleId === sourceBundleId);
      if (sourceIndex === -1) return;

      // Move to end when dropped in a gap.
      const [moved] = apps.splice(sourceIndex, 1);
      apps.push(moved);

      onUpdateGroup({ ...group, apps });
      setDragAppId(null);
      setDropAppTarget(null);
    },
    [group, onUpdateGroup]
  );

  // Aggregate badge count for the group header.
  const totalBadge = group.apps.reduce((sum, app) => {
    const b = badges[app.name];
    if (b) {
      const num = parseInt(b, 10);
      return sum + (isNaN(num) ? 1 : num);
    }
    return sum;
  }, 0);

  return (
    <div
      ref={cardRef}
      className="rounded-md mb-0.5 overflow-hidden"
      style={{
        background: "transparent",
        border: "1px solid transparent",
        ...(orientation === "horizontal"
          ? {
              position: "relative" as const,
              height: "100%",
              ...(computedGridWidth != null ? { width: `${computedGridWidth}px` } : {}),
            }
          : {}),
      }}
    >
      {/* Group header — clicking the row toggles collapse (unless editing or clicking a nested control). */}
      <div
        className="flex items-center gap-1 px-1.5 py-1 cursor-pointer"
        style={
          orientation === "horizontal"
            ? {
                position: "absolute" as const,
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1,
                overflow: "hidden",
                background: "inherit",
              }
            : undefined
        }
        onClick={(e) => {
          // Don't toggle if the click came from an interactive child (buttons, inputs, drag handles).
          const target = e.target as HTMLElement;
          if (target.closest("button") || target.closest("input") || target.closest("[data-drag-handle]")) return;
          if (!editing) onToggleCollapsed(group.id);
        }}
      >
        {/* Collapse caret */}
        <span
          className="text-xs flex-shrink-0"
          style={{
            color: "var(--text-muted)",
            width: "14px",
            textAlign: "center",
          }}
        >
          {group.collapsed ? "▸" : "▾"}
        </span>

        {/* Group name */}
        {editing ? (
          <input
            ref={inputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(group.name);
                setEditing(false);
              }
            }}
            className="flex-1 px-1 py-0 rounded outline-none"
            style={{
              color: "var(--text-primary)",
              background: "rgba(63, 63, 70, 0.6)",
              border: "1px solid var(--accent-blue)",
              fontSize: "12px",
              minWidth: 0,
            }}
          />
        ) : (
          <span
            className="flex-1 text-left truncate"
            style={{
              color: "var(--text-secondary)",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            {group.name}
          </span>
        )}

        {/* Badge total for collapsed groups */}
        {totalBadge > 0 && (
          <span
            className="flex-shrink-0 rounded-full flex items-center justify-center"
            style={{
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              background: "#ef4444",
              color: "#fff",
              fontSize: "9px",
              fontWeight: 600,
            }}
          >
            {totalBadge}
          </span>
        )}

        {/* App count */}
        <span
          className="text-xs flex-shrink-0 px-1 rounded"
          style={{
            color: "var(--text-muted)",
            background:
              group.apps.length > 0 ? "rgba(63, 63, 70, 0.4)" : "transparent",
            fontSize: "10px",
          }}
        >
          {group.apps.length > 0 ? group.apps.length : ""}
        </span>

        {/* Drag handle for group reordering */}
        <span
          data-drag-handle
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            onGroupDragStart(e);
          }}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{
            color: "var(--text-muted)",
            fontSize: "10px",
            lineHeight: 1,
            padding: "2px",
            userSelect: "none",
          }}
          title="Drag to reorder group"
        >
          ⠿
        </span>

        {/* Group menu button */}
        <div>
          <button
            ref={menuButtonRef}
            onClick={() => {
              if (!showMenu && menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                setMenuPos({ x: rect.right, y: rect.bottom + 2 });
              }
              setShowMenu(!showMenu);
            }}
            className="flex-shrink-0 cursor-pointer"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "none",
              fontSize: "14px",
              lineHeight: 1,
              padding: "2px",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--text-primary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
            title="Group options"
          >
            ⋯
          </button>

          {showMenu && menuPos && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div
                className="fixed z-50 rounded shadow-lg py-1"
                style={{
                  right: `${window.innerWidth - menuPos.x}px`,
                  top: `${menuPos.y}px`,
                  background: "rgb(39, 39, 42)",
                  border: "1px solid var(--panel-border)",
                  minWidth: "140px",
                  paddingLeft: "2px",
                  paddingRight: "2px",
                }}
              >
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onOpenPicker(group.id);
                  }}
                  className="w-full text-left px-3 py-1 text-xs cursor-pointer"
                  style={{
                    color: "var(--text-primary)",
                    background: "transparent",
                    border: "none",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--hover-bg)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  Add Apps…
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setEditing(true);
                  }}
                  className="w-full text-left px-3 py-1 text-xs cursor-pointer"
                  style={{
                    color: "var(--text-primary)",
                    background: "transparent",
                    border: "none",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--hover-bg)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  Rename Group
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onDeleteGroup(group.id);
                  }}
                  className="w-full text-left px-3 py-1 text-xs cursor-pointer"
                  style={{
                    color: "#ef4444",
                    background: "transparent",
                    border: "none",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--hover-bg)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  Delete Group
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* App icon grid / row */}
      {!group.collapsed && group.apps.length > 0 && (
        <div
          className="pb-1.5"
          style={
            orientation === "horizontal"
              ? {
                  display: "grid",
                  gridTemplateRows: `repeat(auto-fill, ${ICON_SIZE}px)`,
                  gridAutoColumns: `${ICON_SIZE}px`,
                  gridAutoFlow: "column" as const,
                  gap: `${ICON_GAP}px`,
                  paddingLeft: "2px",
                  paddingRight: "2px",
                  paddingTop: `${HEADER_HEIGHT}px`,
                  height: "100%",
                  boxSizing: "border-box" as const,
                }
              : {
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, 48px)",
                  gap: "4px",
                  justifyContent: "center",
                  paddingLeft: "2px",
                  paddingRight: "2px",
                }
          }
          onDragOver={handleGridDragOver}
          onDrop={handleGridDrop}
        >
          {group.apps.map((app) => (
            <div
              key={app.bundleId}
              draggable
              onDragStart={(e) => handleAppDragStart(e, app.bundleId)}
              onDragOver={(e) => handleAppDragOver(e, app.bundleId)}
              onDragEnter={(e) => handleAppDragEnter(e, app.bundleId)}
              onDrop={(e) => handleAppDrop(e, app.bundleId)}
              onDragEnd={handleAppDragEnd}
              style={{
                opacity: dragAppId === app.bundleId ? 0.4 : 1,
                borderLeft:
                  dropAppTarget === app.bundleId && dragAppId !== app.bundleId
                    ? "2px solid var(--accent-blue)"
                    : "2px solid transparent",
                transition: "opacity 0.15s ease",
              }}
            >
              <AppIcon
                app={app}
                iconSrc={appIcons[app.bundleId] || undefined}
                badge={badges[app.name] || undefined}
                groupId={group.id}
                isRunning={runningBundleIds?.has(app.bundleId)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!group.collapsed && group.apps.length === 0 && (
        <div
          className="pb-1.5 text-xs"
          style={{
            paddingLeft: "2px",
            color: "var(--text-muted)",
            ...(orientation === "horizontal" ? { paddingTop: "26px" } : {}),
          }}
        >
          <button
            onClick={() => onOpenPicker(group.id)}
            className="cursor-pointer"
            style={{
              color: "var(--accent-blue)",
              background: "transparent",
              border: "none",
              fontSize: "11px",
              padding: 0,
            }}
          >
            + Add apps to this group
          </button>
        </div>
      )}
    </div>
  );
}
