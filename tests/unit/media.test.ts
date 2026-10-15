import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MAX_DOC_BYTES, MAX_UPLOAD_BYTES, removeMedia, removeMediaIfUnused, sniffImageType, uploadDocument, uploadImage } from "@/lib/media";
import { UploadRejectedError } from "@/lib/upload-limits";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

/** Only .size/.type/.name are read before the size and type refusals — a real multi-MB File isn't needed to exercise those. */
function fakeFile(overrides: Partial<{ size: number; type: string; name: string }> = {}): File {
  return { size: 1024, type: "image/png", name: "photo.png", ...overrides } as unknown as File;
}

type Format = "jpeg" | "png" | "webp" | "gif" | "avif";

/** A real, tiny image of `format`, declared as `type` (its own MIME type unless a test says otherwise). */
async function imageFile(format: Format, type = format === "jpeg" ? "image/jpeg" : `image/${format}`, name = `photo.${format}`): Promise<File> {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#e30613" } }).toFormat(format).toBuffer();
  return new File([new Uint8Array(bytes)], name, { type });
}

const textFile = (text: string, type: string, name = "file") => new File([text], name, { type });

function stubStorage(uploadResult = dbOk(null), mediaInsertResult = dbOk(null)) {
  const upload = vi.fn<(path: string, file: File, opts: Record<string, unknown>) => Promise<typeof uploadResult>>(
    async () => uploadResult,
  );
  const remove = vi.fn(async () => dbOk(null));
  const builder = queryBuilder(mediaInsertResult);
  const from = vi.fn(() =>
    // both the storage bucket and the "media" table are reached via db.from/db.storage.from with the same client
    builder,
  );
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  })));
  return { upload, remove, from, builder };
}

