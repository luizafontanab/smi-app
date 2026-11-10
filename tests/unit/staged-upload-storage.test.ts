import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { issueStagedUpload, memberUploads, STAGING_BUCKET, sweepStagedUploads, takeStagedUpload } from "@/lib/staged-upload";
import { ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES, MAX_DOC_BYTES, UPLOAD_EXPIRED } from "@/lib/upload-limits";

/**
 * Direct uploads against the local Supabase stack: the staging bucket
 * migration 20261016000070 made, a real signed-URL upload in the shape
 * lib/direct-upload sends from the browser, and the claim that follows.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KEY = process.env.SUPABASE_SECRET_KEY;

/** lib/direct-upload's request, from Node: PUT, x-upsert false, multipart cacheControl + metadata + the file under "". */
async function putStaged(url: string, file: File): Promise<Response> {
  const body = new FormData();
  body.append("cacheControl", "60");
  body.append("metadata", JSON.stringify({ name: file.name }));
  body.append("", file);
  return fetch(url, { method: "PUT", headers: { "x-upsert": "false", ...(ANON_KEY ? { apikey: ANON_KEY } : {}) }, body });
}

describe.skipIf(!KEY)("direct uploads (Supabase Storage)", () => {
  const admin = createClient(URL_, KEY ?? "skipped", { auth: { persistSession: false } });
  const owner = memberUploads(randomUUID());
  const leftovers: string[] = [];

  afterAll(async () => {
    if (leftovers.length) await admin.storage.from(STAGING_BUCKET).remove(leftovers);
  });

  async function stage(file: File): Promise<string> {
    const slot = await issueStagedUpload(owner, "image-or-pdf", file);
    if ("error" in slot) throw new Error(slot.error);
    leftovers.push(slot.path);
    const res = await putStaged(slot.url, file);
    if (!res.ok) throw new Error(`staging PUT ${res.status}: ${await res.text()}`);
    return slot.path;
  }

  it("the staging bucket is private and limited exactly as lib/upload-limits says", async () => {
    const { data, error } = await admin.storage.getBucket(STAGING_BUCKET);
    if (error) throw error;
    expect(data.public).toBe(false);
    expect(data.file_size_limit).toBe(MAX_DOC_BYTES);
    expect([...(data.allowed_mime_types ?? [])].sort()).toEqual([...Object.keys(ALLOWED_IMAGE_TYPES), ...Object.keys(ALLOWED_DOC_TYPES)].sort());
  });

  it("round-trips a file: signed upload from the browser's side, then claimed with its bytes and name — once", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#334155" } }).png().toBuffer();
    const path = await stage(new File([new Uint8Array(bytes)], "Plant floor — 2026.png", { type: "image/png" }));

    const file = await takeStagedUpload(path, owner);
    expect(file.name).toBe("Plant floor — 2026.png");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);

    // claimed means gone: a second save posting the same path can't reuse it
    await expect(takeStagedUpload(path, owner)).rejects.toThrow(UPLOAD_EXPIRED);
  });

  it("a signed URL fills its one path once — it can't overwrite what was staged", async () => {
    const slot = await issueStagedUpload(owner, "pdf", { size: 9, type: "application/pdf" });
    if ("error" in slot) throw new Error(slot.error);
    leftovers.push(slot.path);
    expect((await putStaged(slot.url, new File(["%PDF-1.4\n"], "a.pdf", { type: "application/pdf" }))).ok).toBe(true);
    expect((await putStaged(slot.url, new File(["%PDF-1.4\nswapped"], "b.pdf", { type: "application/pdf" }))).ok).toBe(false);
  });

  it("the bucket itself refuses a type outside the allowlists, whatever the slot was asked for as", async () => {
    const slot = await issueStagedUpload(owner, "image", { size: 20, type: "image/png" });
    if ("error" in slot) throw new Error(slot.error);
    leftovers.push(slot.path);
    const res = await putStaged(slot.url, new File(["<html><script>alert(1)</script>"], "x.html", { type: "text/html" }));
    expect(res.ok).toBe(false);
  });

  it.skipIf(!ANON_KEY)("is invisible to the anon role: no reading, listing or writing", async () => {
    const path = await stage(new File(["%PDF-1.4\n"], "private.pdf", { type: "application/pdf" }));
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.storage.from(STAGING_BUCKET).download(path)).data).toBeNull();
    expect((await anon.storage.from(STAGING_BUCKET).list(owner)).data ?? []).toEqual([]);
    const write = await anon.storage.from(STAGING_BUCKET).upload(`${owner}/${randomUUID()}.pdf`, new Blob(["%PDF-"], { type: "application/pdf" }));
    expect(write.error).not.toBeNull();
    // …and there is no public URL to fetch it from either
    expect((await fetch(`${URL_}/storage/v1/object/public/${STAGING_BUCKET}/${path}`)).ok).toBe(false);
  });

  it("the sweep lists and removes staged objects past the age limit", async () => {
    const path = await stage(new File(["%PDF-1.4\n"], "abandoned.pdf", { type: "application/pdf" }));
    const { data: listed, error } = await admin.rpc("staged_uploads_older_than", { p_before: new Date(Date.now() + 60_000).toISOString(), p_limit: 1000 });
    if (error) throw error;
    expect(listed).toContain(path);

    // A day and a minute from now, everything staged up to now is past the limit.
    const removed = await sweepStagedUploads(Date.now() + 24 * 3_600_000 + 60_000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await admin.storage.from(STAGING_BUCKET).info(path)).data).toBeNull();
  });

  it.skipIf(!ANON_KEY)("the sweep's listing is service-role only", async () => {
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("staged_uploads_older_than", { p_before: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
});
