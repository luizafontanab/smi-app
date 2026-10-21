import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { renderIssueHtml } from "@/lib/adapters/newsletter";
import type { IssueContentResult } from "@/lib/newsletter-picker";
import { PREVIEW_TEXT_SOFT_MAX, SUBJECT_SOFT_MAX } from "@/lib/newsletter-layout";
import { audienceDrift, missingChecks, PROOF_CHECKLIST, tickedKeys } from "@/lib/newsletter-proof";
import { approveIssue, attachNewsletterAd, detachNewsletterAd, placeNewsletterAd, saveProofChecks, searchIssueContent, sendTestIssue, updateIssue, withdrawApproval } from "../../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { CountedInput } from "@/components/console/CountedInput";
import { IssueItemsPicker } from "@/components/console/IssueItemsPicker";

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

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!UUID_RE.test(id)) notFound();
  const issue = await must(
    db.from("newsletter_issues")
      .select("id, number, subject, intro, preview_text, status, sent_count, opens_count, clicks_count, proof_checks, last_test_sent_at, last_test_sent_by, approved_at, approved_by, approved_recipients")
      .eq("id", id).maybeSingle(),
    "console/newsletter issue",
  );
  if (!issue) notFound();
  // A failed send can still be fixed and retried, so it stays editable too.
  const editable = issue.status === "draft" || issue.status === "scheduled" || issue.status === "send_failed";

  const [items, ads, eligible, allStories, allVideos, preview] = await Promise.all([
    must(db.from("newsletter_items").select("position, story_id, video_id, story:stories(id, title, published_at, status), video:videos(id, title, published_at, status)").eq("issue_id", id).order("position"), "console/newsletter items"),
    must(db.from("newsletter_ads").select("advert_id, after_item, advert:adverts(id, name, format, member:members(name))").eq("issue_id", id).order("position"), "console/newsletter ads"),
    must(db.from("adverts").select("id, name, format, member:members(name)").in("format", NEWSLETTER_FORMATS).order("created_at", { ascending: false }), "console/newsletter eligible adverts"),
    must(db.from("stories").select("id, title, published_at, status").eq("status", "published").order("published_at", { ascending: false }).limit(20), "console/newsletter all stories"),
    must(db.from("videos").select("id, title, published_at, status").eq("status", "published").order("published_at", { ascending: false }).limit(20), "console/newsletter all videos"),
    // B5.3: reuse the same render the send job uses, so "Preview" is a proof
    // of the actual email, not a second approximation of it. Only worth the
    // query while the issue can still change.
    editable ? renderIssueHtml(id) : Promise.resolve(null),
  ]);

  const namedIds = [issue.approved_by, issue.last_test_sent_by].filter((v): v is string => Boolean(v));
  // Gap review area 4: the audience check compares against the most recent
  // other issue that recorded how many it went to.
  const [{ count: subscribers }, lastSent, people] = await Promise.all([
    mustList(db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true).is("unsubscribed_at", null), "console/newsletter subscriber count"),
    must(
      db.from("newsletter_issues").select("number, sent_count").eq("status", "sent").not("sent_count", "is", null).neq("id", id)
        .order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      "console/newsletter last sent issue",
    ),
    namedIds.length
      ? must(db.from("profiles").select("user_id, display_name").in("user_id", namedIds), "console/newsletter approvers")
      : Promise.resolve([]),
  ]);
  const nameOf = (userId: string | null) => (people ?? []).find((p) => p.user_id === userId)?.display_name ?? "an admin";
  const ticked = tickedKeys(issue.proof_checks);
  const missing = missingChecks(issue.proof_checks);
  const audience = subscribers ?? 0;
  const drift = audienceDrift(issue.approved_at ? issue.approved_recipients ?? audience : audience, lastSent?.sent_count);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
  const attachedIds = new Set((ads ?? []).map((a) => a.advert_id));
  const available = (eligible ?? []).filter((a) => !attachedIds.has(a.id));
  // Every picked item is listed, however old: saving replaces the whole list,
  // so an item missing from it would be dropped (lib/newsletter-picker).
  const pickedItems = (items ?? []).flatMap((it): IssueContentResult[] =>
    it.story ? [{ ...it.story, kind: "story" }] : it.video ? [{ ...it.video, kind: "video" }] : [],
  );
  const recentItems: IssueContentResult[] = [
    ...(allStories ?? []).map((s) => ({ ...s, kind: "story" as const })),
    ...(allVideos ?? []).map((v) => ({ ...v, kind: "video" as const })),
  ].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const hasMastheadLogo = (ads ?? []).some((a) => a.advert?.format === "association_logo");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/newsletter" className="text-sm text-graphite hover:text-ink">← Newsletter</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">#{issue.number} — {issue.subject}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.tested === "1" && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Test sent to your own address.</p>}

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
            <li key={i}>{i === 0 && <span className="text-xs font-bold uppercase text-ink">Lead · </span>}{it.story?.title ?? (it.video && `${it.video.title} (video)`)}</li>
          ))}
        </ul>
      </section>

      {editable && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Edit issue</h2>
          <form action={updateIssue} className="mt-3 space-y-3 text-sm">
            <UnsavedChangesGuard />
            <input type="hidden" name="id" value={id} />
            <CountedInput name="subject" label="Subject" softMax={SUBJECT_SOFT_MAX} defaultValue={issue.subject} required />
            <CountedInput
              name="preview_text"
              label="Preview text"
              softMax={PREVIEW_TEXT_SOFT_MAX}
              defaultValue={issue.preview_text ?? ""}
              hint="The line inboxes show under the subject. Hidden in the email itself."
            />
            <textarea name="intro" defaultValue={issue.intro ?? ""} placeholder="Intro paragraph" aria-label="Intro paragraph" rows={2} className="w-full rounded border px-3 py-2" />
            <IssueItemsPicker initial={pickedItems} recent={recentItems} search={searchIssueContent} />
            <button className="rounded bg-ink px-4 py-2 text-white">Save changes</button>
            {(issue.approved_at || issue.last_test_sent_at) && (
              <p className="text-xs text-graphite">
                Saving withdraws the approval and the test-send record{issue.status === "scheduled" ? ", and unschedules the issue" : ""}. Your proof ticks stay.
              </p>
            )}
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
        <h2 className="font-bold text-ink">Proof and approval</h2>
        <p className="mt-1 text-xs text-graphite">
          Nothing sends until every item is ticked, a test has gone out since the last change, and the issue is approved to send.
        </p>

        <div className="mt-3 text-sm">
          {issue.last_test_sent_at ? (
            <p className="text-graphite">Last test: {nameOf(issue.last_test_sent_by)}, {when(issue.last_test_sent_at)}.</p>
          ) : (
            <p className="text-graphite">No test sent since the last change.</p>
          )}
          {editable && (
            <form action={sendTestIssue} className="mt-2">
              <input type="hidden" name="id" value={id} />
              <button className="rounded border px-3 py-1.5 text-xs">Send me a test</button>
            </form>
          )}
        </div>

        <p className={`mt-3 text-sm ${drift && !drift.withinLimit ? "text-danger" : "text-graphite"}`}>
          {issue.approved_at ? `${issue.approved_recipients ?? audience} recipients when approved` : `${audience} subscribers now`}
          {drift && lastSent
            ? `, ${drift.pct >= 0 ? "+" : ""}${drift.pct.toFixed(1)}% vs issue #${lastSent.number} (${lastSent.sent_count}).`
            : " — no earlier issue to compare with."}
          {drift && !drift.withinLimit && " More than 5% off last month: find out why before sending."}
        </p>

        <form action={saveProofChecks} className="mt-4 space-y-4 text-sm">
          <input type="hidden" name="id" value={id} />
          {PROOF_CHECKLIST.map((group) => (
            <fieldset key={group.title}>
              <legend className="text-xs font-bold uppercase tracking-wide text-graphite">{group.title}</legend>
              <div className="mt-1 space-y-1">
                {group.items.map((item) => (
                  <label key={item.key} className="flex items-start gap-2">
                    <input type="checkbox" name="checks" value={item.key} defaultChecked={ticked.has(item.key)} disabled={!editable} className="mt-1" />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {editable && <button className="rounded border px-3 py-1.5 text-xs">Save checklist</button>}
        </form>

        <div className="mt-4 border-t pt-3 text-sm">
          {issue.approved_at ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-success">
                Approved to send{issue.approved_by ? ` by ${nameOf(issue.approved_by)}` : " (before approval was recorded)"}, {when(issue.approved_at)}.
              </p>
              {editable && (
                <form action={withdrawApproval}>
                  <input type="hidden" name="id" value={id} />
                  <button className="text-xs text-danger hover:underline">Withdraw approval</button>
                </form>
              )}
            </div>
          ) : editable ? (
            <form action={approveIssue}>
              <input type="hidden" name="id" value={id} />
              <button
                disabled={missing.length > 0 || !issue.last_test_sent_at}
                className="rounded bg-ink px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Approve to send
              </button>
              {(missing.length > 0 || !issue.last_test_sent_at) && (
                <p className="mt-2 text-xs text-graphite">
                  Still needed: {[
                    ...(issue.last_test_sent_at ? [] : ["a test send"]),
                    ...(missing.length ? [`${missing.length} unticked proof ${missing.length === 1 ? "item" : "items"}`] : []),
                  ].join(" and ")}.
                </p>
              )}
            </form>
          ) : (
            <p className="text-graphite">No approval was recorded for this issue.</p>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Advert slots ({(ads ?? []).length} · ~2–3 recommended)</h2>
        <p className="mt-1 text-xs text-graphite">
          Banners sit between the stories, labelled “Sponsored”. Left on auto, the first goes after item 3 (the lead and the first row), the last just before the footer, and any others between. An “In association with” logo goes in the masthead, one per issue.
        </p>
        {(ads ?? []).map((a) => (
          <div key={a.advert_id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
            <span>{a.advert?.name} — {a.advert?.member?.name} <span className="text-graphite">({a.advert?.format.replace(/_/g, " ")})</span></span>
            {a.advert?.format === "association_logo" ? (
              <span className="text-xs text-graphite">In the masthead</span>
            ) : editable ? (
              <form action={placeNewsletterAd} className="flex items-center gap-1 text-xs">
                <input type="hidden" name="issue_id" value={id} />
                <input type="hidden" name="advert_id" value={a.advert_id} />
                <label htmlFor={`after-${a.advert_id}`} className="text-graphite">After item</label>
                <input id={`after-${a.advert_id}`} name="after_item" type="number" min={1} defaultValue={a.after_item ?? ""} placeholder="auto" className="w-16 rounded border px-2 py-0.5" />
                <button className="rounded border px-2 py-0.5">Set</button>
              </form>
            ) : (
              <span className="text-xs text-graphite">{a.after_item ? `After item ${a.after_item}` : "Placed automatically"}</span>
            )}
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
            {available.filter((a) => !(hasMastheadLogo && a.format === "association_logo")).map((a) => (
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
