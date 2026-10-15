import { mediaUrl } from "@/lib/db/server";
import { uploadImage } from "@/lib/media";
import type { UploadResult } from "@/lib/upload-limits";

/**
 * The body of every rich-text editor's image-upload action: store the file,
 * hand back its public URL — or the reason it was refused, as a value. The
 * actions call their auth guard *before* this, outside any try, so an auth
 * redirect still propagates as a redirect rather than being caught here.
 */
export async function editorImageUpload(file: FormDataEntryValue | null, prefix: string): Promise<UploadResult> {
  try {
    const url = mediaUrl(await uploadImage(file as File | null, prefix));
    return url ? { url } : { error: "No image was received — try choosing it again." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed — try again." };
  }
}
