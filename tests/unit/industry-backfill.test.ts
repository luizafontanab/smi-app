import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyIndustryBackfill,
  existingAssignments,
  planIndustryBackfill,
  runIndustryBackfill,
  type BackfillInput,
  type BackfillPlan,
} from "../../scripts/lib/industry-backfill";
import { INDUSTRY_ROWS } from "../../scripts/lib/industries";
import { CATEGORY_TO_INDUSTRY, SERVICE_TO_INDUSTRY } from "../../scripts/lib/industry-map";
import { assertScriptTarget } from "../../scripts/lib/target-guard";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

/**
 * planIndustryBackfill is the whole decision the production backfill makes.
 * Pinned here: which industry each kind of row gets, and what reaches the
 * report for Jas — then the runner around it: the overwrite guard, the target
 * guard, and that the write is a single transactional call. The transaction
 * itself (all or nothing) is proven against the real database in
 * industry-backfill-apply.test.ts.
 */

const industries = INDUSTRY_ROWS.map((r, i) => ({ ...r, id: 100 + i }));
const id = (slug: string) => industries.find((i) => i.slug === slug)!.id;

const input = (over: Partial<BackfillInput> = {}): BackfillInput => ({
  industries,
  members: [],
  stories: [],
  videos: [],
  events: [],
  ...over,
});

describe("planIndustryBackfill — members", () => {
  it("links a member to every industry their services touch and picks the specific one as primary", () => {
    const plan = planIndustryBackfill(
      input({ members: [{ id: "m1", slug: "acme", name: "Acme", services: ["welding-joining-fastening", "forging", "assembly"] }] }),
    );
    expect(plan.links.map((l) => l.industry_id).sort()).toEqual(
      [id("welding-joining"), id("machinery-tools-equipment"), id("subcontractor-news")].sort(),
    );
    expect(plan.members).toEqual([{ id: "m1", industry_id: id("welding-joining") }]);
  });

  it("always includes the primary among the member's links", () => {
    const plan = planIndustryBackfill(
      input({
        members: [
          { id: "m1", slug: "a", name: "A", services: ["forging", "assembly", "tool-die"] },
          { id: "m2", slug: "b", name: "B", services: ["software-cad-cam-erp", "automation-robotics"] },
        ],
      }),
    );
    for (const m of plan.members) {
      expect(plan.links).toContainEqual({ member_id: m.id, industry_id: m.industry_id });
    }
  });

  it("leaves a member whose services map nowhere without an industry, and reports them", () => {
    const plan = planIndustryBackfill(
      input({ members: [{ id: "m1", slug: "lawyers", name: "Lawyers Ltd", services: ["recruitment-services"] }] }),
    );
    expect(plan.links).toEqual([]);
    expect(plan.members).toEqual([{ id: "m1", industry_id: null }]);
    expect(plan.report.unresolvedMembers).toEqual([{ slug: "lawyers", name: "Lawyers Ltd", services: ["recruitment-services"] }]);
  });
});

