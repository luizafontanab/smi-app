import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSource, deleteSource, dismissSuggestion, recheckSource, startStoryFromSuggestion, updateSourceUrl,
} from "@/app/console/sources/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, logError } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  logError: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  logError.mockReset();
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
  it("creates an ordinary admin draft titled after the article, marks the suggestion, and opens the editor", async () => {
    const items = queryBuilder(dbOk({ id: "i1", title: "New 12kW fibre laser installed", state: "new", story_id: null }));
    const stories = queryBuilder(dbOk({ id: "story-9" }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ source_items: () => items, stories: () => stories }) })));

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
    const inserted = callsOf(stories, "insert")[0][0] as Record<string, unknown>;
    expect(inserted).toEqual(expect.objectContaining({ title: "New 12kW fibre laser installed", status: "draft", source: "admin", submitted_by: "admin1" }));
    expect(inserted.slug).toMatch(/^new-12kw-fibre-laser-installed-[a-z0-9]+$/);
    // the source link is never written into the story
    expect(inserted).not.toHaveProperty("body");
    expect(callsOf(items, "update")[0][0]).toEqual(expect.objectContaining({ state: "drafted", story_id: "story-9" }));
  });

  it("a second click opens the story already started instead of making another", async () => {
    const items = queryBuilder(dbOk({ id: "i1", title: "T", state: "drafted", story_id: "story-9" }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ source_items: () => items }) })));

    await expect(startStoryFromSuggestion(form({ id: "i1" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/story-9");
  });

  it("says so when the suggestion has gone", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ source_items: () => queryBuilder(dbOk(null)) }) })));
    await expect(startStoryFromSuggestion(form({ id: "gone" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/sources\?error=/);
  });
});
