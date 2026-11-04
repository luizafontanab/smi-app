"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FOCUS, type Focus } from "@/lib/focus";
import { FocusPicker } from "./FocusPicker";
import { RequiredMark } from "./RequiredMark";
import { FILE_BUTTON, UploadStatus, useStagedUpload } from "./UploadField";

/**
 * Cover image field: file input + crop picker, sharing one preview.
 *
 * The picker needs a URL, so before this existed it could only render for a
 * cover that had already been saved — an admin could not crop the image they
 * were in the middle of uploading, and on the console form there was no upload
 * at all (GAPS A1.1/A1.2). Here the just-chosen file previews through an object
 * URL, so the crop is live on the first upload.
 *
 * The chosen file is also downscaled and re-encoded in the browser before it
 * ever leaves it — see compress() — and then sent straight to Storage like
 * any other file field (UploadField's useStagedUpload). uploadImage's 8MB cap
 * stays as the backstop.
 */

/** Long edge, in px. Twice the widest slot the cover is ever rendered into. */
const MAX_EDGE = 2000;
/** Below this, a re-encode is unlikely to pay for its own quality loss. */
const COMPRESS_OVER_BYTES = 500 * 1024;

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

/**
 * Downscale to MAX_EDGE and re-encode as WebP. Returns the original whenever
 * that is the better answer: an animated GIF (a re-encode would freeze it), a
 * canvas/codec the browser won't give us, or a result no smaller than the
 * source. Never throws — a failed optimisation must not block the upload.
 */
async function compress(file: File): Promise<{ file: File; note: string | null }> {
  if (file.type === "image/gif") return { file, note: null };
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (ratio === 1 && file.size <= COMPRESS_OVER_BYTES) {
      bitmap.close();
      return { file, note: null };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { file, note: null };
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encode = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // Safari < 14 has no WebP encoder and silently hands back a PNG, which is
    // far bigger than the source for a photo — hence the type check, not just
    // a null check, before falling back to JPEG.
    let blob = await encode("image/webp", 0.82);
    let ext = "webp";
    if (blob?.type !== "image/webp") {
      blob = await encode("image/jpeg", 0.85);
      ext = "jpg";
    }
    if (!blob || blob.size >= file.size) return { file, note: null };

    const name = `${file.name.replace(/\.[^.]+$/, "")}.${ext}`;
    return {
      file: new File([blob], name, { type: blob.type }),
      note: `Optimised: ${canvas.width}×${canvas.height}, ${kb(file.size)} → ${kb(blob.size)}.`,
    };
  } catch {
    return { file, note: null };
  }
}

type Props = {
  /** Public URL of the saved cover, if there is one. */
  cover?: string | null;
  /** Saved crop for that cover; centred/no-zoom for a new story. */
  focus?: Focus;
  /** Lets a parent mirror the preview (the member form's Preview tab). */
  onPreview?: (url: string | null) => void;
  label?: string;
  hint?: string;
  /** Only enforced while there's no cover already on file — a resubmit that keeps its existing one isn't blocked. */
  required?: boolean;
};

export function CoverField({
  cover = null,
  focus = DEFAULT_FOCUS,
  onPreview,
  label = "Cover image",
  hint = "Landscape works best: at least 1200×675px (16:9), JPG/PNG/WebP, max 8MB. Keep faces and key detail near the centre.",
  required = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const setPreview = (url: string | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = url;
    setChosen(url);
    onPreview?.(url);
  };

  // The smaller file is what gets sent, so the upload is quicker too. Without
  // JavaScript none of this runs and the original posts with the form.
  const prepare = useCallback(async (file: File) => {
    setNote("Optimising…");
    const result = await compress(file);
    setNote(result.note);
    return result.file;
  }, []);
  // Refused or never arrived: the input has been emptied, so the preview of
  // it goes too — a crop picker over a picture that won't be saved misleads.
  const upload = useStagedUpload({
    inputRef,
    name: "cover",
    kind: "image",
    prepare,
    onFailed: () => {
      setPreview(null);
      setNote(null);
    },
  });

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPreview(file ? URL.createObjectURL(file) : null);
    if (!file) setNote(null);
    upload.choose(file);
  };

  const preview = chosen ?? cover;

  return (
    <div>
      <label htmlFor="cover" className="block text-sm font-medium">
        {label}{required && !cover && <RequiredMark />}
      </label>
      <input
        ref={inputRef}
        id="cover"
        type="file"
        name={upload.enhanced ? undefined : "cover"}
        required={required && !cover}
        accept="image/jpeg,image/png,image/webp"
        onChange={onChange}
        className={`${FILE_BUTTON} mt-1 w-full text-sm`}
      />
      <UploadStatus name="cover" upload={upload} />
      <p className="mt-1 text-xs text-graphite">{hint}</p>
      {note && <p className="mt-1 text-xs text-graphite">{note}</p>}
      {preview && (
        <>
          <p className="mt-3 text-sm font-medium" id="focus-picker-label">Crop focus (click to set the focal point, slide to zoom)</p>
          {/* Remount on a new image — and start a newly chosen one centred,
              since the saved crop was framed against the old picture. */}
          <FocusPicker key={preview} src={preview} initial={chosen ? DEFAULT_FOCUS : focus} />
        </>
      )}
    </div>
  );
}
