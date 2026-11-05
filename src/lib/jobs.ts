import { serviceDb } from "./db/server";
import type { Json } from "./db/types";
import { notifyConsole } from "./notify-admin";
import { siteUrl } from "./site-url";
import { londonAt } from "./london-time";
import { fillStoryPostLinks, readSocialCaps, SOCIAL_LINK_BACKOFF } from "./social-push";
import type { SentPost } from "./adapters/social";
import { planSocialPush, waitingSummary } from "./social-confirm";
import {
  clearConfirmations, connectedChannelIds, loadSocialItem, markChannelPosted, postedTodayByChannel, readChannelRecords,
  socialWaiting, type SocialTarget,
} from "./social-post";
import { graceUntilFrom } from "./grace-period";
import { publishDue } from "./content-lifecycle";
import { logError } from "./log";
import { allRows } from "./db/all-rows";

/**
 * Postgres-backed job queue (TECH-DECISIONS #13).
 * Prod: Vercel Cron hits /api/cron — once a day at 03:00 today (vercel.json;
 * GAPS A3.1), though everything here is written for frequent ticks.
 * Local: scripts/job-runner.ts loop.
 * Failed jobs go 'dead' after max_attempts and surface in "Needs You Today" —
 * publishing must never silently fail.
 */

export type JobKind =
  | "publish_scheduled"      // periodic sweep: stories whose scheduled_at has passed
  | "social_push"            // payload: { story_id } or { video_id } — delayed push after publish
  | "social_links"           // payload: { story_id, post_ids, tries } — collects the live URLs of SMI's posts from Buffer
  | "notify_member"          // payload: { member_id, kind, ... }
  | "crm_sync"               // periodic Bigin poll
  | "crm_push"               // payload: { contact_id, name_changed, re_opt_in } — retry of a failed write-through to Bigin
  | "rollup_daily"           // nightly analytics rollup + partition upkeep
  | "newsletter_send"        // payload: { issue_id }
  | "comp_expiry"            // daily sweep: expired promo comps → grace + console note
  | "membership_lapse"       // daily sweep: grace members whose grace_until has passed → lapsed
  | "advert_lifecycle"       // daily sweep: advert runs start, end, and warn before ending
  | "admin_digest"           // daily sweep: everything waiting on Jas, in one email
  | "newsletter_sync"        // daily sweep: mirror the contact list to the sender
  | "stats_summary"          // daily sweep: fires per member on their chosen stats cadence
  | "lead_alert"             // daily sweep: fires per member on their chosen leads cadence
  | "dev_error_digest"       // daily: the last 24h of recorded errors, emailed to DEV_ALERT_EMAIL (docs/logging.md)
  | "log_retention"          // daily: error logs past 90 days; audit_events per purge_audit_events()
  | "upload_staging_sweep"   // hourly: removes direct uploads staged but never saved (lib/staged-upload)
  | "source_watch"           // hourly: checks the story sources due their daily read (lib/sources/check)
  | "source_bigin_sync"      // daily: Bigin companies' News Page URLs → story sources (lib/sources/bigin)
  | "social_followers";      // daily: Facebook/Instagram/YouTube follower counts for /console/social-reach (lib/adapters/social-followers)

/**
 * In development only, a job that is due now runs as soon as the response is
 * out, instead of waiting for scripts/job-runner.ts to poll /api/cron.
 *
 * Why: locally the runner is optional and usually not running, so `enqueue`
 * looked like a no-op — an approved video's "your video is live" notification
 * sat unclaimed in the queue and read as a product bug. Dev should show the
 * effect of an action immediately.
 *
 * Scope, deliberately narrow:
 *   · development only — never production (Vercel Cron owns it there) and never
 *     test, where vitest sets NODE_ENV=test and `after` has no request context.
 *   · only jobs already due. A delayed job keeps its delay: social_push is
 *     queued for its post time and firing it instantly would be a different
 *     behaviour, not a faster one.
 *   · periodic sweeps (publish_scheduled, comp_expiry, …) are unaffected —
 *     they are time-based and still need the runner. "Immediate in dev" covers
 *     jobs an action causes, not the clock-driven ones.
 *
 * `after` runs the callback once the response is sent, so a slow or failing
 * job can never delay or break the server action that queued it — and it still
 * runs when the action ends in redirect(), which all of them do.
 */
function runDueJobInlineInDev(jobId: string, dueAt: Date) {
  if (process.env.NODE_ENV !== "development") return;
  if (dueAt.getTime() > Date.now()) return;
  // Imported lazily: next/server is unavailable to the plain-node callers of
  // this module (scripts, and the vitest suites that exercise runJob directly).
  // The catch covers both that and `after` being called with no request
  // context — either way the job stays pending for the runner, exactly as it
  // behaved before. A dev convenience must never break the thing it speeds up.
  void import("next/server")
    .then(({ after }) => after(() => runJobById(jobId)))
    .catch(() => {});
}

/**
 * For a job queued by something other than enqueue() — settle_invoice()
 * (20261016000003) inserts the receipt in the same transaction as the payment
 * — so it gets the same immediate run in development that enqueue() gives.
 */
export function runQueuedJobSoon(jobId: string) {
  runDueJobInlineInDev(jobId, new Date());
}

export async function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, dueAt?: Date) {
  const due = dueAt ?? new Date();
  const { data } = await serviceDb()
    .from("jobs")
    .insert({ kind, payload: payload as Json, due_at: due.toISOString() })
    .select("id")
    .single();
  if (data) runDueJobInlineInDev(data.id, due);
}

