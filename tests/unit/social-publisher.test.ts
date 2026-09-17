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
function withChannels(profileIds: string[]) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: () => queryBuilder(dbOk({ value: { profileIds } })),
  })));
}

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

  it("posts to the Buffer API with the token, text, and each configured channel", async () => {
    withChannels(["profile-1", "profile-2"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await getSocialPublisher().publish(post({ text: "Hello world" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.bufferapp.com/1/updates/create.json");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer buffer-token");
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("text")).toBe("Hello world");
    expect(body.getAll("profile_ids[]")).toEqual(["profile-1", "profile-2"]);
  });

  it("appends tag handles to the text body — real @-tagging support is unresolved (B4.3)", async () => {
    withChannels(["profile-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await getSocialPublisher().publish(post({ text: "Hello", tagHandles: { linkedin: "acme-ltd" } }));

    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.get("text")).toBe("Hello\n\nlinkedin:acme-ltd");
  });

  it("attaches the image when imagePath resolves to a URL", async () => {
    withChannels(["profile-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await getSocialPublisher().publish(post({ imagePath: "stories/cover.jpg" }));

    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.get("media[photo]")).toContain("stories/cover.jpg");
  });

  it("refuses to post when no Buffer channel is configured, without ever calling fetch", async () => {
    withChannels([]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/no buffer channel/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws with the response detail when Buffer rejects the request", async () => {
    withChannels(["profile-1"]);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad token", { status: 401 }));

    await expect(getSocialPublisher().publish(post())).rejects.toThrow(/401/);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs and rethrows on a network failure so the job retries", async () => {
    withChannels(["profile-1"]);
    const failure = new Error("network down");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(failure);

    await expect(getSocialPublisher().publish(post())).rejects.toThrow("network down");
    expect(errorSpy).toHaveBeenCalled();
  });
});
