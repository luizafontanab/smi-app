import { must } from "@/lib/db/must";
import type { serviceDb } from "@/lib/db/server";
import { UUID_RE } from "@/lib/validate";

export type FeaturableEvent = { id: string; label: string };

/**
 * The event picker's options: published events that aren't over yet, soonest
 * first — the same rules saveFeaturedEventPlacement enforces. Each label says
 * who would be invoiced, since an event with no member can only be booked
 * unpriced. `keep` adds one event that no longer qualifies (an edit page's
 * own event), so the <select> can't silently fall back to another one.
 */
export async function featurableEvents(db: ReturnType<typeof serviceDb>, today: string, keep?: string | null): Promise<FeaturableEvent[]> {
  // `keep` is spliced into a PostgREST filter string, so only a uuid gets in.
  const keepId = keep && UUID_RE.test(keep) ? keep : null;
  const rows = await must(
    db
      .from("events")
      .select("id, title, starts_on, ends_on, status, member:members(name)")
      .or(`and(status.eq.published,ends_on.gte.${today}),and(status.eq.published,ends_on.is.null,starts_on.gte.${today})${keepId ? `,id.eq.${keepId}` : ""}`)
      .order("starts_on"),
    "console/featured-event events",
  );
  return (rows ?? []).map((e) => {
    const stale = e.status !== "published" || (e.ends_on ?? e.starts_on) < today;
    const who = e.member?.name ?? "no member — unpriced only";
    return { id: e.id, label: `${e.title} — ${e.starts_on} · ${who}${stale ? " (no longer featurable)" : ""}` };
  });
}
