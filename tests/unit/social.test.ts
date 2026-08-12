import { describe, expect, it } from "vitest";
import { mergeSocial, socialHandle, socialHref, socialLinks } from "@/lib/social";

/** Shorthand: the pair the profile card actually renders. */
const render = (key: string, value: string) => {
  const [link] = socialLinks({ [key]: value });
  return link ? `${link.label}: ${link.handle ?? "—"} → ${link.href ?? "—"}` : "";
};

describe("socialHref", () => {
  it("passes full URLs through", () => {
    expect(socialHref("linkedin", "https://www.linkedin.com/company/schuler-group/"))
      .toBe("https://www.linkedin.com/company/schuler-group/");
    expect(socialHref("x", "https://twitter.com/schulergroup")).toBe("https://twitter.com/schulergroup");
  });

  it("adds the scheme when the value is already the channel's own host", () => {
    expect(socialHref("instagram", "www.instagram.com/uksheetmetal")).toBe("https://www.instagram.com/uksheetmetal");
    expect(socialHref("linkedin", "uk.linkedin.com/company/gtma-uk")).toBe("https://uk.linkedin.com/company/gtma-uk");
  });

  it("builds a URL from the bare handles scripts/seed.ts writes", () => {
    expect(socialHref("x", "acme-ltd")).toBe("https://x.com/acme-ltd");
    expect(socialHref("linkedin", "company/acme-ltd")).toBe("https://www.linkedin.com/company/acme-ltd");
    expect(socialHref("facebook", "SMIUK")).toBe("https://www.facebook.com/SMIUK");
  });

  it("infers linkedin's company/ namespace for a bare handle", () => {
    expect(socialHref("linkedin", "acme-ltd")).toBe("https://www.linkedin.com/company/acme-ltd");
    expect(socialHref("linkedin", "in/samanthabenbow")).toBe("https://www.linkedin.com/in/samanthabenbow");
  });

  it("re-adds the @ that youtube and tiktok handles need", () => {
    expect(socialHref("tiktok", "smiuk_")).toBe("https://www.tiktok.com/@smiuk_");
    expect(socialHref("tiktok", "@smiuk_")).toBe("https://www.tiktok.com/@smiuk_");
    expect(socialHref("youtube", "KUKARobotGroup")).toBe("https://www.youtube.com/@KUKARobotGroup");
  });

  it("keeps dotted tiktok handles off the hostname", () => {
    expect(socialHref("tiktok", "cutform.machines")).toBe("https://www.tiktok.com/@cutform.machines");
  });

  it("refuses anything that isn't http(s)", () => {
    expect(socialHref("x", "javascript:alert(1)")).toBeNull();
    expect(socialHref("x", "data:text/html,<script>")).toBeNull();
    expect(socialHref("x", "mailto:hi@example.com")).toBeNull();
  });

  it("returns null for blank values", () => {
    expect(socialHref("x", "")).toBeNull();
    expect(socialHref("x", "   ")).toBeNull();
  });

  it("links unknown channels only when they are already URLs", () => {
    expect(socialHref("threads", "https://www.threads.net/@acme")).toBe("https://www.threads.net/@acme");
    expect(socialHref("threads", "acme")).toBeNull();
  });

  it("cannot be pushed off the channel's host by a handle", () => {
    expect(socialHref("linkedin", "//evil.example/x")).toBe("https://www.linkedin.com/evil.example/x");
  });
});

describe("socialHandle", () => {
  it("strips the namespace segment", () => {
    expect(socialHandle("linkedin", "https://www.linkedin.com/company/schuler-group/")).toBe("schuler-group");
    expect(socialHandle("linkedin", "https://www.linkedin.com/in/samanthabenbow/")).toBe("samanthabenbow");
    expect(socialHandle("youtube", "https://www.youtube.com/user/salvagninichannel")).toBe("salvagninichannel");
  });

  it("marks root-level handles with @ where the platform does", () => {
    expect(socialHandle("x", "https://x.com/gtma1")).toBe("@gtma1");
    expect(socialHandle("instagram", "https://www.instagram.com/traxfabrications/?hl=en")).toBe("@traxfabrications");
    expect(socialHandle("tiktok", "https://www.tiktok.com/@cutform.machines?lang=en-GB")).toBe("@cutform.machines");
    expect(socialHandle("youtube", "https://www.youtube.com/@KUKARobotGroup")).toBe("@KUKARobotGroup");
  });

  it("leaves facebook and linkedin unprefixed", () => {
    expect(socialHandle("facebook", "https://www.facebook.com/SalvagniniUK/")).toBe("SalvagniniUK");
  });

  it("gives up on URLs that hold no readable name", () => {
    // a video, not a channel — the one in the Schuler profile
    expect(socialHandle("youtube", "https://www.youtube.com/watch?v=QmEZ9TPXpxA")).toBeNull();
    // opaque channel id
    expect(socialHandle("youtube", "https://www.youtube.com/channel/UCwg7Css79gc_adlmO3_fVxA")).toBeNull();
    expect(socialHandle("facebook", "https://www.facebook.com/profile.php?id=61569011023773")).toBeNull();
    expect(socialHandle("x", "https://x.com/")).toBeNull();
  });
});

