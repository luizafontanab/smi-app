import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitTagsToX, getSocialPublisher, isSocialLive, MAX_EXTRA_TAGGED_MEMBERS, SocialPublishError, X_MAX_LENGTH, xLength, type SocialPost } from "@/lib/adapters/social";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  text: "First line\nSecond line",
  imagePath: null,
  tagHandles: {},
  ...over,
});

/** Configures serviceDb() to return the given "social_channels" settings row. */
function withChannels(channelIds: string[]) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: () => queryBuilder(dbOk({ value: { channelIds } })),
  })));
}

/** The v1 settings row, as it may still exist on disk from before the GraphQL migration. */
function withLegacyProfileIds(profileIds: string[]) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: () => queryBuilder(dbOk({ value: { profileIds } })),
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

  it("logs the first line only, truncated to 80 chars, when no token is configured", async () => {
    const publisher = getSocialPublisher();
    await publisher.publish(post({ text: "x".repeat(100) + "\nignored second line" }));

    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).toContain("x".repeat(80));
    expect(logged).not.toContain("ignored second line");
  });

  it("reduces CRM-stored handles and URLs to a readable tag", async () => {
    const publisher = getSocialPublisher();
    await publisher.publish(post({ tagHandles: { linkedin: "acme-ltd", x: "https://x.com/acme" } }));

    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).toContain("linkedin:acme-ltd");
    expect(logged).toContain("x:@acme");
  });

  it("falls back to the stored value when it can't be resolved to a handle", async () => {
    const publisher = getSocialPublisher();
    await publisher.publish(post({ tagHandles: { x: "" } }));

    expect(logSpy.mock.calls[0][0]).toContain("x:");
  });

  it("reports 'no tags' when tagHandles is empty", async () => {
    const publisher = getSocialPublisher();
    await publisher.publish(post());

    expect(logSpy.mock.calls[0][0]).toContain("no tags");
  });
});

describe("getSocialPublisher — Buffer", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    errorSpy.mockRestore();
  });

  it("sends one createPost mutation per configured channel, with the token and text", async () => {
    withChannels(["channel-1", "channel-2"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publish(post({ text: "Hello world" }));

    // profile_ids[] is gone — the GraphQL API takes a single channelId per call.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.buffer.com");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer buffer-token");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(inputOf(fetchSpy, 0).text).toBe("Hello world");
    expect(inputOf(fetchSpy, 0).channelId).toBe("channel-1");
    expect(inputOf(fetchSpy, 1).channelId).toBe("channel-2");
  });

  it("posts immediately and schedules nothing of its own — our job queue owns the timing", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publish(post());

    // A queue-shaped mode or a dueAt would stack Buffer's delay on top of the
    // +30 min our own publish_scheduled job already applied.
    const input = inputOf(fetchSpy);
    expect(input.mode).toBe("shareNow");
    expect(input.schedulingType).toBe("custom");
    expect(input.dueAt).toBeUndefined();
  });

  it("appends tag handles to the text body — real @-tagging needs an org URN we don't store (B4.3)", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publish(post({ text: "Hello", tagHandles: { linkedin: "acme-ltd" } }));

    expect(inputOf(fetchSpy).text).toBe("Hello\n\nlinkedin:acme-ltd");
  });

  it("attaches the image by public URL when imagePath resolves", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await getSocialPublisher().publish(post({ imagePath: "stories/cover.jpg" }));

    expect(inputOf(fetchSpy).assets[0].image.url).toContain("stories/cover.jpg");
  });

  it("refuses to post when no Buffer channel is configured, without ever calling fetch", async () => {
    withChannels([]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/no buffer channel/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats leftover v1 profile ids as no channels at all, and says so", async () => {
    withLegacyProfileIds(["profile-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    // Coercing a v1 profile id into a channelId would post to the wrong account.
    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/v1 profile ids/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws with the response detail when Buffer rejects the request", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad token", { status: 401 }));

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/401/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs and rethrows on a network failure so the job retries", async () => {
    withChannels(["channel-1"]);
    const failure = new Error("network down");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(failure);

    await expect(getSocialPublisher().publish(post())).rejects.toThrow("network down");
    expect(errorSpy).toHaveBeenCalled();
  });

  // The four below all return HTTP 200. The pre-migration `!res.ok` check read
  // every one of them as a successful post.

  it("fails on a MutationError returned with HTTP 200", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { createPost: { __typename: "MutationError", message: "Channel not found" } } }), { status: 200 }),
    );

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/Channel not found/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("fails on a top-level GraphQL error returned with HTTP 200", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "Cannot query field createPost" }] }), { status: 200 }),
    );

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/Cannot query field createPost/);
  });

  it("fails on a non-JSON 200 body rather than reading undefined as success", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>gateway</html>", { status: 200 }),
    );

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/non-JSON/i);
  });

  it("attempts every channel even when one fails, and names the failure", async () => {
    withChannels(["channel-1", "channel-2"]);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { createPost: { __typename: "MutationError", message: "revoked" } } }), { status: 200 }),
      );

    // One bad channel must not stop the others, and the error has to say which.
    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/channel-2: revoked/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// Jas 13/10 item 12: co-featured members are tagged too — deduped, and capped
