import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { publicDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => resetDbServerMocks());

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  vi.mocked(publicDb).mockReturnValue(asDb(mockDb({ from: fromByTable(map, () => queryBuilder(dbOk(null))) })));
}

describe("sitemap", () => {
  it("always includes the static section index, even on an empty site", async () => {
    db({});
    const entries = await sitemap();
    const paths = entries.map((e) => e.url);
    expect(paths.some((u) => u.endsWith("/news"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/advertising"))).toBe(true);
  });

  it("adds one entry per published story, member, video, event, sent newsletter and static page", async () => {
    db({
      stories: () => queryBuilder(dbOk([{ slug: "acme-story", updated_at: "2026-01-01" }])),
      members: () => queryBuilder(dbOk([{ slug: "acme" }])),
      videos: () => queryBuilder(dbOk([{ slug: "acme-video" }])),
      events: () => queryBuilder(dbOk([{ slug: "acme-event" }])),
      newsletter_issues: () => queryBuilder(dbOk([{ web_slug: "issue-47" }])),
      static_pages: () => queryBuilder(dbOk([{ slug: "about", updated_at: "2026-02-01" }])),
    });

    const entries = await sitemap();
    const paths = entries.map((e) => e.url);

    expect(paths.some((u) => u.endsWith("/news/acme-story"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/member/acme"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/video/acme-video"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/event/acme-event"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/newsletters/issue-47"))).toBe(true);
    expect(paths.some((u) => u.endsWith("/pages/about"))).toBe(true);
  });
});
