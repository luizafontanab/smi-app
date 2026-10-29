import { afterEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicRewriter, checkRewrite, getRewriter, REWRITE_MODEL, type RewriteInput } from "@/lib/adapters/rewrite";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  vi.unstubAllEnvs();
  logError.mockReset();
});

const INPUT: RewriteInput = {
  company: "Acme",
  title: "We win the award",
  excerpt: "Our team won.",
  html: '<p>We are proud. Read <a href="https://acme.test/x" rel="noopener nofollow">our post</a>.</p><h3>Next</h3><p>"We did it," said Jo.</p>',
};
const GOOD = {
  title: "Acme wins the award",
  summary: "Its team won.",
  body: '<p>Acme is proud. Read <a href="https://acme.test/x" rel="noopener nofollow">its post</a>.</p><h3>Next</h3><p>"We did it," said Jo.</p>',
};

/** A client whose beta.messages.create answers with `reply` (or throws it). */
function fakeClient(reply: unknown) {
  // Typed with its argument so the test can read the request back.
  const create = vi.fn<(request: unknown) => Promise<unknown>>(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { create, client: { beta: { messages: { create } } } as unknown as Anthropic };
}
const answer = (text: string, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text }] });

describe("checkRewrite", () => {
  it("accepts a change of person and tense", () => {
    expect(checkRewrite(INPUT, GOOD)).toEqual({ ok: true, title: GOOD.title, excerpt: GOOD.summary, html: GOOD.body });
  });

  it.each([
    ["a tag added", { ...GOOD, body: GOOD.body.replace("<h3>Next</h3>", "<h2>Next</h2>") }],
    ["a link changed", { ...GOOD, body: GOOD.body.replace("acme.test/x", "acme.test/y") }],
    ["text cut down", { ...GOOD, body: '<p>Proud. Read <a href="https://acme.test/x" rel="noopener nofollow">post</a>.</p><h3>Next</h3><p>Done.</p>' }],
    ["the title rewritten", { ...GOOD, title: "Acme Fabrication scoops the prestigious national manufacturing award for 2026" }],
    ["the summary dropped", { ...GOOD, summary: "" }],
  ])("rejects %s", (_, output) => {
    expect(checkRewrite(INPUT, output)).toEqual({ ok: false, reason: expect.stringMatching(/changed more than person and tense/) });
  });
});

describe("AnthropicRewriter", () => {
  it("asks for a low-effort structured rewrite with refusal fallbacks, and returns the checked result", async () => {
    const { client, create } = fakeClient(answer(JSON.stringify(GOOD)));
    await expect(new AnthropicRewriter(client).toThirdPerson(INPUT)).resolves.toEqual({ ok: true, title: GOOD.title, excerpt: GOOD.summary, html: GOOD.body });
    const request = create.mock.calls[0][0] as unknown as Record<string, unknown> & { output_config: { effort: string; format: { type: string } } };
    expect(request).toEqual(expect.objectContaining({ model: REWRITE_MODEL, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] }));
    expect(request.output_config.effort).toBe("low");
    expect(request.output_config.format.type).toBe("json_schema");
    // the system prompt holds nothing per-request, so it can be cached
    expect(String(request.system)).not.toContain("Acme");
  });

  it.each([
    ["a refusal", answer("", "refusal"), /declined/],
    ["running out of room", answer("{", "max_tokens"), /too long/],
    ["unreadable output", answer("not json"), /didn't answer/],
  ])("skips on %s, keeping the article's own wording", async (_, reply, reason) => {
    const { client } = fakeClient(reply);
    await expect(new AnthropicRewriter(client).toThirdPerson(INPUT)).resolves.toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it("an API error is logged and skipped, never thrown", async () => {
    const { client } = fakeClient(new Error("socket hang up"));
    await expect(new AnthropicRewriter(client).toThirdPerson(INPUT)).resolves.toEqual({ ok: false, reason: expect.stringMatching(/didn't answer/) });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ source: "adapter", area: "adapter:rewrite" }));
  });
});

describe("getRewriter", () => {
  it("without a key, skips and says why", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(getRewriter().toThirdPerson(INPUT)).resolves.toEqual({ ok: false, reason: expect.stringMatching(/isn't set up/) });
  });

  it("with a key, uses Anthropic", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(getRewriter()).toBeInstanceOf(AnthropicRewriter);
  });
});
