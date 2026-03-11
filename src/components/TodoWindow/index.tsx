import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import type { TodoItem } from "../../lib/types";
import { RichTextEditor } from "./RichTextEditor";

const UNASSIGNED_SPACE_ID = 0;

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

interface SpaceTodoSection {
  spaceId: number;
  label: string;
  todos: TodoItem[];
  collapsed: boolean;
}

interface SpaceOption {
  id: number;
  label: string;
}

export function TodoWindow() {
  const { spaceId, spaceName } = getParams();
  const isOverview = spaceId === null;

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [sections, setSections] = useState<SpaceTodoSection[]>([]);
  const [newHtml, setNewHtml] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const addEditorKeyRef = useRef(0);

  // Available spaces for the move-to dropdown (overview mode only).
  const [spaceOptions, setSpaceOptions] = useState<SpaceOption[]>([]);

  const loadSpaceOptions = useCallback(async () => {
    if (!isOverview) return;
    try {
      const state: { spaces: { spaceId: number; label: string; spaceIndex: number }[] } =
        await invoke("get_space_state");
      const opts: SpaceOption[] = state.spaces.map((s) => ({
        id: s.spaceId,
        label: s.label || `Desktop ${s.spaceIndex}`,
      }));
      setSpaceOptions(opts);
    } catch {
      // Silently ignore — non-critical
    }
  }, [isOverview]);

  const loadTodos = useCallback(async () => {
    if (isOverview) {
      const allTodos: Record<string, TodoItem[]> = await invoke("get_all_space_todos");
      let spaceState: { spaces: { spaceId: number; label: string; spaceIndex: number }[] } | null = null;
      try {
        spaceState = await invoke("get_space_state");
      } catch { /* ignore */ }

      const secs: SpaceTodoSection[] = [];
      for (const [id, items] of Object.entries(allTodos)) {
        if (items.length === 0) continue;
        const numId = Number(id);
        if (numId === UNASSIGNED_SPACE_ID) {
          secs.push({ spaceId: UNASSIGNED_SPACE_ID, label: "Unassigned", todos: items, collapsed: false });
        } else {
          const spaceInfo = spaceState?.spaces.find((s) => s.spaceId === numId);
          const label = spaceInfo?.label || `Space ${spaceInfo?.spaceIndex ?? id}`;
          secs.push({ spaceId: numId, label, todos: items, collapsed: false });
        }
      }
      // Sort: Unassigned first, then alphabetical by label.
      secs.sort((a, b) => {
        if (a.spaceId === UNASSIGNED_SPACE_ID) return -1;
        if (b.spaceId === UNASSIGNED_SPACE_ID) return 1;
        return a.label.localeCompare(b.label);
      });
      setSections(secs);
    } else {
      const items: TodoItem[] = await invoke("get_space_todos", { spaceId });
      setTodos(items);
    }
    setLoaded(true);
  }, [isOverview, spaceId]);

  useEffect(() => {
    loadTodos();
    loadSpaceOptions();
  }, [loadTodos, loadSpaceOptions]);

  useEffect(() => {
    const unlisten = listen("todos-changed", () => {
      loadTodos();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadTodos]);

  const notifyChange = useCallback(() => {
    emit("todos-changed");
  }, []);

  const handleAdd = useCallback(async (targetSpaceId?: number) => {
    if (isHtmlEmpty(newHtml)) return;
    const sid = targetSpaceId ?? spaceId ?? UNASSIGNED_SPACE_ID;
    await invoke("add_space_todo", { spaceId: sid, text: newHtml });
    setNewHtml("");
    addEditorKeyRef.current += 1;
    await loadTodos();
    notifyChange();
  }, [newHtml, spaceId, loadTodos, notifyChange]);

  const handleToggle = useCallback(async (sid: number, todoId: string) => {
    await invoke("toggle_space_todo", { spaceId: sid, todoId });
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleDelete = useCallback(async (sid: number, todoId: string) => {
    await invoke("delete_space_todo", { spaceId: sid, todoId });
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleUpdateText = useCallback(async (sid: number, todoId: string, html: string) => {
    if (isHtmlEmpty(html)) return;
    await invoke("update_space_todo_text", { spaceId: sid, todoId, text: html });
    setEditingId(null);
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleMoveTodo = useCallback(async (fromSpaceId: number, toSpaceId: number, todoId: string) => {
    if (fromSpaceId === toSpaceId) return;
    await invoke("move_space_todo", { fromSpaceId, toSpaceId, todoId });
    await loadTodos();
    notifyChange();
  }, [loadTodos, notifyChange]);

  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  const toggleSectionCollapsed = useCallback((sectionSpaceId: number) => {
    setSections((prev) =>
      prev.map((s) =>
        s.spaceId === sectionSpaceId ? { ...s, collapsed: !s.collapsed } : s,
      ),
    );
  }, []);

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

  const incompleteSingle = todos.filter((t) => !t.completed).length;
  const completeSingle = todos.filter((t) => t.completed).length;

  // Build dropdown options: "Unassigned" + active spaces.
  const moveOptions: SpaceOption[] = [
    { id: UNASSIGNED_SPACE_ID, label: "Unassigned" },
    ...spaceOptions,
  ];

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
        {isOverview ? (
          sections.length === 0 ? (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: "var(--text-muted)", fontSize: "12px" }}
            >
              No to-dos yet. Add one below.
            </div>
          ) : (
            sections.map((section) => {
              const incomplete = section.todos.filter((t) => !t.completed).length;
              return (
                <div key={section.spaceId} style={{ marginBottom: "12px" }}>
                  <button
                    onClick={() => toggleSectionCollapsed(section.spaceId)}
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
                      {renderTodoList(section.todos, section.spaceId)}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          <>
            {todos.length === 0 && (
              <div
                className="flex items-center justify-center"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  padding: "24px 0",
                }}
              >
                No to-dos yet. Add one below.
              </div>
            )}
            {todos.length > 0 && (
              <div style={{ marginBottom: "4px" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                  {incompleteSingle} remaining · {completeSingle} done
                </span>
              </div>
            )}
            {renderTodoList(todos, spaceId!)}
          </>
        )}
      </div>

      {/* Add editor — shown in both per-space and overview mode */}
      <div
        className="flex-shrink-0 flex flex-col gap-2"
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--panel-border)",
        }}
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
    </div>
  );

  function renderTodoList(items: TodoItem[], sid: number) {
    return items.map((todo) => (
      <div
        key={todo.id}
        className="flex items-start gap-2"
        style={{
          padding: "4px 0",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={() => handleToggle(sid, todo.id)}
          style={{
            accentColor: "var(--accent-blue)",
            cursor: "pointer",
            flexShrink: 0,
            marginTop: "3px",
          }}
        />
        <div className="flex-1 min-w-0">
          {editingId === todo.id ? (
            <RichTextEditor
              content={editDraft}
              onUpdate={setEditDraft}
              autofocus
              placeholder="Cmd+Enter to save"
              onSubmit={() => handleUpdateText(sid, todo.id, editDraft)}
              onCancel={() => setEditingId(null)}
              onBlur={() => handleUpdateText(sid, todo.id, editDraft)}
            />
          ) : (
            <div
              className="cursor-pointer todo-display"
              onDoubleClick={() => {
                setEditingId(todo.id);
                setEditDraft(todo.text);
              }}
              style={{
                color: todo.completed ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: todo.completed ? "line-through" : "none",
                fontSize: "12px",
                lineHeight: 1.5,
                userSelect: "none",
                wordBreak: "break-word",
              }}
              title="Double-click to edit"
              dangerouslySetInnerHTML={{ __html: todo.text }}
            />
          )}
          {/* Space assignment dropdown (overview mode only) */}
          {isOverview && moveOptions.length > 1 && (
            <select
              value={sid}
              onChange={(e) => handleMoveTodo(sid, Number(e.target.value), todo.id)}
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "var(--text-muted)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "3px",
                fontSize: "9px",
                padding: "1px 4px",
                marginTop: "2px",
                cursor: "pointer",
                maxWidth: "140px",
              }}
              title="Move to another space"
            >
              {moveOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => handleDelete(sid, todo.id)}
          className="flex-shrink-0 cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            fontSize: "13px",
            lineHeight: 1,
            padding: "2px",
            opacity: 0.5,
            marginTop: "2px",
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
    ));
  }
}
