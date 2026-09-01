import { afterEach, describe, expect, it, vi } from "vitest";
import { createMember, recordMemberPayment, saveMember, setMemberStatus } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";
import type { ProvisionResult } from "@/lib/membership";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, enqueue, provisionMember, applyPaymentResult, send, recordRename } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
  provisionMember: vi.fn(async (): Promise<ProvisionResult> => ({ memberId: "m1" })),
  applyPaymentResult: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  recordRename: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));
// Partial mock: memberValuesFromForm also pulls activationBlocked/BILLING_MODES/
// MEMBER_STATUSES/slugify from this same module, so only provisionMember and
// applyPaymentResult are overridden — everything else stays real and pure.
vi.mock("@/lib/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/membership")>()),
  provisionMember,
  applyPaymentResult,
}));
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));
vi.mock("@/lib/redirects", () => ({ recordRename }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  enqueue.mockReset().mockResolvedValue(undefined);
  provisionMember.mockReset().mockResolvedValue({ memberId: "m1" });
  applyPaymentResult.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockResolvedValue(undefined);
  recordRename.mockReset().mockResolvedValue(undefined);
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

const baseFields = { name: "Acme Ltd", status: "active", billing_mode: "card" };

describe("saveMember", () => {
  it("does nothing without an id", async () => {
    const from = db({});
    await saveMember(form({}));
    expect(from).not.toHaveBeenCalled();
  });

  it("does nothing when the member doesn't exist", async () => {
    const from = db({ members: () => queryBuilder(dbOk(null)) });
    await saveMember(form({ id: "m1" }));
    expect(from).not.toHaveBeenCalledWith("members", expect.anything());
  });

  it("redirects with the upload error and never writes to the row", async () => {
    uploadImage.mockRejectedValue(new Error("Image too large (8MB max)"));
    const membersBuilder = queryBuilder(dbOk({ id: "m1", slug: "acme", status: "active", social: null }));
    db({ members: () => membersBuilder });

    await expect(saveMember(form({ id: "m1", ...baseFields })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?error=Image%20too%20large%20(8MB%20max)");
    expect(membersBuilder.update).not.toHaveBeenCalled();
  });

  it("surfaces memberValuesFromForm's own validation errors", async () => {
    db({ members: () => queryBuilder(dbOk({ id: "m1", slug: "acme", status: "active", social: null })) });

    await expect(saveMember(form({ id: "m1", name: "", status: "active", billing_mode: "card" })))
      .rejects.toThrow(/Company%20name%20is%20required/);
  });

  it("refuses to change a live member's web address without the confirmation checkbox", async () => {
    db({ members: () => queryBuilder(dbOk({ id: "m1", slug: "old-slug", status: "active", social: null })) });

    await expect(saveMember(form({ id: "m1", ...baseFields, slug: "new-slug" })))
      .rejects.toThrow(/breaks%20existing%20links/);
  });

  it("allows a slug change on a still-draft member with no confirmation needed", async () => {
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        members: () => queryBuilder(() =>
          call++ === 0 ? dbOk({ id: "m1", slug: "old-slug", status: "draft", social: null }) : dbOk(null), // no clash
        ),
      }, () => queryBuilder(dbOk(null))),
    })));

    await expect(saveMember(form({ id: "m1", ...baseFields, status: "draft", slug: "new-slug" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?saved=1");
    expect(recordRename).not.toHaveBeenCalled(); // draft members have no public URL to preserve
  });

  it("rejects a slug that collides with another member", async () => {
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        members: () => queryBuilder(() =>
          call++ === 0 ? dbOk({ id: "m1", slug: "old-slug", status: "active", social: null }) : dbOk({ id: "m2" }),
        ),
      }, () => queryBuilder(dbOk(null))),
    })));

    await expect(saveMember(form({ id: "m1", ...baseFields, slug: "new-slug", confirm_slug: "on" })))
      .rejects.toThrow(/already%20used%20by%20another%20member/);
  });

  it("on a confirmed slug change to a live member, records the rename and redirects", async () => {
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        members: () => queryBuilder(() =>
          call++ === 0 ? dbOk({ id: "m1", slug: "old-slug", status: "active", social: null }) : dbOk(null), // no clash
        ),
      }, () => queryBuilder(dbOk(null))),
    })));

    await expect(saveMember(form({ id: "m1", ...baseFields, slug: "new-slug", confirm_slug: "on" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?saved=1");

    expect(recordRename).toHaveBeenCalledWith("/member/old-slug", "/member/new-slug");
  });

  it("activating a draft member (with a payment already on record) records the activation", async () => {
    // slug matches what the form derives from the name, so this isn't also a slug change
    const membersBuilder = queryBuilder(dbOk({ id: "m1", slug: "acme-ltd", status: "draft", social: null }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ members: () => membersBuilder, approvals: () => approvalsBuilder });

    await expect(saveMember(form({ id: "m1", ...baseFields, status: "active", paid_at: "2026-08-01T10:00" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?saved=1");

    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "member_activation" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "page_live" }));
  });

  it("reports a unique-address conflict in friendly words", async () => {
    type Member = { id: string; slug: string; status: string; social: null };
    const membersBuilder: ReturnType<typeof queryBuilder<Member>> = queryBuilder<Member>(() => {
      const updates = (membersBuilder.update as ReturnType<typeof vi.fn>).mock.calls;
      return updates.length
        ? (dbError("duplicate", { code: "23505" }) as DbResult<Member>)
        : dbOk<Member>({ id: "m1", slug: "acme-ltd", status: "active", social: null });
    });
    db({ members: () => membersBuilder });

    await expect(saveMember(form({ id: "m1", ...baseFields })))
      .rejects.toThrow(/already%20taken/);
  });
});

describe("createMember", () => {
  it("validates email, password and company before calling provisionMember", async () => {
    await expect(createMember(form({ email: "nope", password: "x", company: "" })))
      .rejects.toThrow(/Please%20enter%20a%20valid%20email/);
    expect(provisionMember).not.toHaveBeenCalled();
  });

  it("rewrites provisionMember's 'already exists' message for the admin's context", async () => {
    provisionMember.mockResolvedValue({ error: "An account with this email already exists — try logging in." });

    await expect(createMember(form({ email: "a@example.com", password: "correcthorse", company: "Acme" })))
      .rejects.toThrow(/find%20them%20in%20the%20members%20list/);
  });

  it("passes through any other provisionMember error unchanged", async () => {
    provisionMember.mockResolvedValue({ error: "Something else went wrong." });

    await expect(createMember(form({ email: "a@example.com", password: "correcthorse", company: "Acme" })))
      .rejects.toThrow(/Something%20else%20went%20wrong/);
  });

  it("on success, emails an invite and redirects to the new member", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      auth: { admin: { generateLink: vi.fn(async () => ({ data: { properties: { action_link: "https://smi.local/reset?token=x" } }, error: null })) } },
    })));

    await expect(createMember(form({ email: "a@example.com", password: "correcthorse", company: "Acme" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?created=1");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com" }));
  });

  it("flags the invite as failed in the redirect when no link comes back, without failing the whole action", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      auth: { admin: { generateLink: vi.fn(async () => ({ data: null, error: { message: "boom" } })) } },
    })));

    await expect(createMember(form({ email: "a@example.com", password: "correcthorse", company: "Acme" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?created=1&invite=failed");

    expect(send).not.toHaveBeenCalled();
  });
});

