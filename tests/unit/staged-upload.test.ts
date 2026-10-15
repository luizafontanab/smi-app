import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { serviceDb } from "@/lib/db/server";
import { uploadImage } from "@/lib/media";
import {
  CONSOLE_UPLOADS, hasSubmittedFile, isStagedPathFor, issueStagedUpload, memberUploads, STAGING_BUCKET, submittedFile,
  takeStagedUpload, uploadOwnerFor,
} from "@/lib/staged-upload";
import { IMAGE_TOO_LARGE, MAX_DOC_BYTES, UPLOAD_EXPIRED, UPLOAD_FAILED, UploadRejectedError } from "@/lib/upload-limits";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  logError.mockReset();
  vi.restoreAllMocks();
});

const MEMBER = "6f1c2a4e-1111-4222-8333-444455556666";
const OTHER = "0b9e8d7c-aaaa-4bbb-8ccc-ddddeeeeffff";
const NAME = "3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const mine = `members/${MEMBER}/${NAME}.png`;

/**
 * The storage surface staged-upload touches, per bucket: the staging bucket's
 * signed-URL/info/download/remove, and the media bucket's upload (reached
 * when a staged file goes on through uploadImage).
 */
function stubStorage(staging: Partial<Record<"createSignedUploadUrl" | "info" | "download" | "remove", ReturnType<typeof vi.fn>>> = {}) {
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => dbOk({ signedUrl: `http://127.0.0.1:56321/storage/v1/object/upload/sign/${STAGING_BUCKET}/${path}?token=t`, path, token: "t" })),
    info: vi.fn(async () => dbError("Object not found", { status: 400, statusCode: "404" })),
    download: vi.fn(async () => dbError("Object not found", { status: 400, statusCode: "404" })),
    remove: vi.fn(async () => dbOk([])),
    ...staging,
  };
  const media = { upload: vi.fn(async () => dbOk(null)), remove: vi.fn(async () => dbOk(null)) };
  const storageFrom = vi.fn((name: string) => (name === STAGING_BUCKET ? bucket : media));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)), storage: { from: storageFrom } })));
  return { bucket, media, storageFrom };
}

/** A staged object as the storage API reports and returns it. */
function staged(bytes: Uint8Array, contentType: string, name = "holiday.png") {
  return {
    info: vi.fn(async () => dbOk({ size: bytes.length, contentType, metadata: { name } })),
    download: vi.fn(async () => dbOk(new Blob([bytes as BlobPart], { type: contentType }))),
  };
}

const png = async () => new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#e30613" } }).png().toBuffer());

describe("uploadOwnerFor", () => {
  it("is the console for an admin, the member's own prefix for a member, and nothing for anyone else", () => {
    const base = { userId: "u", email: "e", displayName: null };
    expect(uploadOwnerFor({ ...base, role: "admin", memberId: null })).toBe("console");
    expect(uploadOwnerFor({ ...base, role: "member", memberId: MEMBER })).toBe(`members/${MEMBER}`);
    expect(uploadOwnerFor({ ...base, role: "member", memberId: null })).toBeNull();
    expect(uploadOwnerFor(null)).toBeNull();
  });
});

describe("isStagedPathFor", () => {
  it("accepts only a random name directly under the owner's own prefix", () => {
    expect(isStagedPathFor(mine, memberUploads(MEMBER))).toBe(true);
    expect(isStagedPathFor(`console/${NAME}.pdf`, CONSOLE_UPLOADS)).toBe(true);
  });

  it.each([
    ["another member's upload", `members/${OTHER}/${NAME}.png`],
    ["a console upload", `console/${NAME}.png`],
    ["a path climbing out of the prefix", `members/${MEMBER}/../${OTHER}/${NAME}.png`],
    ["a deeper folder", `members/${MEMBER}/x/${NAME}.png`],
    ["a name the server never issues", `members/${MEMBER}/cover.png`],
    ["an extension outside the allowlists", `members/${MEMBER}/${NAME}.html`],
    ["a final media path", `stories/${MEMBER}/abc.jpg`],
  ])("refuses %s", (_label, path) => {
    expect(isStagedPathFor(path, memberUploads(MEMBER))).toBe(false);
  });

  it("doesn't let one member's prefix match another's that starts the same", () => {
    expect(isStagedPathFor(`members/${MEMBER}x/${NAME}.png`, memberUploads(MEMBER))).toBe(false);
  });
});

