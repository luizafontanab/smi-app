import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedChannelDetails, cachedChannelNetworks, channelLabel, clearChannelDetailsCache, channelPosts, channelText, clearChannelNetworksCache, fitTagsToX, getSocialPublisher, isSocialLive, MAX_EXTRA_TAGGED_MEMBERS, X_MAX_LENGTH, xLength,
  type SocialPost,
} from "@/lib/adapters/social";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  text: "First line\nSecond line",
  imagePath: null,
  tagHandles: {},
  ...over,
});

const send = (over: Partial<{ channelId: string; text: string; imagePath: string | null }> = {}) => ({
  channelId: "channel-1", text: "Hello world", imagePath: null, ...over,
});

/** Configures serviceDb() to return the given "social_channels" settings row. */
function withSettings(value: Record<string, unknown>) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: () => queryBuilder(dbOk({ value })),
  })));
}

/** A Buffer GraphQL success, which is an HTTP 200 like every other outcome. */
const ok = () =>
  new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "p1" } } } }), {
    status: 200,
  });

/** The `input` object sent on the nth fetch call. */
const inputOf = (spy: ReturnType<typeof vi.spyOn>, n = 0) =>
  JSON.parse(spy.mock.calls[n][1]?.body as string).variables.input;

describe("getSocialPublisher — local dev stub", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it("logs the channel and the first line only, truncated to 80 chars, and sends nothing", async () => {
    const sent = await getSocialPublisher().publishChannel(send({ text: "x".repeat(100) + "\nignored second line" }));

    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).toContain("channel-1");
    expect(logged).toContain("x".repeat(80));
    expect(logged).not.toContain("ignored second line");
    expect(sent).toBeNull();
  });

  it("knows no networks, so every channel gets the fallback text", async () => {
    await expect(getSocialPublisher().channelNetworks()).resolves.toEqual({ kind: "unknown" });
  });
});

describe("channelText — tags", () => {
  it("reduces CRM-stored handles and URLs to a readable tag, each network's own", () => {
    const p = post({ text: "Hello", tagHandles: { linkedin: "acme-ltd", x: "https://x.com/acme" } });
    expect(channelText(p, "linkedin")).toBe("Hello\n\nlinkedin:acme-ltd");
    expect(channelText(p, "twitter")).toBe("Hello\n\nx:@acme");
  });

  it("falls back to the stored value when it can't be resolved to a handle", () => {
    expect(channelText(post({ text: "Hello", tagHandles: { x: "" } }), "twitter")).toBe("Hello\n\nx:");
  });

  it("is the body alone with no tags", () => {
    expect(channelText(post({ text: "Hello" }), "linkedin")).toBe("Hello");
  });

  // Jas 13/10 item 12: co-featured members are tagged too — deduped, and capped
  // so a dozen-member story doesn't turn the post into a list of handles.
  it("tags the extras after the primary, once each", () => {
    const text = channelText(post({ text: "Hello", tagHandles: { x: "acme" }, extraTagHandles: [{ x: "blmgroup" }, { x: "acme" }] }), "twitter");
    expect(text).toContain("x:@acme x:@blmgroup");
    expect(text.match(/@acme/g)).toHaveLength(1);
  });

  it(`stops after ${MAX_EXTRA_TAGGED_MEMBERS} extra members`, () => {
    const extras = Array.from({ length: MAX_EXTRA_TAGGED_MEMBERS + 3 }, (_, i) => ({ linkedin: `member${i}` }));
    const text = channelText(post({ text: "Hello", extraTagHandles: extras }), "linkedin");
    expect(text.match(/linkedin:member/g)).toHaveLength(MAX_EXTRA_TAGGED_MEMBERS);
  });
});