type JobRow = { id: string; kind: string; payload: unknown; attempts: number; max_attempts: number; due_at: string };

/** Claim one specific pending job row and run it, with the same retry/dead-letter handling `runDueJobs` uses. Returns true if it ran (whether it succeeded or was handed back for retry), false if something else claimed it first. */
async function claimAndRun(db: ReturnType<typeof serviceDb>, job: JobRow): Promise<boolean> {
  const { data: claimed } = await db
    .from("jobs")
    .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending") // optimistic claim — only one runner wins
    .select("id");
  if (!claimed?.length) return false;
  try {
    await runJob(job.kind as JobKind, (job.payload ?? {}) as Record<string, unknown>, job.id);
    await db.from("jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job.id);
  } catch (e) {
    // Provider backpressure is not job failure. Resend allows 2 requests a
    // second and a sweep can claim up to 20 jobs, so a burst of member
    // notifications will legitimately 429. Honour Retry-After and hand the
    // attempt back, or three quick notifications in a row would dead-letter
    // a perfectly good job.
    const pause = rateLimitPauseMs(e);
    if (pause !== null) {
      await db.from("jobs").update({
        status: "pending",
        attempts: job.attempts, // undo the claim's increment
        due_at: new Date(Date.now() + pause).toISOString(),
        last_error: String(e).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return true;
    }
    const dead = job.attempts + 1 >= job.max_attempts;
    await db.from("jobs").update({
      status: dead ? "dead" : "pending",
      due_at: dead ? job.due_at : new Date(Date.now() + 60_000 * job.attempts).toISOString(),
      last_error: String(e).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw e;
  }
  return true;
}

export async function runDueJobs(): Promise<{ ran: number; failed: number }> {
  const db = serviceDb();
  let ran = 0, failed = 0;

  // periodic sweeps enqueue themselves if none pending (cheap idempotent upkeep)
  await ensurePeriodic("publish_scheduled", 60);
  await ensurePeriodic("crm_sync", 15 * 60);
  await ensurePeriodic("rollup_daily", 24 * 60 * 60);
  await ensurePeriodic("comp_expiry", 24 * 60 * 60);
  await ensurePeriodic("membership_lapse", 24 * 60 * 60);
  await ensurePeriodic("advert_lifecycle", 24 * 60 * 60);
  await ensurePeriodic("admin_digest", 24 * 60 * 60);
  await ensurePeriodic("newsletter_sync", 24 * 60 * 60);
  await ensurePeriodic("stats_summary", 24 * 60 * 60);
  await ensurePeriodic("lead_alert", 24 * 60 * 60);
  await ensurePeriodic("dev_error_digest", 24 * 60 * 60);
  await ensurePeriodic("log_retention", 24 * 60 * 60);
  await ensurePeriodic("upload_staging_sweep", 60 * 60);
  // Hourly, so the ~726 sources spread across the day in time-boxed batches;
  // each source is still read only once a day (CHECK_EVERY_MS). Production's
  // once-a-day cron (GAPS A3.1) would reach one batch a day — see docs/story-sources.md.
  await ensurePeriodic("source_watch", 60 * 60);
  await ensurePeriodic("source_bigin_sync", 24 * 60 * 60);
  await ensurePeriodic("social_followers", 24 * 60 * 60);

  const { data: due } = await db
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(20);

  for (const job of due ?? []) {
    try {
      if (await claimAndRun(db, job)) ran++;
    } catch {
      failed++;
    }
  }
  return { ran, failed };
}

/**
 * Claim and run exactly one job by id, bypassing the due-jobs sweep. For
 * tests: `runDueJobs()` claims up to 20 pending jobs table-wide, which races
 * against any other test (in this file or another running concurrently
 * against the same local stack) that also has jobs pending — this runs only
 * the job the caller asked for.
 */
export async function runJobById(jobId: string): Promise<void> {
  const db = serviceDb();
  const { data: job } = await db.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return;
  // Mirrors runDueJobs: a job failure's bookkeeping (retry/dead-letter) is
  // already persisted to the row by claimAndRun before it rethrows — callers
  // read the job/its side effects back from the DB, not this promise.
  try {
    await claimAndRun(db, job);
  } catch {
    // handled
  }
}

/**
 * How long to wait when a job failed purely because the provider rate-limited
 * us, or null if it failed for any other reason. Duck-typed on purpose: the
 * adapters are dynamically imported everywhere else in this file and a static
 * import just for `instanceof` would break that pattern.
 */
function rateLimitPauseMs(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const err = e as { name?: unknown; status?: unknown; retryAfterMs?: unknown };
  if (err.name !== "EmailSendError" || err.status !== 429) return null;
  return typeof err.retryAfterMs === "number" && err.retryAfterMs > 0 ? err.retryAfterMs : 2000;
}

/** The "Story crawler" feature flag. Lazy, like the job modules: most ticks never need it. */
async function storyCrawlerOn(): Promise<boolean> {
  const { isFeatureEnabled } = await import("./feature-flags");
  return isFeatureEnabled("story_crawler");
}

async function ensurePeriodic(kind: JobKind, everySeconds: number) {
  const db = serviceDb();
  const { data } = await db.from("jobs").select("id").eq("kind", kind).in("status", ["pending", "running"]).limit(1);
  if (!data?.length) {
    await db.from("jobs").insert({ kind, payload: {}, due_at: new Date(Date.now() + everySeconds * 1000).toISOString() });
  }
}

/**
 * Space an overflow social push across tomorrow instead of stacking every
 * overflow item on the same 09:00 slot — counts what's already pending
 * tomorrow and offsets by one more delay increment per item ahead of it.
 * "Tomorrow" and 09:00 are London time, not the server's (UTC on Vercel).
 * Deliberately simple: no cap on how late a day can run if many items
 * overflow onto it, that's an accepted limit, not a bug.
 */
async function nextOverflowSlot(db: ReturnType<typeof serviceDb>, delayMinutes: number): Promise<Date> {
  const now = new Date();
  const slot = londonAt(now, 1, 9);
  const dayEnd = londonAt(now, 2, 0);
  const { count } = await db
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("kind", "social_push")
    .eq("status", "pending")
    .gte("due_at", slot.toISOString())
    .lt("due_at", dayEnd.toISOString());
  return new Date(slot.getTime() + (count ?? 0) * delayMinutes * 60_000);
}

async function runJob(kind: JobKind, payload: Record<string, unknown>, jobId: string) {
  const db = serviceDb();
  switch (kind) {
    case "publish_scheduled": {
      // The content lifecycle owns the status write (conditional on "scheduled")
      // and what it sets off. One bad row is logged and skipped; the rest still
      // go Live (content-lifecycle Q12). A row someone else moved first is skipped
      // silently — nothing went wrong.
      const { failed } = await publishDue({ db, enqueue });
      for (const f of failed) {
        logError({ source: "job", area: "job:publish_scheduled", error: f.error, context: { kind: f.kind, id: f.id } });
      }
      break;
    }
    case "social_push": {
      // Issue #43: each channel posts on its own, only once an admin has
      // confirmed exactly what it receives. Everything is re-checked here, when
      // the job runs, not when it was queued.
      const target: SocialTarget = payload.video_id ? { video_id: String(payload.video_id) } : { story_id: String(payload.story_id) };
      const item = await loadSocialItem(db, target);
      // taken down, or "Don't post" for the whole item: no post
      if (!item || item.status !== "published" || item.social_skip) return;
      const channelIds = await connectedChannelIds(db);
      const records = await readChannelRecords(db, target);
      // Nobody confirmed anything still to post: nothing to do, and no need to ask Buffer anything.
      if (!channelIds.some((c) => { const r = records.get(c); return r?.confirmed_at && !r.skip && !r.posted_at; })) return;

      const { channelPosts, getSocialPublisher, isSocialLive } = await import("./adapters/social");
      const publisher = getSocialPublisher();
      const networks = await publisher.channelNetworks();
      // A passing lookup failure must not change every channel's text (the
      // fallback is one X-fitted text) and so cancel its confirmation. Retry.
      if (networks.kind === "failed") throw new Error("[social] couldn't look up which network each Buffer channel is; retrying rather than posting");

      const caps = await readSocialCaps(db);
      const plan = planSocialPush({
        now: new Date(),
        item: { socialAt: item.social_at, publishedAt: item.published_at, skip: item.social_skip },
        delayMinutes: caps.delay_minutes,
        perDay: caps.per_day,
        channels: channelPosts(item.post, channelIds, networks).map((p) => ({
          post: { channelId: p.channelId, text: p.text, imagePath: p.imagePath },
          record: records.get(p.channelId) ?? null,
        })),
        postedToday: await postedTodayByChannel(db, channelIds),
      });
      // Changed since confirmed: those wait for confirmation again (and show in Needs You Today).
      if (plan.unconfirm.length) await clearConfirmations(db, target, plan.unconfirm);

      // Every due channel is attempted: one bad channel must not stop the
      // others. Each is stamped the moment Buffer takes it — Buffer has no
      // idempotency key, so the stamp is what stops a retry posting it twice.
      // Stamped only for a real post: the logging stub must not make the editor say "posted".
      const sent: SentPost[] = [];
      const failures: string[] = [];
      for (const post of plan.send) {
        try {
          const accepted = await publisher.publishChannel(post);
          if (isSocialLive()) await markChannelPosted(db, target, post.channelId, accepted?.id ?? null);
          if (accepted) sent.push(accepted);
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }

      // The story page links to SMI's own posts (Jas 13/10 item 8), filled
      // from Buffer: straight away if it has them, otherwise once it has sent
      // the post. Videos have no post-link fields.
      if ("story_id" in target && sent.length) {
        const waiting = await fillStoryPostLinks(db, target.story_id, sent);
        if (waiting.length) {
          await enqueue("social_links", { story_id: target.story_id, post_ids: waiting.map((p) => p.id), tries: 0 },
            new Date(Date.now() + SOCIAL_LINK_BACKOFF[0] * 60_000));
        }
      }
      // The job's own retry covers everything still owed, including channels not yet due.
      if (failures.length) throw new Error(`[social] Buffer publish failed for ${failures.length} of ${plan.send.length} channel(s) — ${failures.join("; ")}`);

      // Run again for the next channel: one whose time is still to come, or
      // one over its daily limit — spaced across tomorrow, not stacked on one slot.
      let next = plan.nextAt;
      if (plan.overCap.length) {
        const slot = await nextOverflowSlot(db, caps.delay_minutes);
        if (!next || slot < next) next = slot;
      }
      if (next) await enqueue("social_push", payload, next);
      break;
    }
    case "social_links": {
      const ids = Array.isArray(payload.post_ids) ? payload.post_ids.filter((x): x is string => typeof x === "string") : [];
      if (!ids.length) return;
      const { getSocialPublisher } = await import("./adapters/social");
      const found = await getSocialPublisher().postLinks(ids);
      const waiting = await fillStoryPostLinks(db, String(payload.story_id), found);
      // Ids Buffer didn't return this time are asked about again, too.
      const retry = [...waiting.map((p) => p.id), ...ids.filter((id) => !found.some((p) => p.id === id))];
      const tries = Number(payload.tries ?? 0) + 1;
      // Gives up quietly after the last look: the fields stay editable, so a
      // missing link can still be pasted.
      if (retry.length && tries < SOCIAL_LINK_BACKOFF.length) {
        await enqueue("social_links", { story_id: payload.story_id, post_ids: retry, tries },
          new Date(Date.now() + SOCIAL_LINK_BACKOFF[tries] * 60_000));
      }
      break;
    }
    case "notify_member": {
      const { data: member } = await db.from("members").select("id, name, contact_email").eq("id", String(payload.member_id)).single();
      if (!member) return;
      // Keyed on this job's own id (unique, stable across this job's own
      // retries) so a retry after a crash between "email sent" and "emailed_at
      // stamped" finds the row it already made instead of inserting a second
      // one — and reuses the same send below, which reuses the same
      // Idempotency-Key, so the retry can't mail the member twice either.
      const { data: existing } = await db.from("notifications").select("id, emailed_at").eq("job_id", jobId).maybeSingle();
      const noteId = existing?.id ?? (
        await db.from("notifications").insert({
          member_id: member.id,
          kind: String(payload.kind ?? "generic"),
          payload: payload as Json,
          job_id: jobId,
        }).select("id").single()
      ).data?.id;
      if (!member.contact_email) return; // pre-funnel members may have no address; in-app notification still lands
      if (existing?.emailed_at) return; // already sent on a prior attempt of this same job

      const [{ getEmailSender }, { renderNotification }, { loadEmailTemplates }] = await Promise.all([
        import("./adapters/email"),
        import("./email/templates"),
        import("./email/store"),
      ]);
      // Request-scoped, so a tick that emails thirty members reads the table
      // once — and an edit made in the console lands on the very next tick.
      const templates = await loadEmailTemplates();
      // Deliberately unguarded: a provider rejection throws, the job retries
      // with backoff and eventually dead-letters into "Needs You Today". A
      // swallowed failure here is how a member silently never hears back.
      await getEmailSender().send({ to: member.contact_email, ...renderNotification(payload, templates) }, { idempotencyKey: `notify-${jobId}` });
      if (noteId) {
        await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", noteId);
      }
      break;
    }
    case "admin_digest": {
      /*
       * Member submissions used to notify Jas via nothing at all: they landed
       * in a console queue he had to remember to open. One digest rather than
       * six per-submission emails is deliberate — lib/notify-admin records the
       * standing rule that the funnel must never bombard him, and a daily
       * summary is more useful than a stream of individual pings.
       */
      const { ADMIN_EMAIL } = await import("./notify-admin");
      if (!ADMIN_EMAIL) {
        console.warn("[digest] ADMIN_EMAIL is not set — skipping the daily digest.");
        return;
      }
      const awaiting = (table: "stories" | "videos" | "events" | "featured_machines" | "member_revisions" | "advert_bookings") =>
        db.from(table).select("*", { count: "exact", head: true }).eq("status", "awaiting_approval");

      const [stories, videos, events, machines, revisions, bookings, interest, drafts] = await Promise.all([
        awaiting("stories"),
        awaiting("videos"),
        awaiting("events"),
        awaiting("featured_machines"),
        awaiting("member_revisions"),
        awaiting("advert_bookings"),
        db.from("visibility_requests").select("*", { count: "exact", head: true }).eq("status", "requested"),
        db.from("members").select("*", { count: "exact", head: true }).eq("status", "draft").not("draft_submitted_at", "is", null),
      ]);

      const lines = [
        ["Stories ready to review", stories.count],
        ["Videos ready to review", videos.count],
        ["Events awaiting approval", events.count],
        ["Featured machines awaiting approval", machines.count],
        ["Page edits awaiting approval", revisions.count],
        ["Advert bookings awaiting approval", bookings.count],
        ["Visibility requests to answer", interest.count],
        ["Member pages submitted for review", drafts.count],
      ].filter(([, count]) => Number(count) > 0) as [string, number][];

      // Issue #43: each Live item whose post time has passed with a channel
      // still unconfirmed, once, linking to its editor.
      const social = await socialWaiting(db, { delayMinutes: (await readSocialCaps(db)).delay_minutes });

      // Silence is the correct output on a quiet day — a "nothing to do" email
      // every morning is how a digest gets filtered into a folder unread.
      if (!lines.length && !social.length) return;

      const total = lines.reduce((sum, [, count]) => sum + count, 0) + social.length;
      const socialLines = social.length
        ? ["", "  Social posts waiting for confirmation:",
          ...social.map((w) => `  “${w.title}”: ${waitingSummary(w.waiting, w.total)} — ${siteUrl()}${w.href}`)]
        : [];
      const [{ getEmailSender }, { renderAdminEmail }, { loadEmailTemplates }] = await Promise.all([
        import("./adapters/email"),
        import("./email/templates"),
        import("./email/store"),
      ]);
      // The per-line markup stays in code: it is generated from counts, so
      // there is nothing in it for anyone to word differently. The sentence
      // around it, and the subject, are editable.
      const mail = renderAdminEmail(
        "admin_digest",
        {
          total: String(total),
          total_s: total === 1 ? "" : "s",
          lines: [...lines.map(([label, count]) => `  ${count} — ${label}`), ...socialLines].join("\n").replace(/^\n/, ""),
          console_url: `${siteUrl()}/console`,
        },
        await loadEmailTemplates(),
      );
      await getEmailSender().send({ to: ADMIN_EMAIL, ...mail });
      break;
    }
    case "newsletter_sync": {
      // Without this a broadcast has no recipients at Resend's end: `contacts`
      // is authoritative here, but the sender can only mail what it holds.
      const { getNewsletterSender } = await import("./adapters/newsletter");
      const { pushed, failed } = await getNewsletterSender().syncContacts();
      if (failed) throw new Error(`newsletter contact sync: ${failed} of ${pushed + failed} contacts failed to push`);
      break;
    }
    case "crm_sync": {
      const { getCrmSync } = await import("./adapters/crm");
      await getCrmSync().sync();
      break;
    }
    case "crm_push": {
      const { getCrmSync } = await import("./adapters/crm");
      const contactId = typeof payload.contact_id === "string" ? payload.contact_id : null;
      if (!contactId) throw new Error("crm_push: payload has no contact_id");
      await getCrmSync().pushContact(contactId, { nameChanged: payload.name_changed === true, reOptIn: payload.re_opt_in === true });
      break;
    }
    case "rollup_daily": {
      const { error } = await db.rpc("run_daily_rollup");
      if (error) throw new Error(error.message);
      break;
    }
    case "dev_error_digest": {
      const { sendErrorDigest } = await import("./log-alerts");
      await sendErrorDigest();
      break;
    }
    case "log_retention": {
      // 90 days, decided 29 Sep (docs/logging.md). An error not seen for 90
      // days goes with its occurrences (cascade); a still-active error keeps
      // its row but sheds occurrences older than the window. Later logging
      // phases add their tables here.
      const cutoff = new Date(Date.now() - 90 * 864e5).toISOString();
      const { error: eventsErr } = await db.from("error_events").delete().lt("last_seen", cutoff);
      if (eventsErr) throw new Error(`log retention (events) failed: ${eventsErr.message}`);
      const { error: occErr } = await db.from("error_occurrences").delete().lt("occurred_at", cutoff);
      if (occErr) throw new Error(`log retention (occurrences) failed: ${occErr.message}`);
      // The security audit log keeps its own clock (12 months; IPs and
      // attempted-login emails 90 days — docs/GDPR.md §16). The app may not
      // delete from it, so its owner-run function does.
      const { error: auditErr } = await db.rpc("purge_audit_events");
      if (auditErr) throw new Error(`log retention (audit) failed: ${auditErr.message}`);
      break;
    }
    case "upload_staging_sweep": {
      // A file chosen in a form that was then abandoned sits in the private
      // staging bucket until this; past STAGED_UPLOAD_MAX_AGE_HOURS nothing
      // can claim it any more. Hourly where the runner ticks every minute;
      // in production it rides the once-a-day cron (HUMAN-TODO §13.1), so an
      // abandoned file can sit for up to two days — private, and never served.
      const { sweepStagedUploads } = await import("./staged-upload");
      await sweepStagedUploads();
      break;
    }
    case "source_watch": {
      // Story sources (ChangeTower replacement). Time-boxed so one run can't
      // hold the cron request; a source it doesn't reach stays due next run.
      // Per-source failures are recorded on the source, not thrown — a site
      // being down is an outcome, not a job failure.
      // The "Story crawler" flag (/console/features) stops it outright; the job
      // still completes, so the queue doesn't back up while it's off.
      if (!(await storyCrawlerOn())) break;
      const { runSourceWatch } = await import("./sources/check");
      await runSourceWatch();
      break;
    }
    case "source_bigin_sync": {
      // Bigin companies' News Page URLs, merged into the source list. Bigin
      // not connected is a skip, not a failure (syncBiginSources returns null).
      if (!(await storyCrawlerOn())) break;
      const { syncBiginSources } = await import("./sources/bigin");
      await syncBiginSources();
      break;
    }
    case "social_followers": {
      // Guidance for the console's Social reach page (issue #4); the homepage
      // figure is never touched here. Platforms without credentials are skipped
      // inside, and a fetch failure is stored on the platform's row rather than
      // thrown. A failed settings read/write throws (and retries); so does a
      // failed Instagram token refresh, deliberately: left alone, the token
      // dies 60 days later, so the job dead-letters into "Needs You Today"
      // with the reason.
      const { refreshSocialFollowers } = await import("./adapters/social-followers");
      const { instagramProblem } = await refreshSocialFollowers({ db });
      if (instagramProblem) throw new Error(instagramProblem);
      break;
    }
    case "comp_expiry": {
      // promo comp ran out with no card payment → grace (Jas decides from there;
      // grace members already surface in "Needs You Today")
      const today = new Date().toISOString().slice(0, 10);
      const { data: expired } = await db
        .from("members")
        .select("id, name, comped_until")
        .eq("status", "active")
        .is("paid_at", null)
        .lt("comped_until", today);
      for (const m of expired ?? []) {
        if (!m.comped_until) continue; // lt() already excludes nulls; this narrows the type
        const until = graceUntilFrom(m.comped_until);
        await db.from("members").update({ status: "grace", grace_until: until }).eq("id", m.id);
        await notifyConsole({
          kind: "comp_expired",
          memberId: m.id,
          name: m.name,
          payload: { member_id: m.id },
          message: `Promo comp expired on ${m.comped_until} — moved to grace until ${until}.`,
        });
      }
      break;
    }
    case "membership_lapse": {
      // grace period ran out with nothing resolving it → lapsed (Jas decides
      // from there; lapsed members already surface in "Needs You Today" via
      // whatever console view lists them)
      const today = new Date().toISOString().slice(0, 10);
      const { data: lapsed } = await db
        .from("members")
        .select("id, name")
        .eq("status", "grace")
        .lt("grace_until", today);
      for (const m of lapsed ?? []) {
        const { data: updated } = await db.from("members")
          .update({ status: "lapsed" })
          .eq("id", m.id)
          .eq("status", "grace")
          .select("id");
        if (!updated?.length) continue;
        await enqueue("notify_member", { member_id: m.id, kind: "membership_lapsed" });
        await notifyConsole({
          kind: "membership_lapsed",
          memberId: m.id,
          name: m.name,
          payload: { member_id: m.id },
          message: "Grace period ended with no resolution — membership moved to lapsed.",
        });
      }
      break;
    }
    case "stats_summary": {
      const nowDate = new Date();
      const isMonthStart = nowDate.getUTCDate() === 1;
      const isQuarterStart = isMonthStart && [0, 3, 6, 9].includes(nowDate.getUTCMonth());
      const monthAgo = new Date(nowDate.getTime() - 30 * 864e5).toISOString();
      const { data: members } = await db
        .from("members")
        .select("id, notification_prefs(stats_frequency)")
        .in("status", ["active", "grace"])
        // The job runner uses serviceDb, so RLS does not hide an archived
        // member here — an archived member has no public page to report views
        // on and must stop receiving automated email (fix list 72).
        .is("archived_at", null);
      // Per-member exact counts, but concurrent: sequential awaits made this
      // linear in member count (2 round-trips each) on the nightly cron. A
      // grouped single query isn't available without an RPC, and pulling raw
      // event rows to count in JS risks PostgREST's max-rows cap silently
      // truncating the numbers members are sent.
      const due = (members ?? []).filter((m) => {
        const frequency = m.notification_prefs?.stats_frequency ?? "quarterly";
        return frequency === "monthly" ? isMonthStart : frequency === "quarterly" ? isQuarterStart : false;
      });
      await Promise.all(due.map(async (m) => {
        const { count } = await db
          .from("analytics_events")
          .select("*", { count: "exact", head: true })
          .eq("kind", "member_page_view")
          .eq("member_id", m.id)
          .gte("occurred_at", monthAgo);
        await enqueue("notify_member", { member_id: m.id, kind: "stats_summary", page_views: count ?? 0 });
      }));
      break;
    }
    case "lead_alert": {
      const isMonday = new Date().getUTCDay() === 1;
      const { data: members } = await db
        .from("members")
        .select("id, notification_prefs(leads_frequency)")
        .in("status", ["active", "grace"])
        // Same as stats_summary above: archived members drop out of the send.
        .is("archived_at", null);
      // Concurrent for the same reason as stats_summary above.
      const due = (members ?? []).filter((m) => {
        const frequency = m.notification_prefs?.leads_frequency ?? "weekly";
        if (frequency === "never") return false;
        return frequency !== "weekly" || isMonday;
      });
      await Promise.all(due.map(async (m) => {
        const frequency = m.notification_prefs?.leads_frequency ?? "weekly";
        const sinceDays = frequency === "weekly" ? 7 : 1;
        const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
        // The member's page views over the window: the sum of `views`. A row
        // count is not a number of companies: the rollup writes one row per
        // member, day and (region, company), and both are null until a
        // resolver is wired, so it was the number of days with views (#12).
        // Summed here rather than in SQL because PostgREST aggregates aren't
        // enabled and the window holds about one row a day; paged so max_rows
        // can't truncate it if region/company rows ever multiply.
        const rows = await allRows((from, to) => db
          .from("engagement_audit")
          .select("id, views")
          .eq("member_id", m.id)
          .gte("occurred_on", since)
          .order("id")
          .range(from, to));
        const count = rows.reduce((sum, row) => sum + (row.views ?? 0), 0);
        if (!count) return;
        // `days` lets the email say "this week" or "since yesterday".
        await enqueue("notify_member", { member_id: m.id, kind: "lead_alert", count, days: sinceDays });
      }));
      break;
    }
    /**
     * The advert run lifecycle, swept once a day.
     *
     * State-based, never event-based: nothing here asks "did today land exactly
     * 7 days before the end?", because prod cron runs once at 03:00 and fails
     * closed when CRON_SECRET is unset, so missing a week is a real state. Each
     * pass asks "which runs are in this condition and have not been told yet?",
     * so a missed day self-heals on the next tick.
     *
     * The sweep only records transitions — it never authorises them. What the
     * public site shows is decided by the render predicate in lib/adverts.ts,
     * which checks the term as well as the status, so a late sweep cannot leave
     * an expired advert on the site or hold a started one back.
     */
    case "advert_lifecycle": {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // 1. started
      const { data: starting } = await db
        .from("advert_bookings")
        .select("id, advert:adverts(member_id)")
        .eq("status", "scheduled")
        .lte("starts_on", today)
        .gte("ends_on", today);
      for (const b of starting ?? []) {
        await db.from("advert_bookings")
          .update({ status: "live", went_live_at: now, updated_at: now })
          .eq("id", b.id).eq("status", "scheduled");
        if (b.advert?.member_id) {
          await enqueue("notify_member", { member_id: b.advert.member_id, kind: "advert_live", booking_id: b.id });
        }
      }

      // 1b. lapsed unpaid holds (6 Oct). A run held for payment whose term
      // has passed was never shown and now never will be: end it as 'unpaid'
      // and void its invoice so the member's pay link stops asking for money
      // for dates already gone. A bundle's one invoice is voided only once no
      // part of it is still owed for (voidBundleInvoiceIfAbandoned). Placements
      // have no status to end — their held rows simply never surface
      // (src/lib/queries.ts) — so only their invoices are voided. No member
      // email: they chose not to pay.
      //
      // Voiding goes through voidInvoices(), which expires an open Checkout
      // Session first, and a failure throws so the sweep retries. The order is
      // what makes the retry work: a run's invoice is voided BEFORE the run is
      // ended (an ended run is no longer found here), and a bundle is checked
      // by state — any bundle still holding an issued invoice with a part
      // ended 'unpaid' — not only the ones this pass ended.
      const { voidInvoices, voidBundleInvoiceIfAbandoned } = await import("./advert-payments");
      const voided = <T extends { ok: true } | { ok: false; error: string }>(what: string, r: T) => {
        if (!r.ok) throw new Error(`advert_lifecycle: could not void the invoice for ${what}: ${(r as { error: string }).error}`);
        return r as Extract<T, { ok: true }>;
      };
      const { data: lapsed } = await db
        .from("advert_bookings")
        .select("id, bundle_id, ends_on")
        .eq("status", "awaiting_payment")
        .lt("ends_on", today);
      const lapsedBundles = new Set<string>();
      for (const b of lapsed ?? []) {
        // A session that completed while this ran means the member is paying:
        // leave the run held for the webhook to release, not ended as unpaid.
        if (voided(`booking ${b.id}`, await voidInvoices({ advert_booking_id: b.id })).paying.length) continue;
        const { data: done } = await db.from("advert_bookings")
          .update({ status: "ended", ended_at: now, ended_reason: "unpaid", ended_notified_for: b.ends_on, updated_at: now })
          .eq("id", b.id)
          .eq("status", "awaiting_payment")
          .select("id");
        if (done?.length && b.bundle_id) lapsedBundles.add(b.bundle_id);
      }
      const { data: openBundleInvoices, error: bundleErr } = await db
        .from("invoices")
        .select("bundle_id")
        .eq("status", "issued")
        .not("bundle_id", "is", null);
      if (bundleErr) throw new Error(`advert_lifecycle: could not read open bundle invoices: ${bundleErr.message}`);
      const openBundles = [...new Set((openBundleInvoices ?? []).map((i) => i.bundle_id).filter((id): id is string => Boolean(id)))];
      if (openBundles.length) {
        const { data: unpaidParts, error: partsErr } = await db
          .from("advert_bookings")
          .select("bundle_id")
          .in("bundle_id", openBundles)
          .eq("ended_reason", "unpaid");
        if (partsErr) throw new Error(`advert_lifecycle: could not read lapsed bundle parts: ${partsErr.message}`);
        for (const p of unpaidParts ?? []) if (p.bundle_id) lapsedBundles.add(p.bundle_id);
      }
      for (const bundleId of lapsedBundles) {
        voided(`bundle ${bundleId}`, await voidBundleInvoiceIfAbandoned(bundleId));
      }
      const { data: lapsedPlacements } = await db
        .from("placements")
        .select("id")
        .eq("awaiting_payment", true)
        .lt("ends_on", today);
      // The hold flag stays set on a lapsed placement for good, so this list
      // only grows: look up which of them still have an issued invoice first,
      // rather than one void call per old placement every night.
      const placementIds = (lapsedPlacements ?? []).map((p) => p.id);
      if (placementIds.length) {
        const { data: stillOpen, error: openErr } = await db
          .from("invoices")
          .select("placement_id")
          .in("placement_id", placementIds)
          .eq("status", "issued");
        if (openErr) throw new Error(`advert_lifecycle: could not read lapsed placements' invoices: ${openErr.message}`);
        for (const placementId of new Set((stillOpen ?? []).map((i) => i.placement_id).filter((id): id is string => Boolean(id)))) {
          voided(`placement ${placementId}`, await voidInvoices({ placement_id: placementId }));
        }
      }

      // 2. finished. Includes scheduled runs whose whole term elapsed inside a
      // gap between sweeps, which is why this is not limited to 'live'.
      const { data: finishing } = await db
        .from("advert_bookings")
        .select("id, ends_on, advert:adverts(member_id)")
        .in("status", ["scheduled", "live"])
        .lt("ends_on", today);
      for (const b of finishing ?? []) {
        const { data: done } = await db.from("advert_bookings")
          .update({ status: "ended", ended_at: now, ended_reason: "term_complete", ended_notified_for: b.ends_on, updated_at: now })
          .eq("id", b.id)
          .in("status", ["scheduled", "live"])
          .select("id");
        if (done?.length && b.advert?.member_id) {
          await enqueue("notify_member", { member_id: b.advert.member_id, kind: "advert_ended", booking_id: b.id });
        }
      }

      // 3. ending soon — last, so a run that just ended above cannot also be
      // told it is "ending soon" hours after it finished.
      const weekOut = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      const { data: expiring } = await db
        .from("advert_bookings")
        .select("id, starts_on, ends_on, ending_soon_notified_for, advert:adverts(name, member_id)")
        .eq("status", "live")
        .gte("ends_on", today)
        .lte("ends_on", weekOut);
      for (const b of expiring ?? []) {
        if (b.ending_soon_notified_for === b.ends_on) continue;
        // a run shorter than the warning window would be "ending soon" on day one
        const days = (Date.parse(b.ends_on) - Date.parse(b.starts_on)) / 864e5;
        if (days <= 7) continue;
        // The conditional update IS the lock, exactly as the job claim above:
        // if no row comes back another runner already took it, so send nothing.
        // Stamp before enqueueing — a crash here costs one nudge, whereas the
        // other order risks mailing a paying advertiser twice.
        const { data: claimed } = await db.from("advert_bookings")
          .update({ ending_soon_notified_for: b.ends_on, updated_at: now })
          .eq("id", b.id)
          .or(`ending_soon_notified_for.is.null,ending_soon_notified_for.neq.${b.ends_on}`)
          .select("id");
        if (!claimed?.length) continue;
        if (b.advert?.member_id) {
          await enqueue("notify_member", { member_id: b.advert.member_id, kind: "advert_ending_soon", booking_id: b.id, ends_on: b.ends_on });
        }
        // and Jas, so a renewal conversation can start from the console.
        //
        // This row is the one that made the message/notification conflation
        // concrete (fix-list 71): it was written as an `advertising` enquiry
        // with `email: ''`, so the console offered a reply form on it and that
        // reply would have been addressed to nobody. It is a notification, and
        // it now links to the booking instead.
        await notifyConsole({
          kind: "advert_ending",
          memberId: b.advert?.member_id ?? null,
          name: b.advert?.name ?? "Advert",
          payload: { booking_id: b.id },
          message: `Advert run "${b.advert?.name}" ends on ${b.ends_on} — worth asking about a renewal.`,
        });
      }
      break;
    }
    case "newsletter_send": {
      const { data: issue } = await db.from("newsletter_issues").select("id, number, subject, status, approved_at").eq("id", String(payload.issue_id)).single();
      if (!issue || issue.status === "sent") return;
      // Gap review area 4: the console only queues approved issues, but a job
      // queued some other way, or an approval withdrawn without the job being
      // cancelled, must still never reach the list. Shown in the board's Failed
      // column; not thrown, since retrying can't make it approved.
      if (!issue.approved_at) {
        await db.from("newsletter_issues")
          .update({ status: "send_failed", send_error: "Not approved to send — finish the proof and approve the issue, then send again." })
          .eq("id", issue.id);
        return;
      }
      const { getNewsletterSender, newsletterIsLive, issueItemsNotLive } = await import("./adapters/newsletter");
      // GAPS B5.5: a story or video withdrawn after it was picked would go out
      // linking to a 404. Refused here, ahead of either sender, so the logging
      // stub can't let it through. Not thrown, like the approval check above:
      // a retry can't put the item back.
      const notLive = await issueItemsNotLive(issue.id);
      if (notLive.length) {
        const { notLiveMessage } = await import("./newsletter-picker");
        await db.from("newsletter_issues")
          .update({ status: "send_failed", send_error: notLiveMessage(notLive).slice(0, 500) })
          .eq("id", issue.id);
        return;
      }
      // Keyed on this job's own id: a retry of the SAME job (crash between the
      // broadcast succeeding and the status write below landing) reuses the
      // key, so Resend dedupes rather than mailing the whole list twice. A
      // deliberate re-send from the console enqueues a new job with a new id,
      // so it isn't blocked from actually re-sending.
      const result = await getNewsletterSender().sendIssue(issue.id, `newsletter-${jobId}`);

      // GAPS C3: this used to flip to 'sent' unconditionally, on top of a stub.
      // The status now follows what actually happened.
      if (!result.ok) {
        await db.from("newsletter_issues")
          .update({ status: "send_failed", send_error: result.error.slice(0, 500) })
          .eq("id", issue.id);
        // Throw so the issue also shows up as a dead job in "Needs You Today" —
        // a failed send to the whole list must be impossible to miss.
        throw new Error(`newsletter issue ${issue.number ?? issue.id} failed to send: ${result.error}`);
      }

      await db.from("newsletter_issues")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          send_error: null,
          sent_count: result.recipients,
          provider_broadcast_id: result.providerBroadcastId ?? null,
        })
        .eq("id", issue.id);
      if (!newsletterIsLive()) {
        // Still honest in the logs when the stub is what "succeeded".
        console.warn(`[newsletter] issue ${issue.id} marked sent by the logging stub — no mail left the building.`);
      }
      break;
    }
    default:
      // unknown kinds must surface in Needs You Today, not silently succeed
      throw new Error(`unknown job kind: ${kind}`);
  }
}
