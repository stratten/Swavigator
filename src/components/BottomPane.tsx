import { useState, type ComponentProps } from "react";
import { AppTray } from "./AppTray";
import { ProcessList } from "./ProcessList";
import type { AppProcess } from "../lib/types";

type Tab = "apps" | "windows";
const TAB_STORAGE_KEY = "swavigator.bottomTab";

type BottomPaneProps = ComponentProps<typeof AppTray> & {
  /** Running apps with window counts, already sorted by count descending. */
  processes: AppProcess[];
  /** Icons for running apps, keyed by bundle ID. */
  processIcons: Record<string, string>;
  fontSize: number;
};

function readStoredTab(): Tab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "windows" ? "windows" : "apps";
  } catch {
    return "apps";
  }
}

/** Bottom area of the panel: the app launcher tray, or windows-per-app with quit/restart. */
export function BottomPane({ processes, processIcons, fontSize, ...trayProps }: BottomPaneProps) {
  const [tab, setTab] = useState<Tab>(readStoredTab);

  const selectTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  };

  const tabButton = (id: Tab, label: string) => (
    <button
      className="cursor-pointer px-2 rounded transition-colors"
      style={{
        fontSize: fontSize - 2,
        color: tab === id ? "var(--text-primary)" : "var(--text-muted)",
        background: tab === id ? "var(--hover-bg)" : "transparent",
      }}
      onClick={() => selectTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-1 py-0.5 flex-shrink-0">
        {tabButton("apps", "Apps")}
        {tabButton("windows", "Windows")}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "apps" ? (
          <AppTray {...trayProps} />
        ) : (
          <ProcessList processes={processes} appIcons={processIcons} fontSize={fontSize} />
        )}
      </div>
    </div>
  );
}
