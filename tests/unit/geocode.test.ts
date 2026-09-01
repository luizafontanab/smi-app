import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "@/lib/adapters/geocode";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("geocodeAddress", () => {
  it("returns null for a blank address without calling out", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await geocodeAddress("   ");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the first result's coordinates, with an identifying User-Agent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "52.4862", lon: "-1.8904" }]), { status: 200 }),
    );

    const result = await geocodeAddress("1 Example Street, Birmingham");

    expect(result).toEqual({ lat: 52.4862, lng: -1.8904 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("nominatim.openstreetmap.org/search");
    expect(String(url)).toContain(encodeURIComponent("1 Example Street, Birmingham"));
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/SMI/);
  });

  it("returns null when nothing matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const result = await geocodeAddress("nowhere in particular");

    expect(result).toBeNull();
  });

  it("returns null on a non-2xx response rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503 }));

    const result = await geocodeAddress("somewhere");

    expect(result).toBeNull();
  });

  it("returns null when the request itself fails, never throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await geocodeAddress("somewhere");

    expect(result).toBeNull();
  });
});
