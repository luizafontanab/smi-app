import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/bigin/route";

// logError is the seam these failure paths report through (docs/logging.md);
// mocked so a test never writes to the real error log.
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

/**
 * `/api/webhooks/bigin` is unauthenticated except for the token Bigin echoes
 * back, and it writes `contacts`. These pin the gate and the routing; what a
 * pulled record does to the table is covered in crm-adapter.test.ts.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { pullIds, unlink } = vi.hoisted(() => ({
  pullIds: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));
vi.mock("@/lib/adapters/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/crm")>()),
  getCrmSync: vi.fn(() => ({ pullIds, unlink })),
}));

afterEach(() => {
  pullIds.mockReset().mockResolvedValue(undefined);
  unlink.mockReset().mockResolvedValue(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TOKEN = "hook-token-123";

function notify(body: unknown) {
  return POST(new Request("http://localhost/api/webhooks/bigin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never);
}

const event = (over: Record<string, unknown> = {}) => ({
  module: "Contacts", operation: "update", ids: ["4876876000000123"], channel_id: 1001, token: TOKEN, ...over,
});

describe("/api/webhooks/bigin", () => {
  it("fails closed with 503 when BIGIN_WEBHOOK_TOKEN is not set", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", "");
    const res = await notify(event());
    expect(res.status).toBe(503);
    expect(pullIds).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing token with 401", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    expect((await notify(event({ token: "guess" }))).status).toBe(401);
    expect((await notify(event({ token: undefined }))).status).toBe(401);
    expect(pullIds).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    expect((await notify("not json")).status).toBe(400);
  });

  it("re-reads inserted and edited contacts from Bigin by id", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    expect((await notify(event({ operation: "insert" }))).status).toBe(200);
    expect((await notify(event({ operation: "update" }))).status).toBe(200);
    expect(pullIds).toHaveBeenCalledTimes(2);
    expect(pullIds).toHaveBeenCalledWith(["4876876000000123"]);
  });

  it("only unlinks on a delete — nothing is deleted here", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    await notify(event({ operation: "delete" }));
    expect(unlink).toHaveBeenCalledWith(["4876876000000123"]);
    expect(pullIds).not.toHaveBeenCalled();
  });

  it("ignores other modules, and ids that aren't Bigin's numeric ones", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    expect(await (await notify(event({ module: "Pipelines" }))).json()).toMatchObject({ ignored: "module" });
    expect(await (await notify(event({ ids: ["../../etc", "1 OR 1=1"] }))).json()).toMatchObject({ ignored: "no ids" });
    expect(pullIds).not.toHaveBeenCalled();
  });

  it("still answers 200 when the pull fails — the next poll catches up, a retry storm wouldn't help", async () => {
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", TOKEN);
    pullIds.mockRejectedValueOnce(new Error("Bigin down"));
    expect((await notify(event())).status).toBe(200);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ source: "webhook", area: "bigin-webhook:sync" }));
  });
});