describe("planIndustryBackfill — content", () => {
  const members = [{ id: "m1", slug: "acme", name: "Acme", services: ["welding-joining-fastening"] }];

  it("gives a story the industry of its categories, ahead of its member's", () => {
    const plan = planIndustryBackfill(
      input({ members, stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: ["software-cad-cam-erp"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: id("software-it-services") }]);
  });

  it("falls back to the member's primary when the categories say nothing", () => {
    const plan = planIndustryBackfill(
      input({ members, stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: ["industry-news"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: id("welding-joining") }]);
  });

  it("leaves a member-less Industry News story without one, and reports it", () => {
    const plan = planIndustryBackfill(
      input({ stories: [{ id: "s1", slug: "news", title: "News", member_id: null, categories: ["industry-news"] }] }),
    );
    expect(plan.stories).toEqual([{ id: "s1", industry_id: null }]);
    expect(plan.report.unresolvedStories).toEqual([{ slug: "news", title: "News", categories: ["industry-news"] }]);
  });

  it("gives videos and events their member's primary, and nothing without a member", () => {
    const plan = planIndustryBackfill(
      input({
        members,
        videos: [{ id: "v1", member_id: "m1" }, { id: "v2", member_id: null }],
        events: [{ id: "e1", member_id: "m1" }, { id: "e2", member_id: null }],
      }),
    );
    expect(plan.videos).toEqual([{ id: "v1", industry_id: id("welding-joining") }, { id: "v2", industry_id: null }]);
    expect(plan.events).toEqual([{ id: "e1", industry_id: id("welding-joining") }, { id: "e2", industry_id: null }]);
  });
});

describe("planIndustryBackfill — report", () => {
  it("lists slugs neither map has seen, once each", () => {
    const plan = planIndustryBackfill(
      input({
        members: [{ id: "m1", slug: "a", name: "A", services: ["new-service", "new-service", "forging"] }],
        stories: [{ id: "s1", slug: "s", title: "S", member_id: null, categories: ["new-topic", "industry-news"] }],
      }),
    );
    expect(plan.report.unknownServices).toEqual(["new-service"]);
    expect(plan.report.unknownCategories).toEqual(["new-topic"]);
  });

  it("names an industry the database lacks instead of silently dropping it", () => {
    const plan = planIndustryBackfill(
      input({
        industries: industries.filter((i) => i.slug !== "welding-joining"),
        members: [{ id: "m1", slug: "a", name: "A", services: ["welding-joining-fastening"] }],
      }),
    );
    expect(plan.report.missingIndustries).toEqual(["Welding & Joining"]);
  });

});

describe("planIndustryBackfill — input order", () => {
  // The backfill reads services and categories in whatever order PostgREST
  // returns them, so the same member must get the same primary either way
  // round. Every pair, both orders: dozens of these pairs tie on everything
  // but primaryIndustry's last tie-break (INDUSTRIES order), so dropping or
  // breaking a tie-break makes the answer follow the input and this fails.
  const mapped = (map: Readonly<Record<string, unknown>>) => Object.keys(map).filter((slug) => map[slug]);
  const pairs = (slugs: string[]) => slugs.flatMap((a, i) => slugs.slice(i + 1).map((b) => [a, b] as const));

  it("gives a member the same primary whichever order their services come in", () => {
    const both = pairs(mapped(SERVICE_TO_INDUSTRY));
    const forward = planIndustryBackfill(input({ members: both.map(([a, b], i) => ({ id: `m${i}`, slug: `m${i}`, name: "M", services: [a, b] })) }));
    const reverse = planIndustryBackfill(input({ members: both.map(([a, b], i) => ({ id: `m${i}`, slug: `m${i}`, name: "M", services: [b, a] })) }));
    expect(reverse.members).toEqual(forward.members);
  });

  it("gives a story the same industry whichever order its categories come in", () => {
    const both = pairs(mapped(CATEGORY_TO_INDUSTRY));
    const story = (categories: string[], i: number) => ({ id: `s${i}`, slug: `s${i}`, title: "S", member_id: null, categories });
    const forward = planIndustryBackfill(input({ stories: both.map(([a, b], i) => story([a, b], i)) }));
    const reverse = planIndustryBackfill(input({ stories: both.map(([a, b], i) => story([b, a], i)) }));
    expect(reverse.stories).toEqual(forward.stories);
  });
});

/* ---------- the runner, its guard and the write ---------- */

/**
 * A target database, table by table. A head-only count (the overwrite guard)
 * answers `counts[table]`; any other read answers `rows[table]`. Each builder
 * is kept so a test can see which filters it got.
 */
function target(counts: Partial<Record<string, number>> = {}, rows: Partial<Record<string, unknown[]>> = {}) {
  const tables = ["industries", "members", "member_services", "stories", "story_categories", "videos", "events", "member_industries"];
  const made: { table: string; builder: ReturnType<typeof queryBuilder> }[] = [];
  const from = fromByTable(Object.fromEntries(tables.map((table) => [table, () => {
    const builder: ReturnType<typeof queryBuilder> = queryBuilder(() => {
      const head = (builder.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.head;
      return head ? dbOk(null, counts[table] ?? 0) : dbOk(rows[table] ?? (table === "industries" ? industries : []));
    });
    made.push({ table, builder });
    return builder;
  }])));
  const rpc = vi.fn(async () => dbOk(null));
  const db = asDb(mockDb({ from, rpc }));
  /** Every write method called on any table — the apply must make none of its own. */
  const tableWrites = () =>
    made.flatMap(({ table, builder }) =>
      (["insert", "update", "upsert", "delete"] as const).flatMap((m) => ((builder[m] as ReturnType<typeof vi.fn>).mock.calls.length ? [`${m} ${table}`] : [])),
    );
  return { db, rpc, made, tableWrites };
}

const quiet = { log: () => {} };

describe("runIndustryBackfill — the overwrite guard", () => {
  it("runs on a target with no industry assignments anywhere", async () => {
    const t = target();
    await runIndustryBackfill(t.db, quiet);
    expect(t.rpc).toHaveBeenCalledTimes(1);
  });

  // member_industries used to be the only table checked, so any of these
  // went straight through and had its hand-picked industries recomputed.
  it.each(["members", "stories", "videos", "events"])(
    "refuses a target whose %s already carry an industry, though member_industries is empty",
    async (table) => {
      const t = target({ [table]: 3 });
      await expect(runIndustryBackfill(t.db, quiet)).rejects.toThrow(`${table}: 3`);
      expect(t.rpc).not.toHaveBeenCalled();
    },
  );

  it("still refuses a target with member_industries rows, and names every table that has some", async () => {
    const t = target({ member_industries: 40, stories: 7 });
    await expect(runIndustryBackfill(t.db, quiet)).rejects.toThrow(/member_industries: 40, stories: 7.*--overwrite/);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("counts only rows that actually have an industry", async () => {
    const t = target();
    await runIndustryBackfill(t.db, quiet);
    const filtered = t.made
      .filter(({ table, builder }) => table !== "member_industries" && (builder.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.head)
      .map(({ table, builder }) => [table, (builder.not as ReturnType<typeof vi.fn>).mock.calls[0]]);
    expect(filtered).toEqual([
      ["members", ["industry_id", "is", null]],
      ["stories", ["industry_id", "is", null]],
      ["videos", ["industry_id", "is", null]],
      ["events", ["industry_id", "is", null]],
    ]);
  });

  it("goes ahead over existing assignments with overwrite", async () => {
    const t = target({ member_industries: 40, members: 12 });
    await runIndustryBackfill(t.db, { ...quiet, overwrite: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
  });

  it("a dry run reports on a curated target and writes nothing", async () => {
    const t = target({ member_industries: 40 });
    const plan = await runIndustryBackfill(t.db, { ...quiet, dryRun: true });
    expect(plan.links).toEqual([]);
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.tableWrites()).toEqual([]);
  });

  it("refuses before writing when the industries table lacks one of Jas's ten", async () => {
    const t = target({}, {
      industries: industries.filter((i) => i.slug !== "welding-joining"),
      members: [{ id: "m1", slug: "a", name: "A" }],
      member_services: [{ member_id: "m1", service: { slug: "welding-joining-fastening" } }],
    });
    await expect(runIndustryBackfill(t.db, quiet)).rejects.toThrow(/lacks: Welding & Joining/);
    expect(t.rpc).not.toHaveBeenCalled();
  });
});

describe("applyIndustryBackfill", () => {
  const plan = planIndustryBackfill(
    input({
      members: [{ id: "m1", slug: "acme", name: "Acme", services: ["welding-joining-fastening", "assembly"] }],
      stories: [{ id: "s1", slug: "s", title: "S", member_id: "m1", categories: [] }],
      videos: [{ id: "v1", member_id: "m1" }],
      events: [{ id: "e1", member_id: null }],
    }),
  );

  // One RPC is one transaction. The old apply was ~20 PostgREST calls, clear
  // first; a failure between them left the target half-written or empty.
  it("writes the whole plan in a single apply_industry_backfill call and nothing else", async () => {
    const t = target();
    await applyIndustryBackfill(t.db, plan);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("apply_industry_backfill", {
      plan: { links: plan.links, members: plan.members, stories: plan.stories, videos: plan.videos, events: plan.events },
    });
    expect(t.tableWrites()).toEqual([]);
  });

  it("sends every row, nulls included — a null is how a stale industry gets cleared", async () => {
    const t = target();
    await applyIndustryBackfill(t.db, plan);
    const sent = (t.rpc.mock.calls[0] as unknown as [string, { plan: BackfillPlan }])[1].plan;
    expect(sent.events).toEqual([{ id: "e1", industry_id: null }]);
    expect(sent).not.toHaveProperty("report");
  });

  it("throws the database's error, so the script exits non-zero", async () => {
    const t = target();
    t.rpc.mockResolvedValueOnce(dbError("insert or update on table \"member_industries\" violates foreign key constraint") as never);
    await expect(applyIndustryBackfill(t.db, plan)).rejects.toThrow(/apply_industry_backfill: .*foreign key/);
  });
});

describe("existingAssignments", () => {
  it("lists only the tables that have some", async () => {
    expect(await existingAssignments(target({ stories: 2 }).db)).toEqual({ stories: 2 });
    expect(await existingAssignments(target().db)).toEqual({});
  });
});

describe("assertScriptTarget (scripts/backfill-industries.ts)", () => {
  it("lets a local target through without a flag", () => {
    expect(() => assertScriptTarget("http://127.0.0.1:56321", "the backfill", [])).not.toThrow();
  });

  it("refuses a hosted project without --remote — a shell with production's env sourced", () => {
    expect(() => assertScriptTarget("https://bvyxeujhecxulzwvpxfr.supabase.co", "the backfill", ["--overwrite"])).toThrow(
      /Refusing to run the backfill against a remote project without --remote/,
    );
  });

  it("allows a hosted project only with --remote, which industries:backfill:prod passes", () => {
    expect(() => assertScriptTarget("https://bvyxeujhecxulzwvpxfr.supabase.co", "the backfill", ["--remote"])).not.toThrow();
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["industries:backfill:prod"]).toMatch(/backfill-industries\.ts --remote$/);
    expect(pkg.scripts["industries:backfill"]).not.toContain("--remote");
  });
});
