import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send, update, eq, withinLimit, logDb, digestRows } = vi.hoisted(() => {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const digestRows = { data: [] as unknown[], error: null as unknown };
  const chain = {
    select: () => chain, gte: () => chain, neq: () => chain, order: () => chain,
    limit: async () => digestRows,
    update,
  };
  return {
    send: vi.fn(async () => {}),
    update,
    eq,
    withinLimit: vi.fn(() => true),
    logDb: vi.fn(() => ({ from: () => chain })),
    digestRows,
  };
});
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: () => ({ send }) }));
vi.mock("@/lib/db/log-client", () => ({ logDb }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), withinLimit }));

import { maybeAlert, sendErrorDigest, shouldAlert, type LogResultRow } from "@/lib/log-alerts";

const row = (over: Partial<LogResultRow> = {}): LogResultRow => ({ event_id: "e1", is_new: true, reopened: false, alerted_at: null, status: "open", ...over });
const rec = { p_source: "server", p_area: "render:/x", p_message: "boom", p_path: "/x", p_stack: "Error: boom\n    at f (/app/src/x.ts:1:1)", p_digest: "123" };

beforeEach(() => {
  process.env.DEV_ALERT_EMAIL = "dev@example.com";
});
afterEach(() => {
  delete process.env.DEV_ALERT_EMAIL;
  vi.clearAllMocks();
  withinLimit.mockReturnValue(true);
  digestRows.data = [];
});

describe("shouldAlert", () => {
  it("alerts on a new error and on a reopened one", () => {
    expect(shouldAlert(row())).toBe(true);
    expect(shouldAlert(row({ is_new: false, reopened: true }))).toBe(true);
  });

  it("stays quiet on a repeat or an ignored error", () => {
    expect(shouldAlert(row({ is_new: false }))).toBe(false);
    expect(shouldAlert(row({ status: "ignored" }))).toBe(false);
    expect(shouldAlert(row({ status: "ignored", reopened: true, is_new: false }))).toBe(false);
  });

  // Found in the live check: a fix that didn't hold came back within the hour
  // and was silenced by the cooldown. Resolving is deliberate, so a reopen alerts.
  it("always alerts a reopen, even within an hour of the last alert", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(shouldAlert(row({ reopened: true, is_new: false, alerted_at: "2026-10-01T11:55:00Z" }), now)).toBe(true);
  });
});

describe("maybeAlert", () => {
  it("emails DEV_ALERT_EMAIL — never ADMIN_EMAIL — and stamps alerted_at", async () => {
    process.env.ADMIN_EMAIL = "jas@example.com";
    await maybeAlert(row(), rec);
    delete process.env.ADMIN_EMAIL;

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "dev@example.com", subject: expect.stringContaining("New error: boom") }),
      { idempotencyKey: expect.stringMatching(/^err-e1-/) },
    );
    expect(update).toHaveBeenCalledWith({ alerted_at: expect.any(String) });
    expect(eq).toHaveBeenCalledWith("id", "e1");
  });

  it("warns instead of sending when DEV_ALERT_EMAIL is unset", async () => {
    delete process.env.DEV_ALERT_EMAIL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await maybeAlert(row(), rec);
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DEV_ALERT_EMAIL"));
  });

  it("respects the hourly cap across all errors", async () => {
    withinLimit.mockReturnValue(false);
    await maybeAlert(row(), rec);
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws, even when the send fails — and leaves alerted_at unstamped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("provider down"));
    await expect(maybeAlert(row(), rec)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("sendErrorDigest", () => {
  it("sends nothing on a quiet day", async () => {
    expect(await sendErrorDigest()).toEqual({ sent: false, errors: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("lists the day's errors, busiest first, to the developer", async () => {
    digestRows.data = [
      { id: "e1", source: "server", area: "render:/x", message: "boom", count: 9, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), status: "open" },
    ];
    expect(await sendErrorDigest()).toEqual({ sent: true, errors: 1 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "dev@example.com", subject: "[SMI] 1 error in the last 24 hours", text: expect.stringContaining("9× server render:/x (new)") }),
      expect.anything(),
    );
  });
});
