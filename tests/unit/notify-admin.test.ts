import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const send = vi.fn(async () => {});
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/** ADMIN_EMAIL is read once at module load, so switching it needs a fresh module instance. */
async function freshNotifyAdmin(adminEmail: string | undefined) {
  vi.resetModules();
  if (adminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = adminEmail;
  return import("@/lib/notify-admin");
}

afterEach(() => {
  resetDbServerMocks();
  send.mockClear();
  vi.restoreAllMocks();
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

describe("notifyAdminFunnel", () => {
  it("always writes a membership inbox row", async () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await notifyAdminFunnel({ name: "Acme Ltd", email: "acme@example.com", message: "Wants to join" });

    expect(from).toHaveBeenCalledWith("inbox_messages");
    expect(builder.insert).toHaveBeenCalledWith({
      kind: "membership", name: "Acme Ltd", email: "acme@example.com", message: "Wants to join",
    });
    expect(send).not.toHaveBeenCalled(); // no kind given — console-only by design
  });

  it("emails ADMIN_EMAIL when a kind is given and it's configured", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));
    const { notifyAdminFunnel } = await freshNotifyAdmin("jas@sheetmetalindustries.com");

    await notifyAdminFunnel({ name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", kind: "admin_new_signup" });

    // Wording comes from the editable template, not from a subject string built
    // at the call site. Still plain text: these have never been HTML, and
    // changing that is a question for Jas rather than a refactor.
    expect(send).toHaveBeenCalledWith({
      to: "jas@sheetmetalindustries.com",
      subject: "New member signup: Acme Ltd",
      text: "Acme Ltd <acme@example.com>\n\nWants to join",
    });
  });

  it("uses the console's edited wording when there is some", async () => {
    const from = vi.fn((table: string) =>
      table === "email_templates"
        ? queryBuilder(dbOk([{ kind: "admin_new_signup", subject: "Someone new: {{name}}" }]))
        : queryBuilder(dbOk(null)),
    );
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin("jas@sheetmetalindustries.com");

    await notifyAdminFunnel({ name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", kind: "admin_new_signup" });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Someone new: Acme Ltd" }));
  });

  it("warns instead of emailing when ADMIN_EMAIL isn't set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await notifyAdminFunnel({ name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", kind: "admin_new_signup" });

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("never throws into the signup flow, even when the insert itself throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const from = vi.fn(() => ({ insert: vi.fn(() => { throw new Error("db unreachable"); }) }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await expect(notifyAdminFunnel({ name: "Acme Ltd", email: "acme@example.com", message: "Wants to join" }))
      .resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
