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
  writer: "",
  speaks_as_i: false,
};
const ACCEPTED = { ok: true, title: GOOD.title, excerpt: GOOD.summary, html: GOOD.body, unnamedWriter: false };

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
    expect(checkRewrite(INPUT, GOOD)).toEqual(ACCEPTED);
  });

  // A CEO's column (smmt.co.uk, 28 Oct): "I" is the writer, not the company.
  const COLUMN: RewriteInput = {
    company: "SMMT", title: "A path to zero", excerpt: null,
    html: "<p>I urge all companies to apply. I hope to see you there.</p><p>Mike Hawes, Chief Executive</p>",
  };
  const column = (body: string, writer: string) => ({ title: COLUMN.title, summary: "", body, writer, speaks_as_i: true });

  it("accepts \"I\" turned into a writer the article names", () => {
    const body = "<p>Mike Hawes urges all companies to apply. Hawes hopes to see you there.</p><p>Mike Hawes, Chief Executive</p>";
    expect(checkRewrite(COLUMN, column(body, "Mike Hawes"))).toEqual({ ok: true, title: COLUMN.title, excerpt: null, html: body, unnamedWriter: false });
  });

  it("rejects a writer's name the article doesn't contain — a guessed byline", () => {
    const input = { ...COLUMN, html: "<p>I urge all companies to apply. I hope to see you there.</p>" };
    const body = "<p>Mike Hawes urges all companies to apply. Hawes hopes to see you there.</p>";
    expect(checkRewrite(input, column(body, "Mike Hawes"))).toEqual({ ok: false, reason: expect.stringMatching(/named a writer the article doesn't/) });
  });

  it("flags an article written as \"I\" with no writer named, attributed to the company", () => {
    const input = { ...COLUMN, html: "<p>I urge all companies to apply. I hope to see you there.</p>" };
    const body = "<p>SMMT urges all companies to apply. SMMT hopes to see you there.</p>";
    expect(checkRewrite(input, column(body, ""))).toEqual(expect.objectContaining({ ok: true, unnamedWriter: true }));
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
    await expect(new AnthropicRewriter(client).toThirdPerson(INPUT)).resolves.toEqual(ACCEPTED);
    const request = create.mock.calls[0][0] as unknown as Record<string, unknown> & { output_config: { effort: string; format: { type: string; schema: { required: string[] } } } };
    expect(request).toEqual(expect.objectContaining({ model: REWRITE_MODEL, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] }));
    expect(request.output_config.effort).toBe("low");
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.output_config.format.schema.required).toEqual(expect.arrayContaining(["writer", "speaks_as_i"]));
    // The two rules the SMMT column broke (28 Oct): "we" read as "the UK", and "I" as the company.
    expect(String(request.system)).toMatch(/Never reinterpret them as anyone else/);
    expect(String(request.system)).toMatch(/Never take a name from anywhere else, and never guess one/);
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
