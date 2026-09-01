import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOC_BYTES, MAX_UPLOAD_BYTES, removeMedia, uploadDocument, uploadImage } from "@/lib/media";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

/** Only .size/.type/.name are ever read — a real multi-MB File isn't needed to exercise the validation or upload path. */
function fakeFile(overrides: Partial<{ size: number; type: string; name: string }> = {}): File {
  return { size: 1024, type: "image/png", name: "photo.png", ...overrides } as unknown as File;
}

function stubStorage(uploadResult = dbOk(null), mediaInsertResult = dbOk(null)) {
  const upload = vi.fn<(path: string, file: File, opts: Record<string, unknown>) => Promise<typeof uploadResult>>(
    async () => uploadResult,
  );
  const remove = vi.fn(async () => dbOk(null));
  const from = vi.fn(() =>
    // both the storage bucket and the "media" table are reached via db.from/db.storage.from with the same client
    queryBuilder(mediaInsertResult),
  );
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  })));
  return { upload, remove, from };
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

  it("uploads to the media bucket and returns the storage path", async () => {
    const { upload } = stubStorage();

    const path = await uploadImage(fakeFile({ type: "image/webp" }), "stories/acme");

    expect(path).toMatch(/^stories\/acme\/[0-9a-z]+\.webp$/);
    const [uploadedPath, , opts] = upload.mock.calls[0];
    expect(uploadedPath).toBe(path);
    expect(opts).toMatchObject({ contentType: "image/webp" });
  });

  it("throws the storage error rather than recording a media row that doesn't exist", async () => {
    const { from } = stubStorage(dbError("bucket not found"));

    await expect(uploadImage(fakeFile(), "stories")).rejects.toThrow("bucket not found");
    expect(from).not.toHaveBeenCalled(); // recordMedia must not run after a failed upload
  });

  it("still returns the path when the best-effort media-library insert fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubStorage(dbOk(null), dbError("insert failed"));

    const path = await uploadImage(fakeFile(), "stories");

    expect(path).toMatch(/^stories\//);
    expect(warnSpy).toHaveBeenCalled();
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

    const path = await uploadDocument(fakeFile({ type: "application/pdf" }), "advertising/media-pack");

    expect(path).toMatch(/^advertising\/media-pack\/[0-9a-z]+\.pdf$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "application/pdf" });
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
