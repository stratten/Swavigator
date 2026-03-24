import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import type { TodoItem, SpaceStatePayload } from "../../lib/types";
import { RichTextEditor } from "./RichTextEditor";

/** Format: "Desktop X" or "Desktop X – Label" when custom name exists. */
function fmtSpaceLabel(spaceIndex: number, label: string): string {
  return label ? `Desktop ${spaceIndex} \u2013 ${label}` : `Desktop ${spaceIndex}`;
}

/** Parse URL query params to determine mode. */
function getParams(): { spaceId: number | null; spaceName: string } {
  const params = new URLSearchParams(window.location.search);
  const rawId = params.get("spaceId");
  return {
    spaceId: rawId ? Number(rawId) : null,
    spaceName: params.get("spaceName") || "",
  };
}

/** Strip HTML tags to check if content is empty. */
function isHtmlEmpty(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length === 0;
}

/** Generate a default subject line: "[spaceLabel] – Mar 20, 2:34 PM". */
function defaultSubject(spaceLabel: string | null | undefined): string {
  const ts = new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return spaceLabel ? `${spaceLabel} \u2013 ${ts}` : `Unassigned \u2013 ${ts}`;
}

interface SpaceTodoSection {
  key: string;
  spaceId: number | null;
  label: string;
  todos: TodoItem[];
  collapsed: boolean;
}

interface SpaceOption {
  id: number | null;
  label: string;
}

