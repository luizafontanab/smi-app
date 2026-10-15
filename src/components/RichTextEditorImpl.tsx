"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, Node, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Image as TiptapImage } from "@tiptap/extension-image";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Spinner } from "@/components/Spinner";
import { stageUpload, uploadErrorMessage } from "@/lib/direct-upload";
import { beginUpload, endUpload, useHoldSubmit } from "@/lib/upload-pending";
import { imageUploadProblem, type UploadResult } from "@/lib/upload-limits";
import { DEFAULT_FLOAT_SIZE, isImageAlign, isImageSize, type ImageAlign, type ImageSize } from "@/lib/image-layout";
// Where a story image may come from — the same prefix lib/sanitize admits on
// save and on render (sanitize-html itself stays out of this bundle).
import { MEDIA_PREFIX } from "@/lib/media-prefix";

/**
 * The advert break: a marker splitting the published article so a rotating slot
 * can sit in the gap (lib/sanitize splitAtAdBreaks). It deliberately carries no
 * attributes — which advert lands here is the rotation's business, and giving
 * the marker settings would be the positional-value mechanism the advert engine
 * forbids. StarterKit's own horizontalRule stays off so a bare <hr>, which the
 * sanitiser drops, can never be authored by accident.
 */
const AdBreak = Node.create({
  name: "adBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr[data-ad-break]" }],
  renderHTML: () => ["hr", { "data-ad-break": "" }],
});

/**
 * Image with the two layout attributes (lib/image-layout): data-align floats it
 * left/right with the text wrapping round it, or spans the column; data-size
 * sets a floated image's share of the column. Unknown values parse to null, so
 * pasted markup can't smuggle anything past what the sanitiser admits anyway.
 */
const StoryImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-align");
          return isImageAlign(v) ? v : null;
        },
        renderHTML: (attrs) => (attrs.align ? { "data-align": attrs.align } : {}),
      },
      size: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-size");
          return isImageSize(v) ? v : null;
        },
        renderHTML: (attrs) => (attrs.size ? { "data-size": attrs.size } : {}),
      },
    };
  },
});

/**
 * Pasted or dropped HTML minus every image the sanitiser would drop — another
 * site's <img src="https://…">, a data: URI out of Word. They used to appear
 * in the editor and then vanish silently on save; taken out at the paste
 * instead, so the author is told while they can still upload them.
 */
function withoutForeignImages(html: string): { html: string; removed: number } {
  if (!/<img\b/i.test(html)) return { html, removed: 0 };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const foreign = [...doc.querySelectorAll("img")].filter((img) => !(img.getAttribute("src") ?? "").startsWith(MEDIA_PREFIX));
  // <picture> wrappers go with their image, or their <source>s are left behind
  for (const img of foreign) (img.closest("picture") ?? img).remove();
  return foreign.length ? { html: doc.body.innerHTML, removed: foreign.length } : { html, removed: 0 };
}

/**
 * The files in a paste or drop that is only files — a screenshot, "Copy
 * image" in a browser, a photo dragged in from the desktop. Empty when the
 * clipboard also carries text: Word and most apps put a picture of the
 * copied selection alongside it, and a text paste must stay a text paste.
 * HTML holding nothing but images ("Copy image" puts the <img> there too)
 * counts as no text.
 */
function filesOnly(data: DataTransfer | null): File[] {
  const files = Array.from(data?.files ?? []);
  if (!data || !files.length) return [];
  const html = data.getData("text/html");
  const text = html ? new DOMParser().parseFromString(html, "text/html").body.textContent ?? "" : data.getData("text/plain");
  return text.trim() ? [] : files;
}

const FOREIGN_IMAGE_NOTICE = (n: number) =>
  `${n === 1 ? "A pasted image was" : `${n} pasted images were`} left out — images can't be copied in from other pages or documents. Save the picture to your device and add it with the Image button.`;

const ALIGN_LABELS: Record<ImageAlign, string> = { left: "Left", right: "Right", full: "Full width" };
const SIZE_LABELS: Record<ImageSize, string> = { small: "Small", medium: "Medium", large: "Large" };

type Props = {
  name: string;
  initialHtml?: string;
  /** Server action: takes FormData with "file", returns { url } or { error }. */
  uploadImage?: (formData: FormData) => Promise<UploadResult>;
  /** Console-only: members self-posting should not be placing advert inventory. */
  allowAdBreak?: boolean;
  minHeightClass?: string;
  /** Accessible name for the editing surface — pass the visible caption text. */
  ariaLabel: string;
};

