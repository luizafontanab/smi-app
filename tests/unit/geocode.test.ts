import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress, geocodePostcode, ukPostcode } from "@/lib/adapters/geocode";

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

  it("returns null when the coordinates are not numbers", async () => {
    // Nominatim answers 200 with a body; a malformed row must not become
    // NaN/NaN and put a pin in the middle of the ocean.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "not-a-number", lon: "-1.8904" }]), { status: 200 }),
    );

    expect(await geocodeAddress("somewhere")).toBeNull();
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

describe("ukPostcode", () => {
  it("finds and normalises the postcode in an imported address", () => {
    expect(ukPostcode("BRUDERER UK Ltd, Unit 8, Hortonwood West,, Telford, Shropshire, TF1 6AH")).toBe("TF1 6AH");
    expect(ukPostcode("Unit 6b pilot drive, coventry, cv34rs")).toBe("CV3 4RS");
    expect(ukPostcode("1 High St, London EC1A 1BB")).toBe("EC1A 1BB");
  });

  it("doesn't mistake a floor or street ordinal for the postcode", () => {
    // "B2 3rd" and "M1 2nd" are shaped like Birmingham and Manchester postcodes.
    expect(ukPostcode("Acme Ltd, Unit B2 3rd Floor, Telford, TF1 6AH")).toBe("TF1 6AH");
    expect(ukPostcode("Unit 4, M1 2nd Avenue, Leeds LS1 4AP")).toBe("LS1 4AP");
    expect(ukPostcode("Acme Ltd, Unit B2 3rd Floor, Telford")).toBeNull();
  });

  it("takes the last postcode-shaped text, where a UK address puts it", () => {
    expect(ukPostcode("Unit A1 1AA Trading Estate, Leeds, LS1 4AP")).toBe("LS1 4AP");
  });

  it("returns null when there is no postcode", () => {
    expect(ukPostcode("Somewhere in Telford")).toBeNull();
    expect(ukPostcode("")).toBeNull();
  });
});

describe("geocodePostcode", () => {
  it("uses Nominatim's structured postcode search, limited to Great Britain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "52.7", lon: "-2.5" }]), { status: 200 }),
    );
    expect(await geocodePostcode("TF1 6AH")).toEqual({ lat: 52.7, lng: -2.5 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`postalcode=${encodeURIComponent("TF1 6AH")}`);
    expect(String(url)).toContain("countrycodes=gb");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/SMI/);
  });

  it("returns null on no match, a bad response or a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]", { status: 200 }));
    expect(await geocodePostcode("TF1 6AH")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 503 }));
    expect(await geocodePostcode("TF1 6AH")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("down"));
    expect(await geocodePostcode("TF1 6AH")).toBeNull();
  });
});
