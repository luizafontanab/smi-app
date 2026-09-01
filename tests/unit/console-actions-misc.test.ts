import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteCategory, deleteContentPage, deleteMedia, markInboxRead, renameMedia, saveCategory, saveContentPage,
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
  it("only accepts story or member kinds", async () => {
    const from = db({});
    await saveCategory(form({ kind: "bogus", name: "x" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const from = db({});
    await saveCategory(form({ kind: "story", name: "  " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a new category and redirects", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ categories: () => builder });

    await expect(saveCategory(form({ kind: "story", name: "Fabrication" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?kind=story&saved=1");
    expect(builder.insert).toHaveBeenCalledWith({ kind: "story", name: "Fabrication", slug: "fabrication" });
  });

  it("reports a friendlier message for a duplicate slug within the same kind", async () => {
    db({ categories: () => queryBuilder(dbError("duplicate", { code: "23505" })) });

    await expect(saveCategory(form({ kind: "story", name: "Fabrication" })))
      .rejects.toThrow(/already%20used%20for%20this%20category%20type/);
  });

  it("updates an existing category in place", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ categories: () => builder });

    await expect(saveCategory(form({ id: "3", kind: "member", name: "Suppliers" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?kind=member&saved=1");
    expect(builder.update).toHaveBeenCalledWith({ name: "Suppliers", slug: "suppliers" });
  });
});

describe("deleteCategory", () => {
  it("requires the confirm checkbox", async () => {
    await expect(deleteCategory(form({ id: "3", kind: "story" })))
      .rejects.toThrow(/Tick%20the%20confirm%20box/);
  });

  it("reports when a member still references the category", async () => {
    db({ categories: () => queryBuilder(dbError("fk violation", { code: "23503" })) });

    await expect(deleteCategory(form({ id: "3", kind: "story", confirm: "1" })))
      .rejects.toThrow(/still%20assigned%20to%20a%20member/);
  });

  it("deletes and redirects with the kind preserved", async () => {
    db({ categories: () => queryBuilder(dbOk(null)) });

    await expect(deleteCategory(form({ id: "3", kind: "member", confirm: "1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/categories?kind=member&deleted=1");
  });
});