describe("issueStagedUpload", () => {
  it("signs a fresh random path under the owner's prefix, named for the declared type", async () => {
    const { bucket, storageFrom } = stubStorage();
    const slot = await issueStagedUpload(memberUploads(MEMBER), "image", { size: 5_000_000, type: "image/webp" });

    expect(storageFrom).toHaveBeenCalledWith(STAGING_BUCKET);
    if (!("path" in slot)) throw new Error(slot.error);
    expect(isStagedPathFor(slot.path, memberUploads(MEMBER))).toBe(true);
    expect(slot.path).toMatch(/\.webp$/);
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(slot.path);
    expect(slot.url).toContain(slot.path);
    // never the same path twice
    const again = await issueStagedUpload(memberUploads(MEMBER), "image", { size: 1, type: "image/webp" });
    expect("path" in again && again.path).not.toBe(slot.path);
  });

  it("refuses what the form wouldn't take, in our words, without asking Storage", async () => {
    const { bucket } = stubStorage();
    expect(await issueStagedUpload(CONSOLE_UPLOADS, "image", { size: 9 * 1024 * 1024, type: "image/jpeg" })).toEqual({ error: IMAGE_TOO_LARGE });
    expect(await issueStagedUpload(CONSOLE_UPLOADS, "image", { size: 10, type: "text/html" })).toEqual({ error: expect.stringMatching(/^Images only/) });
    expect(await issueStagedUpload(CONSOLE_UPLOADS, "pdf", { size: 10, type: "image/png" })).toEqual({ error: "PDF only." });
    expect(await issueStagedUpload(CONSOLE_UPLOADS, "pdf", { size: MAX_DOC_BYTES + 1, type: "application/pdf" })).toEqual({ error: "File too large (20MB max)" });
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("takes a 15MB PDF — the size the old path could never carry — and decides image-or-pdf by type", async () => {
    stubStorage();
    const pdf = await issueStagedUpload(CONSOLE_UPLOADS, "image-or-pdf", { size: 15 * 1024 * 1024, type: "application/pdf" });
    expect("path" in pdf && pdf.path).toMatch(/^console\/.+\.pdf$/);
    expect(await issueStagedUpload(CONSOLE_UPLOADS, "image-or-pdf", { size: 15 * 1024 * 1024, type: "image/png" })).toEqual({ error: IMAGE_TOO_LARGE });
  });

  it("logs a storage failure and says only the generic line", async () => {
    stubStorage({ createSignedUploadUrl: vi.fn(async () => dbError("bucket upload-staging not found")) });
    const slot = await issueStagedUpload(CONSOLE_UPLOADS, "image", { size: 10, type: "image/png" });
    expect(slot).toEqual({ error: UPLOAD_FAILED });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "upload:staging-slot" }));
  });
});

