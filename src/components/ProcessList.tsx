import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  refreshWindowSurfaces,
  setSurfaceSort,
  useWindowSurfaces,
} from "../hooks/useWindowSurfaces";
import type { AppProcess, SurfaceSummary } from "../lib/types";

type Action = "quit" | "restart";

/** Apps that cannot be quit or restarted from here (the backend enforces the same). */
const PROTECTED_BUNDLE_IDS = new Set(["com.apple.finder"]);

const CONFIRM_TIMEOUT_MS = 5000;
const ERROR_TIMEOUT_MS = 8000;

/**
 * Menu strips and 1-pixel helpers are normal (macOS creates them for every app and
 * display). Invisible and overlay surfaces are the ones an app can leak, so those
 * drive the "flagged" state.
 */
const FLAG_HIDDEN_THRESHOLD = 20;
const FLAG_INVISIBLE_THRESHOLD = 10;
const FLAG_OFFSCREEN_THRESHOLD = 25;
/** Typical apps hold fewer than 10 tiny helper surfaces. */
const FLAG_HELPER_THRESHOLD = 30;

const DANGER = "#ef4444";

function isFlagged(s: SurfaceSummary): boolean {
  // Owners without a bundle ID are system components (the compositor itself,
  // for example), not apps the user can act on.
  if (!s.bundleId) return false;
  return (
    s.invisible >= FLAG_INVISIBLE_THRESHOLD ||
    s.invisible + s.overlays >= FLAG_HIDDEN_THRESHOLD ||
    s.offscreen >= FLAG_OFFSCREEN_THRESHOLD ||
    s.helpers >= FLAG_HELPER_THRESHOLD
  );
}

function rowKey(s: SurfaceSummary): string {
  return s.bundleId || `${s.name}:${s.pid}`;
}

