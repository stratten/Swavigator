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
            {filteredSpaces.map((space, idx) => (
              <div
                key={`${space.displayId}:${space.spaceIndex}`}
                className="flex-shrink-0 overflow-y-auto"
                style={{
                  minWidth: space.isCollapsed ? "auto" : "140px",
                  maxWidth: "260px",
                  borderRight:
                    idx < filteredSpaces.length - 1 || minimizedWindows.length > 0
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
                  onSetCollapsed={onSetSpaceCollapsed}
                  onSetLabel={onSetSpaceLabel}
                />
              </div>
            ))}

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