describe("takeStagedUpload", () => {
  it("refuses another member's path before touching Storage", async () => {
    const { bucket } = stubStorage();
    await expect(takeStagedUpload(`members/${OTHER}/${NAME}.png`, memberUploads(MEMBER))).rejects.toThrow(UPLOAD_EXPIRED);
    await expect(takeStagedUpload(`members/${OTHER}/${NAME}.png`, memberUploads(MEMBER))).rejects.toBeInstanceOf(UploadRejectedError);
    expect(bucket.info).not.toHaveBeenCalled();
    expect(bucket.download).not.toHaveBeenCalled();
  });

  it("says the upload expired when it's gone (swept, or already used)", async () => {
    stubStorage();
    await expect(takeStagedUpload(mine, memberUploads(MEMBER))).rejects.toThrow(UPLOAD_EXPIRED);
  });

  it("hands back the staged bytes as a File with their type and original name, and removes the staged copy", async () => {
    const bytes = await png();
    const { bucket } = stubStorage(staged(bytes, "image/png", "Holiday snap.png"));

    const file = await takeStagedUpload(mine, memberUploads(MEMBER));

    expect(file.name).toBe("Holiday snap.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(bucket.remove).toHaveBeenCalledWith([mine]);
  });

  it("refuses an object over the bucket's ceiling without downloading it", async () => {
    const { bucket } = stubStorage({ info: vi.fn(async () => dbOk({ size: MAX_DOC_BYTES + 1, contentType: "image/jpeg", metadata: {} })) });
    await expect(takeStagedUpload(mine, memberUploads(MEMBER))).rejects.toThrow(IMAGE_TOO_LARGE);
    expect(bucket.download).not.toHaveBeenCalled();
    expect(bucket.remove).toHaveBeenCalledWith([mine]);
  });

  it("throws a plain Error (for the log, not the person) on any other storage failure", async () => {
    stubStorage({ info: vi.fn(async () => dbError("permission denied for table objects", { status: 403, statusCode: "403" })) });
    const err = await takeStagedUpload(mine, memberUploads(MEMBER)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UploadRejectedError);
  });
});

describe("submittedFile", () => {
  const form = (entries: [string, string | File][]) => {
    const fd = new FormData();
    for (const [k, v] of entries) fd.append(k, v);
    return fd;
  };

  it("passes a posted file straight through — the no-JavaScript form, unchanged", async () => {
    const { bucket } = stubStorage();
    const file = new File(["x"], "a.png", { type: "image/png" });
    expect(await submittedFile(form([["cover", file]]), "cover", memberUploads(MEMBER))).toBe(file);
    expect(bucket.info).not.toHaveBeenCalled();
  });

  it("is null when the field is missing or empty", async () => {
    stubStorage();
    expect(await submittedFile(form([]), "cover", memberUploads(MEMBER))).toBeNull();
    expect(await submittedFile(form([["cover", ""]]), "cover", memberUploads(MEMBER))).toBeNull();
  });

  it("claims a staged path — and only the caller's own", async () => {
    const bytes = await png();
    stubStorage(staged(bytes, "image/png"));
    const file = await submittedFile(form([["cover", mine]]), "cover", memberUploads(MEMBER));
    expect(file?.size).toBe(bytes.length);
    await expect(submittedFile(form([["cover", mine]]), "cover", memberUploads(OTHER))).rejects.toThrow(UPLOAD_EXPIRED);
  });

  // The whole point of reusing uploadImage: a staged file gets the same
  // byte-level checks as a posted one. An HTML page declared as a PNG must be
  // refused, and nothing written to the public bucket.
  it("puts staged bytes through uploadImage's own checks — an HTML page calling itself a PNG is refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { media } = stubStorage(staged(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png", "x.png"));
    const file = await submittedFile(form([["cover", mine]]), "cover", memberUploads(MEMBER));
    await expect(uploadImage(file, "stories")).rejects.toThrow(/isn't a readable JPEG, PNG, WebP, GIF or AVIF image/);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it("…and a real staged image lands in the media bucket at the same path shape a posted one does", async () => {
    const { media } = stubStorage(staged(await png(), "image/png"));
    const path = await uploadImage(await submittedFile(form([["cover", mine]]), "cover", memberUploads(MEMBER)), "stories");
    expect(path).toMatch(/^stories\/[0-9a-z]+\.png$/);
    expect(media.upload).toHaveBeenCalledWith(path, expect.anything(), expect.objectContaining({ contentType: "image/png" }));
  });
});

describe("hasSubmittedFile", () => {
  it("is true for a non-empty file or a staged path, false for an empty input or nothing", () => {
    const fd = new FormData();
    fd.append("a", new File(["x"], "a.png"));
    fd.append("b", mine);
    fd.append("c", new File([], ""));
    fd.append("d", "");
    expect(["a", "b", "c", "d", "e"].map((f) => hasSubmittedFile(fd, f))).toEqual([true, true, false, false, false]);
  });
});
