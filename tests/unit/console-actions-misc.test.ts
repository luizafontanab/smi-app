import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteCategory, deleteContentPage, deleteIndustry, deleteMedia, markAllInboxRead, markInboxRead, renameMedia,
  replyToInboxMessage, saveCategory, saveResource,
  markProspect, saveContentPage, saveIndustry, saveSocialChannels,
} from "@/app/console/actions";
import { clearSocialReachHomepage, saveSocialReachHomepage, saveSocialReachPlatforms } from "@/app/console/social-reach/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, removeMedia, recordRename, uploadImage, uploadDocument } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  recordRename: vi.fn(async () => {}),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  uploadDocument: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ removeMedia, uploadImage, uploadDocument }));
vi.mock("@/lib/redirects", () => ({ recordRename }));

// The reply goes out through the same adapter as every other outgoing mail;
// what it renders on the way is src/lib/email's business and is tested there.
const { send } = vi.hoisted(() => ({ send: vi.fn(async () => {}) }));
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));

afterEach(() => {
  resetDbServerMocks();
  removeMedia.mockReset().mockResolvedValue(undefined);
  recordRename.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockResolvedValue(undefined);
  uploadImage.mockReset().mockResolvedValue(null);
  uploadDocument.mockReset().mockResolvedValue(null);
});

/* ---------- member resources: an image or a PDF, staged or posted ---------- */

describe("saveResource", () => {
  const NAME = "3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf";

  it("takes a staged PDF — a size the old request could never carry — through uploadDocument", async () => {
    const bucket = {
      info: vi.fn(async () => dbOk({ size: 15 * 1024 * 1024, contentType: "application/pdf", metadata: { name: "Rate card.pdf" } })),
      download: vi.fn(async () => dbOk(new Blob(["%PDF-1.7"], { type: "application/pdf" }))),
      remove: vi.fn(async () => dbOk([])),
    };
    const resources = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ resources: () => resources }), storage: { from: vi.fn(() => bucket) } })));
    uploadDocument.mockResolvedValue("resources/abc.pdf");

    await expect(saveResource(form({ title: "Rate card", file: `console/${NAME}` }))).rejects.toThrow("NEXT_REDIRECT:/console/resources?saved=1");
    const [file, prefix] = uploadDocument.mock.calls[0];
    expect(file?.type).toBe("application/pdf");
    expect(file?.name).toBe("Rate card.pdf");
    expect(prefix).toBe("resources");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(resources.insert).toHaveBeenCalledWith({ title: "Rate card", path: "resources/abc.pdf", kind: "document" });
  });

  it("asks for a file when none came, staged or posted", async () => {
    await expect(saveResource(form({ title: "Rate card" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/resources\?error=Choose%20a%20file/);
    expect(uploadDocument).not.toHaveBeenCalled();
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

describe("markInboxRead", () => {
  it("defaults to marking read, unless explicitly told 0", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ inbox_messages: () => builder });

    await markInboxRead(form({ id: "msg1" }));
    expect(builder.update).toHaveBeenCalledWith({ read: true });

    await markInboxRead(form({ id: "msg1", read: "0" }));
    expect(builder.update).toHaveBeenCalledWith({ read: false });
  });
});

/**
 * Clearing the unread queue is scoped to what is on screen (fix-list 71).
 * Without the category scope, "mark all read" on the Messages tab would also
 * silently clear every notification — the one thing a split feed must never do.
 */
describe("markAllInboxRead", () => {
  it("scopes to the category and kind being filtered on", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ inbox_messages: () => builder });

    await markAllInboxRead(form({ category: "message", kind: "contact" }));

    expect(builder.update).toHaveBeenCalledWith({ read: true });
    expect(builder.eq).toHaveBeenCalledWith("category", "message");
    expect(builder.eq).toHaveBeenCalledWith("kind", "contact");
  });

  it("clears everything unread when nothing is filtered", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ inbox_messages: () => builder });

    await markAllInboxRead(form({}));

    expect(builder.eq).toHaveBeenCalledWith("read", false);
    expect(builder.eq).not.toHaveBeenCalledWith("category", expect.anything());
  });
});