describe("getSocialPublisher — Buffer", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
  });

  it("sends one createPost mutation for the channel, with the token and exactly the text given", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publishChannel(send({ text: "Hello world\n\nlinkedin:acme" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.buffer.com");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer buffer-token");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(inputOf(fetchSpy).text).toBe("Hello world\n\nlinkedin:acme");
    expect(inputOf(fetchSpy).channelId).toBe("channel-1");
  });

  it("posts immediately and schedules nothing of its own — our job queue owns the timing", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publishChannel(send());

    // A queue-shaped mode or a dueAt would stack Buffer's delay on top of our own.
    const input = inputOf(fetchSpy);
    expect(input.mode).toBe("shareNow");
    expect(input.schedulingType).toBe("custom");
    expect(input.dueAt).toBeUndefined();
  });

  it("attaches the image by public URL when imagePath resolves", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publishChannel(send({ imagePath: "stories/cover.jpg" }));

    expect(inputOf(fetchSpy).assets[0].image.url).toContain("stories/cover.jpg");
  });

  it("throws with the channel and the response detail when Buffer rejects the request", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad token", { status: 401 }));

    await expect(getSocialPublisher().publishChannel(send())).rejects.toThrow(/channel-1.*401/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "social:buffer-publish" }));
  });

  it("logs and rethrows on a network failure so the job retries", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(getSocialPublisher().publishChannel(send())).rejects.toThrow("network down");
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "social:buffer-publish" }));
  });

  // The three below all return HTTP 200. The pre-GraphQL `!res.ok` check read
  // every one of them as a successful post.

  it("fails on a MutationError returned with HTTP 200", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { createPost: { __typename: "MutationError", message: "Channel not found" } } }), { status: 200 }),
    );

    await expect(getSocialPublisher().publishChannel(send())).rejects.toThrow(/Channel not found/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "social:buffer-publish" }));
  });

  it("fails on a top-level GraphQL error returned with HTTP 200", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "Cannot query field createPost" }] }), { status: 200 }),
    );

    await expect(getSocialPublisher().publishChannel(send())).rejects.toThrow(/Cannot query field createPost/);
  });

  it("fails on a non-JSON 200 body rather than reading undefined as success", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));

    await expect(getSocialPublisher().publishChannel(send())).rejects.toThrow(/non-JSON/i);
  });
});

// social_push stamps a channel posted only for a real post, so the editor
// never says "posted" for what the logging stub swallowed.
describe("isSocialLive", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true only when a Buffer token is configured", () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    expect(isSocialLive()).toBe(false);
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "test-not-a-real-token");
    expect(isSocialLive()).toBe(true);
  });
});

// The story page's post links are filled from Buffer, not pasted (21 Oct).
describe("Buffer — the live links of SMI's posts", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns the accepted post's id, network, status and link, asking createPost for them", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply({ createPost: {
      __typename: "PostActionSuccess",
      post: { id: "p1", channelService: "linkedin", status: "sent", externalLink: "https://www.linkedin.com/feed/update/urn:li:share:1" },
    } }));

    const sent = await getSocialPublisher().publishChannel(send());

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).query).toContain("externalLink");
    expect(sent).toEqual({ id: "p1", service: "linkedin", status: "sent", link: "https://www.linkedin.com/feed/update/urn:li:share:1" });
  });

  it("still counts a success that came back without its post", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply({ createPost: { __typename: "PostActionSuccess" } }));

    await expect(getSocialPublisher().publishChannel(send())).resolves.toBeNull();
  });

  it("looks posts up by id, leaving out any it can't read", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { id } = JSON.parse((init as RequestInit).body as string).variables.input;
      if (id === "gone") return reply({ post: null });
      if (id === "broken") return new Response("nope", { status: 500 });
      return reply({ post: { id, channelService: "facebook", status: "sent", externalLink: "https://www.facebook.com/smi/posts/1" } });
    });

    const found = await getSocialPublisher().postLinks(["p1", "gone", "broken"]);

    expect(found).toEqual([{ id: "p1", service: "facebook", status: "sent", link: "https://www.facebook.com/smi/posts/1" }]);
  });

  it("the local stub finds nothing", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    await expect(getSocialPublisher().postLinks(["p1"])).resolves.toEqual([]);
  });
});

