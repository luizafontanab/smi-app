import { afterEach, describe, expect, it, vi } from "vitest";
import { resetNextHeadersMocks } from "../stubs/next-headers";

const { recordError, allowRequest } = vi.hoisted(() => ({
  recordError: vi.fn(async () => {}),
  allowRequest: vi.fn(async () => true),
}));
vi.mock("@/lib/log", () => ({ recordError }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), allowRequest }));
// after() needs a request scope that a unit test doesn't have — run the work inline.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

import { POST } from "@/app/api/client-errors/route";

const post = (body: unknown) =>
  new Request("http://localhost/api/client-errors", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => {
  vi.clearAllMocks();
  allowRequest.mockResolvedValue(true);
  resetNextHeadersMocks();
});

describe("POST /api/client-errors (docs/logging.md)", () => {
  it("records a browser error, grouped by section, without the server's own stack", async () => {
    const res = await POST(post({ message: "x is undefined", stack: null, kind: "boundary", path: "/news/some-story", digest: "99" }));
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(recordError).toHaveBeenCalled());
    const [input] = recordError.mock.calls[0] as unknown as [{ source: string; area: string; path: string; digest: string; error: Error }];
    expect(input).toMatchObject({ source: "client", area: "client:/news", path: "/news/some-story", digest: "99" });
    expect(input.error.stack).toBe("");
  });

  it("answers 204 and records nothing for a bad, oversized, noisy or rate-limited report", async () => {
    expect((await POST(post("not json"))).status).toBe(204);
    expect((await POST(post({ stack: "no message" }))).status).toBe(204);
    expect((await POST(post({ message: "x".repeat(9000) }))).status).toBe(204);
    expect((await POST(post({ message: "x", stack: "at chrome-extension://a/b.js" }))).status).toBe(204);
    allowRequest.mockResolvedValue(false);
    expect((await POST(post({ message: "real" }))).status).toBe(204);
    expect(recordError).not.toHaveBeenCalled();
  });
});
