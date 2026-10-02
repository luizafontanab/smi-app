import { afterEach, describe, expect, it, vi } from "vitest";

// Never let these tests reach a real database: vitest loads .env.local, so an
// unmocked logDb() would write to the local Supabase.
const { rpc, logDb, maybeAlert } = vi.hoisted(() => {
  const rpc = vi.fn(async () => ({ data: [{ event_id: "e1", is_new: true, reopened: false, alerted_at: null, status: "open" }], error: null }));
  return { rpc, logDb: vi.fn(() => ({ rpc })), maybeAlert: vi.fn(async () => {}) };
});
vi.mock("@/lib/db/log-client", () => ({ logDb }));
vi.mock("@/lib/log-alerts", () => ({ maybeAlert }));

import { buildRecord, describe as describeError, fingerprint, normaliseMessage, recordError, scrub, stripQuery } from "@/lib/log";

afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockClear();
  logDb.mockClear();
  maybeAlert.mockClear();
});

describe("fingerprint", () => {
  const stack = (line: number) => `Error: x\n    at memberBySlug (/app/src/lib/queries.ts:${line}:12)\n    at node:internal`;

  it("groups the same failure whatever ids or numbers it mentions", () => {
    const a = fingerprint("server", "render:/member/[slug]", "member 123 not found (3f2b8a1c-1d2e-4f5a-8b9c-0d1e2f3a4b5c)", null);
    const b = fingerprint("server", "render:/member/[slug]", "member 456 not found (00000000-0000-4000-8000-000000000000)", null);
    expect(a).toBe(b);
  });

  it("does not split a group when a rebuild moves the line number", () => {
    expect(fingerprint("server", "a", "boom", stack(10))).toBe(fingerprint("server", "a", "boom", stack(99)));
  });

  it("separates different areas and sources", () => {
    expect(fingerprint("server", "a", "boom", null)).not.toBe(fingerprint("server", "b", "boom", null));
    expect(fingerprint("server", "a", "boom", null)).not.toBe(fingerprint("client", "a", "boom", null));
  });

  it("normalises quoted values and numbers", () => {
    expect(normaliseMessage(`relation "stories" has 42 rows`)).toBe("relation <str> has <n> rows");
  });
});

describe("scrub", () => {
  it("redacts secret-looking keys at any depth", () => {
    expect(scrub({ a: 1, password: "x", nested: { apiKey: "k", Authorization: "Bearer t", inner: { session_token: "t" } } })).toEqual({
      a: 1,
      password: "[redacted]",
      nested: { apiKey: "[redacted]", Authorization: "[redacted]", inner: { session_token: "[redacted]" } },
    });
  });

  it("caps long strings and survives cycles", () => {
    const loop: Record<string, unknown> = { s: "x".repeat(2000) };
    loop.self = loop;
    const out = scrub(loop) as Record<string, unknown>;
    expect((out.s as string).length).toBeLessThan(600);
    expect(out.self).toBe("[…]");
  });

  it("strips query strings from paths — they carry tokens and search terms", () => {
    expect(stripQuery("/reset/confirm?token_hash=abc#x")).toBe("/reset/confirm");
    expect(stripQuery(null)).toBeNull();
  });
});

describe("buildRecord", () => {
  it("describes non-Error throws and caps the message", () => {
    expect(describeError("plain")).toEqual({ message: "plain", stack: null });
    const rec = buildRecord({ source: "server", area: "x", error: new Error("y".repeat(5000)), path: "/a?b=c", context: { cookie: "c" } });
    expect(rec.p_message.length).toBeLessThanOrEqual(1025);
    expect(rec.p_path).toBe("/a");
    expect(rec.p_context).toEqual({ cookie: "[redacted]" });
  });
});

describe("recordError", () => {
  it("prints the console line, records through the log client, and hands the verdict to alerting", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordError({ source: "server", area: "render:/x", error: new Error("boom") });

    expect(consoleErr).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] .*"message":"boom"/));
    expect(rpc).toHaveBeenCalledWith("log_error_event", expect.objectContaining({ p_source: "server", p_area: "render:/x", p_message: "boom" }));
    expect(maybeAlert).toHaveBeenCalledWith(expect.objectContaining({ event_id: "e1", is_new: true }), expect.objectContaining({ p_message: "boom" }));
  });

  it("never throws — not when the RPC fails, nor when the client itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation does not exist" } } as never);
    await expect(recordError({ source: "server", area: "x", error: new Error("a") })).resolves.toBeUndefined();
    expect(maybeAlert).not.toHaveBeenCalled();

    logDb.mockImplementationOnce(() => { throw new Error("no env"); });
    await expect(recordError({ source: "server", area: "x", error: new Error("b") })).resolves.toBeUndefined();
  });

  it("still prints the console line when there is no database client at all", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    logDb.mockReturnValueOnce(null as never);
    await recordError({ source: "client", area: "client:/news", error: new Error("c") });
    expect(consoleErr).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] /));
    expect(rpc).not.toHaveBeenCalled();
  });
});
