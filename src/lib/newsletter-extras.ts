import { serviceDb } from "./db/server";
import { isMemberLinkable } from "./member-visibility";
import { diaryWindow } from "./newsletter-layout";

/** The most events the diary lists; the SOP's issue is a digest, not a calendar. */
const DIARY_LIMIT = 8;

export type DiaryEvent = { slug: string; title: string; starts_on: string; ends_on: string | null; location: string | null };
export type DirectoryEntry = { slug: string; name: string; logo_path: string | null };

/**
 * The SOP blocks that follow the stories (gap review area 5 slice B), shared
 * by the email render and the web copy so they show the same thing:
 *
 * - the events diary: published events starting in the 30 days from the
 *   issue's send date (scheduled, else sent, else today for a draft);
 * - the supplier directory: the members Jas picked, in name order, keeping
 *   only those with a public page to link to.
 *
 * Read with the service role, because newsletter_directory is console-managed
 * (no anon policy). Events are filtered to published here for the same reason.
 * A failed read leaves its block out rather than failing the send.
 */
export async function issueExtras(issueId: string, sendAt: string | null | undefined): Promise<{ events: DiaryEvent[]; directory: DirectoryEntry[] }> {
  const db = serviceDb();
  const { from, to } = diaryWindow(sendAt);
  const [{ data: events, error: eventsError }, { data: picks, error: picksError }] = await Promise.all([
    db.from("events").select("slug, title, starts_on, ends_on, location")
      .eq("status", "published").gte("starts_on", from).lte("starts_on", to)
      .order("starts_on").limit(DIARY_LIMIT),
    db.from("newsletter_directory").select("member:members(slug, name, logo_path, status, archived_at)").eq("issue_id", issueId),
  ]);
  if (eventsError) console.error(`[newsletter] events diary for ${issueId}: ${eventsError.message}`);
  if (picksError) console.error(`[newsletter] directory for ${issueId}: ${picksError.message}`);

  const directory = (picks ?? [])
    .flatMap((row) => (isMemberLinkable(row.member) ? [row.member] : []))
    .map(({ slug, name, logo_path }) => ({ slug, name, logo_path }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { events: events ?? [], directory };
}