function ToolbarButton({ label, title, active, pressed, onRun, disabled }: {
  label: string; title: string; active?: boolean; pressed?: boolean; onRun: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* keep editor selection/focus */}
      onClick={onRun}
      className={`rounded px-2 py-1 text-sm ${active ? "bg-ink text-white" : "bg-shade text-ink hover:bg-line"} disabled:opacity-40`}
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
export function RichTextEditor({ name, initialHtml = "", uploadImage, allowAdBreak = false, minHeightClass = "min-h-48", ariaLabel }: Props) {
  const [html, setHtml] = useState(initialHtml);
  const [uploading, setUploading] = useState(0);
  /** Fraction sent of the latest image — shown while it is the only one in flight. */
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Paste and drop handlers are fixed when the editor is created; they reach
  // the current insertImage (which closes over this render's editor) via this.
  const insertRef = useRef<(file: File) => Promise<void>>(async () => {});
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
      ...(uploadImage ? [StoryImage] : []),
      ...(allowAdBreak ? [AdBreak] : []),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: `story-body ${minHeightClass} w-full rounded-b border border-t-0 px-3 py-2 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-ink`,
        // The editing surface is a contenteditable, not a form control, so a
        // <label htmlFor> cannot reach it — callers pass their visible caption
        // here so it still has an accessible name. role=textbox is required
        // for aria-label to be permitted on the div (axe aria-prohibited-attr).
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
      },
      // Paste and drop both come through here (ProseMirror parseFromClipboard).
      // Only where images exist at all: without the Image extension the schema
      // already drops every <img>, and there is no Image button to point to.
      ...(uploadImage
        ? {
            transformPastedHTML: (pasted: string) => {
              const { html: kept, removed } = withoutForeignImages(pasted);
              if (removed) setUploadError(FOREIGN_IMAGE_NOTICE(removed));
              return kept;
            },
            // A pasted or dropped image file (no text with it) goes up the
            // same way as one chosen with the Image button. Taken here, ahead
            // of ProseMirror's own handling, because that parses the HTML
            // first — and "Copy image" HTML is a foreign <img>, which would
            // raise FOREIGN_IMAGE_NOTICE for a picture that is about to be
            // uploaded after all.
            handleDOMEvents: {
              paste: (_view: EditorView, event: ClipboardEvent) => takeFiles(event, filesOnly(event.clipboardData)),
              drop: (view: EditorView, event: DragEvent) => {
                const files = filesOnly(event.dataTransfer);
                if (!files.length) return false;
                // Land where it was dropped, not wherever the cursor last was.
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
                return takeFiles(event, files);
              },
            },
          }
        : {}),
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
    // Same rules the server enforces, checked here first: an oversized phone
    // photo should fail in a blink, not after uploading 12MB to be told no.
    const problem = imageUploadProblem(file);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploadError(null);
    setProgress(null);
    setUploading((n) => n + 1);
    beginUpload();
    try {
      // The bytes go straight to Storage (lib/direct-upload), past Vercel's
      // 4.5MB request cap; the action gets the staged path, checks the bytes
      // and stores the image as it always has.
      const path = await stageUpload(file, "image", { onProgress: setProgress });
      const fd = new FormData();
      fd.set("file", path);
      const result = await uploadImage(fd);
      if ("url" in result) editor.chain().focus().setImage({ src: result.url }).run();
      else setUploadError(result.error);
    } catch (e) {
      // stageUpload's own wording, or a transport failure of the action —
      // which never throws for a refused file.
      setUploadError(uploadErrorMessage(e, "image"));
    } finally {
      setUploading((n) => n - 1);
      endUpload();
    }
  };
  useEffect(() => {
    insertRef.current = insertImage;
  });

  /** Upload `files` in turn, if there are any; true (and the browser's own handling stopped) when this took the event. */
  function takeFiles(event: Event, files: File[]): boolean {
    if (!files.length) return false;
    event.preventDefault();
    void (async () => {
      for (const file of files) await insertRef.current(file);
    })();
    return true;
  }

  // While an image is in flight the hidden body field doesn't contain it yet,
  // so a save now would silently drop the picture.
  const holdSave = useCallback(() => setUploadError("Wait for the image to finish uploading, then save."), []);
  useHoldSubmit(rootRef, uploading > 0, holdSave);

  // Selecting an image is a selection change, not a doc change, so onUpdate
  // never re-renders for it — subscribe to exactly the bits the image row needs.
  const imageSel = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e?.isActive("image")
        ? { align: (e.getAttributes("image").align ?? null) as ImageAlign | null, size: (e.getAttributes("image").size ?? null) as ImageSize | null }
        : null,
  });

  if (!editor) {
    return <div className={`mt-1 ${minHeightClass} w-full animate-pulse rounded border bg-shade`} />;
  }

  // Choosing the alignment already set clears it back to a plain inline image.
  // A float always needs a width, so one without a size gets the default.
  const setAlign = (align: ImageAlign) => {
    const clear = imageSel?.align === align;
    const size = clear || align === "full" ? null : imageSel?.size ?? DEFAULT_FLOAT_SIZE;
    editor.chain().focus().updateAttributes("image", { align: clear ? null : align, size }).run();
  };
  const setSize = (size: ImageSize) => editor.chain().focus().updateAttributes("image", { size }).run();
  const floated = imageSel?.align === "left" || imageSel?.align === "right";

  return (
    <div ref={rootRef} className="mt-1">
      <div className="flex flex-wrap gap-1 rounded-t border bg-shade p-1.5">
        <ToolbarButton label="B" title="Bold" active={editor.isActive("bold")} onRun={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton label="I" title="Italic" active={editor.isActive("italic")} onRun={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton label="H2" title="Heading" active={editor.isActive("heading", { level: 2 })} onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton label="H3" title="Subheading" active={editor.isActive("heading", { level: 3 })} onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolbarButton label="• List" title="Bullet list" active={editor.isActive("bulletList")} onRun={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton label="1. List" title="Numbered list" active={editor.isActive("orderedList")} onRun={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton label="❝" title="Quote" active={editor.isActive("blockquote")} onRun={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolbarButton label="Link" title="Add link" active={editor.isActive("link")} onRun={setLink} />
        {uploadImage && (
          <ToolbarButton label="Image" title="Insert image" disabled={uploading > 0} onRun={() => fileRef.current?.click()} />
        )}
        {allowAdBreak && (
          <ToolbarButton
            label="⊞ Ad break"
            title="Split the article here for a rotating advert"
            onRun={() => editor.chain().focus().insertContent({ type: "adBreak" }).run()}
          />
        )}
        <ToolbarButton label="↺" title="Undo" disabled={!editor.can().undo()} onRun={() => editor.chain().focus().undo().run()} />
      </div>
      {imageSel && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-t-0 bg-paper px-1.5 py-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-graphite">Image</span>
          <div role="group" aria-label="Image position" className="flex gap-1">
            {(Object.keys(ALIGN_LABELS) as ImageAlign[]).map((a) => (
              <ToolbarButton key={a} label={ALIGN_LABELS[a]} title={`Image: ${ALIGN_LABELS[a].toLowerCase()}`} active={imageSel.align === a} pressed={imageSel.align === a} onRun={() => setAlign(a)} />
            ))}
          </div>
          <div role="group" aria-label="Image size" className="flex gap-1">
            {(Object.keys(SIZE_LABELS) as ImageSize[]).map((z) => (
              <ToolbarButton key={z} label={SIZE_LABELS[z]} title={floated ? `Image size: ${SIZE_LABELS[z].toLowerCase()}` : "Choose Left or Right to size the image"} active={floated && imageSel.size === z} pressed={floated && imageSel.size === z} disabled={!floated} onRun={() => setSize(z)} />
            ))}
          </div>
          <span className="text-xs text-graphite">Text wraps beside left/right images on larger screens; on phones each image sits on its own line.</span>
        </div>
      )}
      <EditorContent editor={editor} />
      {uploadImage && (
        <>
          {/* Always mounted, so the status is announced when it fills. */}
          <p role="status" className="mt-1 flex items-center gap-2 text-sm text-graphite empty:mt-0">
            {uploading > 0 && (
              <>
                <Spinner />
                Uploading image…
                {/* Not announced: a screen reader re-reading every percent is noise. */}
                {uploading === 1 && progress !== null && <span aria-hidden="true">{Math.round(progress * 100)}%</span>}
              </>
            )}
          </p>
          {uploadError && (
            <p role="alert" className="rounded bg-danger/10 p-2 text-sm text-danger">
              {uploadError}
            </p>
          )}
        </>
      )}
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
