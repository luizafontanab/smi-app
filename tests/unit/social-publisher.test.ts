import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSocialPublisher, type SocialPost } from "@/lib/adapters/social";
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
