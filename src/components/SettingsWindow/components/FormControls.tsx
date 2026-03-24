/**
 * Reusable form control components for the Settings window.
 */

interface SectionHeaderProps {
  children: React.ReactNode;
  first?: boolean;
}

export function SectionHeader({ children, first }: SectionHeaderProps) {
  return (
    <div
      style={{
        color: "var(--text-secondary)",
        fontSize: "12.5px",
        lineHeight: 1,
        letterSpacing: "0.05em",
        marginTop: first ? "4px" : "14px",
        marginBottom: "2px",
        paddingBottom: "1px",
        paddingLeft: "6px",
        borderBottom: "1px solid var(--panel-border)",
      }}
    >
      {children}
    </div>
  );
}

interface SettingRowProps {
  label: string;
  children: React.ReactNode;
}

export function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ marginBottom: "6px", padding: "3px 6px" }}
    >
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

interface StyledSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
}

export function StyledSelect({ value, onChange, options }: StyledSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="view-mode-select text-xs rounded px-2 py-0.5 outline-none cursor-pointer"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
}

export function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <label className="inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className="relative w-8 h-4 rounded-full"
        style={{
          background: checked
            ? "var(--accent-color, #3b82f6)"
            : "rgba(63, 63, 70, 0.6)",
        }}
      >
        <div
          className="absolute rounded-full transition-transform"
          style={{
            width: "12px",
            height: "12px",
            top: "1px",
            left: "1px",
            background: "#fff",
            transform: checked ? "translateX(14px)" : "translateX(0)",
          }}
        />
      </div>
    </label>
  );
}
