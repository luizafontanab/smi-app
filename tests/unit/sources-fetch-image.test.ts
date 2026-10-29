import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImage } from "@/lib/sources/fetch";

afterEach(() => vi.restoreAllMocks());

const respond = (body: BodyInit | null, headers: Record<string, string>, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status, headers }));

describe("fetchImage", () => {
  it("returns the image as a file named for its type", async () => {
    respond(new Uint8Array([1, 2, 3]), { "content-type": "image/webp; charset=binary" });
    const file = await fetchImage("https://acme.test/a.webp");
    expect(file).toBeInstanceOf(File);
    expect(file).toEqual(expect.objectContaining({ name: "cover.webp", type: "image/webp", size: 3 }));
  });

  it.each([
    ["not an image", new Uint8Array([1]), { "content-type": "text/html" }, 200],
    ["an SVG (scriptable)", new Uint8Array([1]), { "content-type": "image/svg+xml" }, 200],
    ["an error page", new Uint8Array([1]), { "content-type": "image/png" }, 404],
    ["too large by its header", new Uint8Array([1]), { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) }, 200],
    ["empty", new Uint8Array([]), { "content-type": "image/png" }, 200],
  ])("refuses %s", async (_, body, headers, status) => {
    respond(body, headers, status);
    expect(await fetchImage("https://acme.test/a")).toBeNull();
  });

  it("a network failure is null, not a throw", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchImage("https://acme.test/a")).toBeNull();
  });
});
