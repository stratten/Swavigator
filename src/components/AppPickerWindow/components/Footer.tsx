interface FooterProps {
  currentAppsCount: number;
  search: string;
  addedCount: number;
  onBrowseFolder: () => void;
  onBrowse: () => void;
  onShowUrlInput: () => void;
  onClose: () => void;
}

export function Footer({
  currentAppsCount,
  search,
  addedCount,
  onBrowseFolder,
  onBrowse,
  onShowUrlInput,
  onClose,
}: FooterProps) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 flex-shrink-0"
      style={{ borderTop: "1px solid var(--panel-border)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {currentAppsCount} app{currentAppsCount !== 1 ? "s" : ""}
        {search ? " matching" : ""}
        {addedCount > 0 && (
          <span style={{ color: "var(--accent-green, #22c55e)", marginLeft: "8px" }}>
            +{addedCount} added
          </span>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onBrowseFolder}
          className="cursor-pointer rounded px-2.5 py-1"
          style={{
            color: "var(--text-secondary)",
            background: "rgba(63, 63, 70, 0.4)",
            border: "1px solid var(--panel-border)",
            fontSize: "11px",
          }}
          title="Add a folder from Finder."
        >
          📁 Folder…
        </button>
        <button
          onClick={onBrowse}
          className="cursor-pointer rounded px-2.5 py-1"
          style={{
            color: "var(--text-secondary)",
            background: "rgba(63, 63, 70, 0.4)",
            border: "1px solid var(--panel-border)",
            fontSize: "11px",
          }}
          title="Add a file from Finder."
        >
          📄 File…
        </button>
        <button
          onClick={onShowUrlInput}
          className="cursor-pointer rounded px-2.5 py-1"
          style={{
            color: "var(--text-secondary)",
            background: "rgba(63, 63, 70, 0.4)",
            border: "1px solid var(--panel-border)",
            fontSize: "11px",
          }}
          title="Add a URL bookmark."
        >
          🔗 URL…
        </button>
        <button
          onClick={onClose}
          className="cursor-pointer rounded px-3 py-1"
          style={{
            color: "var(--accent-blue)",
            background: "rgba(59, 130, 246, 0.15)",
            border: "1px solid var(--accent-blue)",
            fontSize: "12px",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