// so a dozen-member story doesn't turn the post into a list of handles.
describe("formatTags with co-featured members", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it("tags the extras after the primary, once each", async () => {
    const publisher = getSocialPublisher();
    await publisher.publish(post({ tagHandles: { x: "acme" }, extraTagHandles: [{ x: "blmgroup" }, { x: "acme" }] }));
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain("x:@acme x:@blmgroup");
    expect(line.match(/@acme/g)).toHaveLength(1);
  });

  it(`stops after ${MAX_EXTRA_TAGGED_MEMBERS} extra members`, async () => {
    const publisher = getSocialPublisher();
    const extras = Array.from({ length: MAX_EXTRA_TAGGED_MEMBERS + 3 }, (_, i) => ({ x: `member${i}` }));
    await publisher.publish(post({ tagHandles: {}, extraTagHandles: extras }));
    const line = String(logSpy.mock.calls[0][0]);
    expect(line.match(/x:@member/g)).toHaveLength(MAX_EXTRA_TAGGED_MEMBERS);
  });
});

// Area 3: social_push stamps social_posted_at only for a real post, so the
// editor never says "Posted" for what the logging stub swallowed.
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
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns each accepted post's id, network, status and link, asking createPost for them", async () => {
    withChannels(["channel-1", "channel-2"]);
    let n = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply({ createPost: {
      __typename: "PostActionSuccess",
      post: n++ === 0
        ? { id: "p1", channelService: "linkedin", status: "sent", externalLink: "https://www.linkedin.com/feed/update/urn:li:share:1" }
        : { id: "p2", channelService: "twitter", status: "sending", externalLink: null },
    } }));

    const sent = await getSocialPublisher().publish(post());

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).query).toContain("externalLink");
    expect(sent).toEqual([
      { id: "p1", service: "linkedin", status: "sent", link: "https://www.linkedin.com/feed/update/urn:li:share:1" },
      { id: "p2", service: "twitter", status: "sending", link: null },
    ]);
  });

  it("still counts a success that came back without its post", async () => {
    withChannels(["channel-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply({ createPost: { __typename: "PostActionSuccess" } }));

    await expect(getSocialPublisher().publish(post())).resolves.toEqual([]);
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

  it("the local stub sends nothing and finds nothing", async () => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(getSocialPublisher().publish(post())).resolves.toEqual([]);
    await expect(getSocialPublisher().postLinks(["p1"])).resolves.toEqual([]);
  });
});

// GAPS B4.5: each channel gets its own network's tags, an X post stays within
// 280, and a retry never posts again to a channel that already took it.
describe("per-channel posts and retries (GAPS B4.5)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("BUFFER_ACCESS_TOKEN", "buffer-token");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbServerMocks();
    fetchSpy?.mockRestore();
    errorSpy.mockRestore();
  });

  function withOrg(channelIds: string[]) {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ value: { channelIds, organizationId: "org-1" } })),
    })));
  }
  const channels = (list: { id: string; service: string }[]) =>
    new Response(JSON.stringify({ data: { channels: list } }), { status: 200 });
  const failed = (message: string) =>
    new Response(JSON.stringify({ data: { createPost: { __typename: "MutationError", message } } }), { status: 200 });
  /** createPost inputs only — the channel lookup is the first call when an organisation id is stored. */
  const posted = (spy: ReturnType<typeof vi.spyOn>) =>
    (spy.mock.calls as [unknown, RequestInit | undefined][])
      .map(([, init]) => JSON.parse(init?.body as string) as { variables?: { input?: { channelId: string; text: string } } })
      .flatMap((body) => (body.variables?.input ? [body.variables.input] : []));

  const LINK = "https://sheetmetalindustries.com/news/a-story";
  const fivemembers = post({
    text: `${"word ".repeat(40).trim()}\n\n${LINK}`,
    tagHandles: { x: "acmeengineering", linkedin: "acme-engineering-ltd", facebook: "acmeeng" },
    extraTagHandles: Array.from({ length: 4 }, (_, i) => ({ x: `featuredmember${i}ltd`, linkedin: `featured-member-${i}-limited` })),
  });

  it("looks up each channel's network and tags only that network's handles", async () => {
    withOrg(["li-1", "x-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(channels([{ id: "li-1", service: "linkedin" }, { id: "x-1", service: "twitter" }]))
      .mockImplementation(async () => ok());

    await getSocialPublisher().publish(post({ text: "Hello", tagHandles: { linkedin: "acme-ltd", x: "acme" } }));

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).query).toContain('organizationId: "org-1"');
    const [li, x] = posted(fetchSpy);
    expect(li).toMatchObject({ channelId: "li-1", text: "Hello\n\nlinkedin:acme-ltd" });
    expect(x).toMatchObject({ channelId: "x-1", text: "Hello\n\nx:@acme" });
  });

  it("keeps an X post within 280 with five members tagged, dropping the co-featured ones first", async () => {
    withOrg(["x-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(channels([{ id: "x-1", service: "twitter" }]))
      .mockImplementation(async () => ok());

    await getSocialPublisher().publish(fivemembers);

    const [{ text }] = posted(fetchSpy);
    expect(xLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(text).toContain("x:@acmeengineering");
    expect(text).not.toContain("linkedin:");
    expect(text).not.toContain("x:@featuredmember3ltd");
  });

  it("fits one text to X's limit for every channel when the lookup fails", async () => {
    withOrg(["a", "b"]);
    fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockImplementation(async () => ok());

    await getSocialPublisher().publish(fivemembers);

    const [a, b] = posted(fetchSpy);
    expect(a.text).toBe(b.text);
    expect(xLength(a.text)).toBeLessThanOrEqual(X_MAX_LENGTH);
  });

  it("on a partial failure, throws with the channels that took it, and skips them on the retry", async () => {
    withOrg(["li-1", "x-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(channels([{ id: "li-1", service: "linkedin" }, { id: "x-1", service: "twitter" }]))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(failed("too long"));

    const error = await getSocialPublisher().publish(post()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocialPublishError);
    expect((error as SocialPublishError).doneChannelIds).toEqual(["li-1"]);
    expect((error as SocialPublishError).sent.map((p) => p.id)).toEqual(["p1"]);

    fetchSpy.mockReset()
      .mockResolvedValueOnce(channels([{ id: "li-1", service: "linkedin" }, { id: "x-1", service: "twitter" }]))
      .mockImplementation(async () => ok());
    await getSocialPublisher().publish(post(), { skipChannelIds: ["li-1"] });
    expect(posted(fetchSpy).map((p) => p.channelId)).toEqual(["x-1"]);
  });

  it("posts nothing, and doesn't look anything up, when every channel is already done", async () => {
    withOrg(["li-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());
    expect(await getSocialPublisher().publish(post(), { skipChannelIds: ["li-1"] })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
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
