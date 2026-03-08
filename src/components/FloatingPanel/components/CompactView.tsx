interface CompactViewProps {
  fontFamily: string;
  spacesCount: number;
  totalWindows: number;
  onExpand: () => void;
}

/**
 * The collapsed/compact view of the floating panel.
 */
export function CompactView({
  fontFamily,
  spacesCount,
  totalWindows,
  onExpand,
}: CompactViewProps) {
  return (
    <div
      data-tauri-drag-region
      className="h-full flex items-center rounded-lg overflow-hidden cursor-grab relative"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        fontFamily,
      }}
    >
      {/* App initial — fixed to the left */}
      <span
        data-tauri-drag-region
        className="font-semibold pointer-events-none absolute"
        style={{ left: "10px", color: "var(--text-primary)" }}
      >
        S
      </span>

      {/* Centered summary */}
      <span
        data-tauri-drag-region
        className="text-xs pointer-events-none w-full text-center"
        style={{ color: "var(--text-secondary)" }}
      >
        <span style={{ color: "var(--accent-blue)" }}>{spacesCount}</span>
        <span style={{ color: "var(--text-muted)" }}> spaces</span>
        {"  ·  "}
        <span style={{ color: "var(--accent-blue)" }}>{totalWindows}</span>
        <span style={{ color: "var(--text-muted)" }}> windows</span>
      </span>

      {/* Expand button — fixed to the right */}
      <button
        onClick={onExpand}
        className="cursor-pointer absolute"
        style={{
          right: "8px",
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          fontSize: "13px",
          lineHeight: 1,
          padding: "2px",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title="Expand"
      >
        +
      </button>
    </div>
  );
}
