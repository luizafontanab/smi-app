import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchImage } from "@/lib/sources/fetch";
import { isPublicAddress, isPublicUrl } from "@/lib/sources/public-url";

// Hostnames → addresses, so no test touches real DNS. Unknown names fail to resolve.
const { hosts } = vi.hoisted(() => ({ hosts: new Map<string, string[]>() }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const literal = /^[\d.]+$|:/.test(host) ? [host] : undefined;
    const found = literal ?? hosts.get(host);
    if (!found) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  }),
}));

beforeEach(() => {
  hosts.clear();
  hosts.set("acme.test", ["93.184.216.34"]);
  hosts.set("cdn.acme.test", ["93.184.216.35"]);
  hosts.set("internal.acme.test", ["10.0.0.5"]);
});
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

  it("refuses a body that runs past the size cap with no Content-Length to say so", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 20) c.enqueue(chunk);
        else c.close();
      },
    });
    respond(stream, { "content-type": "image/png" });
    expect(await fetchImage("https://acme.test/huge.png")).toBeNull();
    // It stopped reading once over the cap rather than taking all 20 MB.
    expect(sent).toBeLessThan(20);
  });

  it.each([
    ["a private address", "http://10.0.0.5/a.png"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data"],
    ["localhost", "http://localhost:3100/a.png"],
    ["IPv6 loopback", "http://[::1]/a.png"],
    ["a name that resolves to a private address", "https://internal.acme.test/a.png"],
    ["a name that doesn't resolve", "https://nowhere.acme.test/a.png"],
    ["a non-web scheme", "file:///etc/passwd"],
  ])("never requests %s", async (_, url) => {
    const fetchMock = respond(new Uint8Array([1]), { "content-type": "image/png" });
    expect(await fetchImage(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to a public host", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.acme.test/a.png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/png" } }));
    expect(await fetchImage("https://acme.test/a.png")).toEqual(expect.objectContaining({ size: 2 }));
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://cdn.acme.test/a.png");
  });

  it("refuses a redirect into a private address", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    expect(await fetchImage("https://acme.test/a.png")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: "https://acme.test/again" } }));
    expect(await fetchImage("https://acme.test/a.png")).toBeNull();
  });

  it("a network failure is null, not a throw", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchImage("https://acme.test/a")).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"])(
    "refuses %s", (ip) => {
      expect(isPublicAddress(ip)).toBe(false);
    },
  );
});

describe("isPublicUrl", () => {
  it("needs every resolved address to be public", async () => {
    hosts.set("mixed.acme.test", ["93.184.216.34", "10.0.0.1"]);
    expect(await isPublicUrl("https://acme.test/x")).toBe(true);
    expect(await isPublicUrl("https://mixed.acme.test/x")).toBe(false);
  });
});
