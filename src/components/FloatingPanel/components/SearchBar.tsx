interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The inline search/filter bar.
 */
export function SearchBar({
  searchQuery,
  onSearchChange,
  onClose,
  inputRef,
}: SearchBarProps) {
  return (
    <div
      className="px-2 py-1.5 flex-shrink-0"
      style={{ borderBottom: "1px solid var(--panel-border)" }}
    >
      <input
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSearchChange("");
            onClose();
          }
        }}
        placeholder="Filter spaces, apps, windows…"
        className="w-full text-xs rounded px-2 py-1 outline-none"
        style={{
          background: "rgba(63, 63, 70, 0.5)",
          color: "var(--text-primary)",
          border: "1px solid var(--panel-border)",
        }}
      />
    </div>
  );
}