describe("recordMemberPayment", () => {
  it("does nothing without an id", async () => {
    await recordMemberPayment(form({}));
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("rejects a comp length outside 1–60 months", async () => {
    await expect(recordMemberPayment(form({ id: "m1", kind: "comped", months: "0" })))
      .rejects.toThrow(/whole%20number%20of%20months/);
    await expect(recordMemberPayment(form({ id: "m1", kind: "comped", months: "61" })))
      .rejects.toThrow(/whole%20number%20of%20months/);
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("records a comp for a valid month count", async () => {
    await expect(recordMemberPayment(form({ id: "m1", kind: "comped", months: "6" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?saved=1");
    expect(applyPaymentResult).toHaveBeenCalledWith("m1", { kind: "comped", months: 6 });
  });

  it("records a plain payment otherwise", async () => {
    await expect(recordMemberPayment(form({ id: "m1", kind: "paid" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/members/m1?saved=1");
    expect(applyPaymentResult).toHaveBeenCalledWith("m1", { kind: "paid" });
  });
});

describe("setMemberStatus", () => {
  it("ignores an unrecognised status", async () => {
    const from = db({});
    await setMemberStatus(form({ id: "m1", status: "bogus" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses to activate a draft member with no payment or comp on record", async () => {
    const membersBuilder = queryBuilder(dbOk({ status: "draft", paid_at: null, comped_until: null }));
    db({ members: () => membersBuilder });

    await setMemberStatus(form({ id: "m1", status: "active" }));

    expect(membersBuilder.update).not.toHaveBeenCalled();
  });

  it("activating a paid draft member updates the status and records the activation", async () => {
    const membersBuilder = queryBuilder(dbOk({ status: "draft", paid_at: "2026-08-01T00:00:00.000Z", comped_until: null }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ members: () => membersBuilder, approvals: () => approvalsBuilder });

    await setMemberStatus(form({ id: "m1", status: "active" }));

    expect(membersBuilder.update).toHaveBeenCalledWith({ status: "active" });
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "member_activation" }));
  });

  it("a transition between two non-activating statuses updates without an activation record", async () => {
    const membersBuilder = queryBuilder(dbOk({ status: "active", paid_at: "2026-01-01", comped_until: null }));
    const from = db({ members: () => membersBuilder });

    await setMemberStatus(form({ id: "m1", status: "grace" }));

    expect(membersBuilder.update).toHaveBeenCalledWith({ status: "grace" });
    expect(from).not.toHaveBeenCalledWith("approvals");
  });
});
