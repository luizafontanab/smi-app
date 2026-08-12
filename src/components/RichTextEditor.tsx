"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Image as TiptapImage } from "@tiptap/extension-image";

type Props = {
  name: string;
  initialHtml?: string;
  /** Server action: takes FormData with "file", returns the public URL (or null). */
  uploadImage?: (formData: FormData) => Promise<string | null>;
  minHeightClass?: string;
};

function ToolbarButton({ label, title, active, onRun, disabled }: {
  label: string; title: string; active?: boolean; onRun: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* keep editor selection/focus */}
      onClick={onRun}
      className={`rounded px-2 py-1 text-sm ${active ? "bg-navy text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"} disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

/**
 * WYSIWYG editor emitting the sanctioned .story-body vocabulary as HTML.
 * Serialises into a hidden input so plain server-action forms keep working
 * (same pattern as FocusPicker).
 */
export function RichTextEditor({ name, initialHtml = "", uploadImage, minHeightClass = "min-h-48" }: Props) {
  const [html, setHtml] = useState(initialHtml);
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false },
      }),
      ...(uploadImage ? [TiptapImage] : []),
    ],
    content: initialHtml,
    editorProps: {
      attributes: { class: `story-body ${minHeightClass} w-full rounded-b border border-t-0 px-3 py-2 focus:outline-none` },
    },
    onUpdate: ({ editor }) => setHtml(editor.isEmpty ? "" : editor.getHTML()),
  });

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertImage = async (file: File | null) => {
    if (!file || !editor || !uploadImage) return;
    const fd = new FormData();
    fd.set("file", file);
    const url = await uploadImage(fd);
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  if (!editor) {
    return <div className={`mt-1 ${minHeightClass} w-full animate-pulse rounded border bg-gray-50`} />;
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1 rounded-t border bg-gray-50 p-1.5">
        <ToolbarButton label="B" title="Bold" active={editor.isActive("bold")} onRun={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton label="I" title="Italic" active={editor.isActive("italic")} onRun={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton label="H2" title="Heading" active={editor.isActive("heading", { level: 2 })} onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton label="H3" title="Subheading" active={editor.isActive("heading", { level: 3 })} onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolbarButton label="• List" title="Bullet list" active={editor.isActive("bulletList")} onRun={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton label="1. List" title="Numbered list" active={editor.isActive("orderedList")} onRun={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton label="❝" title="Quote" active={editor.isActive("blockquote")} onRun={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolbarButton label="Link" title="Add link" active={editor.isActive("link")} onRun={setLink} />
        {uploadImage && (
          <ToolbarButton label="Image" title="Insert image" onRun={() => fileRef.current?.click()} />
        )}
        <ToolbarButton label="↺" title="Undo" disabled={!editor.can().undo()} onRun={() => editor.chain().focus().undo().run()} />
      </div>
      <EditorContent editor={editor} />
      {uploadImage && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => { void insertImage(e.target.files?.[0] ?? null); e.target.value = ""; }}
        />
      )}
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
