interface UrlInputRowProps {
  urlValue: string;
  setUrlValue: (value: string) => void;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onAddUrl: () => void;
  onCancel: () => void;
}

export function UrlInputRow({
  urlValue,
  setUrlValue,
  urlInputRef,
  onAddUrl,
  onCancel,
}: UrlInputRowProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      style={{ borderTop: "1px solid var(--panel-border)" }}
    >
      <input
        ref={urlInputRef}
        value={urlValue}
        onChange={(e) => setUrlValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAddUrl();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="https://example.com"
        className="flex-1 text-sm rounded px-3 py-1.5 outline-none"
        style={{
          background: "rgba(63, 63, 70, 0.5)",
          color: "var(--text-primary)",
          border: "1px solid var(--panel-border)",
        }}
      />
      <button
        onClick={onAddUrl}
        className="cursor-pointer rounded px-3 py-1"
        style={{
          color: "var(--accent-blue)",
          background: "rgba(59, 130, 246, 0.15)",
          border: "1px solid var(--accent-blue)",
          fontSize: "12px",
        }}
      >
        Add
      </button>
      <button
        onClick={onCancel}
        className="cursor-pointer rounded px-2 py-1"
        style={{
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          fontSize: "12px",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