export function TodoWindow() {
  const { spaceId, spaceName } = getParams();
  const isOverview = spaceId === null;

  const [allTodos, setAllTodos] = useState<TodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [newHtml, setNewHtml] = useState("");
  const addEditorKeyRef = useRef(0);

  const [activeTab, setActiveTab] = useState<"open" | "done">("open");
  const [transitioning, setTransitioning] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const [spaceOptions, setSpaceOptions] = useState<SpaceOption[]>([]);

  const loadTodos = useCallback(async () => {
    if (isOverview) {
      const todos = await invoke<TodoItem[]>("get_all_todos");
      setAllTodos(todos);
    } else {
      const todos = await invoke<TodoItem[]>("get_space_todos", { spaceId });
      setAllTodos(todos);
    }
    setLoaded(true);
  }, [isOverview, spaceId]);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  useEffect(() => {
    const unlisten = listen("todos-changed", () => { loadTodos(); });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadTodos]);

  // Seed space options on mount (lightweight, no window enumeration) and keep
  // them in sync via the polling loop the main panel already drives.
  // Loaded in both overview and per-space modes so the space dropdown works everywhere.
  useEffect(() => {
    invoke<{ spaceId: number; spaceIndex: number; label: string }[]>("get_space_list")
      .then((list) => {
        setSpaceOptions(
          list.map((s) => ({ id: s.spaceId, label: fmtSpaceLabel(s.spaceIndex, s.label) })),
        );
      })
      .catch(() => {});

    const unlisten = listen<SpaceStatePayload>("space-state-update", (e) => {
      setSpaceOptions(
        e.payload.spaces.map((s) => ({ id: s.spaceId, label: fmtSpaceLabel(s.spaceIndex, s.label) })),
      );
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const notifyChange = useCallback(() => { emit("todos-changed"); }, []);

  // Build a lookup from spaceId → label for active spaces.
  const spaceLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const opt of spaceOptions) {
      if (opt.id != null) map.set(opt.id, opt.label);
    }
    return map;
  }, [spaceOptions]);

  // Build dropdown options: "Unassigned" + active spaces.
  const moveOptions: SpaceOption[] = useMemo(
    () => [{ id: null, label: "Unassigned" }, ...spaceOptions],
    [spaceOptions],
  );

  // ── Per-space mode filtering ──────────────────────────────────────────

  const perSpaceTodos = useMemo(
    () => (isOverview ? [] : allTodos),
    [isOverview, allTodos],
  );

  const incompleteSingle = useMemo(
    () => perSpaceTodos.filter((t) => !t.completed).length,
    [perSpaceTodos],
  );
  const completeSingle = useMemo(
    () => perSpaceTodos.filter((t) => t.completed).length,
    [perSpaceTodos],
  );

  const visiblePerSpaceTodos = useMemo(
    () =>
      perSpaceTodos.filter((t) => {
        if (transitioning.has(t.id)) return true;
        return activeTab === "open" ? !t.completed : t.completed;
      }),
    [perSpaceTodos, activeTab, transitioning],
  );

  // ── Overview mode sections ────────────────────────────────────────────

  const overviewTodos = useMemo(
    () => (isOverview ? allTodos : []),
    [isOverview, allTodos],
  );

  const incompleteOverview = useMemo(
    () => overviewTodos.filter((t) => !t.completed).length,
    [overviewTodos],
  );
  const completeOverview = useMemo(
    () => overviewTodos.filter((t) => t.completed).length,
    [overviewTodos],
  );

  const sections: SpaceTodoSection[] = useMemo(() => {
    if (!isOverview) return [];

    const filtered = overviewTodos.filter((t) => {
      if (transitioning.has(t.id)) return true;
      return activeTab === "open" ? !t.completed : t.completed;
    });

    const grouped = new Map<string, { spaceId: number | null; label: string; todos: TodoItem[] }>();

    for (const todo of filtered) {
      let key: string;
      let label: string;

      if (todo.spaceId != null) {
        key = `space-${todo.spaceId}`;
        const liveLabel = spaceLabelMap.get(todo.spaceId);
        if (liveLabel) {
          label = liveLabel;
        } else {
          label = todo.lastAssignedTo
            ? `${todo.lastAssignedTo} (removed)`
            : `Space ${todo.spaceId}`;
        }
      } else {
        const origin = todo.lastAssignedTo || "Unassigned";
        key = `unassigned-${origin}`;
        label = origin === "Unassigned" ? "Unassigned" : `${origin} (removed)`;
      }

      const existing = grouped.get(key);
      if (existing) {
        existing.todos.push(todo);
      } else {
        grouped.set(key, { spaceId: todo.spaceId ?? null, label, todos: [todo] });
      }
    }

    const secs: SpaceTodoSection[] = [];
    for (const [key, val] of grouped) {
      secs.push({
        key,
        spaceId: val.spaceId,
        label: val.label,
        todos: val.todos,
        collapsed: collapsedSections.has(key),
      });
    }

    secs.sort((a, b) => {
      if (a.spaceId == null && b.spaceId != null) return 1;
      if (a.spaceId != null && b.spaceId == null) return -1;
      return a.label.localeCompare(b.label);
    });

    return secs;
  }, [isOverview, overviewTodos, activeTab, transitioning, spaceLabelMap, collapsedSections]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleAdd = useCallback(async (targetSpaceId?: number | null) => {
    if (isHtmlEmpty(newHtml)) return;
    const sid = targetSpaceId !== undefined ? targetSpaceId : spaceId;
    const label = sid != null ? (spaceLabelMap.get(sid) ?? spaceName) : null;
    const subject = defaultSubject(label || null);
    await invoke("add_todo", { spaceId: sid, subject, text: newHtml });
    setNewHtml("");
    addEditorKeyRef.current += 1;
    await loadTodos();
    notifyChange();
  }, [newHtml, spaceId, spaceName, spaceLabelMap, loadTodos, notifyChange]);

  const handleToggle = useCallback(async (todoId: string) => {
    await invoke("toggle_todo", { todoId });
    notifyChange();
    setTransitioning((prev) => new Set(prev).add(todoId));
    await loadTodos();
    setTimeout(() => {
      setTransitioning((prev) => {
        const next = new Set(prev);
        next.delete(todoId);
        return next;
      });
    }, 600);
  }, [loadTodos, notifyChange]);

  const handleDelete = useCallback(async (todoId: string) => {
    await invoke("delete_todo", { todoId });
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleUpdateText = useCallback(async (todoId: string, html: string) => {
    if (isHtmlEmpty(html)) return;
    await invoke("update_todo_text", { todoId, text: html });
    setEditingId(null);
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleUpdateSubject = useCallback(async (todoId: string, subject: string) => {
    const trimmed = subject.trim();
    if (!trimmed) { setEditingSubjectId(null); return; }
    await invoke("update_todo_subject", { todoId, subject: trimmed });
    setEditingSubjectId(null);
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleMoveTodo = useCallback(async (todoId: string, toSpaceId: number | null) => {
    await invoke("move_todo", { todoId, toSpaceId });
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleClose = useCallback(() => { getCurrentWindow().close(); }, []);

  const toggleSectionCollapsed = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  if (!loaded) {
    return (
      <div
        className="h-full flex items-center justify-center rounded-lg"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          color: "var(--text-muted)",
          fontSize: "13px",
        }}
      >
        Loading…
      </div>
    );
  }

  const title = isOverview ? "All To-Dos" : `To-Dos — ${spaceName}`;

  return (
    <div
      className="h-full flex flex-col rounded-lg overflow-hidden"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
      }}
    >
      {/* Title bar */}
      <div
        data-tauri-drag-region
        className="flex items-center py-2 px-4 flex-shrink-0 cursor-grab"
        style={{ borderBottom: "1px solid var(--panel-border)" }}
      >
        <span
          data-tauri-drag-region
          className="font-semibold flex-1 truncate"
          style={{ color: "var(--text-primary)", fontSize: "13px" }}
        >
          {title}
        </span>
        <button
          onClick={handleClose}
          className="cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 4px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "8px 12px" }}>
        {/* Open / Done tabs (both overview and per-space) */}
        <div
          className="flex gap-0 flex-shrink-0"
          style={{ marginBottom: "8px", borderBottom: "1px solid var(--panel-border)" }}
        >
          {(["open", "done"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const count = isOverview
              ? (tab === "open" ? incompleteOverview : completeOverview)
              : (tab === "open" ? incompleteSingle : completeSingle);
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="cursor-pointer"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--accent-blue)" : "2px solid transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "12px",
                  fontWeight: isActive ? 600 : 400,
                  padding: "4px 12px 6px",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab === "open" ? "Open" : "Done"}
                {count > 0 && (
                  <span
                    style={{
                      marginLeft: "5px",
                      fontSize: "10px",
                      color: isActive ? "var(--accent-blue)" : "var(--text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {isOverview ? (
          sections.length === 0 ? (
            <div
              className="flex items-center justify-center"
              style={{ color: "var(--text-muted)", fontSize: "12px", padding: "24px 0" }}
            >
              {activeTab === "open"
                ? allTodos.length === 0
                  ? "No to-dos yet. Add one below."
                  : "All done!"
                : "No completed to-dos."}
            </div>
          ) : (
            sections.map((section) => {
              const incomplete = section.todos.filter((t) => !t.completed).length;
              return (
                <div key={section.key} style={{ marginBottom: "12px" }}>
                  <button
                    onClick={() => toggleSectionCollapsed(section.key)}
                    className="flex items-center gap-1 w-full cursor-pointer"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "4px 0",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ width: "12px", textAlign: "center", fontSize: "10px" }}>
                      {section.collapsed ? "▸" : "▾"}
                    </span>
                    <span className="flex-1 truncate">{section.label}</span>
                    {incomplete > 0 && (
                      <span
                        className="rounded-full px-1"
                        style={{
                          background: "var(--accent-blue)",
                          color: "#fff",
                          fontSize: "10px",
                          lineHeight: "16px",
                          minWidth: "16px",
                          textAlign: "center",
                        }}
                      >
                        {incomplete}
                      </span>
                    )}
                  </button>
                  {!section.collapsed && (
                    <div style={{ paddingLeft: "14px" }}>
                      {renderTodoList(section.todos)}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          <>
            {visiblePerSpaceTodos.length === 0 && (
              <div
                className="flex items-center justify-center"
                style={{ color: "var(--text-muted)", fontSize: "12px", padding: "24px 0" }}
              >
                {activeTab === "open"
                  ? allTodos.length === 0
                    ? "No to-dos yet. Add one below."
                    : "All done!"
                  : "No completed to-dos."}
              </div>
            )}
            {renderTodoList(visiblePerSpaceTodos)}
          </>
        )}
      </div>

      {/* Add editor — shown on the Open tab */}
      {activeTab === "open" && (
        <div
          className="flex-shrink-0 flex flex-col gap-2"
          style={{ padding: "8px 12px", borderTop: "1px solid var(--panel-border)" }}
        >
          <RichTextEditor
            key={addEditorKeyRef.current}
            content=""
            onUpdate={setNewHtml}
            placeholder="Cmd+Enter to add"
            onSubmit={() => handleAdd()}
            autofocus
          />
          <div className="flex justify-end">
            <button
              onClick={() => handleAdd()}
              className="cursor-pointer"
              style={{
                background: "var(--accent-blue)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
                padding: "4px 12px",
                fontWeight: 600,
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );

  function renderTodoList(items: TodoItem[]) {
    return items.map((todo) => {
      const isFading = transitioning.has(todo.id);
      const displaySubject = todo.subject || todo.lastAssignedTo || "Untitled";

      return (
        <div
          key={todo.id}
          style={{
            padding: "6px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            opacity: isFading ? 0.4 : 1,
            transition: "opacity 0.4s ease",
          }}
        >
          {/* Subject header row */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => handleToggle(todo.id)}
              style={{
                accentColor: "var(--accent-blue)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            />
            {editingSubjectId === todo.id ? (
              <input
                type="text"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onBlur={() => handleUpdateSubject(todo.id, subjectDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUpdateSubject(todo.id, subjectDraft);
                  if (e.key === "Escape") setEditingSubjectId(null);
                }}
                autoFocus
                className="flex-1 min-w-0"
                style={{
                  color: "var(--text-primary)",
                  background: "rgba(63, 63, 70, 0.6)",
                  border: "1px solid var(--accent-blue)",
                  borderRadius: "3px",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "1px 4px",
                  outline: "none",
                }}
              />
            ) : (
              <span
                className="flex-1 min-w-0 truncate cursor-pointer"
                onDoubleClick={() => {
                  setEditingSubjectId(todo.id);
                  setSubjectDraft(todo.subject || displaySubject);
                }}
                style={{
                  color: todo.completed ? "var(--text-muted)" : "var(--text-primary)",
                  textDecoration: todo.completed ? "line-through" : "none",
                  fontSize: "12px",
                  fontWeight: 600,
                  userSelect: "none",
                  fontStyle: todo.subject ? "normal" : "italic",
                }}
                title="Double-click to edit subject"
              >
                {displaySubject}
              </span>
            )}
            <select
              value={spaceOptions.length === 0 ? "__loading__" : (todo.spaceId ?? "null")}
              disabled={spaceOptions.length === 0}
              onChange={(e) => {
                const val = e.target.value;
                handleMoveTodo(todo.id, val === "null" ? null : Number(val));
              }}
              className="view-mode-select"
              style={{
                fontSize: "9px",
                padding: "1px 18px 1px 4px",
                maxWidth: "140px",
                flexShrink: 0,
                opacity: spaceOptions.length === 0 ? 0.5 : 1,
              }}
              title={spaceOptions.length === 0 ? "Loading spaces…" : "Move to another space"}
            >
              {spaceOptions.length === 0 ? (
                <option value="__loading__">Loading…</option>
              ) : (
                moveOptions.map((opt) => (
                  <option key={opt.id ?? "null"} value={opt.id ?? "null"}>
                    {opt.label}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => handleDelete(todo.id)}
              className="flex-shrink-0 cursor-pointer"
              style={{
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                fontSize: "13px",
                lineHeight: 1,
                padding: "2px",
                opacity: 0.5,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.color = "#ef4444";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "0.5";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              title="Delete"
            >
              ✕
            </button>
          </div>

          {/* Body text row */}
          <div style={{ paddingLeft: "22px", marginTop: "2px" }}>
            {editingId === todo.id ? (
              <RichTextEditor
                content={editDraft}
                onUpdate={setEditDraft}
                autofocus
                placeholder="Cmd+Enter to save"
                onSubmit={() => handleUpdateText(todo.id, editDraft)}
                onCancel={() => setEditingId(null)}
                onBlur={() => handleUpdateText(todo.id, editDraft)}
              />
            ) : (
              <div
                className="cursor-pointer todo-display"
                onDoubleClick={() => {
                  setEditingId(todo.id);
                  setEditDraft(todo.text);
                }}
                style={{
                  color: todo.completed ? "var(--text-muted)" : "var(--text-secondary, var(--text-primary))",
                  textDecoration: todo.completed ? "line-through" : "none",
                  fontSize: "11px",
                  lineHeight: 1.5,
                  userSelect: "none",
                  wordBreak: "break-word",
                  opacity: 0.85,
                }}
                title="Double-click to edit"
                dangerouslySetInnerHTML={{ __html: todo.text }}
              />
            )}
          </div>
        </div>
      );
    });
  }
}
