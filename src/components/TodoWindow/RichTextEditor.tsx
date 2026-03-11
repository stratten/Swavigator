import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useCallback } from "react";

interface RichTextEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  /** If true, render as a compact inline editor (no toolbar, minimal chrome). */
  inline?: boolean;
  placeholder?: string;
  autofocus?: boolean;
  /** Called when the editor loses focus. */
  onBlur?: () => void;
  /** Called on Mod+Enter or (in inline mode) Enter without Shift. */
  onSubmit?: () => void;
  /** Called on Escape. */
  onCancel?: () => void;
}

const toolbarBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(255,255,255,0.12)" : "transparent",
  border: "none",
  color: active ? "var(--text-primary)" : "var(--text-muted)",
  cursor: "pointer",
  borderRadius: "3px",
  fontSize: "12px",
  fontWeight: active ? 700 : 400,
  lineHeight: 1,
  padding: "2px 5px",
  minWidth: "22px",
  textAlign: "center" as const,
});

export function RichTextEditor({
  content,
  onUpdate,
  inline = false,
  placeholder,
  autofocus = false,
  onBlur,
  onSubmit,
  onCancel,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
    ],
    content,
    autofocus,
    editorProps: {
      attributes: {
        class: "tiptap-content",
        style: [
          "outline: none",
          "color: var(--text-primary)",
          "font-size: 12px",
          "line-height: 1.5",
          `min-height: ${inline ? "20px" : "48px"}`,
          `max-height: ${inline ? "120px" : "160px"}`,
          "overflow-y: auto",
          `padding: ${inline ? "2px 4px" : "6px 8px"}`,
        ].join("; "),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape" && onCancel) {
          onCancel();
          return true;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmit) {
          onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      onUpdate(e.getHTML());
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  // Sync content from outside (e.g. when switching which todo is being edited).
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const handleClear = useCallback(() => {
    editor?.commands.clearContent();
  }, [editor]);

  // Expose clear for parent to call after add
  useEffect(() => {
    if (editor) {
      (editor as unknown as { _clearContent: () => void })._clearContent = handleClear;
    }
  }, [editor, handleClear]);

  if (!editor) return null;

  if (inline) {
    return (
      <div
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid var(--accent-blue)",
          borderRadius: "3px",
          flex: 1,
          minWidth: 0,
        }}
      >
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid var(--panel-border)",
        borderRadius: "4px",
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* Formatting toolbar -- preventDefault stops buttons from stealing editor focus */}
      <div
        className="flex items-center gap-0.5"
        onMouseDown={(e) => e.preventDefault()}
        style={{
          padding: "3px 4px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          style={toolbarBtnStyle(editor.isActive("bold"))}
          title="Bold (Cmd+B)"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          style={{ ...toolbarBtnStyle(editor.isActive("italic")), fontStyle: "italic" }}
          title="Italic (Cmd+I)"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          style={{ ...toolbarBtnStyle(editor.isActive("strike")), textDecoration: "line-through" }}
          title="Strikethrough"
        >
          S
        </button>
        <span style={{ width: "1px", height: "14px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          style={toolbarBtnStyle(editor.isActive("bulletList"))}
          title="Bullet list"
        >
          •&thinsp;list
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          style={toolbarBtnStyle(editor.isActive("orderedList"))}
          title="Numbered list"
        >
          1.&thinsp;list
        </button>
        {placeholder && editor.isEmpty && (
          <span style={{ flex: 1, textAlign: "right", color: "var(--text-muted)", fontSize: "10px", opacity: 0.6, paddingRight: "4px" }}>
            {placeholder}
          </span>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
