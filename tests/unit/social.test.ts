import { describe, expect, it } from "vitest";
import { keepUntouchedPosts, mergeSocial, parseStoryPosts, SMI_SOCIAL_URLS, socialHandle, socialHref, socialLinks, storyPostLinks, storyPostUrl } from "@/lib/social";

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

// Jas 13/10 item 8: links to SMI's own posts of a story.
describe("storyPostUrl", () => {
  it.each([
    ["linkedin", "https://www.linkedin.com/posts/sheet-metal-industries_blm-activity-1234"],
    ["linkedin", "https://uk.linkedin.com/feed/update/urn:li:activity:1234/"],
    ["facebook", "https://www.facebook.com/SMIUK/posts/pfbid0abc"],
    ["facebook", "https://fb.com/SMIUK/posts/1"],
    ["x", "https://x.com/SMIUK_/status/1845"],
    ["x", "https://twitter.com/SMIUK_/status/1845"],
    ["x", "https://x.com/i/web/status/1845"],
    ["facebook", "https://www.facebook.com/share/p/1AbCdEf/"],
    ["facebook", "https://www.facebook.com/permalink.php?story_fbid=123&id=456"],
    ["linkedin", "https://www.linkedin.com/posts/smi_blm-activity-1234-abcd?utm_source=share&utm_medium=member_desktop"],
  ] as const)("accepts a %s post on its own host: %s", (network, url) => {
    expect(storyPostUrl(network, url)).toBe(new URL(url).toString());
  });

  it.each([
    ["http, not https", "linkedin", "http://www.linkedin.com/posts/x"],
    ["another network's host", "linkedin", "https://x.com/SMIUK_/status/1"],
    ["a look-alike host", "facebook", "https://facebook.com.evil.example/x"],
    ["a script URL", "x", "javascript:alert(1)//x.com/"],
    ["a bare handle", "x", "SMIUK_"],
    ["junk", "linkedin", "https://"],
    // Review 16 Oct: the right host, but they forward anywhere.
    ["Facebook's link shim", "facebook", "https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example%2F"],
    ["Facebook's mobile link shim", "facebook", "https://lm.facebook.com/l.php?u=https://evil.example/"],
    ["l.php on the main host", "facebook", "https://www.facebook.com/l.php?u=https://evil.example/"],
    ["Facebook's external-link warning", "facebook", "https://www.facebook.com/flx/warn/?u=https://evil.example/"],
    ["an OAuth dialog with a return URL", "facebook", "https://www.facebook.com/dialog/oauth?client_id=1&redirect_uri=https://evil.example/"],
    ["LinkedIn's redirector", "linkedin", "https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fevil.example"],
    ["LinkedIn's external-link warning", "linkedin", "https://www.linkedin.com/safety/go?url=https://evil.example"],
    ["a sign-in page with a return URL", "linkedin", "https://www.linkedin.com/login?session_redirect=https://evil.example"],
    ["X's redirector", "x", "https://x.com/i/redirect?url=https://evil.example"],
    ["a share intent", "x", "https://twitter.com/intent/tweet?url=https://smi.example/news/x"],
    ["any URL carried in a parameter", "linkedin", "https://www.linkedin.com/posts/x?next=//evil.example"],
  ] as const)("refuses %s", (_label, network, url) => {
    expect(storyPostUrl(network, url)).toBeNull();
  });
});

describe("parseStoryPosts", () => {
  const fields = (v: Record<string, string>) => (k: string) => v[k] ?? "";

  it("keeps the filled-in posts and leaves blanks out", () => {
    expect(parseStoryPosts(fields({ linkedin: " https://www.linkedin.com/posts/a ", x: "" }))).toEqual({
      value: { linkedin: "https://www.linkedin.com/posts/a" },
    });
  });

  it("names the network of the first bad link", () => {
    const r = parseStoryPosts(fields({ facebook: "https://example.com/post" }));
    expect(r).toEqual({ error: expect.stringContaining("Facebook") });
  });
});

describe("storyPostLinks", () => {
  it("one link per network, the post where there is one, SMI's page otherwise", () => {
    const links = storyPostLinks({ linkedin: "https://www.linkedin.com/posts/a" });
    expect(links.map((l) => l.key)).toEqual(["linkedin", "facebook", "x"]);
    expect(links[0]).toMatchObject({ href: "https://www.linkedin.com/posts/a", isPost: true });
    expect(links[1]).toMatchObject({ href: SMI_SOCIAL_URLS.facebook, isPost: false });
    expect(links[2]).toMatchObject({ href: SMI_SOCIAL_URLS.x, isPost: false });
  });

  it("doesn't trust what's stored: a bad value falls back to SMI's page", () => {
    const links = storyPostLinks({ x: "javascript:alert(1)", facebook: 42 });
    expect(links.every((l) => !l.isPost)).toBe(true);
  });

  it("copes with nothing stored at all", () => {
    expect(storyPostLinks(null)).toHaveLength(3);
    expect(storyPostLinks([])).toHaveLength(3);
  });
});

// The post links are filled from Buffer in the background (21 Oct); saving an
// editor opened before that must not wipe them.
describe("keepUntouchedPosts", () => {
  const LI = "https://www.linkedin.com/feed/update/urn:li:share:1";
  const was = (m: Record<string, string>) => (k: string) => m[k] ?? null;

  it("keeps a link filled in since the form opened when the field wasn't touched", () => {
    expect(keepUntouchedPosts({}, { linkedin: LI }, was({ linkedin: "", facebook: "", x: "" }))).toEqual({ linkedin: LI });
  });

  it("takes what the editor changed — a new link, or clearing one", () => {
    const FB = "https://www.facebook.com/smi/posts/1";
    expect(keepUntouchedPosts({ linkedin: LI, facebook: FB }, { linkedin: LI }, was({ linkedin: LI, facebook: "", x: "" }))).toEqual({ linkedin: LI, facebook: FB });
    expect(keepUntouchedPosts({}, { linkedin: LI }, was({ linkedin: LI, facebook: "", x: "" }))).toEqual({});
  });

  it("without the form's record of what it showed, the submitted values stand", () => {
    expect(keepUntouchedPosts({}, { linkedin: LI }, () => null)).toEqual({});
  });
});