// GAPS B4.5 / issue #43: each channel gets its own network's text, an X post
// stays within 280, and a failed lookup is never mistaken for "no networks".
describe("channel networks and each channel's post", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  const channels = (list: { id: string; service: string }[]) =>
    new Response(JSON.stringify({ data: { channels: list } }), { status: 200 });

  it("looks up each channel's network with the stored organisation id", async () => {
    withSettings({ channelIds: ["li-1", "x-1"], organizationId: "org-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(channels([{ id: "li-1", service: "linkedin" }, { id: "x-1", service: "twitter" }]));

    const networks = await getSocialPublisher().channelNetworks();

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).query).toContain('organizationId: "org-1"');
    expect(networks).toEqual({ kind: "known", services: new Map([["li-1", "linkedin"], ["x-1", "twitter"]]) });
  });

  it("has nothing to look up without an organisation id, and doesn't call Buffer", async () => {
    withSettings({ channelIds: ["li-1"] });
    fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getSocialPublisher().channelNetworks()).resolves.toEqual({ kind: "unknown" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a failed lookup as failed, not as unknown", async () => {
    withSettings({ channelIds: ["li-1"], organizationId: "org-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(getSocialPublisher().channelNetworks()).resolves.toEqual({ kind: "failed" });
  });

  const LINK = "https://sheetmetalindustries.com/news/a-story";
  const fivemembers = post({
    text: `${"word ".repeat(40).trim()}\n\n${LINK}`,
    imagePath: "covers/a.jpg",
    tagHandles: { x: "acmeengineering", linkedin: "acme-engineering-ltd", facebook: "acmeeng" },
    extraTagHandles: Array.from({ length: 4 }, (_, i) => ({ x: `featuredmember${i}ltd`, linkedin: `featured-member-${i}-limited` })),
  });

  it("gives each channel only its own network's tags, with the image", () => {
    const known = { kind: "known" as const, services: new Map([["li-1", "linkedin"], ["x-1", "twitter"]]) };
    const [li, x] = channelPosts(post({ text: "Hello", imagePath: "c.jpg", tagHandles: { linkedin: "acme-ltd", x: "acme" } }), ["li-1", "x-1"], known);
    expect(li).toEqual({ network: "linkedin", post: { channelId: "li-1", text: "Hello\n\nlinkedin:acme-ltd", imagePath: "c.jpg" } });
    expect(x).toEqual({ network: "twitter", post: { channelId: "x-1", text: "Hello\n\nx:@acme", imagePath: "c.jpg" } });
  });

  it("keeps an X post within 280 with five members tagged, dropping the co-featured ones first", () => {
    const [{ post: { text } }] = channelPosts(fivemembers, ["x-1"], { kind: "known", services: new Map([["x-1", "twitter"]]) });
    expect(xLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(text).toContain("x:@acmeengineering");
    expect(text).not.toContain("linkedin:");
    expect(text).not.toContain("x:@featuredmember3ltd");
  });

  it("fits one text to X's limit for every channel when the network isn't known", () => {
    for (const networks of [{ kind: "unknown" as const }, { kind: "failed" as const }]) {
      const [a, b] = channelPosts(fivemembers, ["a", "b"], networks);
      expect(a.post.text).toBe(b.post.text);
      expect(a.network).toBeNull();
      expect(xLength(a.post.text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    }
  });

  it("labels a channel by its network, or by its id when that isn't known", () => {
    expect(channelLabel("li-1", "linkedin")).toBe("LinkedIn");
    expect(channelLabel("x-1", "twitter")).toBe("X");
    expect(channelLabel("abc123", null)).toBe("Channel abc123");
  });

  it("labels a channel by network and name once Buffer's details are known", () => {
    const detail = { id: "li-1", service: "linkedin", name: "Sheet Metal Industries", disconnected: false, locked: false, profileUrl: null };
    expect(channelLabel("li-1", "linkedin", detail)).toBe("LinkedIn · Sheet Metal Industries");
    // The network lookup failed, the details didn't: the details still name it.
    expect(channelLabel("li-1", null, detail)).toBe("LinkedIn · Sheet Metal Industries");
    expect(channelLabel("li-1", "linkedin", { ...detail, name: "" })).toBe("LinkedIn");
  });
});

describe("xLength / fitTagsToX", () => {
  it("counts any link as 23", () => {
    expect(xLength(`ab https://example.com/${"x".repeat(100)}`)).toBe(3 + 23);
  });

  it("adds tags while they fit and stops at the first that doesn't", () => {
    const body = "y".repeat(260); // +2+6 = 268 fits; +1+18 would be 287
    expect(fitTagsToX(body, ["x:@one", "x:@twotwotwotwotwo", "x:@3"])).toBe(`${body}\n\nx:@one`);
  });
});

describe("cachedChannelNetworks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    vi.restoreAllMocks();
    clearChannelNetworksCache();
  });

  it("asks Buffer once for a few minutes, then again; a failed answer is never kept", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    withSettings({ channelIds: ["li"], organizationId: "org-1" });
    const ok = () => new Response(JSON.stringify({ data: { channels: [{ id: "li", service: "linkedin" }] } }));
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());
    const t = Date.now();

    expect((await cachedChannelNetworks(t)).kind).toBe("failed");
    expect((await cachedChannelNetworks(t)).kind).toBe("known"); // the failure wasn't kept
    expect((await cachedChannelNetworks(t + 60_000)).kind).toBe("known");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await cachedChannelNetworks(t + 6 * 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

// The console's names and details for each channel: a lookup of its own, so
// it can never change what a post says.
describe("channel details", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
    clearChannelDetailsCache();
  });

  const reply = (channels: Record<string, unknown>[]) =>
    new Response(JSON.stringify({ data: { channels } }), { status: 200 });

  it("reads each channel's name, network, connection and profile link from the stored organisation", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    withSettings({ channelIds: ["li-1"], organizationId: "org-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply([
      { id: "li-1", service: "linkedin", name: "smi", displayName: "Sheet Metal Industries", isDisconnected: false, isLocked: false, externalLink: "https://www.linkedin.com/company/smi" },
      { id: "x-1", service: "twitter", name: "SheetMetalInd", displayName: null, isDisconnected: true, isLocked: false, externalLink: "javascript:alert(1)" },
    ]));

    const details = await getSocialPublisher().channelDetails();

    const query = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).query as string;
    expect(query).toContain('organizationId: "org-1"');
    expect(query).toContain("displayName");
    expect(details).toEqual({
      kind: "known",
      channels: new Map([
        ["li-1", { id: "li-1", service: "linkedin", name: "Sheet Metal Industries", disconnected: false, locked: false, profileUrl: "https://www.linkedin.com/company/smi" }],
        // Falls back to the handle, and a link that isn't a web address is dropped.
        ["x-1", { id: "x-1", service: "twitter", name: "SheetMetalInd", disconnected: true, locked: false, profileUrl: null }],
      ]),
    });
  });

  it("says why there's nothing to show: no key, or no organisation id", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    await expect(getSocialPublisher().channelDetails()).resolves.toEqual({ kind: "unknown", reason: "no-key" });

    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    withSettings({ channelIds: ["li-1"] });
    fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(getSocialPublisher().channelDetails()).resolves.toEqual({ kind: "unknown", reason: "no-organisation" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a GraphQL error as failed, so the console never shows a half answer", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    withSettings({ channelIds: ["li-1"], organizationId: "org-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "Cannot query field" }] }), { status: 200 }),
    );

    await expect(getSocialPublisher().channelDetails()).resolves.toEqual({ kind: "failed" });
  });

  it("is remembered for a few minutes; a failed answer is never kept", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    withSettings({ channelIds: ["li"], organizationId: "org-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(reply([{ id: "li", service: "linkedin", name: "smi" }]))
      .mockResolvedValueOnce(reply([{ id: "li", service: "linkedin", name: "smi" }]));
    const t = Date.now();

    expect((await cachedChannelDetails(t)).kind).toBe("failed");
    expect((await cachedChannelDetails(t)).kind).toBe("known");
    expect((await cachedChannelDetails(t + 60_000)).kind).toBe("known");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    clearChannelDetailsCache();
    await cachedChannelDetails(t + 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
