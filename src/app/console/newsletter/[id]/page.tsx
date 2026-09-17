import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { renderIssueHtml } from "@/lib/adapters/newsletter";
import { attachNewsletterAd, detachNewsletterAd, updateIssue } from "../../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";

// Only artwork uploaded for these formats is eligible — newsletter_ads has no
// link to advert_bookings or a rate card, so the artwork's own format is the
// only structural signal for "meant for a newsletter." Whether a given member
// is entitled to be in this particular issue stays a manual judgment call.
const NEWSLETTER_FORMATS = ["newsletter_banner", "association_logo"];

export default async function IssueDetail(props: PageProps<"/console/newsletter/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();

  const { data: issue } = await db.from("newsletter_issues").select("id, number, subject, intro, status, sent_count, opens_count, clicks_count").eq("id", id).single();
  if (!issue) notFound();
  // A failed send can still be fixed and retried, so it stays editable too.
  const editable = issue.status === "draft" || issue.status === "scheduled" || issue.status === "send_failed";

  const [{ data: items }, { data: ads }, { data: eligible }, { data: allStories }, { data: allVideos }, preview] = await Promise.all([
    db.from("newsletter_items").select("position, story_id, video_id, story:stories(title), video:videos(title)").eq("issue_id", id).order("position"),
    db.from("newsletter_ads").select("advert_id, advert:adverts(id, name, format, member:members(name))").eq("issue_id", id).order("position"),
    db.from("adverts").select("id, name, format, member:members(name)").in("format", NEWSLETTER_FORMATS).order("created_at", { ascending: false }),
    db.from("stories").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
    db.from("videos").select("id, title, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
    // B5.3: reuse the same render the send job uses, so "Preview" is a proof
    // of the actual email, not a second approximation of it. Only worth the
    // query while the issue can still change.
    editable ? renderIssueHtml(id) : Promise.resolve(null),
  ]);
  const attachedIds = new Set((ads ?? []).map((a) => a.advert_id));
  const available = (eligible ?? []).filter((a) => !attachedIds.has(a.id));
  const pickedStoryIds = new Set((items ?? []).flatMap((it) => (it.story_id ? [it.story_id] : [])));
  const pickedVideoIds = new Set((items ?? []).flatMap((it) => (it.video_id ? [it.video_id] : [])));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/newsletter" className="text-sm text-graphite hover:text-ink">← Newsletter</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">#{issue.number} — {issue.subject}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      {issue.status === "sent" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Performance</h2>
          <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-xs uppercase tracking-wide text-graphite">Sent</p><p className="text-lg font-bold text-ink">{issue.sent_count ?? "—"}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-graphite">Opens</p><p className="text-lg font-bold text-ink">{issue.opens_count}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-graphite">Clicks</p><p className="text-lg font-bold text-ink">{issue.clicks_count}</p></div>
          </div>
          {issue.opens_count === 0 && issue.clicks_count === 0 && (
            <p className="mt-2 text-xs text-graphite">
              No opens or clicks recorded yet — this also reads 0 if the Resend account isn&apos;t live, since local sends use the logging stub.
            </p>
          )}
        </section>
      )}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Content ({(items ?? []).length})</h2>
        <ul className="mt-2 space-y-1 text-sm text-graphite">
          {(items ?? []).map((it, i) => (
            <li key={i}>{it.story?.title ?? (it.video && `${it.video.title} (video)`)}</li>
          ))}
        </ul>
      </section>

      {editable && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Edit issue</h2>
          <form action={updateIssue} className="mt-3 space-y-3 text-sm">
            <UnsavedChangesGuard />
            <input type="hidden" name="id" value={id} />
            <input name="subject" defaultValue={issue.subject} required className="w-full rounded border px-3 py-2" />
            <textarea name="intro" defaultValue={issue.intro ?? ""} placeholder="Intro paragraph" rows={2} className="w-full rounded border px-3 py-2" />
            <p className="text-xs uppercase tracking-wide text-graphite">Stories</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
              {(allStories ?? []).map((s) => (
                <label key={s.id} className="flex items-center gap-2">
                  <input type="checkbox" name="stories" value={s.id} defaultChecked={pickedStoryIds.has(s.id)} />
                  <span>{s.title}</span>
                  <span className="text-xs text-graphite">{s.published_at?.slice(0, 10)}</span>
                </label>
              ))}
            </div>
            <p className="text-xs uppercase tracking-wide text-graphite">Video (optional)</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
              {(allVideos ?? []).map((v) => (
                <label key={v.id} className="flex items-center gap-2">
                  <input type="checkbox" name="videos" value={v.id} defaultChecked={pickedVideoIds.has(v.id)} />
                  <span>{v.title}</span>
                  <span className="text-xs text-graphite">{v.published_at?.slice(0, 10)}</span>
                </label>
              ))}
              {!allVideos?.length && <p className="text-xs text-graphite">No published videos yet.</p>}
            </div>
            <button className="rounded bg-ink px-4 py-2 text-white">Save changes</button>
          </form>
        </section>
      )}

      {preview && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <details>
            <summary className="cursor-pointer font-bold text-ink">Preview email</summary>
            <p className="mt-2 text-xs text-graphite">
              This is the actual HTML the send job would build right now — the same proof a member would receive.
            </p>
            {/* sandbox blocks scripts/top navigation from anything a story excerpt or advert link_url might contain */}
            <iframe
              srcDoc={preview.html}
              sandbox=""
              title="Newsletter preview"
              className="mt-3 h-[600px] w-full rounded border"
            />
          </details>
        </section>
      )}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Advert slots ({(ads ?? []).length} · ~2–3 recommended)</h2>
        {(ads ?? []).map((a) => (
          <div key={a.advert_id} className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <span>{a.advert?.name} — {a.advert?.member?.name} <span className="text-graphite">({a.advert?.format.replace(/_/g, " ")})</span></span>
            {editable && (
              <form action={detachNewsletterAd}>
                <input type="hidden" name="issue_id" value={id} />
                <input type="hidden" name="advert_id" value={a.advert_id} />
                <button className="text-xs text-danger hover:underline">remove</button>
              </form>
            )}
          </div>
        ))}
        {!ads?.length && <p className="mt-2 text-sm text-graphite">Nothing attached yet.</p>}

        {editable && (
          <>
            <h3 className="mt-4 text-xs font-bold uppercase text-graphite">Add</h3>
            {available.map((a) => (
              <div key={a.id} className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
                <span>{a.name} — {a.member?.name} <span className="text-graphite">({a.format.replace(/_/g, " ")})</span></span>
                <form action={attachNewsletterAd}>
                  <input type="hidden" name="issue_id" value={id} />
                  <input type="hidden" name="advert_id" value={a.id} />
                  <button className="rounded bg-ink px-3 py-1 text-xs text-white">Add</button>
                </form>
              </div>
            ))}
            {!available.length && <p className="mt-2 text-sm text-graphite">No newsletter-format artwork available — add some from Artwork.</p>}
          </>
        )}
      </section>
    </div>
  );
}
