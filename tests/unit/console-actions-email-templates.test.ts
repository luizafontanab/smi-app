import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEmailTemplate, saveEmailTemplate, sendTestEmail } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));

const send = vi.fn(async () => {});
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));

afterEach(() => {
  resetDbServerMocks();
  send.mockReset().mockResolvedValue(undefined);
  requireConsole.mockResolvedValue({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  });
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("saveEmailTemplate", () => {
  it("stores only the fields that were filled in, as a partial override", async () => {
    // The whole point of the table: a subject edit must not freeze the body at
    // whatever shipped that day. Blank fields go in as null and keep falling
    // through to src/lib/email/defaults.ts.
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(saveEmailTemplate(form({ kind: "story_live", subject: "You're on the front page" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates/story_live?saved=1");

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "story_live",
        family: "member",
        subject: "You're on the front page",
        body_html: null,
        body_text: null,
        cta_label: null,
        updated_by: "admin1",
      }),
    );
  });

  it("stamps updated_at by hand, since this database has no triggers", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(saveEmailTemplate(form({ kind: "welcome", subject: "Hello" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({ updated_at: expect.any(String) }));
  });

  it("refuses a placeholder the email doesn't have, naming it", async () => {
    // Left to send, {{ends_onn}} reaches the member as literal braces and
    // whoever typed it never finds out.
    db({ email_templates: () => queryBuilder(dbOk(null)) });

    await expect(saveEmailTemplate(form({ kind: "advert_ending_soon", body_text: "Ends {{ends_onn}}." })))
      .rejects.toThrow(/ends_onn/);
    // Named as the field on screen, not as the database column behind it.
    await expect(saveEmailTemplate(form({ kind: "advert_ending_soon", body_text: "Ends {{ends_onn}}." })))
      .rejects.toThrow(/plain-text%20body/);
  });

  it("accepts a placeholder the email does have", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(saveEmailTemplate(form({ kind: "advert_ending_soon", body_text: "Ends {{ends_on}}." })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates/advert_ending_soon?saved=1");
    expect(builder.upsert).toHaveBeenCalled();
  });

  it("refuses a shell that would send every member an empty email", async () => {
    db({ email_templates: () => queryBuilder(dbOk(null)) });

    await expect(saveEmailTemplate(form({ kind: "_shell", body_html: "<html><body>Hello</body></html>" })))
      .rejects.toThrow(/body/);
  });

  it("accepts a shell that keeps its body placeholder", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(saveEmailTemplate(form({ kind: "_shell", body_html: "<html><body>{{body}}{{cta}}</body></html>" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates/_shell?saved=1");
  });

  it("rejects a kind that isn't a real email", async () => {
    db({ email_templates: () => queryBuilder(dbOk(null)) });

    await expect(saveEmailTemplate(form({ kind: "../../etc/passwd", subject: "x" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates?error=That%20email%20doesn't%20exist.");
  });

  it("surfaces a write failure rather than claiming it saved — in plain words; Postgres's go to the error log", async () => {
    db({ email_templates: () => queryBuilder(dbError("permission denied")) });

    await expect(saveEmailTemplate(form({ kind: "welcome", subject: "Hello" })))
      .rejects.toThrow(/error=That%20couldn't%20be%20saved/);
    await expect(saveEmailTemplate(form({ kind: "welcome", subject: "Hello" })))
      .rejects.not.toThrow(/permission/);
  });
});

describe("resetEmailTemplate", () => {
  it("deletes the row, because an absent row IS the default", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(resetEmailTemplate(form({ kind: "welcome", confirm: "1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates/welcome?reset=1");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("kind", "welcome");
  });

  it("will not reset without the confirm box ticked", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ email_templates: () => builder });

    await expect(resetEmailTemplate(form({ kind: "welcome" }))).rejects.toThrow(/confirm/);
    expect(builder.delete).not.toHaveBeenCalled();
  });
});

describe("sendTestEmail", () => {
  it("sends to the logged-in admin and nobody else", async () => {
    // A free-text recipient field here would be an authenticated open relay on
    // the SMI sending domain, so the address is never taken from the form.
    db({ email_templates: () => queryBuilder(dbOk([])) });

    await expect(sendTestEmail(form({ kind: "welcome", to: "someone-else@example.com" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/email-templates/welcome?tested=1");

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jas@smi.local", subject: expect.stringContaining("[Test]") }),
    );
  });

  it("sends the stored wording, not the shipped default", async () => {
    db({ email_templates: () => queryBuilder(dbOk([{ kind: "welcome", subject: "Edited subject" }])) });

    await expect(sendTestEmail(form({ kind: "welcome" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: "[Test] Edited subject" }));
  });

  it("reports a provider rejection instead of swallowing it", async () => {
    // getEmailSender().send throws by design so a bad key or an unverified
    // domain is visible rather than silent.
    db({ email_templates: () => queryBuilder(dbOk([])) });
    send.mockRejectedValueOnce(new Error("domain is not verified"));

    await expect(sendTestEmail(form({ kind: "welcome" }))).rejects.toThrow(/domain%20is%20not%20verified/);
  });
});