describe("mergeSocial", () => {
  const form = (values: Record<string, string>) => (key: string) => values[key] ?? "";

  it("keeps channels the form did not submit", () => {
    // the old action rebuilt from four fields, wiping these two on every save
    const stored = { linkedin: "company/acme", youtube: "@acme", tiktok: "@acme" };
    expect(mergeSocial(stored, form({ linkedin: "company/acme" }))).toEqual({ linkedin: "company/acme" });
    expect(mergeSocial(stored, form({ linkedin: "company/acme", youtube: "@acme", tiktok: "@acme" })))
      .toEqual(stored);
  });

  it("removes a channel the member cleared instead of storing an empty string", () => {
    const merged = mergeSocial({ x: "acme", facebook: "acme" }, form({ x: "acme", facebook: "   " }));
    expect(merged).toEqual({ x: "acme" });
    expect("facebook" in merged).toBe(false);
  });

  it("trims what it stores and adds newly filled channels", () => {
    expect(mergeSocial({}, form({ tiktok: "  @acme  " }))).toEqual({ tiktok: "@acme" });
  });

  it("preserves keys outside the six the form renders", () => {
    expect(mergeSocial({ threads: "https://www.threads.net/@acme" }, form({ x: "acme" })))
      .toEqual({ threads: "https://www.threads.net/@acme", x: "acme" });
  });

  it("drops the empty strings older saves left behind", () => {
    expect(mergeSocial({ facebook: "", instagram: "   ", x: "acme" }, form({}))).toEqual({});
  });

  it("survives a null or malformed social column", () => {
    expect(mergeSocial(null, form({ x: "acme" }))).toEqual({ x: "acme" });
    expect(mergeSocial("nope", form({}))).toEqual({});
  });
});

describe("socialLinks", () => {
  it("drops blank and non-string values", () => {
    const links = socialLinks({ x: "https://x.com/acme", facebook: "", instagram: "   ", youtube: null });
    expect(links.map((l) => l.key)).toEqual(["x"]);
  });

  it("orders by channel, not by however the json was written", () => {
    const links = socialLinks({ tiktok: "@a", x: "b", linkedin: "company/c", youtube: "@d" });
    expect(links.map((l) => l.label)).toEqual(["LinkedIn", "X", "YouTube", "TikTok"]);
  });

  it("appends unknown channels after the known six", () => {
    const links = socialLinks({ threads: "https://www.threads.net/@acme", x: "acme" });
    expect(links.map((l) => l.label)).toEqual(["X", "Threads"]);
  });

  it("keeps the raw value so an unlinkable entry can still be shown", () => {
    const [link] = socialLinks({ x: "javascript:alert(1)" });
    expect(link.href).toBeNull();
    expect(link.value).toBe("javascript:alert(1)");
  });

  it("handles a missing or malformed social column", () => {
    expect(socialLinks(null)).toEqual([]);
    expect(socialLinks(undefined)).toEqual([]);
    expect(socialLinks("nope")).toEqual([]);
    expect(socialLinks([1, 2])).toEqual([]);
  });

  it("never shows a row for a value the form left blank", () => {
    const stored = { linkedin: "company/acme", youtube: "@acme" };
    const saved = mergeSocial(stored, (k) => (k === "linkedin" ? "" : (stored[k as "youtube"] ?? "")));
    expect(socialLinks(saved).map((l) => l.label)).toEqual(["YouTube"]);
  });

  it("renders the profile in the screenshot", () => {
    expect(render("x", "https://twitter.com/schulergroup")).toBe("X: @schulergroup → https://twitter.com/schulergroup");
    expect(render("linkedin", "https://www.linkedin.com/company/schuler-group/"))
      .toBe("LinkedIn: schuler-group → https://www.linkedin.com/company/schuler-group/");
    expect(render("youtube", "https://www.youtube.com/watch?v=QmEZ9TPXpxA"))
      .toBe("YouTube: — → https://www.youtube.com/watch?v=QmEZ9TPXpxA");
  });
});
