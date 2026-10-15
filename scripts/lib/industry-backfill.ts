/**
 * Backfills industries onto members and content from Jas's mapping
 * (industry-map.ts), reading everything it needs from the target database —
 * `member_services` and `story_categories` — so it runs the same against a
 * fresh local seed and against production, with no WordPress export involved.
 *
 *  - Members: every industry their services point at goes into
 *    `member_industries`; the best single one becomes `members.industry_id`,
 *    their primary (primaryIndustry's rule).
 *  - Stories: the industry their news categories point at, else their member's
 *    primary.
 *  - Videos and events: their member's primary.
 *
 * A full, deterministic recompute: it replaces what is there, in one
 * transaction (apply_industry_backfill, migration 20261016000030), so a run
 * that fails part-way changes nothing and is simply run again. That also makes
 * it destructive once people curate industries by hand, which is why
 * runIndustryBackfill refuses a target that already has ANY industry
 * assignment — a member_industries row, or industry_id on a member, story,
 * video or event — unless told to overwrite.
 *
 * Shared by scripts/backfill-industries.ts (production, after the migration)
 * and both seeds.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "../../src/lib/db/all-rows";
import { industrySlug, type Industry } from "./industries";
import {
  CATEGORY_TO_INDUSTRY,
  SERVICE_TO_INDUSTRY,
  industriesForServices,
  industryForCategories,
  primaryIndustry,
  unknownSlugs,
} from "./industry-map";

export type BackfillInput = {
  industries: { id: number; slug: string; name: string; sort_order: number }[];
  members: { id: string; slug: string; name: string; services: string[] }[];
  stories: { id: string; slug: string; title: string; member_id: string | null; categories: string[] }[];
  videos: { id: string; member_id: string | null }[];
  events: { id: string; member_id: string | null }[];
};

type Assignment = { id: string; industry_id: number | null };

export type BackfillPlan = {
  links: { member_id: string; industry_id: number }[];
  members: Assignment[];
  stories: Assignment[];
  videos: Assignment[];
  events: Assignment[];
  report: {
    unresolvedMembers: { slug: string; name: string; services: string[] }[];
    unresolvedStories: { slug: string; title: string; categories: string[] }[];
    /** Slugs neither map has an entry for — new or renamed terms. */
    unknownServices: string[];
    unknownCategories: string[];
    /** Industry names the database lacks — the migration and industries.ts disagree. */
    missingIndustries: string[];
  };
};

/** Pure: decides every assignment. No I/O, so the rule is unit-testable. */
export function planIndustryBackfill(input: BackfillInput): BackfillPlan {
  const idBySlug = new Map(input.industries.map((i) => [i.slug, i.id]));
  const missing = new Set<string>();
  const idOf = (industry: Industry | null) => {
    if (!industry) return null;
    const id = idBySlug.get(industrySlug(industry));
    if (id == null) missing.add(industry);
    return id ?? null;
  };

  const links: BackfillPlan["links"] = [];
  const members: Assignment[] = [];
  const primaryOf = new Map<string, number | null>();
  for (const m of input.members) {
    const primary = idOf(primaryIndustry(m.services, SERVICE_TO_INDUSTRY));
    primaryOf.set(m.id, primary);
    members.push({ id: m.id, industry_id: primary });
    for (const industry of industriesForServices(m.services)) {
      const industry_id = idOf(industry);
      if (industry_id != null) links.push({ member_id: m.id, industry_id });
    }
  }
  const memberPrimary = (memberId: string | null) => (memberId ? primaryOf.get(memberId) ?? null : null);

  const stories = input.stories.map((s) => ({
    id: s.id,
    industry_id: idOf(industryForCategories(s.categories)) ?? memberPrimary(s.member_id),
  }));
  const viaMember = (rows: { id: string; member_id: string | null }[]) =>
    rows.map((r) => ({ id: r.id, industry_id: memberPrimary(r.member_id) }));

  const storyById = new Map(input.stories.map((s) => [s.id, s]));
  return {
    links,
    members,
    stories,
    videos: viaMember(input.videos),
    events: viaMember(input.events),
    report: {
      unresolvedMembers: input.members
        .filter((m) => primaryOf.get(m.id) == null)
        .map(({ slug, name, services }) => ({ slug, name, services })),
      unresolvedStories: stories
        .filter((s) => s.industry_id == null)
        .map((s) => storyById.get(s.id)!)
        .map(({ slug, title, categories }) => ({ slug, title, categories })),
      unknownServices: unknownSlugs(input.members.flatMap((m) => m.services), SERVICE_TO_INDUSTRY).sort(),
      unknownCategories: unknownSlugs(input.stories.flatMap((s) => s.categories), CATEGORY_TO_INDUSTRY).sort(),
      missingIndustries: [...missing].sort(),
    },
  };
}

