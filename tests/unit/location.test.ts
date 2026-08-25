import { describe, expect, it } from "vitest";

import { displayLocation } from "@/lib/location";

// Real ACF Google-Map values from the WordPress handover (json/event.json).
const GOLF = `a:13:{s:7:"address";s:93:"Moor Hall Drive, The Royal Town of Sutton Coldfield, Birmingham, Sutton Coldfield B75 6LN, UK";s:3:"lat";d:52.5830722;s:3:"lng";d:-1.8125813;s:4:"zoom";i:5;s:8:"place_id";s:27:"ChIJLSq3EMClcEgRruVUrb28rDA";s:4:"name";s:7:"B75 6LN";s:11:"street_name";s:15:"Moor Hall Drive";s:17:"street_name_short";s:12:"Moor Hall Dr";s:4:"city";s:16:"Sutton Coldfield";s:5:"state";s:7:"England";s:9:"post_code";s:7:"B75 6LN";s:7:"country";s:14:"United Kingdom";s:13:"country_short";s:2:"GB";}`;

// s:54: is a BYTE count against a 51-character string — the multi-byte trap.
const EUROBLECH = `a:13:{s:7:"address";s:54:"Messegelände, 30521 Hannover-Döhren-Wülfel, Germany";s:3:"lat";d:52.3184606;s:3:"lng";d:9.8057512;s:4:"zoom";i:5;s:8:"place_id";s:139:"EjZNZXNzZWdlbMOkbmRlLCAzMDUyMSBIYW5ub3Zlci1Ew7ZocmVuLVfDvGxmZWwsIEdlcm1hbnkiLiosChQKEgkXdFTqQgqwRxE_yhVqLhOrvRIUChIJA54PHFsKsEcR8DDE3nCsJRw";s:4:"name";s:13:"Messegelände";s:11:"street_name";s:13:"Messegelände";s:4:"city";s:8:"Hannover";s:5:"state";s:13:"Niedersachsen";s:11:"state_short";s:3:"NDS";s:9:"post_code";s:5:"30521";s:7:"country";s:7:"Germany";s:13:"country_short";s:2:"DE";}`;

describe("displayLocation", () => {
  it("reduces a UK ACF map blob to city + postcode", () => {
    expect(displayLocation(GOLF)).toBe("Sutton Coldfield, B75 6LN");
  });

  it("appends the country for non-UK events, unharmed by multi-byte lengths", () => {
    expect(displayLocation(EUROBLECH)).toBe("Hannover, 30521, Germany");
  });

  it("falls back to the formatted address when city/postcode are missing", () => {
    const blob = `a:3:{s:7:"address";s:9:"The Belfry";s:5:"state";s:0:"";s:13:"country_short";s:2:"GB";}`;
    expect(displayLocation(blob)).toBe("The Belfry");
  });

  it("fails closed rather than leaking the blob", () => {
    expect(displayLocation(`a:2:{s:3:"lat";d:52.58;s:3:"lng";d:-1.81;}`)).toBeNull();
  });

  it("passes plain text through", () => {
    expect(displayLocation("Belfry, West Midlands")).toBe("Belfry, West Midlands");
  });

  it("handles null/empty", () => {
    expect(displayLocation(null)).toBeNull();
    expect(displayLocation(undefined)).toBeNull();
    expect(displayLocation("   ")).toBeNull();
  });
});
