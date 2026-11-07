import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

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
  // `category` and `kind` are both required and both stated by the caller
  // (fix-list 71). The old version of this function hard-coded
  // `kind: 'membership'` on every row it wrote, which is how a signup receipt
  // and a member's question ended up indistinguishable in the console.
  it("writes the category and kind the caller stated", async () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await notifyAdminFunnel({
      category: "notification", kind: "signup_started",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join",
      memberId: "m1", payload: { member_id: "m1" },
    });

    expect(from).toHaveBeenCalledWith("inbox_messages");
    expect(builder.insert).toHaveBeenCalledWith({
      category: "notification", kind: "signup_started",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join",
      member_id: "m1", payload: { member_id: "m1" },
    });
    expect(send).not.toHaveBeenCalled(); // no emailKind given — console-only by design
  });

  it("defaults member_id and payload rather than omitting them", async () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await notifyAdminFunnel({
      category: "message", kind: "membership",
      name: "Acme Ltd", email: "acme@example.com", message: "A question",
    });

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "message", kind: "membership", member_id: null, payload: {},
    }));
  });

  it("emails ADMIN_EMAIL when a kind is given and it's configured", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));
    const { notifyAdminFunnel } = await freshNotifyAdmin("jas@sheetmetalindustries.com");

    await notifyAdminFunnel({
      category: "notification", kind: "signup_started",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", emailKind: "admin_new_signup",
    });

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

    await notifyAdminFunnel({
      category: "notification", kind: "signup_started",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", emailKind: "admin_new_signup",
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Someone new: Acme Ltd" }));
  });

  it("warns instead of emailing when ADMIN_EMAIL isn't set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await notifyAdminFunnel({
      category: "notification", kind: "signup_started",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join", emailKind: "admin_new_signup",
    });

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("never throws into the signup flow, even when the insert itself throws", async () => {
    const from = vi.fn(() => ({ insert: vi.fn(() => { throw new Error("db unreachable"); }) }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyAdminFunnel } = await freshNotifyAdmin(undefined);

    await expect(notifyAdminFunnel({
      category: "message", kind: "membership",
      name: "Acme Ltd", email: "acme@example.com", message: "Wants to join",
    })).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "notify-admin:funnel" }));
  });
});

/**
 * The console-only half of the same module (fix-list 71): a receipt for
 * something a member did, with the id needed to link to it and no correspondent
 * to reply to.
 */
describe("notifyConsole", () => {
  it("writes a notification row, naming the member it looked up", async () => {
    const inbox = queryBuilder(dbOk(null));
    const members = queryBuilder(dbOk({ name: "Acme Ltd" }));
    const from = vi.fn((table: string) => (table === "members" ? members : inbox));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyConsole } = await freshNotifyAdmin(undefined);

    await notifyConsole({ kind: "story_submitted", memberId: "m1", payload: { story_id: "s1" }, message: "Submitted a story." });

    expect(inbox.insert).toHaveBeenCalledWith({
      category: "notification",
      kind: "story_submitted",
      name: "Acme Ltd",
      // Empty on purpose: this is what the detail page checks before offering
      // a reply form. jobs.ts used to write a real address on rows like this.
      email: "",
      message: "Submitted a story.",
      member_id: "m1",
      payload: { story_id: "s1" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder name when the member lookup finds nothing", async () => {
    const inbox = queryBuilder(dbOk(null));
    const members = queryBuilder(dbOk(null));
    const from = vi.fn((table: string) => (table === "members" ? members : inbox));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyConsole } = await freshNotifyAdmin(undefined);

    await notifyConsole({ kind: "video_submitted", memberId: "gone", message: "Submitted a video." });

    expect(inbox.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "A member", payload: {} }));
  });

  it("skips the lookup entirely when the caller names the row itself", async () => {
    const inbox = queryBuilder(dbOk(null));
    const from = vi.fn(() => inbox);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyConsole } = await freshNotifyAdmin(undefined);

    await notifyConsole({ kind: "advert_ending", name: "Acme banner", payload: { booking_id: "b1" }, message: "Ends soon." });

    expect(from).not.toHaveBeenCalledWith("members");
    expect(inbox.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Acme banner", member_id: null }));
  });

  it("never throws into the action that raised it", async () => {
    const from = vi.fn(() => ({ insert: vi.fn(() => { throw new Error("db unreachable"); }) }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    const { notifyConsole } = await freshNotifyAdmin(undefined);

    await expect(notifyConsole({ kind: "story_submitted", name: "Acme Ltd", message: "Submitted." }))
      .resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "notify-admin:console" }));
  });
});
