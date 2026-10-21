import { afterEach, describe, expect, it, vi } from "vitest";
import { issueExtras } from "@/lib/newsletter-extras";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable(map) })));
}

const member = (name: string, extra: Record<string, unknown> = {}) => ({
  member: { slug: name.toLowerCase(), name, logo_path: null, status: "active", archived_at: null, ...extra },
});

describe("issueExtras", () => {
  it("reads published events in the 30 days from the send date", async () => {
    const events = queryBuilder(dbOk([{ slug: "euroblech", title: "EuroBLECH", starts_on: "2026-11-10", ends_on: null, location: "Hanover" }]));
    db({ events: () => events, newsletter_directory: () => queryBuilder(dbOk([])) });

    const { events: diary } = await issueExtras("iss1", "2026-11-03T09:00:00Z");

    expect(events.eq).toHaveBeenCalledWith("status", "published");
    expect(events.gte).toHaveBeenCalledWith("starts_on", "2026-11-03");
    expect(events.lte).toHaveBeenCalledWith("starts_on", "2026-12-03");
    expect(diary.map((e) => e.slug)).toEqual(["euroblech"]);
  });

  it("lists the picked members in name order, leaving out any without a public page", async () => {
    db({
      events: () => queryBuilder(dbOk([])),
      newsletter_directory: () => queryBuilder(dbOk([
        member("Trumpf"),
        member("Amada"),
        member("Lapsed Ltd", { status: "lapsed" }),
        member("Archived Ltd", { archived_at: "2026-09-01" }),
        { member: null },
      ])),
    });

    const { directory } = await issueExtras("iss1", null);

    expect(directory).toEqual([
      { slug: "amada", name: "Amada", logo_path: null },
      { slug: "trumpf", name: "Trumpf", logo_path: null },
    ]);
  });

  it("leaves a block out when its read fails, rather than failing the send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ events: () => queryBuilder(dbError("boom")), newsletter_directory: () => queryBuilder(dbError("boom")) });

    expect(await issueExtras("iss1", null)).toEqual({ events: [], directory: [] });
  });
});
