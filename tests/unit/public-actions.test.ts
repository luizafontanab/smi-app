import { afterEach, describe, expect, it, vi } from "vitest";
import { sendContactMessage, subscribeNewsletter } from "@/app/(public)/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { allowRequest, send, syncContactToCrm } = vi.hoisted(() => ({
  allowRequest: vi.fn(async () => true),
  send: vi.fn(async () => {}),
  syncContactToCrm: vi.fn(async () => {}),
}));
vi.mock("@/lib/adapters/crm", () => ({ syncContactToCrm }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest, HOUR: 3_600_000 }));
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));
vi.mock("@/lib/notify-admin", () => ({ ADMIN_EMAIL: "jas@sheetmetalindustries.com" }));

afterEach(() => {
  resetDbServerMocks();
  allowRequest.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue(undefined);
  syncContactToCrm.mockReset().mockResolvedValue(undefined);
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("subscribeNewsletter", () => {
  it("rejects a malformed email before checking the rate limit", async () => {
    const result = await subscribeNewsletter({ message: "" }, form({ email: "nope" }));
    expect(result).toEqual({ message: "Please enter a valid email." });
    expect(allowRequest).not.toHaveBeenCalled();
  });

  it("refuses over the rate limit", async () => {
    allowRequest.mockResolvedValue(false);
    const result = await subscribeNewsletter({ message: "" }, form({ email: "a@example.com" }));
    expect(result.message).toContain("Too many attempts");
  });

  it("refuses to silently re-subscribe a contact that previously opted out", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "c1", unsubscribed_at: "2026-01-01T00:00:00.000Z" })),
    })));

    const result = await subscribeNewsletter({ message: "" }, form({ email: "a@example.com" }));

    expect(result.message).toContain("previously unsubscribed");
  });

  it("records the signup and creates a new contact for a first-time address", async () => {
    const contactsBuilder = queryBuilder(dbOk(null));
    const signupsBuilder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => signupsBuilder }),
    })));

    const result = await subscribeNewsletter({ message: "" }, form({ email: "New@Example.com" }));

    expect(result).toEqual({ message: "Subscribed — see you next issue." });
    expect(signupsBuilder.insert).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(contactsBuilder.insert).toHaveBeenCalledWith({ email: "new@example.com", source: "newsletter", subscribed: true });
  });

  it("writes a new signup through to Bigin by contact id", async () => {
    let call = 0;
    // 1: the existing-contact lookup (none), 2: the insert returning the new id
    const contactsBuilder = queryBuilder(() => (call++ === 0 ? dbOk(null) : dbOk({ id: "c-new" })));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
    })));

    await subscribeNewsletter({ message: "" }, form({ email: "new@example.com" }));

    expect(syncContactToCrm).toHaveBeenCalledWith("c-new");
  });

  it("re-pushes an existing contact on a repeat signup", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => queryBuilder(dbOk({ id: "c1", unsubscribed_at: null })), newsletter_signups: () => queryBuilder(dbOk(null)) }),
    })));
    await subscribeNewsletter({ message: "" }, form({ email: "existing@example.com" }));
    expect(syncContactToCrm).toHaveBeenCalledWith("c1");
  });

  it("does not duplicate the contact row for an already-subscribed address", async () => {
    const contactsBuilder = queryBuilder(dbOk({ id: "c1", unsubscribed_at: null }));
    const signupsBuilder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => signupsBuilder }),
    })));

    await subscribeNewsletter({ message: "" }, form({ email: "existing@example.com" }));

    expect(signupsBuilder.insert).toHaveBeenCalled();
    expect(contactsBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("sendContactMessage", () => {
  it("requires every field", async () => {
    const result = await sendContactMessage({ message: "" }, form({ name: "", email: "a@example.com", message: "hi" }));
    expect(result).toEqual({ message: "All fields are required." });
  });

  it("refuses over the rate limit", async () => {
    allowRequest.mockResolvedValue(false);
    const result = await sendContactMessage({ message: "" }, form({ name: "A", email: "a@example.com", message: "hi" }));
    expect(result.message).toContain("Too many attempts");
  });

  it("defaults to 'contact' kind, and records 'advertising' only when explicitly flagged", async () => {
    const inboxBuilder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => inboxBuilder })));

    await sendContactMessage({ message: "" }, form({ name: "A", email: "a@example.com", message: "hi" }));
    expect(inboxBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "contact" }));

    await sendContactMessage({ message: "" }, form({ name: "A", email: "a@example.com", message: "hi", kind: "advertising" }));
    expect(inboxBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "advertising" }));
  });

  it("still acknowledges the visitor even when the admin email send fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));
    send.mockRejectedValue(new Error("Resend rejected the send (403)"));

    const result = await sendContactMessage({ message: "" }, form({ name: "A", email: "a@example.com", message: "hi" }));

    expect(result).toEqual({ message: "Thanks — we'll come back to you shortly." });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("acknowledges the visitor and sends nothing when ADMIN_EMAIL isn't configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("@/lib/notify-admin", () => ({ ADMIN_EMAIL: undefined }));
    vi.resetModules();
    const fresh = await import("@/app/(public)/actions");
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));

    const result = await fresh.sendContactMessage({ message: "" }, form({ name: "A", email: "a@example.com", message: "hi" }));

    expect(result).toEqual({ message: "Thanks — we'll come back to you shortly." });
    expect(warnSpy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
