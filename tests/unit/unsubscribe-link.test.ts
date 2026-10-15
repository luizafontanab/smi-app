import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

// The signed, two-step typed-address unsubscribe (review finding 16 Oct): the
// old form permanently unsubscribed whatever address anyone typed, and pushed
// it to Bigin.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { send, syncContactToCrm, logError, allowRequest, after } = vi.hoisted(() => ({
  send: vi.fn(async () => {}),
  syncContactToCrm: vi.fn(async () => {}),
  logError: vi.fn(),
  allowRequest: vi.fn(async () => true),
  // after() runs its work once the response is sent; here, collected and run by hand.
  after: vi.fn((task: () => unknown) => { void task; }),
}));
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: () => ({ send }) }));
vi.mock("@/lib/adapters/crm", () => ({ syncContactToCrm }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), allowRequest }));
vi.mock("next/server", () => ({ after }));

import {
  sendUnsubscribeLink,
  signUnsubscribeToken,
  unsubscribeAddress,
  unsubscribeConfigured,
  UNSUBSCRIBE_LINK_HOURS,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribe";
import { confirmUnsubscribe, requestUnsubscribe } from "@/app/unsubscribe/actions";
import { renderUnsubscribeConfirmation } from "@/lib/email/templates";

const SECRET = "test-unsubscribe-secret-0123456789abcdef";
const HOUR = 3_600_000;

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDbServerMocks();
  send.mockReset().mockResolvedValue(undefined);
  syncContactToCrm.mockReset().mockResolvedValue(undefined);
  logError.mockReset();
  allowRequest.mockReset().mockResolvedValue(true);
  after.mockReset();
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A contacts table answering lookups with `row`. */
function contacts(row: Record<string, unknown> | null) {
  const builder = queryBuilder(dbOk(row));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ contacts: () => builder }) })));
  return builder;
}

let n = 0;
/** A fresh address per test: the per-address mail throttle is real, in-memory state. */
const address = () => `reader${++n}-${Date.now()}@example.com`;

describe("unsubscribe tokens", () => {
  it("round-trip the address they were signed for", () => {
    const token = signUnsubscribeToken("reader@example.com")!;
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, email: "reader@example.com" });
  });

  it("expire after the advertised window", () => {
    const now = Date.UTC(2026, 9, 16);
    const token = signUnsubscribeToken("reader@example.com", now)!;
    expect(verifyUnsubscribeToken(token, now + (UNSUBSCRIBE_LINK_HOURS - 1) * HOUR).ok).toBe(true);
    expect(verifyUnsubscribeToken(token, now + UNSUBSCRIBE_LINK_HOURS * HOUR + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse a token whose address was swapped for someone else's", () => {
    const [, expires, signature] = signUnsubscribeToken("me@example.com")!.split(".");
    const forged = `${Buffer.from("victim@example.com").toString("base64url")}.${expires}.${signature}`;
    expect(verifyUnsubscribeToken(forged)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuse a token whose expiry was pushed out — the expiry is signed too", () => {
    const [email, expires, signature] = signUnsubscribeToken("me@example.com")!.split(".");
    expect(verifyUnsubscribeToken(`${email}.${Number(expires) + 86_400}.${signature}`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuse a token signed with another key, and junk", () => {
    const token = signUnsubscribeToken("me@example.com")!;
    vi.stubEnv("UNSUBSCRIBE_SECRET", "a-completely-different-secret-of-length-40");
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: "invalid" });
    for (const junk of ["", "a.b", "a.b.c.d", "x.1.y", "%%%.%%%.%%%"]) {
      expect(verifyUnsubscribeToken(junk).ok).toBe(false);
    }
  });

  it("fail closed with no secret, or one too short to be a key", () => {
    const token = signUnsubscribeToken("me@example.com")!;
    for (const value of ["", "short-secret"]) {
      vi.stubEnv("UNSUBSCRIBE_SECRET", value);
      expect(unsubscribeConfigured()).toBe(false);
      expect(signUnsubscribeToken("me@example.com")).toBeNull();
      expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, reason: "unconfigured" });
    }
  });
});

