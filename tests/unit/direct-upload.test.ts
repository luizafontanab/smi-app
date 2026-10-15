// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUploadAbort, stageUpload, uploadConnectionFailed, uploadErrorMessage, uploadRefused } from "@/lib/direct-upload";
import { IMAGE_TOO_LARGE, UPLOAD_RATE_LIMITED, UploadRejectedError, type UploadSlot } from "@/lib/upload-limits";

const { requestUploadSlot } = vi.hoisted(() => ({
  requestUploadSlot: vi.fn<(r: { kind: string; size: number; type: string }) => Promise<UploadSlot>>(),
}));
vi.mock("@/app/uploads/actions", () => ({ requestUploadSlot }));

/** Just enough XMLHttpRequest to see what stageUpload sends and to answer it. */
class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  answer(status: number, text = "") {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const SLOT = { path: "members/m1/3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.jpg", url: "http://127.0.0.1:56321/storage/v1/object/upload/sign/upload-staging/members/m1/x.jpg?token=t" };
const photo = (size = 6 * 1024 * 1024) => new File([new Uint8Array(size)], "phone.jpg", { type: "image/jpeg" });
/** Lets the slot request resolve so the PUT is under way. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  requestUploadSlot.mockResolvedValue(SLOT);
});
afterEach(() => {
  vi.unstubAllGlobals();
  requestUploadSlot.mockReset();
  vi.restoreAllMocks();
});

describe("stageUpload", () => {
  // The bug this exists for: a 6MB phone photo is inside the 8MB limit but
  // over Vercel's 4.5MB request cap, so it must never ride in the action.
  it("asks for a slot with the declared size and type, then PUTs the file straight to Storage", async () => {
    const file = photo();
    const done = stageUpload(file, "image");
    await settle();

    expect(requestUploadSlot).toHaveBeenCalledWith({ kind: "image", size: file.size, type: "image/jpeg" });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(SLOT.url);
    expect(xhr.headers["x-upsert"]).toBe("false");
    // the shape uploadToSignedUrl sends: multipart, file under "", name in metadata
    const body = xhr.body as FormData;
    expect(body.get("")).toBe(file);
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ name: "phone.jpg" });
    expect(body.get("cacheControl")).toBeTruthy();

    xhr.answer(200, '{"Key":"upload-staging/x"}');
    await expect(done).resolves.toBe(SLOT.path);
  });

  it("reports progress as the browser sends", async () => {
    const onProgress = vi.fn();
    const done = stageUpload(photo(), "image", { onProgress });
    await settle();
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 });
    FakeXhr.last.answer(200);
    await done;
    expect(onProgress).toHaveBeenCalledWith(0.75);
  });

  it("refuses an oversized file before asking for a slot or sending a byte", async () => {
    await expect(stageUpload(photo(9 * 1024 * 1024), "image")).rejects.toThrow(IMAGE_TOO_LARGE);
    expect(requestUploadSlot).not.toHaveBeenCalled();
  });

  it("passes the server's refusal on in its own words", async () => {
    requestUploadSlot.mockResolvedValue({ error: UPLOAD_RATE_LIMITED });
    const err = await stageUpload(photo(), "image").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejectedError);
    expect((err as Error).message).toBe(UPLOAD_RATE_LIMITED);
  });

  it("never shows Storage's own text — a refused PUT is our generic line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const done = stageUpload(new File(["%PDF-"], "pack.pdf", { type: "application/pdf" }), "pdf");
    await settle();
    FakeXhr.last.answer(400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}');
    const err = await done.catch((e: unknown) => e);
    expect(uploadErrorMessage(err, "pdf")).toBe(uploadRefused("pdf"));
    expect(uploadRefused("pdf")).toMatch(/^The file didn't upload/);
  });

  it("says to check the connection when the request never completes, or the slot request fails", async () => {
    const done = stageUpload(photo(), "image");
    await settle();
    FakeXhr.last.onerror?.();
    expect(uploadErrorMessage(await done.catch((e: unknown) => e), "image")).toBe(uploadConnectionFailed("image"));

    requestUploadSlot.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(uploadErrorMessage(await stageUpload(photo(), "image").catch((e: unknown) => e), "image")).toBe(uploadConnectionFailed("image"));
  });

  it("stops when its signal aborts, with an abort the caller can tell apart from a failure", async () => {
    const controller = new AbortController();
    const done = stageUpload(photo(), "image", { signal: controller.signal });
    await settle();
    controller.abort();
    const err = await done.catch((e: unknown) => e);
    expect(isUploadAbort(err)).toBe(true);
  });

  it("anything unexpected is worded as a connection problem, never passed through", () => {
    expect(uploadErrorMessage(new Error("TypeError: x is undefined"), "image")).toBe(uploadConnectionFailed("image"));
  });
});
