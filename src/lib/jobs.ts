import { serviceDb } from "./db/server";
import type { Json } from "./db/types";

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
  | "comp_expiry";           // daily sweep: expired promo comps → grace + console note

export async function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, dueAt?: Date) {
  await serviceDb().from("jobs").insert({ kind, payload: payload as Json, due_at: (dueAt ?? new Date()).toISOString() });
}

export async function runDueJobs(): Promise<{ ran: number; failed: number }> {
  const db = serviceDb();
  let ran = 0, failed = 0;

  // periodic sweeps enqueue themselves if none pending (cheap idempotent upkeep)
  await ensurePeriodic("publish_scheduled", 60);
  await ensurePeriodic("crm_sync", 15 * 60);
  await ensurePeriodic("rollup_daily", 24 * 60 * 60);
  await ensurePeriodic("comp_expiry", 24 * 60 * 60);

  const { data: due } = await db
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(20);

  for (const job of due ?? []) {
    const { data: claimed } = await db
      .from("jobs")
      .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending") // optimistic claim — only one runner wins
      .select("id");
    if (!claimed?.length) continue;
    try {
      await runJob(job.kind as JobKind, (job.payload ?? {}) as Record<string, unknown>);
      await db.from("jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job.id);
      ran++;
    } catch (e) {
      failed++;
      const dead = job.attempts + 1 >= job.max_attempts;
      await db.from("jobs").update({
        status: dead ? "dead" : "pending",
        due_at: dead ? job.due_at : new Date(Date.now() + 60_000 * job.attempts).toISOString(),
        last_error: String(e).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
  }
  return { ran, failed };
}

async function ensurePeriodic(kind: JobKind, everySeconds: number) {
  const db = serviceDb();
  const { data } = await db.from("jobs").select("id").eq("kind", kind).in("status", ["pending", "running"]).limit(1);
  if (!data?.length) {
    await db.from("jobs").insert({ kind, payload: {}, due_at: new Date(Date.now() + everySeconds * 1000).toISOString() });
  }
}

async function runJob(kind: JobKind, payload: Record<string, unknown>) {
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
      await db.from("notifications").insert({
        member_id: member.id,
        kind: String(payload.kind ?? "generic"),
        payload: payload as Json,
      });
      if (!member.contact_email) return; // pre-funnel members may have no address; in-app notification still lands
      const { getEmailSender } = await import("./adapters/email");
      await getEmailSender().send({
        to: member.contact_email,
        subject: payload.kind === "story_live" ? "Your story is live on SMI" :
                 payload.kind === "story_rejected" ? "About your submitted story" :
                 payload.kind === "video_live" ? "Your video is live on SMI" :
                 payload.kind === "video_rejected" ? "About your submitted video" :
                 payload.kind === "event_published" ? "Your event is live on SMI" :
                 payload.kind === "event_rejected" ? "About your submitted event" :
                 payload.kind === "page_live" ? "Your SMI member page is live" : "Update from SMI",
        text: payload.kind === "page_live"
          ? "Your company page has been approved and is now live in the SMI member directory."
          : String(payload.reason ?? "Log in to your member area for details."),
      });
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
    case "newsletter_send": {
      const { data: issue } = await db.from("newsletter_issues").select("id, subject, status").eq("id", String(payload.issue_id)).single();
      if (!issue || issue.status === "sent") return;
      const { getNewsletterSender } = await import("./adapters/newsletter");
      await getNewsletterSender().sendIssue(issue.id);
      await db.from("newsletter_issues").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", issue.id);
      break;
    }
    default:
      // unknown kinds must surface in Needs You Today, not silently succeed
      throw new Error(`unknown job kind: ${kind}`);
  }
}