describe("sendUnsubscribeLink", () => {
  it("emails a contact a signed link to the confirm page", async () => {
    const email = address();
    contacts({ id: "c1", unsubscribed_at: null });
    await sendUnsubscribeLink(email);

    expect(send).toHaveBeenCalledTimes(1);
    const mail = (send.mock.calls[0] as unknown as [{ to: string; text: string }])[0];
    expect(mail.to).toBe(email);
    const token = decodeURIComponent(/\/unsubscribe\?t=(\S+)/.exec(mail.text)![1]);
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, email });
  });

  it("sends nothing to an address that isn't a contact, or has already unsubscribed", async () => {
    contacts(null);
    await sendUnsubscribeLink(address());
    contacts({ id: "c1", unsubscribed_at: "2026-01-01T00:00:00Z" });
    await sendUnsubscribeLink(address());
    expect(send).not.toHaveBeenCalled();
  });

  it("can't be used to flood one inbox: three emails an hour per address", async () => {
    const email = address();
    contacts({ id: "c1", unsubscribed_at: null });
    for (let i = 0; i < 5; i++) await sendUnsubscribeLink(email);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("never throws — a failed send is logged", async () => {
    contacts({ id: "c1", unsubscribed_at: null });
    send.mockRejectedValue(new Error("Resend 403"));
    await expect(sendUnsubscribeLink(address())).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});

describe("unsubscribeAddress", () => {
  it("stamps the permanent opt-out and tells Bigin", async () => {
    const builder = contacts({ id: "c1", subscribed: true, unsubscribed_at: null });
    await unsubscribeAddress("reader@example.com");
    expect(builder.update).toHaveBeenCalledWith({ subscribed: false, unsubscribed_at: expect.any(String) });
    expect(syncContactToCrm).toHaveBeenCalledWith("c1");
  });

  it("leaves an already-unsubscribed contact exactly as it is", async () => {
    const builder = contacts({ id: "c1", subscribed: false, unsubscribed_at: "2026-01-01T00:00:00Z" });
    await unsubscribeAddress("reader@example.com");
    expect(builder.update).not.toHaveBeenCalled();
    expect(syncContactToCrm).not.toHaveBeenCalled();
  });
});

describe("requestUnsubscribe (typing an address)", () => {
  it("no longer unsubscribes anything — it schedules the confirmation email and answers the same either way", async () => {
    const builder = contacts({ id: "c1", subscribed: true, unsubscribed_at: null });
    await expect(requestUnsubscribe(form({ email: " Reader@Example.com " }))).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?sent=1");
    expect(builder.update).not.toHaveBeenCalled();
    expect(syncContactToCrm).not.toHaveBeenCalled();
    // the lookup and the send happen after the response, so timing can't tell a contact from a stranger
    expect(after).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a malformed address, and anything over the caller's rate limit", async () => {
    await expect(requestUnsubscribe(form({ email: "nope" }))).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?error=email");
    allowRequest.mockResolvedValue(false);
    await expect(requestUnsubscribe(form({ email: "a@example.com" }))).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?error=limit");
    expect(after).not.toHaveBeenCalled();
  });

  it("fails closed, and logs it, without the secret", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "");
    await expect(requestUnsubscribe(form({ email: "a@example.com" }))).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?error=unavailable");
    expect(after).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });
});

describe("confirmUnsubscribe (the button on the emailed link's page)", () => {
  it("applies the opt-out for the address the token was signed for", async () => {
    const builder = contacts({ id: "c1", subscribed: true, unsubscribed_at: null });
    await expect(confirmUnsubscribe(form({ t: signUnsubscribeToken("reader@example.com")! }))).rejects.toThrow("NEXT_REDIRECT:/unsubscribe?done=1");
    expect(builder.eq).toHaveBeenCalledWith("email", "reader@example.com");
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ subscribed: false }));
    expect(syncContactToCrm).toHaveBeenCalledWith("c1");
  });

  it.each([
    ["a forged token", () => "x.1.y", "invalid"],
    ["an expired token", () => signUnsubscribeToken("reader@example.com", Date.now() - (UNSUBSCRIBE_LINK_HOURS + 1) * HOUR)!, "expired"],
  ])("refuses %s and writes nothing", async (_label, token, reason) => {
    const builder = contacts({ id: "c1", subscribed: true, unsubscribed_at: null });
    await expect(confirmUnsubscribe(form({ t: token() }))).rejects.toThrow(`NEXT_REDIRECT:/unsubscribe?error=${reason}`);
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe("renderUnsubscribeConfirmation", () => {
  it("carries the link in both parts, escaped in the HTML", () => {
    const link = "https://smi.example/unsubscribe?t=a.b.c&x=<y>";
    const mail = renderUnsubscribeConfirmation({ link, validForHours: 72 });
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("https://smi.example/unsubscribe?t=a.b.c&amp;x=&lt;y&gt;");
    expect(mail.html).not.toContain("<y>");
    expect(mail.text).toMatch(/72 hours/);
  });
});