/** Every row a select matches, in id order, failing loudly rather than truncating. */
const readAll = <T>(db: SupabaseClient, table: string, columns: string, orderBy: string[]) =>
  allRows<T>(async (from, to) => {
    let q = db.from(table).select(columns);
    for (const col of orderBy) q = q.order(col);
    const { data, error } = await q.range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    return { data: data as T[] };
  });

/** Reads the target's members, content and the two taxonomies' join tables. */
export async function loadBackfillInput(db: SupabaseClient): Promise<BackfillInput> {
  type Embedded = { slug: string } | null;
  const [industries, members, memberServices, stories, storyCategories, videos, events] = await Promise.all([
    readAll<BackfillInput["industries"][number]>(db, "industries", "id, slug, name, sort_order", ["sort_order", "id"]),
    readAll<{ id: string; slug: string; name: string }>(db, "members", "id, slug, name", ["id"]),
    readAll<{ member_id: string; service: Embedded }>(db, "member_services", "member_id, service:services(slug)", ["member_id", "service_id"]),
    readAll<{ id: string; slug: string; title: string; member_id: string | null }>(db, "stories", "id, slug, title, member_id", ["id"]),
    readAll<{ story_id: string; category: Embedded }>(db, "story_categories", "story_id, category:categories(slug)", ["story_id", "category_id"]),
    readAll<{ id: string; member_id: string | null }>(db, "videos", "id, member_id", ["id"]),
    readAll<{ id: string; member_id: string | null }>(db, "events", "id, member_id", ["id"]),
  ]);
  const slugsBy = <R>(rows: R[], key: (r: R) => string, term: (r: R) => Embedded) => {
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const slug = term(r)?.slug;
      if (!slug) continue;
      const list = out.get(key(r));
      if (list) list.push(slug);
      else out.set(key(r), [slug]);
    }
    return out;
  };
  const servicesOf = slugsBy(memberServices, (r) => r.member_id, (r) => r.service);
  const categoriesOf = slugsBy(storyCategories, (r) => r.story_id, (r) => r.category);
  return {
    industries,
    members: members.map((m) => ({ ...m, services: servicesOf.get(m.id) ?? [] })),
    stories: stories.map((s) => ({ ...s, categories: categoriesOf.get(s.id) ?? [] })),
    videos,
    events,
  };
}

/**
 * Writes a plan in one call to apply_industry_backfill, which replaces
 * member_industries and sets every listed row's industry_id inside a single
 * transaction. It used to be ~20 separate PostgREST calls, clear-everything
 * first; a failure between them left the target half-written or empty, and
 * the retry then tripped the overwrite guard on the remains.
 *
 * The report stays behind: the function takes only what it writes.
 */
export async function applyIndustryBackfill(db: SupabaseClient, plan: BackfillPlan): Promise<void> {
  const { links, members, stories, videos, events } = plan;
  const { error } = await db.rpc("apply_industry_backfill", { plan: { links, members, stories, videos, events } });
  if (error) throw new Error(`apply_industry_backfill: ${error.message}`);
}

