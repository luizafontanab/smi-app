import { afterEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicSocialWriter, checkWording, getSocialWriter, SOCIAL_WRITER_MODEL, socialWriterLive, type WriteInput,
} from "@/lib/adapters/social-writer";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  vi.unstubAllEnvs();
  logError.mockReset();
});

const INPUT: WriteInput = {
  network: "linkedin",
  title: "Acme opens a new laser cell",
  summary: "Acme Engineering has added a fibre laser cell in Leeds.",
  body: "Acme Engineering has added a 12 kW fibre laser cell at its Leeds site.",
  companies: ["Acme Engineering"],
  maxLength: 1500,
};

/** A client whose beta.messages.create answers with `reply` (or throws it). */
function fakeClient(reply: unknown) {
  const create = vi.fn<(request: unknown) => Promise<unknown>>(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { create, client: { beta: { messages: { create } } } as unknown as Anthropic };
}
const answer = (text: string, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text }] });

describe("checkWording", () => {
  it("accepts wording within the limit, trimmed", () => {
    expect(checkWording("  Acme Engineering has a new laser cell.  ", 100)).toEqual({ ok: true, text: "Acme Engineering has a new laser cell." });
  });

  it("refuses wording over the limit rather than cutting it", () => {
    expect(checkWording("x".repeat(201), 200)).toEqual({ ok: false, reason: expect.stringMatching(/201 characters, over this network's 200/) });
  });

  it("refuses a link or an @handle, which the app adds itself", () => {
    for (const text of ["Read more at https://smi.test/x", "See www.acme.test", "Well done @acme"]) {
      expect(checkWording(text, 500)).toEqual({ ok: false, reason: expect.stringMatching(/link or an @handle/) });
    }
    // An email-like "@" inside a word isn't a handle.
    expect(checkWording("Contact sales@acme for details", 500).ok).toBe(true);
  });

  it("refuses empty wording", () => {
    expect(checkWording("   ", 500).ok).toBe(false);
  });
});

describe("AnthropicSocialWriter", () => {
  it("asks for a low-effort structured post with refusal fallbacks, giving the network and its limit", async () => {
    const { create, client } = fakeClient(answer(JSON.stringify({ text: "Acme Engineering has added a fibre laser cell in Leeds." })));

    const result = await new AnthropicSocialWriter(client).write(INPUT);

    expect(result).toEqual({ ok: true, text: "Acme Engineering has added a fibre laser cell in Leeds." });
    const request = create.mock.calls[0][0] as Record<string, unknown> & { messages: { content: string }[] };
    expect(request.model).toBe(SOCIAL_WRITER_MODEL);
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(request.messages[0].content).toContain("Network: linkedin");
    expect(request.messages[0].content).toContain("Length limit: 1500 characters");
    expect(request.messages[0].content).toContain("Acme Engineering");
  });

  it.each([
    ["a refusal", answer("", "refusal"), /declined/],
    ["output cut off", answer('{"text": "Acme', "max_tokens"), /didn't answer/],
    ["a non-JSON answer", answer("Here you go"), /didn't answer/],
    ["an API error", new Anthropic.APIError(500, undefined, "boom", undefined), /didn't answer/],
    ["wording over the limit", answer(JSON.stringify({ text: "x".repeat(1501) })), /over this network's 1500/],
  ])("turns %s into a reason, never a post", async (_, reply, reason) => {
    const { client } = fakeClient(reply);
    await expect(new AnthropicSocialWriter(client).write(INPUT)).resolves.toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });
});

describe("getSocialWriter", () => {
  it("does nothing without a key, and says so", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(socialWriterLive()).toBe(false);
    await expect(getSocialWriter().write(INPUT)).resolves.toEqual({ ok: false, reason: expect.stringMatching(/isn't set up/) });
  });

  it("uses Claude with a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(socialWriterLive()).toBe(true);
    expect(getSocialWriter()).toBeInstanceOf(AnthropicSocialWriter);
  });
});
