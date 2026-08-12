import { serviceDb } from "@/lib/db/server";

/** Upload an image to the public media bucket. Returns the storage path. */
export async function uploadImage(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error("Image too large (8MB max)");
  const db = serviceDb();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().slice(0, 4);
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}