/** The tables that carry a single industry_id, besides member_industries' many. */
const ASSIGNMENT_TABLES = ["members", "stories", "videos", "events"] as const;

/**
 * How many industry assignments the target already holds, per table — zero
 * everywhere on a target fresh from migration 20261012000001. member_industries
 * alone is not enough to go on: a console edit can set a story's or event's
 * industry while no member has links yet, and the backfill rewrites those too.
 */
export async function existingAssignments(db: SupabaseClient): Promise<Record<string, number>> {
  const counted = await Promise.all([
    db.from("member_industries").select("member_id", { count: "exact", head: true }).then((r) => ["member_industries", r] as const),
    ...ASSIGNMENT_TABLES.map((table) =>
      db.from(table).select("id", { count: "exact", head: true }).not("industry_id", "is", null).then((r) => [table, r] as const),
    ),
  ]);
  const out: Record<string, number> = {};
  for (const [table, { count, error }] of counted) {
    if (error) throw new Error(`${table}: ${error.message}`);
    if (count) out[table] = count;
  }
  return out;
}

/** Per-industry counts for the log: members (all links / primary), stories, videos, events. */
export function summarise(plan: BackfillPlan, industries: BackfillInput["industries"]): string[] {
  const count = (rows: { industry_id: number | null }[], id: number) => rows.filter((r) => r.industry_id === id).length;
  const sorted = [...industries].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const lines = sorted.map((i) =>
    `  ${i.name}: ${plan.links.filter((l) => l.industry_id === i.id).length} members (${count(plan.members, i.id)} primary), ` +
    `${count(plan.stories, i.id)} stories, ${count(plan.videos, i.id)} videos, ${count(plan.events, i.id)} events`,
  );
  const none = (rows: { industry_id: number | null }[]) => rows.filter((r) => r.industry_id == null).length;
  lines.push(
    `  (none): ${none(plan.members)} members, ${none(plan.stories)} stories, ${none(plan.videos)} videos, ${none(plan.events)} events`,
  );
  return lines;
}

/**
 * Load → plan → (apply), with the overwrite guard. Returns the plan so callers
 * can print the report. `overwrite` is required once the target holds any
 * industry assignment (existingAssignments): after launch those are curated,
 * and a re-run would wipe them.
 */
export async function runIndustryBackfill(
  db: SupabaseClient,
  opts: { dryRun?: boolean; overwrite?: boolean; log?: (line: string) => void } = {},
): Promise<BackfillPlan> {
  const log = opts.log ?? console.log;
  const tag = opts.dryRun ? "[dry-run] " : "";
  if (!opts.overwrite && !opts.dryRun) {
    const existing = Object.entries(await existingAssignments(db));
    if (existing.length) {
      throw new Error(
        `The target already has industry assignments (${existing.map(([t, n]) => `${t}: ${n}`).join(", ")}). ` +
          `The backfill recomputes every one of them, which would discard any picked by hand since. ` +
          `Re-run with --overwrite if that is intended.`,
      );
    }
  }

  const input = await loadBackfillInput(db);
  const plan = planIndustryBackfill(input);
  if (plan.report.missingIndustries.length) {
    throw new Error(
      `The industries table lacks: ${plan.report.missingIndustries.join(", ")}. ` +
        `Has migration 20261012000001 been applied?`,
    );
  }
  log(`${tag}— industries: ${plan.links.length} member_industries links across ${input.members.length} members`);
  for (const line of summarise(plan, input.industries)) log(`${tag}${line}`);
  if (plan.report.unknownServices.length) log(`${tag}  ⚠ services not in Jas's mapping: ${plan.report.unknownServices.join(", ")}`);
  if (plan.report.unknownCategories.length) log(`${tag}  ⚠ categories not in Jas's mapping: ${plan.report.unknownCategories.join(", ")}`);

  if (!opts.dryRun) await applyIndustryBackfill(db, plan);
  return plan;
}
