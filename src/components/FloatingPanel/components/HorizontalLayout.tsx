import React from "react";
import { SpaceCard } from "../../SpaceCard";
import { AppTray } from "../../AppTray";
import { MinimizedSection } from "./MinimizedSection";
import type { ViewMode, SpaceInfo, WindowInfo, AppGroup, EntryType } from "../../../lib/types";

interface HorizontalLayoutProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  filteredSpaces: SpaceInfo[];
  minimizedWindows: WindowInfo[];
  minimizedCollapsed: boolean;
  onToggleMinimizedCollapsed: () => void;
  searchQuery: string;
  activeSpaceId: number;
  viewMode: ViewMode;
  appIcons: Record<string, string>;
  spaceNameFontSize: number;
  windowFontSize: number;
  totalDisplays: number;
  externalDisplayNumbers: Record<string, number>;
  traySplitPercent: number;
  isDraggingDivider: boolean;
  onStartDragging: (e: React.MouseEvent) => void;
  onSetSpaceCollapsed: (spaceId: number, collapsed: boolean) => void;
  onSetSpaceLabel: (spaceId: number, label: string) => void;
  /** Incomplete to-do counts per spaceId. */
  todoCounts: Record<number, number>;
  /** Whether the tasks feature is enabled. */
  enableTodos?: boolean;
  // App tray props
  groups: AppGroup[];
  trayVisible: boolean;
  groupAppIcons: Record<string, string>;
  badges: Record<string, string>;
  onToggleTray: () => void;
  onCreateGroup: (name: string) => Promise<AppGroup | null>;
  onDeleteGroup: (id: string) => void;
  onUpdateGroup: (group: AppGroup) => void;
  onToggleGroupCollapsed: (id: string) => void;
  onAddApp: (groupId: string, bundleId: string, name: string, entryType?: EntryType) => void;
  onRemoveApp: (groupId: string, bundleId: string) => void;
  onReorderGroups: (ids: string[]) => void;
  runningBundleIds?: Set<string>;
}

/**
 * The horizontal layout for the expanded panel (spaces side-by-side, tray on right).
 */
export function HorizontalLayout({
  containerRef,
  loading,
  filteredSpaces,
  minimizedWindows,
  minimizedCollapsed,
  onToggleMinimizedCollapsed,
  searchQuery,
  activeSpaceId,
  viewMode,
  appIcons,
  spaceNameFontSize,
  windowFontSize,
  totalDisplays,
  externalDisplayNumbers,
  traySplitPercent,
  isDraggingDivider,
  onStartDragging,
  onSetSpaceCollapsed,
  onSetSpaceLabel,
  todoCounts,
  enableTodos = true,
  groups,
  trayVisible,
  groupAppIcons,
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
}: HorizontalLayoutProps) {
  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-row overflow-hidden"
      style={{ minHeight: 0 }}
    >
      {/* Scrollable space columns — takes remaining width */}
      <div
        className="flex flex-row overflow-x-auto overflow-y-hidden"
        style={{ flex: `0 0 ${100 - traySplitPercent}%`, minWidth: 0 }}
      >
        {loading ? (
          <div
            className="text-xs px-2 py-2 flex-shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            Loading spaces…
          </div>
        ) : filteredSpaces.length === 0 && minimizedWindows.length === 0 ? (
          <div
            className="text-xs px-2 py-2 flex-shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            {searchQuery ? "No matches." : "No spaces detected."}
          </div>
        ) : (
          <>
            {filteredSpaces.map((space, idx) => {
              const isDisplayBoundary =
                totalDisplays > 1 &&
                idx > 0 &&
                space.displayId !== filteredSpaces[idx - 1].displayId;
              const hasRightNeighbor =
                idx < filteredSpaces.length - 1 || minimizedWindows.length > 0;

              return (
                <React.Fragment key={`${space.displayId}:${space.spaceIndex}`}>
                  {isDisplayBoundary && (
                    <div
                      style={{
                        width: "1px",
                        background: "var(--panel-border)",
                        margin: "6px 4px",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div
                    className="flex-shrink-0 overflow-y-auto"
                    style={{
                      minWidth: space.isCollapsed ? "auto" : "140px",
                      maxWidth: "260px",
                      borderRight: hasRightNeighbor
                        ? "1px solid var(--panel-border)"
                        : "none",
                    }}
                  >
                    <SpaceCard
                      space={space}
                      activeSpaceId={activeSpaceId}
                      viewMode={viewMode}
                      appIcons={appIcons}
                      spaceNameFontSize={spaceNameFontSize}
                      windowFontSize={windowFontSize}
                      totalDisplays={totalDisplays}
                      externalDisplayNumber={externalDisplayNumbers[space.displayId]}
                      orientation="horizontal"
                      todoCount={todoCounts[space.spaceId] ?? 0}
                      enableTodos={enableTodos}
                      onSetCollapsed={onSetSpaceCollapsed}
                      onSetLabel={onSetSpaceLabel}
                    />
                  </div>
                </React.Fragment>
              );
            })}

            {/* Minimized windows column */}
            {minimizedWindows.length > 0 && (
              <div
                className="flex-shrink-0 overflow-y-auto"
                style={{
                  minWidth: minimizedCollapsed ? "auto" : "140px",
                  maxWidth: "260px",
                }}
              >
                <MinimizedSection
                  minimizedWindows={minimizedWindows}
                  minimizedCollapsed={minimizedCollapsed}
                  onToggleCollapsed={onToggleMinimizedCollapsed}
                  viewMode={viewMode}
                  appIcons={appIcons}
                  spaceNameFontSize={spaceNameFontSize}
                  windowFontSize={windowFontSize}
                  orientation="horizontal"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Draggable divider — vertical bar */}
      <div
        onMouseDown={onStartDragging}
        style={{
          width: "3px",
          cursor: "col-resize",
          background: isDraggingDivider
            ? "var(--accent-blue)"
            : "var(--panel-border)",
          flexShrink: 0,
          transition: isDraggingDivider ? "none" : "background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (!isDraggingDivider)
            e.currentTarget.style.background = "var(--text-muted)";
        }}
        onMouseLeave={(e) => {
          if (!isDraggingDivider)
            e.currentTarget.style.background = "var(--panel-border)";
        }}
        title="Drag to resize"
      />

      {/* App tray column */}
      <div
        className="overflow-hidden"
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          flex: `0 0 calc(${traySplitPercent}% - 3px)`,
          minWidth: "60px",
        }}
      >
        <AppTray
          groups={groups}
          trayVisible={trayVisible}
          appIcons={groupAppIcons}
          badges={badges}
          onToggleTray={onToggleTray}
          onCreateGroup={onCreateGroup}
          onDeleteGroup={onDeleteGroup}
          onUpdateGroup={onUpdateGroup}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onAddApp={onAddApp}
          onRemoveApp={onRemoveApp}
          onReorderGroups={onReorderGroups}
          runningBundleIds={runningBundleIds}
          orientation="horizontal"
        />
      </div>
    </div>
  );
}
