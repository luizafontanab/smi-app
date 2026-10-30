import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSource, deleteSource, dismissSuggestion, recheckSource, startStoryFromSuggestion, syncSourcesFromBigin, updateSourceUrl,
} from "@/app/console/sources/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";
import { UploadRejectedError } from "@/lib/upload-limits";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, logError } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  logError: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));
const { isFeatureEnabled, syncBiginSources } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(async () => true),
  syncBiginSources: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/sources/bigin", () => ({ syncBiginSources }));
const DRAFT = {
  title: "Acme installs a laser", excerpt: "Acme has a laser.", body: "<p>Acme has a laser.</p>",
  cover: new File([new Uint8Array([1])], "cover.jpg", { type: "image/jpeg" }),
  original: "<p>We have a laser.</p>", rewritten: true, notes: [] as string[],
};
const { prepareDraft, uploadImage, removeMedia } = vi.hoisted(() => ({
  prepareDraft: vi.fn(),
  uploadImage: vi.fn(),
  removeMedia: vi.fn(async () => {}),
}));
vi.mock("@/lib/sources/draft", () => ({ prepareDraft }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia }));

afterEach(() => {
  resetDbServerMocks();
  logError.mockReset();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  syncBiginSources.mockReset();
  prepareDraft.mockReset().mockResolvedValue(DRAFT);
  uploadImage.mockReset().mockResolvedValue("stories/cover.jpg");
  removeMedia.mockClear();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const callsOf = (builder: ReturnType<typeof queryBuilder>, method: string) =>
  vi.mocked(builder[method] as (...a: unknown[]) => unknown).mock.calls;

describe("addSource", () => {
  it("normalises the address and inserts it with its bare domain", async () => {
    const sources = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));

    await expect(addSource(form({ url: "www.example-fab.co.uk/news#top", label: "Example Fab" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/sources?view=sources&added=1");
    expect(callsOf(sources, "insert")[0][0]).toEqual({ url: "https://www.example-fab.co.uk/news", domain: "example-fab.co.uk", label: "Example Fab" });
  });

  it("refuses something that isn't an address, without touching the database", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({}) })));
    await expect(addSource(form({ url: "not an address" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/sources\?view=sources&error=/);
  });

  it("says so when the page is already on the list", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ content_sources: () => queryBuilder(dbError("duplicate key", { code: "23505" })) }),
    })));
    await expect(addSource(form({ url: "https://example-fab.co.uk/news/" })))
      .rejects.toThrow(encodeURIComponent("That news page is already on the list."));
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("recheckSource / updateSourceUrl", () => {
  it("forgets the stored method and puts the source first in line", async () => {
    const sources = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));

    await expect(recheckSource(form({ id: "s1", return: "access=blocked&page=1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/sources?view=sources&queued=1&access=blocked&page=1");
    expect(callsOf(sources, "update")[0][0]).toEqual(expect.objectContaining({ method: null, method_url: null, failure_count: 0, last_checked_at: null }));
    expect(callsOf(sources, "eq")[0]).toEqual(["id", "s1"]);
  });

  it("a changed address resets how the source is read", async () => {
    const sources = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));

    await expect(updateSourceUrl(form({ id: "s1", url: "https://example-fab.co.uk/latest-news/" }))).rejects.toThrow("queued=1");
    expect(callsOf(sources, "update")[0][0]).toEqual(expect.objectContaining({
      url: "https://example-fab.co.uk/latest-news/", domain: "example-fab.co.uk", method: null, access: "unknown", last_error: null,
    }));
  });
});

describe("a source owned by a Bigin company", () => {
  const linked = () => queryBuilder(dbOk({ bigin_account_id: "9100000000001" }));

  it("can't have its address changed here — the next Bigin sync would undo it", async () => {
    const sources = linked();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));
    await expect(updateSourceUrl(form({ id: "s1", url: "https://example-fab.co.uk/blog/" })))
      .rejects.toThrow(encodeURIComponent("change or clear it in Bigin"));
    expect(sources.update).not.toHaveBeenCalled();
  });

  it("can't be removed here either", async () => {
    const sources = linked();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));
    await expect(deleteSource(form({ id: "s1", confirm: "1" }))).rejects.toThrow(encodeURIComponent("change or clear it in Bigin"));
    expect(sources.delete).not.toHaveBeenCalled();
  });
});

describe("deleteSource", () => {
  it("needs the confirm tick", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({}) })));
    await expect(deleteSource(form({ id: "s1" }))).rejects.toThrow(/error=/);
  });

  it("removes the source when confirmed", async () => {
    const sources = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ content_sources: () => sources }) })));
    await expect(deleteSource(form({ id: "s1", confirm: "1" }))).rejects.toThrow("removed=1");
    expect(sources.delete).toHaveBeenCalled();
  });
});

describe("dismissSuggestion", () => {
  it("only dismisses a suggestion that is still new", async () => {
    const items = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ source_items: () => items }) })));

    await expect(dismissSuggestion(form({ id: "i1", return: "page=2" }))).rejects.toThrow("NEXT_REDIRECT:/console/sources?page=2");
    expect(callsOf(items, "update")[0][0]).toEqual(expect.objectContaining({ state: "dismissed" }));
    expect(callsOf(items, "eq")).toEqual([["id", "i1"], ["state", "new"]]);
  });
});

