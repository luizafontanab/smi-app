import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteCategory, deleteContentPage, deleteIndustry, deleteMedia, markInboxRead, renameMedia, saveCategory,
  markProspect, saveContentPage, saveIndustry, saveSocialChannels,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, removeMedia, recordRename } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  recordRename: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ removeMedia, uploadImage: vi.fn(async () => null), uploadDocument: vi.fn(async () => null) }));
vi.mock("@/lib/redirects", () => ({ recordRename }));

afterEach(() => {
  resetDbServerMocks();
  removeMedia.mockReset().mockResolvedValue(undefined);
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
