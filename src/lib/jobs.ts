import { serviceDb } from "./db/server";
import type { Json } from "./db/types";
import { siteUrl } from "./site-url";

/**
 * Postgres-backed job queue (TECH-DECISIONS #13).
 * Prod: Vercel Cron hits /api/cron every minute. Local: scripts/job-runner.ts loop.
 * Failed jobs go 'dead' after max_attempts and surface in "Needs You Today" —
 * publishing must never silently fail.
 */

export type JobKind =
  | "publish_scheduled"      // periodic sweep: stories whose scheduled_at has passed
  | "social_push"            // payload: { story_id } or { video_id } — delayed push after publish
  | "notify_member"          // payload: { member_id, kind, ... }
  | "crm_sync"               // periodic Bigin poll
  | "rollup_daily"           // nightly analytics rollup + partition upkeep
  | "newsletter_send"        // payload: { issue_id }
  | "comp_expiry"            // daily sweep: expired promo comps → grace + console note
  | "advert_lifecycle"       // daily sweep: advert runs start, end, and warn before ending
  | "admin_digest"           // daily sweep: everything waiting on Jas, in one email
  | "newsletter_sync";       // daily sweep: mirror the contact list to the sender

export async function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, dueAt?: Date) {
  await serviceDb().from("jobs").insert({ kind, payload: payload as Json, due_at: (dueAt ?? new Date()).toISOString() });
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
  await ensurePeriodic("advert_lifecycle", 24 * 60 * 60);
  await ensurePeriodic("admin_digest", 24 * 60 * 60);
  await ensurePeriodic("newsletter_sync", 24 * 60 * 60);

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

async function ensurePeriodic(kind: JobKind, everySeconds: number) {
  const db = serviceDb();
  const { data } = await db.from("jobs").select("id").eq("kind", kind).in("status", ["pending", "running"]).limit(1);
  if (!data?.length) {
    await db.from("jobs").insert({ kind, payload: {}, due_at: new Date(Date.now() + everySeconds * 1000).toISOString() });
  }
}

async function runJob(kind: JobKind, payload: Record<string, unknown>, jobId: string) {
  const db = serviceDb();
  switch (kind) {
    case "publish_scheduled": {
      const { data: ready } = await db
        .from("stories")
        .select("id, member_id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());
      for (const s of ready ?? []) {
        await db.from("stories").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
        const { data: caps } = await db.from("settings").select("value").eq("key", "social_caps").single();
        const delayMin = (caps?.value as { delay_minutes?: number })?.delay_minutes ?? 30;
        await enqueue("social_push", { story_id: s.id }, new Date(Date.now() + delayMin * 60_000));
        if (s.member_id) {
          await enqueue("notify_member", { member_id: s.member_id, kind: "story_live", story_id: s.id });
        }
      }
      const { data: readyVideos } = await db
        .from("videos")
        .select("id, member_id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());
      for (const v of readyVideos ?? []) {
        await db.from("videos").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", v.id);
        const { data: caps } = await db.from("settings").select("value").eq("key", "social_caps").single();
        const delayMin = (caps?.value as { delay_minutes?: number })?.delay_minutes ?? 30;
        await enqueue("social_push", { video_id: v.id }, new Date(Date.now() + delayMin * 60_000));
        if (v.member_id) {
          await enqueue("notify_member", { member_id: v.member_id, kind: "video_live", video_id: v.id });
        }
      }
      break;
    }
    case "social_push": {
      if (payload.video_id) {
        const { data: video } = await db
          .from("videos")
          .select("id, title, slug, thumbnail_path, member:members(name, social)")
          .eq("id", String(payload.video_id))
          .single();
        if (!video) return;
        const { data: caps } = await db.from("settings").select("value").eq("key", "social_caps").single();
        const perDay = (caps?.value as { per_day?: number })?.per_day ?? 3;
        const { count } = await db
          .from("jobs")
          .select("*", { count: "exact", head: true })
          .eq("kind", "social_push")
          .eq("status", "done")
          .gte("updated_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
        if ((count ?? 0) >= perDay) {
          const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
          await enqueue("social_push", payload, tomorrow);
          return;
        }
        const { getSocialPublisher } = await import("./adapters/social");
        await getSocialPublisher().publish({
          text: `${video.title}\n\nhttps://sheetmetalindustries.com/video/${video.slug}`,
          imagePath: video.thumbnail_path,
          tagHandles: (video.member?.social ?? {}) as Record<string, string>,
        });
        break;
      }
      const { data: story } = await db
        .from("stories")
        .select("id, title, slug, excerpt, cover_path, member:members(name, social)")
        .eq("id", String(payload.story_id))
        .single();
      if (!story) return;
      // daily cap check (2–3 posts/day — never bombard)
      const { data: caps } = await db.from("settings").select("value").eq("key", "social_caps").single();
      const perDay = (caps?.value as { per_day?: number })?.per_day ?? 3;
      const { count } = await db
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("kind", "social_push")
        .eq("status", "done")
        .gte("updated_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
      if ((count ?? 0) >= perDay) {
        // push past the cap → tomorrow morning
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
        await enqueue("social_push", payload, tomorrow);
        return;
      }
      const { getSocialPublisher } = await import("./adapters/social");
      await getSocialPublisher().publish({
        text: `${story.title}\n\nhttps://sheetmetalindustries.com/news/${story.slug}`,
        imagePath: story.cover_path,
        // @-tag from the CRM-stored handle — never hand-typed
        tagHandles: (story.member?.social ?? {}) as Record<string, string>,
      });
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

      const [{ getEmailSender }, { renderNotification }] = await Promise.all([
        import("./adapters/email"),
        import("./email/templates"),
      ]);
      // Deliberately unguarded: a provider rejection throws, the job retries
      // with backoff and eventually dead-letters into "Needs You Today". A
      // swallowed failure here is how a member silently never hears back.
      await getEmailSender().send({ to: member.contact_email, ...renderNotification(payload) }, { idempotencyKey: `notify-${jobId}` });
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
        ["Stories awaiting approval", stories.count],
        ["Videos awaiting approval", videos.count],
        ["Events awaiting approval", events.count],
        ["Featured machines awaiting approval", machines.count],
        ["Page edits awaiting approval", revisions.count],
        ["Advert bookings awaiting approval", bookings.count],
        ["Visibility requests to answer", interest.count],
        ["Member pages submitted for review", drafts.count],
      ].filter(([, count]) => Number(count) > 0) as [string, number][];

      // Silence is the correct output on a quiet day — a "nothing to do" email
      // every morning is how a digest gets filtered into a folder unread.
      if (!lines.length) return;

      const total = lines.reduce((sum, [, count]) => sum + count, 0);
      const { getEmailSender } = await import("./adapters/email");
      await getEmailSender().send({
        to: ADMIN_EMAIL,
        subject: `SMI — ${total} item${total === 1 ? "" : "s"} waiting for you`,
        text: [
          `${total} item${total === 1 ? "" : "s"} waiting in the console:`,
          "",
          ...lines.map(([label, count]) => `  ${count} — ${label}`),
          "",
          `${siteUrl()}/console`,
        ].join("\n"),
      });
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
    case "rollup_daily": {
      const { error } = await db.rpc("run_daily_rollup");
      if (error) throw new Error(error.message);
      break;
    }
    case "comp_expiry": {
      // promo comp ran out with no card payment → grace (Jas decides from there;
      // grace members already surface in "Needs You Today")
      const today = new Date().toISOString().slice(0, 10);
      const { data: expired } = await db
        .from("members")
        .select("id, name, contact_email, comped_until")
        .eq("status", "active")
        .is("paid_at", null)
        .lt("comped_until", today);
      for (const m of expired ?? []) {
        const graceUntil = new Date(`${m.comped_until}T12:00:00Z`);
        graceUntil.setUTCDate(graceUntil.getUTCDate() + 30);
        await db.from("members").update({ status: "grace", grace_until: graceUntil.toISOString().slice(0, 10) }).eq("id", m.id);
        await db.from("inbox_messages").insert({
          kind: "membership",
          name: m.name,
          email: m.contact_email ?? "",
          message: `Promo comp expired on ${m.comped_until} — moved to grace until ${graceUntil.toISOString().slice(0, 10)}.`,
        });
      }
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
        // and Jas, so a renewal conversation can start from the console
        await db.from("inbox_messages").insert({
          kind: "advertising",
          name: b.advert?.name ?? "Advert",
          email: "",
          message: `Advert run "${b.advert?.name}" ends on ${b.ends_on} — worth asking about a renewal.`,
        });
      }
      break;
    }
    case "newsletter_send": {
      const { data: issue } = await db.from("newsletter_issues").select("id, number, subject, status").eq("id", String(payload.issue_id)).single();
      if (!issue || issue.status === "sent") return;
      const { getNewsletterSender, newsletterIsLive } = await import("./adapters/newsletter");
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
        .update({ status: "sent", sent_at: new Date().toISOString(), send_error: null })
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