/** Plain-language breakdown such as "110 invisible, 7 helpers, 12 menu strips". */
function breakdown(s: SurfaceSummary, includeNormal: boolean): string {
  const parts: string[] = [];
  if (s.invisible) parts.push(`${s.invisible} invisible`);
  if (s.overlays) parts.push(`${s.overlays} overlay${s.overlays === 1 ? "" : "s"}`);
  if (includeNormal) {
    if (s.visible) parts.push(`${s.visible} visible`);
    if (s.offscreen) parts.push(`${s.offscreen} off-screen`);
  } else if (s.offscreen >= FLAG_OFFSCREEN_THRESHOLD) {
    parts.push(`${s.offscreen} off-screen`);
  }
  if (s.helpers) parts.push(`${s.helpers} helper${s.helpers === 1 ? "" : "s"}`);
  if (s.menuStrips) parts.push(`${s.menuStrips} menu strip${s.menuStrips === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return "-";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

interface ProcessListProps {
  /** Windows Swavigator tracks per app (spaces plus minimized). */
  processes: AppProcess[];
  /** Icon data URLs keyed by bundle ID (same map the workspace outline uses). */
  appIcons: Record<string, string>;
  fontSize?: number;
}

export function ProcessList({ processes, appIcons, fontSize = 12 }: ProcessListProps) {
  // Cached at module level: the list is available immediately when the tab or
  // panel reappears, and refreshes in the background.
  const { surfaces: rawSurfaces, icons: fetchedIcons, error: loadError, loaded, sort } =
    useWindowSurfaces();
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<Record<string, Action>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const surfaces = useMemo(() => {
    if (sort === "total") return rawSurfaces; // Backend already sorts by total.
    return [...rawSurfaces].sort(
      (a, b) => b.memoryBytes - a.memoryBytes || b.total - a.total || a.name.localeCompare(b.name),
    );
  }, [rawSurfaces, sort]);

  const trackedByBundle = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of processes) map.set(p.bundleId, p.windowCount);
    return map;
  }, [processes]);

  // A confirmation expires on its own so a stray click never leaves it armed.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const run = useCallback(
    async (s: SurfaceSummary, action: Action) => {
      const key = rowKey(s);
      setPending(null);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setBusy((prev) => ({ ...prev, [key]: action }));
      try {
        await invoke(action === "quit" ? "quit_app" : "restart_app", { bundleId: s.bundleId });
      } catch (err) {
        const message = String(err)
          .replace(/^App (quit|restart) failed:\s*/i, "")
          .replace(/^ERR:\s*/, "");
        setErrors((prev) => ({ ...prev, [key]: message }));
        setTimeout(() => {
          setErrors((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, ERROR_TIMEOUT_MS);
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        void refreshWindowSurfaces();
      }
    },
    [],
  );

  const totalSurfaces = surfaces.reduce((sum, s) => sum + s.total, 0);
  const flaggedCount = surfaces.filter(isFlagged).length;

  if (loadError && surfaces.length === 0) {
    return (
      <div className="px-2 py-2" style={{ color: DANGER, fontSize }}>
        Could not read window list: {loadError}
      </div>
    );
  }

  if (!loaded || surfaces.length === 0) {
    return (
      <div className="px-2 py-2" style={{ color: "var(--text-muted)", fontSize }}>
        Reading windows...
      </div>
    );
  }

  const buttonStyle = {
    color: "var(--text-secondary)",
    fontSize: fontSize - 1,
    lineHeight: 1,
  } as const;
  const numberCell = {
    color: "var(--text-secondary)",
    minWidth: "2.2em",
  } as const;
  const memoryCell = { ...numberCell, minWidth: "4.6em" } as const;
  const sortHeader = (id: "total" | "memory", label: string, style: { minWidth: string; color: string }) => (
    <button
      className="cursor-pointer text-right"
      style={{
        ...style,
        color: sort === id ? "var(--text-primary)" : "var(--text-muted)",
        textDecoration: sort === id ? "underline" : undefined,
        fontSize: fontSize - 2,
      }}
      title={`Sort by ${label === "mem" ? "memory" : "surfaces"}`}
      onClick={() => setSurfaceSort(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-2 flex-shrink-0 px-2 py-0.5"
        style={{ color: "var(--text-muted)", fontSize: fontSize - 2 }}
        title="Surfaces are everything the window server holds for an app, including hidden ones. Menu strips and helpers are normal. Invisible and overlay surfaces are the ones that can pile up."
      >
        <span className="flex-1 truncate">
          {totalSurfaces} surfaces in {surfaces.length} apps
          {flaggedCount > 0 && (
            <span style={{ color: DANGER }}>
              {" "}
              ({flaggedCount} flagged)
            </span>
          )}
        </span>
        <span className="text-right" style={numberCell}>
          open
        </span>
        {sortHeader("total", "total", numberCell)}
        {sortHeader("memory", "mem", memoryCell)}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {surfaces.map((s) => {
          const key = rowKey(s);
          const protectedApp = !s.bundleId || PROTECTED_BUNDLE_IDS.has(s.bundleId);
          const activeBusy = busy[key];
          const confirming = pending?.key === key ? pending.action : null;
          const iconSrc = (s.bundleId && (fetchedIcons[s.bundleId] || appIcons[s.bundleId])) || "";
          const flagged = isFlagged(s);
          const tracked = trackedByBundle.get(s.bundleId) ?? 0;
          const tooltip = `${s.name}: ${s.total} surfaces (${breakdown(s, true)}), ${formatMemory(s.memoryBytes)}`;

          return (
            <div key={key}>
              <div
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors"
                style={{
                  fontSize,
                  background: hovered === key ? "var(--hover-bg)" : "transparent",
                }}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                title={tooltip}
              >
                {iconSrc ? (
                  <img
                    src={iconSrc}
                    alt=""
                    className="flex-shrink-0"
                    style={{ width: "14px", height: "14px" }}
                  />
                ) : (
                  <span className="flex-shrink-0" style={{ width: "14px", height: "14px" }} />
                )}
                <span
                  className="truncate flex-1"
                  style={{
                    color: flagged ? DANGER : "var(--text-primary)",
                    opacity: activeBusy ? 0.5 : 1,
                  }}
                >
                  {s.name}
                  {!s.isRegular && (
                    <span style={{ color: "var(--text-muted)", fontSize: fontSize - 2 }}>
                      {" "}
                      (background)
                    </span>
                  )}
                </span>

                {activeBusy ? (
                  <span style={{ color: "var(--text-muted)", fontSize: fontSize - 1 }}>
                    {activeBusy === "quit" ? "Quitting..." : "Restarting..."}
                  </span>
                ) : confirming ? (
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span style={{ color: "var(--text-secondary)", fontSize: fontSize - 1 }}>
                      {confirming === "quit" ? "Quit?" : "Restart?"}
                    </span>
                    <button
                      className="cursor-pointer px-1 rounded"
                      style={{
                        ...buttonStyle,
                        color: confirming === "quit" ? DANGER : "var(--accent-blue)",
                      }}
                      onClick={() => run(s, confirming)}
                    >
                      Yes
                    </button>
                    <button
                      className="cursor-pointer px-1 rounded"
                      style={buttonStyle}
                      onClick={() => setPending(null)}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <>
                    {!protectedApp && hovered === key && (
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <button
                          className="cursor-pointer px-1 rounded"
                          style={buttonStyle}
                          title={`Restart ${s.name}`}
                          onClick={() => setPending({ key, action: "restart" })}
                        >
                          Restart
                        </button>
                        <button
                          className="cursor-pointer px-1 rounded"
                          style={{ ...buttonStyle, color: DANGER }}
                          title={`Quit ${s.name}`}
                          onClick={() => setPending({ key, action: "quit" })}
                        >
                          Quit
                        </button>
                      </span>
                    )}
                    <span className="flex-shrink-0 tabular-nums text-right" style={numberCell}>
                      {tracked > 0 ? tracked : "-"}
                    </span>
                    <span
                      className="flex-shrink-0 tabular-nums text-right"
                      style={{
                        ...numberCell,
                        color: flagged ? DANGER : "var(--text-secondary)",
                        fontWeight: flagged ? 600 : undefined,
                      }}
                    >
                      {s.total}
                    </span>
                    <span
                      className="flex-shrink-0 tabular-nums text-right"
                      style={{
                        ...memoryCell,
                        fontWeight: s.memoryBytes >= 1024 ** 3 ? 600 : undefined,
                      }}
                      title={
                        s.processCount > 0
                          ? `${s.processCount} process${s.processCount === 1 ? "" : "es"}, memory footprint`
                          : "Memory not readable"
                      }
                    >
                      {formatMemory(s.memoryBytes)}
                    </span>
                  </>
                )}
              </div>
              {flagged && !activeBusy && (
                <div
                  className="pb-0.5"
                  style={{
                    color: DANGER,
                    opacity: 0.8,
                    fontSize: fontSize - 2,
                    paddingLeft: "28px",
                  }}
                >
                  {breakdown(s, false)}
                </div>
              )}
              {errors[key] && (
                <div
                  className="pb-0.5"
                  style={{ color: DANGER, fontSize: fontSize - 2, paddingLeft: "28px" }}
                >
                  {errors[key]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
