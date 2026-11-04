import { describe, expect, it } from "vitest";
import {
  DEFAULT_REACH_LABEL, REACH_LABEL_MAX, YOUTUBE_MAX_AGE_MS,
  freshFetched, homepageReachFromForm, manualFromForm, parseFetched, parseHomepageReach, parseManual, platformRows, rowTotals,
  type FetchedValues, type ManualValues,
} from "@/lib/social-reach";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const NOW = new Date("2026-11-04T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
const noneConnected = { facebook: false, instagram: false, youtube: false };

describe("homepageReachFromForm", () => {
  it("accepts a whole number and a label, stamping today's date", () => {
    expect(homepageReachFromForm(form({ value: "12500", label: "  Followers   across our channels " }), NOW)).toEqual({
      value: { value: 12500, label: "Followers across our channels", as_of: NOW.toISOString() },
    });
  });

  it("accepts zero, and thousands separators typed by hand", () => {
    expect(homepageReachFromForm(form({ value: "0", label: "Reach" }), NOW)).toMatchObject({ value: { value: 0 } });
    expect(homepageReachFromForm(form({ value: "12,500", label: "Reach" }), NOW)).toMatchObject({ value: { value: 12500 } });
  });

  it.each([
    ["", "Enter the number to show"],
    ["-5", "whole number of 0 or more"],
    ["12.5", "whole number of 0 or more"],
    ["lots", "whole number of 0 or more"],
  ])("rejects the number %j with a field error", (value, message) => {
    const result = homepageReachFromForm(form({ value, label: "Reach" }), NOW);
    expect(result).toEqual({ errors: { value: expect.stringContaining(message) } });
  });

  it("rejects an empty label and an over-long one", () => {
    expect(homepageReachFromForm(form({ value: "10", label: "   " }), NOW)).toEqual({ errors: { label: expect.stringContaining("Enter the caption") } });
    expect(homepageReachFromForm(form({ value: "10", label: "x".repeat(REACH_LABEL_MAX + 1) }), NOW)).toEqual({
      errors: { label: expect.stringContaining(`${REACH_LABEL_MAX} characters`) },
    });
  });

  it("reports both fields at once", () => {
    const result = homepageReachFromForm(form({ value: "-1", label: "" }), NOW);
    expect(result).toEqual({ errors: { value: expect.any(String), label: expect.any(String) } });
  });
});

describe("parseHomepageReach", () => {
  it("is null for a missing or malformed row, so the homepage hides the stat", () => {
    expect(parseHomepageReach(null)).toBeNull();
    expect(parseHomepageReach({ label: "x" })).toBeNull();
    expect(parseHomepageReach({ value: -3, label: "x", as_of: NOW.toISOString() })).toBeNull();
    expect(parseHomepageReach({ value: 1.5, label: "x", as_of: NOW.toISOString() })).toBeNull();
  });

  it("falls back to the default caption for a stored blank label", () => {
    expect(parseHomepageReach({ value: 10, label: "", as_of: NOW.toISOString() })).toEqual({ value: 10, label: DEFAULT_REACH_LABEL, as_of: NOW.toISOString() });
  });
});

describe("manualFromForm", () => {
  it("reads followers, views and the views period per platform; blanks are cleared", () => {
    const result = manualFromForm(form({
      "linkedin.followers": "4,200", "linkedin.views": "18000", "linkedin.period": " last 30 days ",
      "x.followers": "", "x.views": "", "x.period": "",
    }), parseManual(null), NOW);
    if (!("value" in result)) throw new Error("expected a value");
    expect(result.value.linkedin).toEqual({
      followers: { value: 4200, at: NOW.toISOString() },
      views: { value: 18000, period: "last 30 days", at: NOW.toISOString() },
    });
    expect(result.value.x).toEqual({ followers: null, views: null });
  });

  it("keeps the old date when a figure didn't change, and stamps a new one when it did", () => {
    const previous: ManualValues = {
      ...parseManual(null),
      linkedin: { followers: { value: 4200, at: days(10) }, views: { value: 100, period: "October", at: days(10) } },
    };
    const result = manualFromForm(form({ "linkedin.followers": "4200", "linkedin.views": "150", "linkedin.period": "October" }), previous, NOW);
    if (!("value" in result)) throw new Error("expected a value");
    expect(result.value.linkedin.followers).toEqual({ value: 4200, at: days(10) });
    expect(result.value.linkedin.views).toEqual({ value: 150, period: "October", at: NOW.toISOString() });
  });

  // A fetched row has no followers input on the page, so its field is absent
  // from the post — that must leave the typed figure alone, not clear it.
  it("keeps a typed figure whose field wasn't on the form (a fetched row)", () => {
    const previous: ManualValues = { ...parseManual(null), facebook: { followers: { value: 800, at: days(40) }, views: null } };
    const result = manualFromForm(form({ "facebook.views": "", "facebook.period": "" }), previous, NOW);
    if (!("value" in result)) throw new Error("expected a value");
    expect(result.value.facebook.followers).toEqual({ value: 800, at: days(40) });
  });

  it("names the field that's wrong", () => {
    expect(manualFromForm(form({ "facebook.followers": "-2", "tiktok.views": "1.5" }), parseManual(null), NOW)).toEqual({
      errors: { "facebook.followers": expect.any(String), "tiktok.views": expect.any(String) },
    });
  });

  it("refuses a period with no views figure", () => {
    expect(manualFromForm(form({ "x.period": "last 30 days" }), parseManual(null), NOW)).toEqual({
      errors: { "x.views": expect.stringContaining("views") },
    });
  });
});

describe("freshFetched — YouTube's 30-day storage limit (Developer Policies III.E.4.b)", () => {
  const fetched = (at: string): FetchedValues => ({
    youtube: { value: 1230, at, error: null },
    facebook: { value: 900, at, error: null },
  });

  it("keeps a YouTube count under 30 days old", () => {
    const at = new Date(NOW.getTime() - YOUTUBE_MAX_AGE_MS + 60_000).toISOString();
    expect(freshFetched(fetched(at), NOW).youtube).toEqual({ value: 1230, at, error: null });
  });

  it("drops a YouTube count older than 30 days, keeping any error", () => {
    const at = new Date(NOW.getTime() - YOUTUBE_MAX_AGE_MS - 60_000).toISOString();
    const stale: FetchedValues = { youtube: { value: 1230, at, error: { message: "quota", at: days(1) } } };
    expect(freshFetched(stale, NOW).youtube).toEqual({ value: null, at: null, error: { message: "quota", at: days(1) } });
  });

  it("leaves other platforms' last good value alone, however old", () => {
    expect(freshFetched(fetched(days(90)), NOW).facebook).toEqual({ value: 900, at: days(90), error: null });
  });
});

describe("platformRows", () => {
  it("lists all six platforms in a fixed order", () => {
    expect(platformRows({ manual: parseManual(null), fetched: {}, connected: noneConnected, now: NOW }).map((r) => r.platform))
      .toEqual(["linkedin", "facebook", "instagram", "youtube", "x", "tiktok"]);
  });

  it("with no credentials, every row is not connected and entered by hand", () => {
    const rows = platformRows({ manual: parseManual(null), fetched: {}, connected: noneConnected, now: NOW });
    expect(rows.every((r) => r.status === "not_connected" && r.followers.mode === "manual")).toBe(true);
  });

  it("a hand-entered figure shows as manual with its date", () => {
    const manual = { ...parseManual(null), linkedin: { followers: { value: 4200, at: days(2) }, views: null } };
    const [linkedin] = platformRows({ manual, fetched: {}, connected: noneConnected, now: NOW });
    expect(linkedin.status).toBe("manual");
    expect(linkedin.followers).toEqual({ mode: "manual", value: 4200, at: days(2) });
  });

  it("a connected platform with a good value shows it as fetched", () => {
    const fetched: FetchedValues = { facebook: { value: 900, at: days(1), error: null } };
    const facebook = platformRows({ manual: parseManual(null), fetched, connected: { ...noneConnected, facebook: true }, now: NOW })[1];
    expect(facebook.status).toBe("auto");
    expect(facebook.followers).toEqual({ mode: "auto", value: 900, at: days(1) });
  });

  it("a failed fetch keeps showing the last good value and says so — never zero", () => {
    const fetched: FetchedValues = { facebook: { value: 900, at: days(3), error: { message: "HTTP 500", at: days(0) } } };
    const facebook = platformRows({ manual: parseManual(null), fetched, connected: { ...noneConnected, facebook: true }, now: NOW })[1];
    expect(facebook.status).toBe("auto_stale");
    expect(facebook.followers).toEqual({ mode: "auto", value: 900, at: days(3) });
    expect(facebook.error).toEqual({ message: "HTTP 500", at: days(0) });
  });

  it("a connected platform that has never fetched is entered by hand while it waits", () => {
    const instagram = platformRows({ manual: parseManual(null), fetched: {}, connected: { ...noneConnected, instagram: true }, now: NOW })[2];
    expect(instagram.status).toBe("waiting");
    expect(instagram.followers.mode).toBe("manual");
  });

  it("a connected platform whose fetch fails with nothing good stored is 'failing'", () => {
    const fetched: FetchedValues = { instagram: { value: null, at: null, error: { message: "token expired", at: days(0) } } };
    const instagram = platformRows({ manual: parseManual(null), fetched, connected: { ...noneConnected, instagram: true }, now: NOW })[2];
    expect(instagram.status).toBe("failing");
    expect(instagram.followers.mode).toBe("manual");
  });

  it("a YouTube count past 30 days is never shown: the row is failing and asks for a hand-entered figure", () => {
    const fetched: FetchedValues = { youtube: { value: 1230, at: days(31), error: { message: "quota", at: days(0) } } };
    const youtube = platformRows({ manual: parseManual(null), fetched, connected: { ...noneConnected, youtube: true }, now: NOW })[3];
    expect(youtube.status).toBe("failing");
    expect(youtube.followers).toEqual({ mode: "manual", value: null, at: null });
  });

  it("a stored fetched value isn't used once its credentials are removed", () => {
    const fetched: FetchedValues = { facebook: { value: 900, at: days(1), error: null } };
    const facebook = platformRows({ manual: parseManual(null), fetched, connected: noneConnected, now: NOW })[1];
    expect(facebook.status).toBe("not_connected");
    expect(facebook.followers.mode).toBe("manual");
  });
});

describe("rowTotals", () => {
  it("sums the followers and views shown, skipping blanks", () => {
    const manual: ManualValues = {
      ...parseManual(null),
      linkedin: { followers: { value: 4200, at: days(1) }, views: { value: 18000, period: "30 days", at: days(1) } },
      x: { followers: { value: 300, at: days(1) }, views: null },
    };
    const fetched: FetchedValues = { youtube: { value: 1230, at: days(1), error: null } };
    const rows = platformRows({ manual, fetched, connected: { ...noneConnected, youtube: true }, now: NOW });
    expect(rowTotals(rows)).toEqual({ followers: 5730, views: 18000 });
  });
});

describe("parseFetched / parseManual are tolerant", () => {
  it("drop malformed entries rather than throwing", () => {
    expect(parseFetched({ facebook: { value: "lots" }, nonsense: 1 })).toEqual({ facebook: { value: null, at: null, error: null } });
    expect(parseManual({ linkedin: { followers: { value: -1 } } }).linkedin).toEqual({ followers: null, views: null });
  });
});