describe("startStoryFromSuggestion", () => {
  const ACME = { id: "m-acme", name: "Acme Fabrication Ltd", slug: "acme-fabrication", industry_id: 7, status: "active", archived_at: null };
  const suggestion = (extra: Record<string, unknown> = {}) => queryBuilder(dbOk({
    id: "i1", url: "https://acme.test/news/laser", title: "New 12kW fibre laser installed", state: "new", story_id: null,
    source: { label: "Acme news", domain: "acme.test", bigin_account_name: null, member: null }, ...extra,
  }));
  const setup = (items: ReturnType<typeof queryBuilder>, opts: { stories?: ReturnType<typeof queryBuilder>; originals?: ReturnType<typeof queryBuilder>; rpc?: () => Promise<unknown> } = {}) => {
    const stories = opts.stories ?? queryBuilder(dbOk({ id: "story-9" }));
    const originals = opts.originals ?? queryBuilder(dbOk(null));
    const db = mockDb({
      from: fromByTable({ source_items: () => items, stories: () => stories, story_originals: () => originals }),
      ...(opts.rpc ? { rpc: opts.rpc } : {}),
    });
    vi.mocked(serviceDb).mockReturnValue(asDb(db));
    return { stories, originals, db };
  };

  it("makes an admin draft pre-loaded from the article, keeps the original, marks the suggestion and opens the editor", async () => {
    const items = suggestion();
    const { stories, originals } = setup(items);

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(prepareDraft).toHaveBeenCalledWith({ url: "https://acme.test/news/laser", title: "New 12kW fibre laser installed", company: "Acme news", member: null });
    const inserted = callsOf(stories, "insert")[0][0] as Record<string, unknown>;
    expect(inserted).toEqual(expect.objectContaining({
      title: "Acme installs a laser", excerpt: "Acme has a laser.", body: "<p>Acme has a laser.</p>", cover_path: "stories/cover.jpg",
      status: "draft", source: "admin", submitted_by: "admin1", member_id: null, industry_id: null,
    }));
    expect(inserted.slug).toMatch(/^acme-installs-a-laser-[a-z0-9]+$/);
    expect(uploadImage).toHaveBeenCalledWith(expect.any(File), "stories");
    expect(callsOf(originals, "insert")[0][0]).toEqual({ story_id: "story-9", source_url: "https://acme.test/news/laser", body: "<p>We have a laser.</p>", rewritten: true });
    expect(callsOf(items, "update")[0][0]).toEqual(expect.objectContaining({ state: "drafted", story_id: "story-9" }));
  });

  it("lists whatever couldn't be loaded on the editor, and still makes the draft", async () => {
    prepareDraft.mockResolvedValueOnce({
      title: "New 12kW fibre laser installed", excerpt: null, body: "", cover: null, original: "", rewritten: false,
      notes: ["Couldn't read the article page.", "No image."],
    });
    const { stories, originals } = setup(suggestion());

    const thrown = await startStoryFromSuggestion(form({ id: "i1" })).catch((e: Error) => e);
    const target = new URL(String((thrown as Error).message).replace("NEXT_REDIRECT:", "http://x"));
    expect(target.pathname).toBe("/console/stories/story-9");
    expect(target.searchParams.get("notice")).toBe("Couldn't read the article page.\nNo image.");
    expect(callsOf(stories, "insert")[0][0]).toEqual(expect.objectContaining({ title: "New 12kW fibre laser installed", body: "", cover_path: null }));
    expect(uploadImage).not.toHaveBeenCalled();
    // nothing was read, so there is no original to keep
    expect(callsOf(originals, "insert")).toHaveLength(0);
  });

  it("a source matched to a member tags the draft, takes their industry and passes them on for the link", async () => {
    const { stories, db } = setup(suggestion({ source: { label: "Acme news", domain: "acme.test", bigin_account_name: "Acme (Bigin)", member: ACME } }));

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(prepareDraft).toHaveBeenCalledWith(expect.objectContaining({ company: "Acme Fabrication Ltd", member: ACME }));
    expect(callsOf(stories, "insert")[0][0]).toEqual(expect.objectContaining({ member_id: "m-acme", industry_id: 7 }));
    expect(db.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "story-9", p_member_ids: ["m-acme"] });
  });

  it("names the company from Bigin when no member is matched", async () => {
    setup(suggestion({ source: { label: "Acme news", domain: "acme.test", bigin_account_name: "Acme Fabrication", member: null } }));
    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(prepareDraft).toHaveBeenCalledWith(expect.objectContaining({ company: "Acme Fabrication", member: null }));
  });

  it("doesn't tag a member without a live page (lapsed or archived)", async () => {
    const { stories, db } = setup(suggestion({ source: { label: null, domain: "acme.test", bigin_account_name: null, member: { ...ACME, status: "lapsed" } } }));

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(callsOf(stories, "insert")[0][0]).toEqual(expect.objectContaining({ member_id: null, industry_id: null }));
    expect(prepareDraft).toHaveBeenCalledWith(expect.objectContaining({ company: "acme.test", member: null }));
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("if tagging fails the draft is kept untagged, and the editor says so", async () => {
    const items = suggestion({ source: { label: null, domain: "acme.test", bigin_account_name: null, member: ACME } });
    const { stories } = setup(items, { rpc: async () => ({ data: null, error: { message: "boom" } }) });

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/story-9\?error=/);
    expect(callsOf(stories, "update")[0][0]).toEqual({ member_id: null });
    expect(logError).toHaveBeenCalled();
    expect(callsOf(items, "update")[0][0]).toEqual(expect.objectContaining({ state: "drafted", story_id: "story-9" }));
  });

  it("a refused image is a note, not a failure", async () => {
    uploadImage.mockRejectedValueOnce(new UploadRejectedError("Images only"));
    const { stories } = setup(suggestion());

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/story-9\?notice=/);
    expect(callsOf(stories, "insert")[0][0]).toEqual(expect.objectContaining({ cover_path: null }));
    expect(logError).not.toHaveBeenCalled();
  });

  it("if the draft can't be made, the uploaded cover is removed", async () => {
    setup(suggestion(), { stories: queryBuilder(dbError("boom")) });

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/sources\?error=/);
    expect(removeMedia).toHaveBeenCalledWith("stories/cover.jpg");
  });

  it("a second click opens the story already started instead of making another", async () => {
    setup(suggestion({ state: "drafted", story_id: "story-9" }));
    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(prepareDraft).not.toHaveBeenCalled();
  });

  it("only claims a suggestion still in the state it was read in", async () => {
    const items = suggestion();
    setup(items);
    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(callsOf(items, "eq")).toEqual(expect.arrayContaining([["state", "new"]]));
  });

  describe("when another click started it first, while this draft was being prepared", () => {
    const row = { id: "i1", url: "https://acme.test/news/laser", title: "New 12kW fibre laser installed", state: "new", story_id: null, source: { label: "Acme news", domain: "acme.test", bigin_account_name: null, member: null } };
    // read → the claim (no row: someone else changed it) → the re-read
    const raced = (after: Record<string, unknown> | null) => sequence(dbOk(row), dbOk(null), dbOk(after));
    const setupRace = (after: Record<string, unknown> | null) => {
      const stories = queryBuilder(dbOk({ id: "story-9" }));
      vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
        from: fromByTable({ source_items: raced(after), stories: () => stories, story_originals: () => queryBuilder(dbOk(null)) }),
      })));
      return { stories };
    };

    it("removes its own draft and cover, and opens the one already started", async () => {
      const { stories } = setupRace({ state: "drafted", story_id: "story-1" });
      await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-1");
      expect(callsOf(stories, "delete")).toHaveLength(1);
      expect(callsOf(stories, "eq")).toEqual(expect.arrayContaining([["id", "story-9"]]));
      expect(removeMedia).toHaveBeenCalledWith("stories/cover.jpg");
    });

    it("says so when it was dismissed instead", async () => {
      const { stories } = setupRace({ state: "dismissed", story_id: null });
      await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/sources\?error=/);
      expect(callsOf(stories, "delete")).toHaveLength(1);
    });
  });

  it("if the claim itself fails, the draft is kept and opened", async () => {
    const row = { id: "i1", url: "https://acme.test/news/laser", title: "t", state: "new", story_id: null, source: { label: null, domain: "acme.test", bigin_account_name: null, member: null } };
    const stories = queryBuilder(dbOk({ id: "story-9" }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ source_items: sequence(dbOk(row), dbError("timeout")), stories: () => stories, story_originals: () => queryBuilder(dbOk(null)) }),
    })));
    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    expect(callsOf(stories, "delete")).toHaveLength(0);
    expect(logError).toHaveBeenCalled();
  });

  it("says so when the suggestion has gone", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ source_items: () => queryBuilder(dbOk(null)) }) })));
    await expect(startStoryFromSuggestion(form({ id: "gone" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/sources\?error=/);
  });
});

describe("syncSourcesFromBigin", () => {
  it("refuses while the story crawler is off", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await expect(syncSourcesFromBigin()).rejects.toThrow(encodeURIComponent("The story crawler is off"));
    expect(syncBiginSources).not.toHaveBeenCalled();
  });

  it("says so when Bigin isn't connected", async () => {
    syncBiginSources.mockResolvedValue(null);
    await expect(syncSourcesFromBigin()).rejects.toThrow(encodeURIComponent("Bigin isn't connected"));
  });

  it("runs the sync and reports back", async () => {
    syncBiginSources.mockResolvedValue({ added: 1 });
    await expect(syncSourcesFromBigin()).rejects.toThrow("NEXT_REDIRECT:/console/sources?view=sources&bigin=synced");
  });

  it("a failed sync is logged and reported, not thrown to the error page", async () => {
    syncBiginSources.mockRejectedValue(new Error("db down"));
    await expect(syncSourcesFromBigin()).rejects.toThrow(encodeURIComponent("The Bigin sync failed part-way"));
    expect(logError).toHaveBeenCalled();
  });
});