describe("uploadImage", () => {
  it("returns null for no file or an empty one", async () => {
    expect(await uploadImage(null, "stories")).toBeNull();
    expect(await uploadImage(fakeFile({ size: 0 }), "stories")).toBeNull();
    expect(vi.mocked(serviceDb)).not.toHaveBeenCalled();
  });

  it("rejects a file over the 8MB cap", async () => {
    await expect(uploadImage(fakeFile({ size: MAX_UPLOAD_BYTES + 1 }), "stories"))
      .rejects.toThrow("Image too large (8MB max)");
  });

  it("rejects anything outside the image allowlist", async () => {
    await expect(uploadImage(fakeFile({ type: "image/svg+xml" }), "stories"))
      .rejects.toThrow("Images only — JPEG, PNG, WebP, GIF or AVIF.");
    await expect(uploadImage(fakeFile({ type: "text/html" }), "stories"))
      .rejects.toThrow("Images only — JPEG, PNG, WebP, GIF or AVIF.");
  });

  it("its refusals are UploadRejectedErrors, so callers can show them as they stand", async () => {
    await expect(uploadImage(fakeFile({ type: "text/html" }), "stories")).rejects.toBeInstanceOf(UploadRejectedError);
  });

  it("uploads to the media bucket and returns the storage path", async () => {
    const { upload } = stubStorage();

    const path = await uploadImage(await imageFile("webp"), "stories/acme");

    expect(path).toMatch(/^stories\/acme\/[0-9a-z]+\.webp$/);
    const [uploadedPath, , opts] = upload.mock.calls[0];
    expect(uploadedPath).toBe(path);
    expect(opts).toMatchObject({ contentType: "image/webp" });
  });

  it.each(["jpeg", "png", "webp", "gif", "avif"] as const)("accepts a real %s", async (format) => {
    stubStorage();
    await expect(uploadImage(await imageFile(format), "stories")).resolves.toMatch(/^stories\//);
  });

  // Review finding 16 Oct: only the client-declared type was checked, so any
  // bytes at all could be stored in the public bucket as image/*.
  it.each([
    ["an HTML page declared as a PNG", textFile("<html><script>alert(1)</script></html>", "image/png", "x.png")],
    ["an HTML page behind a GIF signature", textFile("GIF89a<html><script>alert(1)</script></html>", "image/gif", "x.gif")],
    ["a PNG signature on junk", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], "x.png", { type: "image/png" })],
    ["an SVG declared as a JPEG", textFile("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "image/jpeg", "x.jpg")],
  ])("refuses %s, storing nothing", async (_label, file) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { upload } = stubStorage();
    await expect(uploadImage(file, "stories")).rejects.toThrow(/isn't a readable JPEG, PNG, WebP, GIF or AVIF image/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("stores an image by what its bytes are, not what it was called — a PNG named .jpg is stored as a PNG", async () => {
    const { upload, builder } = stubStorage();
    const path = await uploadImage(await imageFile("png", "image/jpeg", "photo.jpg"), "stories");
    expect(path).toMatch(/\.png$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ content_type: "image/png" }));
  });

  it("throws the storage error rather than recording a media row that doesn't exist", async () => {
    const { from } = stubStorage(dbError("bucket not found"));

    await expect(uploadImage(await imageFile("png"), "stories")).rejects.toThrow("bucket not found");
    expect(from).not.toHaveBeenCalled(); // recordMedia must not run after a failed upload
  });

  it("still returns the path when the best-effort media-library insert fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubStorage(dbOk(null), dbError("insert failed"));

    const path = await uploadImage(await imageFile("png"), "stories");

    expect(path).toMatch(/^stories\//);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("sniffImageType", () => {
  it("reads each allowlisted signature, and nothing else", async () => {
    for (const format of ["jpeg", "png", "webp", "gif", "avif"] as const) {
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).toFormat(format).toBuffer();
      expect(sniffImageType(bytes)).toBe(format === "jpeg" ? "image/jpeg" : `image/${format}`);
    }
    expect(sniffImageType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it("tells AVIF from HEIC, which shares the container but isn't allowed", () => {
    const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode(`ftyp${brand}\0\0\0\0mif1${brand}`)]);
    expect(sniffImageType(ftyp("avif"))).toBe("image/avif");
    expect(sniffImageType(ftyp("heic"))).toBeNull();
  });
});

describe("uploadDocument", () => {
  it("returns null for no file or an empty one", async () => {
    expect(await uploadDocument(null, "advertising")).toBeNull();
    expect(await uploadDocument(fakeFile({ size: 0, type: "application/pdf" }), "advertising")).toBeNull();
  });

  it("rejects a file over the 20MB cap", async () => {
    await expect(uploadDocument(fakeFile({ type: "application/pdf", size: MAX_DOC_BYTES + 1 }), "advertising"))
      .rejects.toThrow("File too large (20MB max)");
  });

  it("only accepts PDFs", async () => {
    await expect(uploadDocument(fakeFile({ type: "image/png" }), "advertising")).rejects.toThrow("PDF only.");
  });

  it("uploads a PDF and returns the storage path", async () => {
    const { upload } = stubStorage();

    const path = await uploadDocument(textFile("%PDF-1.7\n%âãÏÓ\n", "application/pdf", "pack.pdf"), "advertising/media-pack");

    expect(path).toMatch(/^advertising\/media-pack\/[0-9a-z]+\.pdf$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "application/pdf" });
  });

  // Review finding 16 Oct: the declared type was the only check.
  it("refuses a file declared as a PDF that doesn't start like one", async () => {
    const { upload } = stubStorage();
    await expect(uploadDocument(textFile("<html><script>alert(1)</script>", "application/pdf", "pack.pdf"), "media-pack"))
      .rejects.toThrow(/isn't a PDF/);
    await expect(uploadDocument(textFile("%PD", "application/pdf", "pack.pdf"), "media-pack")).rejects.toBeInstanceOf(UploadRejectedError);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("removeMediaIfUnused", () => {
  function stubWithUse(inUse: ReturnType<typeof dbOk> | ReturnType<typeof dbError>) {
    const remove = vi.fn(async () => dbOk(null));
    const raw = mockDb({ from: vi.fn(() => queryBuilder(dbOk(null))), storage: { from: vi.fn(() => ({ remove })) }, rpc: async () => inUse });
    vi.mocked(serviceDb).mockReturnValue(asDb(raw));
    return { remove, raw };
  }

  it("removes only the paths nothing references, asking once for all of them", async () => {
    const { remove, raw } = stubWithUse(dbOk(["stories/mem1/b.jpg"]));
    await removeMediaIfUnused(["stories/c.jpg", "stories/mem1/b.jpg", null, "stories/c.jpg"]);
    expect(raw.rpc).toHaveBeenCalledWith("media_paths_in_use", { p_paths: ["stories/c.jpg", "stories/mem1/b.jpg"] });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["stories/c.jpg"]);
  });

  it("removes nothing when it can't tell what is in use", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { remove } = stubWithUse(dbError("function media_paths_in_use does not exist"));
    await removeMediaIfUnused(["stories/c.jpg"]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does nothing at all for no paths", async () => {
    await removeMediaIfUnused([null, undefined]);
    expect(vi.mocked(serviceDb)).not.toHaveBeenCalled();
  });
});

describe("removeMedia", () => {
  it("does nothing for a null or undefined path", async () => {
    await removeMedia(null);
    await removeMedia(undefined);
    expect(vi.mocked(serviceDb)).not.toHaveBeenCalled();
  });

  it("removes the storage object and deletes the media-library row", async () => {
    const builder = queryBuilder(dbOk(null));
    const remove = vi.fn(async () => dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, storage: { from: vi.fn(() => ({ remove })) } })));

    await removeMedia("stories/acme/cover.jpg");

    expect(remove).toHaveBeenCalledWith(["stories/acme/cover.jpg"]);
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("path", "stories/acme/cover.jpg");
  });

  it("still deletes the media-library row even when the storage removal fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const builder = queryBuilder(dbOk(null));
    const remove = vi.fn(async () => dbError("object not found"));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, storage: { from: vi.fn(() => ({ remove })) } })));

    await removeMedia("stories/acme/cover.jpg");

    expect(warnSpy).toHaveBeenCalled();
    expect(builder.delete).toHaveBeenCalled();
  });
});