describe("replyToInboxMessage", () => {
  const message = (overrides: Record<string, unknown> = {}) =>
    ({ name: "Gareth Pryce", email: "gareth@example.com", category: "message", ...overrides });

  /** inbox_messages is read then updated; inbox_replies is inserted then stamped. */
  function inboxDb(row: Record<string, unknown> | null, replyId: string | null = "r1") {
    const messages = queryBuilder(row ? dbOk(row) : dbOk(null));
    const replies = queryBuilder(replyId ? dbOk({ id: replyId }) : dbOk(null));
    db({ inbox_messages: () => messages, inbox_replies: () => replies });
    return { messages, replies };
  }

  it("stores the reply before sending, then stamps it sent and marks the thread replied", async () => {
    const { messages, replies } = inboxDb(message());

    await expect(replyToInboxMessage(form({ id: "msg1", subject: "Re: your enquiry", body: "Hello there" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/notifications/msg1?replied=1");

    expect(replies.insert).toHaveBeenCalledWith({
      message_id: "msg1", subject: "Re: your enquiry", body: "Hello there", sent_by: "admin1",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "gareth@example.com" }));
    expect(replies.update).toHaveBeenCalledWith(expect.objectContaining({ sent_at: expect.any(String) }));
    expect(messages.update).toHaveBeenCalledWith(expect.objectContaining({ replied_at: expect.any(String) }));
  });

  // The old version sent and kept nothing, so a provider rejection redirected
  // with an error and destroyed whatever had just been typed.
  it("keeps the typed reply and records why it failed when the provider rejects it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { messages, replies } = inboxDb(message());
    send.mockRejectedValueOnce(new Error("mailbox unavailable"));

    await expect(replyToInboxMessage(form({ id: "msg1", subject: "Re: your enquiry", body: "Hello there" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/notifications\/msg1\?error=/);

    expect(replies.insert).toHaveBeenCalled();
    expect(replies.update).toHaveBeenCalledWith({ delivery_error: "mailbox unavailable" });
    // Nothing was delivered, so the thread must not read as answered.
    expect(messages.update).not.toHaveBeenCalledWith(expect.objectContaining({ replied_at: expect.any(String) }));
  });

  // Reachable by direct POST even though the page hides the form on these.
  it("refuses a notification, which nobody sent", async () => {
    const { replies } = inboxDb(message({ category: "notification", email: "" }));

    await expect(replyToInboxMessage(form({ id: "msg1", subject: "Hi", body: "Hello" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/notifications\/msg1\?error=/);

    expect(replies.insert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // The advert-expiry notice jobs.ts used to write with email: "" — replying to
  // it addressed an email to nobody.
  it("refuses a message with no address on it", async () => {
    const { replies } = inboxDb(message({ email: "" }));

    await expect(replyToInboxMessage(form({ id: "msg1", subject: "Hi", body: "Hello" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/notifications\/msg1\?error=/);

    expect(replies.insert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("requires both a subject and a body before it touches the database", async () => {
    const from = db({});

    await expect(replyToInboxMessage(form({ id: "msg1", subject: "", body: "Hello" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/notifications\/msg1\?error=/);

    expect(from).not.toHaveBeenCalled();
  });
});

describe("renameMedia", () => {
  it("does nothing without an id", async () => {
    const from = db({});
    await renameMedia(form({}));
    expect(from).not.toHaveBeenCalled();
  });

  it("nulls out blank fields rather than storing empty strings", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ media: () => builder });

    await renameMedia(form({ id: "med1", original_name: "  ", alt_text: "  " }));

    expect(builder.update).toHaveBeenCalledWith({ original_name: null, alt_text: null });
  });
});

describe("deleteMedia", () => {
  it("requires an id, a path, and the confirm checkbox", async () => {
    await deleteMedia(form({ id: "med1", path: "a.jpg" })); // no confirm
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it("removes the object once confirmed", async () => {
    await deleteMedia(form({ id: "med1", path: "a.jpg", confirm: "1" }));
    expect(removeMedia).toHaveBeenCalledWith("a.jpg");
  });
});

describe("saveContentPage", () => {
  it("requires a title", async () => {
    await expect(saveContentPage(form({ title: "" }))).rejects.toThrow(/Give%20the%20page%20a%20title/);
  });

  it("rejects a title that slugifies to nothing", async () => {
    await expect(saveContentPage(form({ title: "!!!" }))).rejects.toThrow(/has%20no%20letters%20or%20numbers/);
  });

  it("refuses a slug already used by another page", async () => {
    db({ static_pages: () => queryBuilder(dbOk({ slug: "about" })) });
    await expect(saveContentPage(form({ title: "About", slug: "about" })))
      .rejects.toThrow(/already%20used%20by%20another%20page/);
  });

  it("creates a new page and redirects to it", async () => {
    const pagesBuilder = queryBuilder(dbOk(null));
    db({ static_pages: () => pagesBuilder });

    await expect(saveContentPage(form({ title: "About Us", body: "<p>Hi</p>" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/content-pages/about-us?saved=1");

    expect(pagesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ slug: "about-us", title: "About Us" }));
  });

  it("renaming an existing page's slug preserves the old URL via a redirect record", async () => {
    const pagesBuilder = queryBuilder(dbOk(null));
    db({ static_pages: () => pagesBuilder });

    await expect(saveContentPage(form({ original_slug: "about", title: "About Us", slug: "about-us" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/content-pages/about-us?saved=1");

    expect(recordRename).toHaveBeenCalledWith("/pages/about", "/pages/about-us");
  });

  it("leaves the slug alone when the clash is the page's own current slug", async () => {
    const pagesBuilder = queryBuilder(dbOk({ slug: "about" }));
    db({ static_pages: () => pagesBuilder });

    await expect(saveContentPage(form({ original_slug: "about", title: "About Us", slug: "about" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/content-pages/about?saved=1");
    expect(recordRename).not.toHaveBeenCalled();
  });
});

describe("deleteContentPage", () => {
  it("does nothing without a slug", async () => {
    const from = db({});
    await deleteContentPage(form({}));
    expect(from).not.toHaveBeenCalled();
  });

  it("deletes and redirects", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ static_pages: () => builder });

    await expect(deleteContentPage(form({ slug: "about" }))).rejects.toThrow("NEXT_REDIRECT:/console/content-pages?deleted=1");
    expect(builder.delete).toHaveBeenCalled();
  });
});

describe("saveCategory", () => {
  it("requires a name", async () => {
    const from = db({});
    await saveCategory(form({ name: "  " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a new category and redirects", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ categories: () => builder });

    await expect(saveCategory(form({ name: "Fabrication" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?saved=1");
    expect(builder.insert).toHaveBeenCalledWith({ name: "Fabrication", slug: "fabrication" });
  });

  it("reports a friendlier message for a duplicate slug", async () => {
    db({ categories: () => queryBuilder(dbError("duplicate", { code: "23505" })) });

    await expect(saveCategory(form({ name: "Fabrication" })))
      .rejects.toThrow(/already%20used%20by%20another%20category/);
  });

  it("updates an existing category in place", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ categories: () => builder });

    await expect(saveCategory(form({ id: "3", name: "Suppliers" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?saved=1");
    expect(builder.update).toHaveBeenCalledWith({ name: "Suppliers", slug: "suppliers" });
  });
});

describe("deleteCategory", () => {
  it("requires the confirm checkbox", async () => {
    await expect(deleteCategory(form({ id: "3" })))
      .rejects.toThrow(/Tick%20the%20confirm%20box/);
  });

  it("deletes and redirects", async () => {
    db({ categories: () => queryBuilder(dbOk(null)) });

    await expect(deleteCategory(form({ id: "3", confirm: "1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?deleted=1");
  });
});

describe("saveIndustry", () => {
  it("requires a name", async () => {
    const from = db({});
    await saveIndustry(form({ name: "  " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a new industry with its strip position and redirects", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ industries: () => builder });

    await expect(saveIndustry(form({ name: "Tube Bending", sort_order: "9" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/industries?saved=1");
    expect(builder.insert).toHaveBeenCalledWith({ name: "Tube Bending", slug: "tube-bending", sort_order: 9 });
  });

  it("reports a friendlier message for a duplicate slug", async () => {
    db({ industries: () => queryBuilder(dbError("duplicate", { code: "23505" })) });

    await expect(saveIndustry(form({ name: "Welding" })))
      .rejects.toThrow(/already%20used%20by%20another%20industry/);
  });

  it("updates an existing industry in place", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ industries: () => builder });

    await expect(saveIndustry(form({ id: "3", name: "Welding", sort_order: "10" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/industries?saved=1");
    expect(builder.update).toHaveBeenCalledWith({ name: "Welding", slug: "welding", sort_order: 10 });
  });
});

describe("deleteIndustry", () => {
  it("requires the confirm checkbox", async () => {
    await expect(deleteIndustry(form({ id: "3" })))
      .rejects.toThrow(/Tick%20the%20confirm%20box/);
  });

  it("reports when content still references the industry", async () => {
    // members/stories/videos/events all point at industries with the default
    // RESTRICT, so any one of the four blocks the delete
    db({ industries: () => queryBuilder(dbError("fk violation", { code: "23503" })) });

    await expect(deleteIndustry(form({ id: "3", confirm: "1" })))
      .rejects.toThrow(/still%20assigned%20to%20a%20member%2C%20story%2C%20video%20or%20event/);
  });

  it("deletes and redirects", async () => {
    db({ industries: () => queryBuilder(dbOk(null)) });

    await expect(deleteIndustry(form({ id: "3", confirm: "1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/industries?deleted=1");
  });
});

describe("saveSocialChannels", () => {
  it("stores channel ids from either separator, trimmed, blanks dropped", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialChannels(form({ channel_ids: "c-1\n c-2 ,,c-3\n\n" }));

    expect(builder.upsert).toHaveBeenCalledWith({
      key: "social_channels",
      value: { channelIds: ["c-1", "c-2", "c-3"] },
    });
  });

  it("omits the organisation id when it's blank, rather than storing an empty string", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialChannels(form({ channel_ids: "c-1", organization_id: "  " }));

    expect(builder.upsert).toHaveBeenCalledWith({ key: "social_channels", value: { channelIds: ["c-1"] } });
  });

  it("keeps the organisation id when given", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialChannels(form({ channel_ids: "c-1", organization_id: "org-1" }));

    expect(builder.upsert).toHaveBeenCalledWith({
      key: "social_channels",
      value: { channelIds: ["c-1"], organizationId: "org-1" },
    });
  });

  it("replaces the whole row, so saving clears any leftover v1 profileIds", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialChannels(form({ channel_ids: "c-1" }));

    // Exact match, so the absence of a `profileIds` key is part of the assertion:
    // the upsert writes a whole new value rather than merging into the old one.
    expect(builder.upsert).toHaveBeenCalledWith({ key: "social_channels", value: { channelIds: ["c-1"] } });
  });
});

describe("markProspect", () => {
  it("redirects to login when not an admin", async () => {
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/console"));

    await expect(markProspect(form({ ref: "https://www.linkedin.com/company/acme", action: "call" })))
      .rejects.toThrow("NEXT_REDIRECT:/login?next=/console");
  });

  it("marks a prospect and returns to the same search", async () => {
    db({ prospect_marks: () => queryBuilder(dbOk(null)) });

    await expect(markProspect(form({ ref: "https://www.linkedin.com/company/acme", action: "call", q: "company_type=software" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/leads?company_type=software&saved=1");
  });

  it("ignores an action that isn't one of the four", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ prospect_marks: () => builder });

    // No redirect thrown means it returned early — the DB check constraint is
    // the backstop here, not the gate.
    await markProspect(form({ ref: "https://www.linkedin.com/company/acme", action: "drop_table" }));

    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it("ignores a blank ref", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ prospect_marks: () => builder });

    await markProspect(form({ ref: "  ", action: "call" }));

    expect(builder.upsert).not.toHaveBeenCalled();
  });
});

/* ---------- social reach (/console/social-reach, issue #4) ---------- */

describe("social reach actions", () => {
  /** A settings table whose read returns `stored`, with every upsert/delete spied on. */
  function settings(stored: unknown = null, write = dbOk(null)) {
    const b: ReturnType<typeof queryBuilder> = queryBuilder(() =>
      callsOf(b.upsert).length || callsOf(b.delete).length ? write : dbOk(stored === null ? null : { value: stored }),
    );
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ settings: () => b }) })));
    return b;
  }
  const callsOf = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls;
  const redirectUrl = async (p: Promise<unknown>) => {
    const e = await p.then(() => null, (err: Error) => err);
    const m = /^NEXT_REDIRECT:(.*)$/.exec(e?.message ?? "");
    if (!m) throw new Error(`expected a redirect, got ${e?.message}`);
    return new URL(m[1], "http://x");
  };

  it.each([
    ["anonymous visitor", "NEXT_REDIRECT:/login?next=/console"],
    ["member", "NEXT_REDIRECT:/dashboard"],
  ])("refuses a %s and writes nothing", async (_who, bounce) => {
    const b = settings();
    const fields = form({ value: "100", label: "Reach", "linkedin.followers": "5" });
    for (const run of [() => saveSocialReachHomepage(fields), () => clearSocialReachHomepage(), () => saveSocialReachPlatforms(fields)]) {
      requireConsole.mockRejectedValueOnce(new Error(bounce));
      await expect(run()).rejects.toThrow(bounce);
    }
    expect(b.upsert).not.toHaveBeenCalled();
    expect(b.delete).not.toHaveBeenCalled();
  });

  it("saves the homepage number and caption with today's date", async () => {
    const b = settings();
    const url = await redirectUrl(saveSocialReachHomepage(form({ value: "12,500", label: "Followers across our channels" })));
    expect(url.pathname).toBe("/console/social-reach");
    expect(url.searchParams.get("saved")).toBe("homepage");
    expect(b.upsert).toHaveBeenCalledWith({
      key: "social_reach_homepage",
      value: { value: 12500, label: "Followers across our channels", as_of: expect.any(String) },
    });
  });

  it.each([
    [{ value: "-1", label: "Reach" }, "e_value"],
    [{ value: "1.5", label: "Reach" }, "e_value"],
    [{ value: "", label: "Reach" }, "e_value"],
    [{ value: "10", label: "" }, "e_label"],
    [{ value: "10", label: "x".repeat(61) }, "e_label"],
  ])("rejects %j with a field error and keeps what was typed", async (fields, errorParam) => {
    const b = settings();
    const url = await redirectUrl(saveSocialReachHomepage(form(fields)));
    expect(url.searchParams.get(errorParam)).toBeTruthy();
    expect(url.searchParams.get("value")).toBe(fields.value);
    expect(url.searchParams.get("label")).toBe(fields.label);
    expect(b.upsert).not.toHaveBeenCalled();
  });

  it("removes the homepage figure, hiding the stat again", async () => {
    const b = settings();
    const url = await redirectUrl(clearSocialReachHomepage());
    expect(url.searchParams.get("saved")).toBe("cleared");
    expect(b.delete).toHaveBeenCalled();
    expect(b.eq).toHaveBeenCalledWith("key", "social_reach_homepage");
  });

  it("saves the hand-entered platform figures, keeping the dates of unchanged ones", async () => {
    const old = "2026-10-01T09:00:00.000Z";
    const b = settings({ linkedin: { followers: { value: 4200, at: old }, views: null } });
    const url = await redirectUrl(saveSocialReachPlatforms(form({ "linkedin.followers": "4200", "x.followers": "310", "x.views": "9000", "x.period": "last 30 days" })));
    expect(url.searchParams.get("saved")).toBe("platforms");
    const [[row]] = callsOf(b.upsert) as [[{ key: string; value: Record<string, unknown> }]];
    expect(row.key).toBe("social_reach_manual");
    expect(row.value.linkedin).toEqual({ followers: { value: 4200, at: old }, views: null });
    expect(row.value.x).toEqual({ followers: { value: 310, at: expect.any(String) }, views: { value: 9000, period: "last 30 days", at: expect.any(String) } });
  });

  it("rejects a bad platform figure, naming the field, and writes nothing", async () => {
    const b = settings();
    const url = await redirectUrl(saveSocialReachPlatforms(form({ "facebook.followers": "-3", "x.followers": "12" })));
    expect(url.searchParams.get("pe_facebook.followers")).toBeTruthy();
    expect(url.searchParams.get("pv_x.followers")).toBe("12");
    expect(b.upsert).not.toHaveBeenCalled();
  });

  it("says so when the database refuses the write", async () => {
    settings(null, dbError("boom"));
    const url = await redirectUrl(saveSocialReachHomepage(form({ value: "10", label: "Reach" })));
    expect(url.searchParams.get("error")).toMatch(/couldn't be saved/);
  });
});
