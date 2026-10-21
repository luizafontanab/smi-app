import { afterEach, describe, expect, it, vi } from "vitest";
import { sendContactMessage, subscribeNewsletter } from "@/app/(public)/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
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

    const result = await subscribeNewsletter({ message: "" }, form({ email: "New@Example.com", surface: "grid_footer" }));

    expect(result).toEqual({ message: "Subscribed — see you next issue." });
    expect(signupsBuilder.insert).toHaveBeenCalledWith({ email: "new@example.com" });
    // Gap review area 6: when, by which route, and against what wording.
    expect(contactsBuilder.insert).toHaveBeenCalledWith({
      email: "new@example.com", source: "newsletter", subscribed: true,
      opt_in_at: expect.any(String),
      opt_in_source: "site_form",
      opt_in_wording: "Monthly newsletter — UK sheet metal news, machinery launches and event dates, for free. [email address] [Subscribe]",
    });
  });

  it("records an unknown form surface as unknown rather than guessing its wording", async () => {
    const contactsBuilder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
    })));

    await subscribeNewsletter({ message: "" }, form({ email: "a@example.com", surface: "toString" }));

    expect(contactsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      opt_in_source: "site_form",
      opt_in_wording: "A newsletter signup form (which one wasn't recorded).",
    }));
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

  // GAPS B5.4: a known contact who was never on the list was told
  // "Subscribed" and left with subscribed = false — out of every send.
  it("opts in a known contact who wasn't on the list, conditional on them not having unsubscribed", async () => {
    const contactsBuilder = queryBuilder(dbOk({ id: "c1", subscribed: false, unsubscribed_at: null }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
    })));

    const result = await subscribeNewsletter({ message: "" }, form({ email: "known@example.com" }));

    expect(result).toEqual({ message: "Subscribed — see you next issue." });
    expect(contactsBuilder.update).toHaveBeenCalledWith({
      subscribed: true, unsubscribed_at: null,
      opt_in_at: expect.any(String), opt_in_source: "site_form", opt_in_wording: expect.any(String),
    });
    expect(contactsBuilder.eq).toHaveBeenCalledWith("id", "c1");
    expect(contactsBuilder.is).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(syncContactToCrm).toHaveBeenCalledWith("c1");
  });

  it("doesn't claim success when that opt-in fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    // 1: the lookup, 2: the update
    const contactsBuilder = queryBuilder(() => (call++ === 0 ? dbOk({ id: "c1", subscribed: false, unsubscribed_at: null }) : dbError("timeout")));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
    })));

    const result = await subscribeNewsletter({ message: "" }, form({ email: "known@example.com" }));

    expect(result.message).not.toMatch(/Subscribed/);
    expect(syncContactToCrm).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("leaves an already-subscribed contact's row alone when it has a real consent record", async () => {
    for (const source of ["site_form", "console", "mailchimp"]) {
      const contactsBuilder = queryBuilder(dbOk({ id: "c1", subscribed: true, unsubscribed_at: null, opt_in_at: "2026-10-01T00:00:00Z", opt_in_source: source }));
      vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
        from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
      })));
      await subscribeNewsletter({ message: "" }, form({ email: "existing@example.com" }));
      expect(contactsBuilder.update).not.toHaveBeenCalled();
    }
  });

  // Gap review area 6: a Bigin import date isn't a consent record, and older
  // rows have none; a signup on the site is one, so it becomes the record.
  it("records the signup as consent for a subscribed contact with no record, or only Bigin's import date", async () => {
    for (const row of [{ opt_in_at: null, opt_in_source: null }, { opt_in_at: "2026-10-07T00:00:00Z", opt_in_source: "bigin" }]) {
      const contactsBuilder = queryBuilder(dbOk({ id: "c1", subscribed: true, unsubscribed_at: null, ...row }));
      vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
        from: fromByTable({ contacts: () => contactsBuilder, newsletter_signups: () => queryBuilder(dbOk(null)) }),
      })));

      const result = await subscribeNewsletter({ message: "" }, form({ email: "known@example.com", surface: "footer" }));

      expect(result).toEqual({ message: "Subscribed — see you next issue." });
      expect(contactsBuilder.update).toHaveBeenCalledWith({
        opt_in_at: expect.any(String), opt_in_source: "site_form", opt_in_wording: "Monthly newsletter [email address] [Subscribe]",
      });
      expect(contactsBuilder.eq).toHaveBeenCalledWith("id", "c1");
    }
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
