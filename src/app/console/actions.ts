"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { requireConsole } from "@/lib/auth";
import { getLeadGenSource, isProspectAction } from "@/lib/adapters/leadgen";
import { AD_FORMAT_KEYS, type AdFormat } from "@/lib/advert-formats";
import { DEFAULT_SOCIAL_CAPS, type SocialCaps } from "@/lib/social-caps";
import { CONFIRM_MESSAGES, confirmSocialPost, seenFromForm } from "@/lib/social-push";
import { parseLondonInput } from "@/lib/london-time";
import type { SocialChannels } from "@/lib/social-channels";
import { clearChannelDetailsCache } from "@/lib/adapters/social";
import { parseStoryView } from "@/lib/story-board";
import { applyOptIn, NEWSLETTER_CHOICES, type NewsletterChoice } from "@/lib/contacts";
import { optInEvidence } from "@/lib/newsletter-consent";
import { NEWSLETTER_FOOTER_KEY, newsletterFooterFromForm } from "@/lib/newsletter-footer";
import { newsletterAudience } from "@/lib/newsletter-audience";
import { meetsWcagAA } from "@/lib/contrast";
import { serviceDb } from "@/lib/db/server";
import { DEV_ASSIGNEES, DEV_STATUSES, devTaskValuesFromForm, type DevStatus } from "@/lib/dev-tasks";
import { enqueue } from "@/lib/jobs";
import { EMAIL_RE, safeInternalPath, UUID_RE } from "@/lib/validate";
import { eventLastDay, FEATURED_EVENT_BACKUP_KEY } from "@/lib/featured-event";
import { approve, decline, move, publish, schedule, type ContentKind, type LifecycleDeps, type LifecycleResult, type PublishOptions } from "@/lib/content-lifecycle";
import { save, slugify, type IntakeRefusal } from "@/lib/content-intake";
import { consoleIntakeDeps } from "@/lib/content-intake-deps";
import { FEATURED_SLOTS, penniesFromPounds } from "@/lib/pricing";
import { BANNER_SPOTS_KEY } from "@/lib/banner-spots";
import { raiseInvoice } from "@/lib/invoicing";
import { holdsForPayment, invoiceAdvertising, settleInvoice, voidBundleInvoiceIfAbandoned, voidInvoices } from "@/lib/advert-payments";
import { renewalDatesProblem } from "@/lib/advert-renewal";
import { editorImageUpload, uploadFailureMessage } from "@/lib/editor-upload";
import type { UploadResult } from "@/lib/upload-limits";
import { removeMedia, uploadDocument, uploadImage } from "@/lib/media";
import { CONSOLE_UPLOADS, hasSubmittedFile, submittedFile } from "@/lib/staged-upload";
import { memberValuesFromForm } from "@/lib/member-form";
import { logError } from "@/lib/log";
import { parseRevisionPayload } from "./member-revision";
import { firstImportPreviewFresh } from "./crm/first-import";
import {
  billItem, invoiceFailedMessage, invoiceOnRecord, paidDiffersMessage, priceError, releaseHold, repricePlan, voidForReprice,
  type BillTarget, type Reprice,
} from "./item-billing";
import { resolveCoordinates } from "@/lib/member-geocode";
import { membershipTypeIdsFromForm, membershipTypesError, replaceMemberIndustries, replaceMemberMembershipTypes, replaceMemberServices } from "@/lib/member-services";
import { recordRename } from "@/lib/redirects";
import { activationBlocked, MEMBER_STATUSES, type MemberStatus } from "@/lib/membership";
import { sanitizeRichText } from "@/lib/sanitize";
import { siteUrl } from "@/lib/site-url";
import { missingChecks, PROOF_KEYS } from "@/lib/newsletter-proof";
import { parseIssueItems, type IssueContentResult, type IssueItemRef } from "@/lib/newsletter-picker";
import { ONE_PER_ISSUE_FORMATS } from "@/lib/newsletter-layout";
import { isVariant, SITE_VARIANT_KEY, VARIANT_COOKIE } from "@/lib/variant";
import { featureFlagKey, isFeatureFlag } from "@/lib/feature-flags";
import { HOME_SECTION_IDS, HOME_SECTIONS_KEY, LOCKED_VISIBLE, moveHomeSection, resolveHomeSections, type HomeSectionId } from "@/lib/home-sections";
import { optionalYoutubeUrl } from "@/lib/youtube";
import { advertLinkFromForm } from "@/lib/advert-link";


/** Editor image upload — returns { url } for insertion as <img src>, or { error } to show. */
export async function consoleUploadImage(formData: FormData): Promise<UploadResult> {
  await requireConsole();
  return editorImageUpload(formData, CONSOLE_UPLOADS, "stories/console");
}

/**
 * A database error, for the person at the console: a plain sentence on the
 * page, and Postgres's own wording (constraint and column names) in the error
 * log, where a developer reads it. Messages Jas can act on — a clash, a
 * duplicate slug — are mapped to their own sentence at the call site first.
 * Not exported: this is a "use server" module.
 */
function dbProblem(area: string, error: { message: string; code?: string }, sentence = "That couldn't be saved — please try again. If it keeps happening, it's in the error log."): string {
  logError({ source: "db", area, error: error.message, context: { code: error.code ?? null } });
  return sentence;
}

/* ---------- stories ---------- */

/**
 * The story editor's Save. Parsing, the upload, the write (and its cleanup),
 * tagged members, categories and SMI's post links live in lib/content-intake.
 */
export async function saveStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "") || null;
  const res = await save(consoleIntakeDeps(), "story", id, formData, { userId: user.userId });
  if (!res.ok) {
    if (res.code === "partial") revalidatePath("/console/stories");
    redirect(saveErrorPath("story", id, res));
  }
  revalidatePath("/console/stories");
  redirect(`/console/stories/${res.id}?saved=1`);
}

/**
 * Where a console save refusal is shown: the editor it came from (or, for a
 * story that saved but whose members didn't, the saved story's editor), or the
 * list when the story isn't there to edit. Not exported: "use server".
 */
function saveErrorPath(kind: ContentKind, id: string | null, res: IntakeRefusal): string {
  const list = `/console/${kind === "story" ? "stories" : `${kind}s`}`;
  if (res.code === "not_found") return `${list}?error=${encodeURIComponent(res.error)}`;
  return `${list}/${res.id ?? id ?? "new"}?error=${encodeURIComponent(res.error)}`;
}

/** The content lifecycle's dependencies: the service client and the real job queue. Not exported: "use server". */
function lifecycleDeps(): LifecycleDeps {
  return { db: serviceDb(), enqueue };
}

/**
 * Where a decide/schedule refusal is shown: the item's editor, or its list
 * when there is no console editor to land on (not found — which includes a
 * member's unsubmitted story draft). Not exported: "use server".
 */
function lifecycleErrorPath(kind: ContentKind, id: string, res: Extract<LifecycleResult, { ok: false }>): string {
  const list = `/console/${kind === "story" ? "stories" : `${kind}s`}`;
  const base = res.code === "not_found" ? list : `${list}/${id}`;
  return `${base}?error=${encodeURIComponent(res.error)}`;
}

/**
 * The editor's Industry box, which its publishing forms carry (MirrorInput).
 * Undefined when the form didn't send one — the board's buttons — so the
 * lifecycle falls back to the member's own industry. Not exported: "use server".
 */
function industryChoice(formData: FormData): PublishOptions | undefined {
  return formData.has("industry_id") ? { industryId: Number(formData.get("industry_id")) || null } : undefined;
}

export async function scheduleStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const now = formData.get("mode") === "now";
  // The editor's time is UK wall-clock; read on the server it was UTC, an hour out all summer.
  const at = when && !now ? parseLondonInput(when) : null;
  if (when && !now && !at) {
    redirect(`/console/stories/${id}?error=${encodeURIComponent("That publish time isn't a date and time we can read.")}`);
  }
  // Publish now is the urgent override; scheduling from Ready to review is also
  // an approval. Legality, the social post, the emails and the approval record
  // all live in lib/content-lifecycle.
  const res = now
    ? await publish(lifecycleDeps(), "story", id, { userId: user.userId }, industryChoice(formData))
    : at ? await schedule(lifecycleDeps(), "story", id, at, { userId: user.userId }, industryChoice(formData)) : null;
  if (res && !res.ok) redirect(lifecycleErrorPath("story", id, res));
  revalidatePath("/console/stories");
  // come back to whichever Story Engine view the operator came from (board,
  // calendar or list). Validated, not trusted — this is POST-reachable like every action.
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/stories(\?[\w=&-]*)?$/.test(back) ? back : "/console/stories");
}

/**
 * Approve publishes; anything else declines (lib/content-lifecycle): a
 * member's story is Sent back with the reason; the desk's own goes back to
 * Draft with no email — its member_id is the company it is *about*, who didn't
 * write it (Jas's flow chart, 16 Oct).
 */
export async function decideStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const actor = { userId: user.userId };
  const res = decision === "approve"
    ? await approve(lifecycleDeps(), "story", id, actor, reason, industryChoice(formData))
    : await decline(lifecycleDeps(), "story", id, actor, reason);
  if (!res.ok) redirect(lifecycleErrorPath("story", id, res));
  revalidatePath("/console");
  revalidatePath("/console/stories");
}

export async function pinStory(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("stories").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
  }).eq("id", id);
  revalidatePath("/console/stories");
}

/**
 * Kanban drop handler — a typed server action called directly from the client
 * board, same "not FormData" precedent as moveDevTask. Unlike moveDevTask, any
 * move here can be illegal (see LEGAL_STORY_MOVES), so this returns {ok,error}
 * rather than void. lib/content-lifecycle re-reads the row's current status
 * rather than trusting the client's idea of "from", so a stale drag can't apply
 * an illegal transition.
 */
export async function moveStory(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const res = await move(lifecycleDeps(), "story", input.id, input.to, { userId: user.userId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/console");
  revalidatePath("/console/stories");
  return { ok: true };
}

/**
 * Keyboard/no-JS fallback for the story board — same shape as setDevTaskStatus,
 * except a refused or failed move comes back as ?error= (the board shows it)
 * rather than a redirect that reads as if the card moved.
 */
export async function setStoryStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  // The editor's "Mark ready to review" posts here too and comes back to
  // itself — only ever to this story's own editor, never an arbitrary path.
  const back = formData.get("return_to") === `/console/stories/${id}` ? `/console/stories/${id}` : "/console/stories";
  const res = await moveStory({ id, to });
  if (!res.ok) redirect(`${back}?error=${encodeURIComponent(res.error ?? "That move isn't allowed.")}`);
  redirect(back);
}

/* ---------- social posts (issue #43) ---------- */

/**
 * The editor's Confirm / Confirm all under "Social post": snapshots what each
 * channel would receive from the saved item (lib/social-push
 * confirmSocialPost) and queues the post, refusing if it is no longer what
 * the page showed. The buttons submit their own small form (SocialConfirmForm),
 * not the editor's, and are disabled while the editor has unsaved changes. A
 * failure comes back as ?error=, like every other path here. Not exported:
 * "use server".
 */
async function confirmSocial(kind: "story" | "video", formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const which = String(formData.get("confirm_channel") ?? "");
  const list = `/console/${kind === "story" ? "stories" : "videos"}`;
  if (!UUID_RE.test(id)) redirect(`${list}?error=${encodeURIComponent(CONFIRM_MESSAGES.notFound)}`);
  const editor = `${list}/${id}`;
  if (!which) redirect(`${editor}?error=${encodeURIComponent(CONFIRM_MESSAGES.nothingWaiting)}#social`);
  const { cachedChannelNetworks } = await import("@/lib/adapters/social");
  let res: Awaited<ReturnType<typeof confirmSocialPost>>;
  try {
    res = await confirmSocialPost(
      serviceDb(),
      kind === "story" ? { story_id: id } : { video_id: id },
      { only: which === "all" ? "all" : [which], userId: user.userId, seen: seenFromForm(formData) },
      // the same remembered answer the editor's preview was built from
      { networks: () => cachedChannelNetworks(), enqueue },
    );
  } catch (e) {
    logError({ source: "server", area: "console:confirm-social", error: e, context: { kind, id } });
    res = { ok: false, error: "Confirming didn't save, so nothing was confirmed. Try again." };
  }
  revalidatePath(editor);
  revalidatePath("/console");
  if (!res.ok) redirect(`${editor}?error=${encodeURIComponent(res.error)}#social`);
  redirect(`${editor}?confirmed=${res.confirmed.length}#social`);
}

export async function confirmStorySocial(formData: FormData) {
  await confirmSocial("story", formData);
}

export async function confirmVideoSocial(formData: FormData) {
  await confirmSocial("video", formData);
}

/* ---------- videos ---------- */

/** Editor image upload for the description field — returns { url } for insertion as <img src>, or { error } to show. */
export async function consoleUploadVideoImage(formData: FormData): Promise<UploadResult> {
  await requireConsole();
  return editorImageUpload(formData, CONSOLE_UPLOADS, "videos/console");
}

/** The video editor's Save (lib/content-intake). */
export async function saveVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "") || null;
  const res = await save(consoleIntakeDeps(), "video", id, formData, { userId: user.userId });
  if (!res.ok) redirect(saveErrorPath("video", id, res));
  revalidatePath("/console/videos");
  redirect(`/console/videos/${res.id}?saved=1`);
}

export async function scheduleVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const now = formData.get("mode") === "now";
  // UK wall-clock, as scheduleStory.
  const at = when && !now ? parseLondonInput(when) : null;
  if (when && !now && !at) {
    redirect(`/console/videos/${id}?error=${encodeURIComponent("That publish time isn't a date and time we can read.")}`);
  }
  // As scheduleStory: the rules and side effects live in lib/content-lifecycle.
  const res = now
    ? await publish(lifecycleDeps(), "video", id, { userId: user.userId }, industryChoice(formData))
    : at ? await schedule(lifecycleDeps(), "video", id, at, { userId: user.userId }, industryChoice(formData)) : null;
  if (res && !res.ok) redirect(lifecycleErrorPath("video", id, res));
  revalidatePath("/console/videos");
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/videos(\?[\w=&-]*)?$/.test(back) ? back : "/console/videos");
}

/** As decideStory: approve publishes, anything else declines. */
export async function decideVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const actor = { userId: user.userId };
  const res = decision === "approve"
    ? await approve(lifecycleDeps(), "video", id, actor, reason, industryChoice(formData))
    : await decline(lifecycleDeps(), "video", id, actor, reason);
  if (!res.ok) redirect(lifecycleErrorPath("video", id, res));
  revalidatePath("/console");
  revalidatePath("/console/videos");
}

export async function pinVideo(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("videos").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/console/videos");
}

/**
 * Video Engine kanban drop handler — the sibling of `moveStory`, same contract:
 * lib/content-lifecycle re-reads the current status, refuses anything outside
 * LEGAL_VIDEO_MOVES, and returns the reason so the board can revert its
 * optimistic update and say why.
 */
export async function moveVideo(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const res = await move(lifecycleDeps(), "video", input.id, input.to, { userId: user.userId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/console");
  revalidatePath("/console/videos");
  return { ok: true };
}

/** Keyboard/no-JS fallback for the video board — same shape as setStoryStatus. */
export async function setVideoStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  const res = await moveVideo({ id, to });
  // The editor's "Mark ready to review" comes back to its own page (as setStoryStatus).
  if (formData.get("return_to") === `/console/videos/${id}`) {
    redirect(res.ok ? `/console/videos/${id}` : `/console/videos/${id}?error=${encodeURIComponent(res.error ?? "That move isn't allowed.")}`);
  }
}

/* ---------- unpublish ---------- */

// Not exported: this is a "use server" module, and Next only permits async
// function exports from one. A const export here is a runtime error on every
// page that imports the module, which typecheck and lint both let through.
const UNPUBLISHABLE_KINDS = ["story", "video", "event", "machine"] as const;

/**
 * Take published content back to draft (fix list).
 *
 * Stories could already do this, but *only* by dragging a card on the board —
 * the editors offered no button, and videos, events and equipment had no route
 * back from published at all. This is that button, for all four.
 *
 * Stories and videos delegate to their board matrix so it stays the single
 * authority on legal transitions; events and equipment have no matrix, so the
 * `published` precondition is checked inline. Either way an already-draft row is
 * a no-op rather than an error.
 *
 * The member is deliberately NOT notified — there is no notification kind for
 * "your content was taken down" and inventing the wording is Jas's call
 * (docs/ask-jas.md).
 */
export async function returnToDraft(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!id || !(UNPUBLISHABLE_KINDS as readonly string[]).includes(kind)) return;
  const db = serviceDb();

  // One branch per table rather than a generic `db.from(table)`: the four
  // tables' Update types differ (featured_machines has no updated_at at all,
  // only created_at), and a union collapses the payload type to never. The
  // compiler caught exactly that — worth keeping the branches honest.
  if (kind === "story") {
    await moveStory({ id, to: "draft" });
    redirect(`/console/stories/${id}`);
  }
  if (kind === "video") {
    await moveVideo({ id, to: "draft" });
    redirect(`/console/videos/${id}`);
  }
  if (kind === "event") {
    const result = await moveEvent({ id, to: "draft" });
    if (!result.ok) return;
    redirect(`/console/events/${id}`);
  }

  const { data: row } = await db.from("featured_machines").select("id, status").eq("id", id).single();
  if (!row || row.status !== "published") return;
  await db.from("featured_machines").update({ status: "draft" }).eq("id", id);
  revalidatePath("/console");
  revalidatePath("/console/machines");
  redirect(`/console/machines/${id}`);
}

/* ---------- events & member revisions ---------- */

/** Editor image upload for the description field — returns { url } for insertion as <img src>, or { error } to show. */
export async function consoleUploadEventImage(formData: FormData): Promise<UploadResult> {
  await requireConsole();
  return editorImageUpload(formData, CONSOLE_UPLOADS, "events/console");
}

/** The event editor's Save (lib/content-intake): geocodes a changed location, keeping the old pin on failure. */
export async function saveEvent(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "") || null;
  const res = await save(consoleIntakeDeps(), "event", id, formData, { userId: user.userId });
  if (!res.ok) redirect(saveErrorPath("event", id, res));
  revalidatePath("/console/events");
  redirect(`/console/events/${res.id}?saved=1`);
}

/** As decideStory: approve publishes; a member's event is Sent back with the reason, the desk's own goes back to Draft. */
export async function decideEvent(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const actor = { userId: user.userId };
  const res = decision === "approve"
    ? await approve(lifecycleDeps(), "event", id, actor, reason, industryChoice(formData))
    : await decline(lifecycleDeps(), "event", id, actor, reason);
  if (!res.ok) redirect(lifecycleErrorPath("event", id, res));
  revalidatePath("/console");
  revalidatePath("/console/events");
}

/**
 * Board/dropdown status moves for events (A1.10-style, mirroring moveStory).
 * Console-created events start at "draft" with no other code path to
 * "published" — this is that path (lib/content-lifecycle move).
 */
export async function moveEvent(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const res = await move(lifecycleDeps(), "event", input.id, input.to, { userId: user.userId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/console");
  revalidatePath("/console/events");
  return { ok: true };
}

/** Keyboard/no-JS fallback for the events board — same shape as setStoryStatus. */
export async function setEventStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  await moveEvent({ id, to });
  redirect("/console/events");
}

export async function decideRevision(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: rev } = await db.from("member_revisions").select("id, member_id, payload, status").eq("id", id).single();
  if (!rev || rev.status !== "awaiting_approval") return;
  if (approve) {
    // The member's form carries their web address now that it is shared with
    // the console editor, so approving one can rename them — and a rename has
    // to be handled exactly as saveMember handles it, or their inbound links
    // die quietly. Read the slug they have *now*, before the update below.
    const { data: current } = await db.from("members").select("slug").eq("id", rev.member_id).single();
    // Only what the member's own profile form can produce, each value re-checked
    // (member-revision.ts) — the payload is member-written and reachable by a
    // direct PostgREST insert, so applying it wholesale let a member set their
    // own status, billing or paid_at by having Jas click Approve. Services and
    // membership types ride it as id lists (they're join tables, not columns);
    // null means the revision predates that picker, so the member's existing
    // set is left alone rather than wiped. Industries are Jas's alone: a
    // revision's industry fields are never applied (member-revision.ts).
    const { values: payload, serviceIds, membershipTypeIds, ignored } = parseRevisionPayload(rev.payload, rev.member_id);
    if (ignored.length) {
      logError({
        source: "server",
        area: "action:decideRevision",
        error: "Member revision carried fields that were not applied",
        userId: user.userId,
        context: { revision_id: id, member_id: rev.member_id, ignored },
      });
    }

    // A slug clash would violate the unique index and fail the whole approval,
    // so drop the rename rather than lose the rest of the member's edit — Jas
    // sees the error and can settle the name with them separately.
    const newSlug = typeof payload.slug === "string" ? payload.slug : null;
    const renamed = Boolean(newSlug && current && newSlug !== current.slug);
    if (renamed && newSlug) {
      const { data: clash } = await db.from("members").select("id").eq("slug", newSlug).neq("id", rev.member_id).maybeSingle();
      if (clash) return memberFail(rev.member_id, `That member asked for the web address “${newSlug}”, which another member already uses. Approve it after settling the name.`);
    }

    // Refuse an over-cap pick before anything is written, like the slug clash
    // above — otherwise the rest of the edit lands and the revision stays pending.
    const typesError = membershipTypeIds ? membershipTypesError(membershipTypeIds) : null;
    if (typesError) return memberFail(rev.member_id, `This edit asks for too many membership types. ${typesError}`);

    if (Object.keys(payload).length) {
      const { error: updateError } = await db.from("members").update(payload).eq("id", rev.member_id);
      if (updateError) return memberFail(rev.member_id, "Their changes couldn't be applied — nothing was changed. Try approving again.");
    }
    // null, not [], for a revision written before services existed on the form:
    // that member's existing services must not be wiped by approving it.
    if (serviceIds) await replaceMemberServices(db, rev.member_id, serviceIds);
    // Same null rule: a revision from before members could pick their types
    // leaves the types Jas assigned untouched.
    if (membershipTypeIds) {
      try {
        await replaceMemberMembershipTypes(db, rev.member_id, membershipTypeIds);
      } catch (e) {
        return memberFail(rev.member_id, e instanceof Error ? e.message : "Could not save membership types.");
      }
    }
    // Same redirect bookkeeping saveMember does — a live member's old URL has
    // to keep resolving.
    if (renamed && newSlug && current) await recordRename(`/member/${current.slug}`, `/member/${newSlug}`);
    await db.from("member_revisions").update({ status: "published", decided_at: new Date().toISOString() }).eq("id", id);
    // The edit is live: the public page (under its new address, if renamed) and the directory.
    revalidateMemberSurfaces(rev.member_id, (renamed ? newSlug : current?.slug) ?? null);
    await enqueue("notify_member", { member_id: rev.member_id, kind: "page_changes_live", revision_id: id });
  } else {
    await db.from("member_revisions").update({ status: "rejected", rejected_reason: reason, decided_at: new Date().toISOString() }).eq("id", id);
    await enqueue("notify_member", { member_id: rev.member_id, kind: "page_changes_rejected", revision_id: id, reason });
  }
  await db.from("approvals").insert({ kind: "member_revision", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
}

/* ---------- page layouts ---------- */

const PAGE_TYPES = ["story", "member_profile", "featured_machine", "static_page"] as const;

export async function saveLayout(formData: FormData) {
  await requireConsole();
  const pageType = String(formData.get("page_type")) as (typeof PAGE_TYPES)[number];
  const entityId = String(formData.get("entity_id") ?? "") || null;
  const qs = `type=${pageType}${entityId ? `&entity=${entityId}` : ""}`;
  if (!PAGE_TYPES.includes(pageType)) redirect(`/console/pages?${qs}&error=${encodeURIComponent("Unknown page type.")}`);
  let layout: unknown;
  try {
    layout = JSON.parse(String(formData.get("layout") ?? ""));
  } catch {
    redirect(`/console/pages?${qs}&error=${encodeURIComponent("Layout could not be read — try again.")}`);
  }
  const { validateLayout } = await import("@/lib/blocks/schema");
  const error = validateLayout(pageType, layout);
  if (error) redirect(`/console/pages?${qs}&error=${encodeURIComponent(error)}`);
  await serviceDb().from("page_layouts").upsert({
    page_type: pageType,
    entity_id: entityId,
    layout: layout as import("@/lib/db/types").Json,
    updated_at: new Date().toISOString(),
  }, { onConflict: "page_type,entity_id" });
  revalidatePath("/console/pages");
  redirect(`/console/pages?${qs}&saved=1`);
}

export async function resetLayout(formData: FormData) {
  await requireConsole();
  const pageType = String(formData.get("page_type")) as (typeof PAGE_TYPES)[number];
  if (!PAGE_TYPES.includes(pageType)) return;
  const entityId = String(formData.get("entity_id") ?? "") || null;
  let q = serviceDb().from("page_layouts").delete().eq("page_type", pageType);
  q = entityId ? q.eq("entity_id", entityId) : q.is("entity_id", null);
  await q;
  revalidatePath("/console/pages");
  redirect(`/console/pages?type=${pageType}${entityId ? `&entity=${entityId}` : ""}`);
}

/* ---------- featured machines ---------- */

export async function saveMachine(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const memberId = String(formData.get("member_id") ?? "");
  // seller attribution is required on the public page — same reasoning as
  // saveStory: say why rather than silently re-rendering.
  if (!name || !memberId) {
    redirect(`/console/machines/${id || "new"}?error=${encodeURIComponent("A machine name and a seller are both required.")}`);
  }
  const video = optionalYoutubeUrl(formData.get("video_url"));
  if ("error" in video) redirect(`/console/machines/${id || "new"}?error=${encodeURIComponent(video.error)}`);
  const db = serviceDb();
  let image: string | null = null;
  try {
    image = await uploadImage(await submittedFile(formData, "image", CONSOLE_UPLOADS), "machines");
  } catch (e) {
    // Was an unhandled throw into the error boundary; now said on the form.
    redirect(`/console/machines/${id || "new"}?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveMachine"))}`);
  }
  const values = {
    name,
    member_id: memberId,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    external_url: String(formData.get("external_url") ?? "") || null,
    video_url: video.url,
    ...(image ? { image_path: image } : {}),
  };
  let machineId = id;
  if (id) {
    await db.from("featured_machines").update(values).eq("id", id);
  } else {
    const { data } = await db.from("featured_machines").insert({
      ...values,
      status: "published",
      source: "admin",
      submitted_by: user.userId,
    }).select("id").single();
    machineId = data!.id;
  }
  revalidatePath("/console/machines");
  redirect(`/console/machines/${machineId}?saved=1`);
}

export async function decideMachine(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: machine } = await db.from("featured_machines").select("id, member_id, status").eq("id", id).single();
  if (!machine || machine.status !== "awaiting_approval") return;
  await db.from("featured_machines").update(
    approve ? { status: "published" } : { status: "rejected", rejected_reason: reason },
  ).eq("id", id);
  await db.from("approvals").insert({ kind: "machine", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  if (machine.member_id) {
    await enqueue("notify_member", { member_id: machine.member_id, kind: approve ? "machine_live" : "machine_rejected", machine_id: id, ...(approve ? {} : { reason }) });
  }
  revalidatePath("/console/machines");
  revalidatePath("/console");
}

export async function saveMachinePlacement(formData: FormData) {
  await requireConsole();
  const machineId = String(formData.get("machine_id"));
  const db = serviceDb();
  const { data: machine } = await db.from("featured_machines").select("member_id, status").eq("id", machineId).single();
  if (!machine || machine.status !== "published") return;
  await db.from("placements").insert({
    kind: "featured_machine",
    featured_machine_id: machineId,
    member_id: machine.member_id,
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
  });
  revalidatePath("/console/machines");
  revalidatePath("/featured-machine");
}

/**
 * The invoice side of editing something already sold (item-billing.ts), in
 * two halves around the save. Before: read what's on record and decide —
 * refusing outright (with nothing written) when the change needs Jas's
 * decision, and voiding an unpaid invoice whose terms the save will change,
 * so its pay link stops working before the new terms land. After: bill the
 * item as saved. Returns the message to show instead of plain "Saved", or
 * null. Not exported — this is a "use server" module.
 */
async function rebillBeforeSave(target: BillTarget, next: { memberId: string | null; pricePennies: number | null }, back: string): Promise<Reprice> {
  const onRecord = await invoiceOnRecord(target);
  if (!onRecord.ok) redirect(`${back}?error=${encodeURIComponent(onRecord.error)}`);
  const plan = repricePlan(onRecord.invoice, next);
  if (plan.action === "refuse") redirect(`${back}?error=${encodeURIComponent(plan.error)}`);
  return plan;
}

async function voidBeforeSave(target: BillTarget, plan: Reprice, back: string) {
  if (plan.action !== "replace") return;
  const voided = await voidForReprice(target);
  if (!voided.ok) redirect(`${back}?error=${encodeURIComponent(voided.error)}`);
}

async function rebillAfterSave(
  target: BillTarget,
  plan: Reprice,
  pricePennies: number | null,
  opts: { mayRelease: boolean } = { mayRelease: true },
): Promise<string | null> {
  if (plan.action === "paid_differs") return paidDiffersMessage(plan.invoice, pricePennies);
  if (pricePennies) {
    // A price newly on the item is billed and, if it hasn't started, held —
    // like booking it priced. A replaced invoice keeps the hold as it was.
    const billed = await billItem(target, { hold: plan.action !== "replace" });
    return billed.ok ? null : invoiceFailedMessage(billed.error);
  }
  // No price now: nothing is owed, so nothing stays held for it.
  if (opts.mayRelease) {
    const released = await releaseHold(target);
    if (!released.ok) return `Saved, but it's still marked as waiting for payment — ${released.error}`;
  }
  return null;
}

/** Where a save lands: `?saved=1`, or the message the billing step left. */
const savedOr = (back: string, message: string | null) =>
  message ? `${back}?error=${encodeURIComponent(message)}` : `${back}?saved=1`;

/**
 * Featured Member: a placements row directly (no featured_machines lookup —
 * unlike saveMachinePlacement, there is no separate "is this published" gate
 * here, since the member picker only lists active members).
 *
 * Cap enforcement is an app-level count check, not a DB exclusion constraint.
 * Unlike takeover (exactly one concurrent row, expressible as a GiST
 * exclusion — placements_takeover_no_overlap), Featured Member allows up to
 * FEATURED_SLOTS.cap concurrently, which a two-row exclusion cannot express.
 * This has a benign TOCTOU race between the count and the insert; acceptable
 * because Jas is the sole console user booking this today.
 */
export async function saveFeaturedMemberPlacement(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  // Present when editing an existing slot (fix-list 76) — there used to be no
  // way to change one once booked.
  const id = String(formData.get("id") ?? "");
  const memberId = String(formData.get("member_id"));
  const startsOn = String(formData.get("starts_on"));
  const endsOn = String(formData.get("ends_on"));
  const back = id ? `/console/adverts/featured-member/${id}` : "/console/adverts/featured-member";
  const price = penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") redirect(`${back}?error=${encodeURIComponent(priceError("400"))}`);
  // As the takeover editor: a slot deleted under an open edit page is said so,
  // not "saved" — the update below would match nothing and report no error.
  let plan: Reprice = { action: "keep" };
  if (id) {
    const { data: slot } = await db.from("placements").select("id").eq("id", id).eq("kind", "featured_member").maybeSingle();
    if (!slot) redirect(`/console/adverts/featured-member?error=${encodeURIComponent("That Featured Member slot no longer exists.")}`);
    // A paid slot can't change hands; an unpaid one that changes member or
    // price gets a fresh invoice (item-billing repricePlan).
    plan = await rebillBeforeSave({ placement_id: id }, { memberId, pricePennies: price }, back);
  }

  let overlapping = db
    .from("placements")
    .select("id", { count: "exact", head: true })
    .eq("kind", "featured_member")
    .lte("starts_on", endsOn)
    .gte("ends_on", startsOn); // overlap test: any existing row whose term intersects the requested one
  // An edit must not count the slot against itself, or a full month could
  // never have one of its own slots moved by a day.
  if (id) overlapping = overlapping.neq("id", id);
  const { count } = await overlapping;

  if ((count ?? 0) >= FEATURED_SLOTS.cap) {
    redirect(`${back}?error=${encodeURIComponent(
      `Featured Member is full for those dates — max ${FEATURED_SLOTS.cap} at once.`,
    )}`);
  }

  // Last check passed: the old member's (or old price's) unpaid invoice stops
  // being payable before the slot changes, so its pay link can't release the
  // new terms.
  if (id) await voidBeforeSave({ placement_id: id }, plan, back);

  const values = { member_id: memberId, starts_on: startsOn, ends_on: endsOn, price_pennies: price };
  const { data: saved, error } = id
    ? await db.from("placements").update(values).eq("id", id).eq("kind", "featured_member").select("id").maybeSingle()
    : await db.from("placements").insert({ kind: "featured_member", ...values, awaiting_payment: holdsForPayment(price) }).select("id").single();
  if (error) redirect(`${back}?error=${encodeURIComponent(dbProblem("action:saveFeaturedMemberPlacement", error))}`);
  if (id && !saved) redirect(`/console/adverts/featured-member?error=${encodeURIComponent("That Featured Member slot no longer exists.")}`);

  // A new slot: its invoice (with the pay link, when it's held for it). A
  // failure is said on the slot's own page, where Raise invoice is.
  let message: string | null = null;
  if (!id && saved && price) {
    const invoice = await invoiceAdvertising(memberId, price, { placement_id: saved.id, description: `Featured Member slot (${startsOn} to ${endsOn})` });
    if (invoice && !invoice.ok) message = invoiceFailedMessage(invoice.error);
  }
  if (id) message = await rebillAfterSave({ placement_id: id }, plan, price);

  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/featured-member");
  if (id) revalidatePath(back);
  revalidatePath("/console");
  revalidatePath("/");
  redirect(savedOr(message && !id && saved ? `/console/adverts/featured-member/${saved.id}` : back, message));
}

const FEATURED_EVENT_LIST = "/console/adverts/featured-event";
const FEATURED_EVENT_CLASH = "Another event is already featured for those dates — only one can run at a time.";

/** Everything that shows the homepage's top event card or a list of its bookings. */
function revalidateFeaturedEvent(back?: string) {
  revalidatePath("/console/adverts");
  revalidatePath(FEATURED_EVENT_LIST);
  if (back) revalidatePath(back);
  revalidatePath("/console/events");
  revalidatePath("/console");
  revalidatePath("/");
}

/**
 * Featured Event (HUMAN-TODO 4.4): the homepage's top event card, booked by
 * date like Featured Member, but ONE at a time — the
 * placements_featured_event_no_overlap constraint is the guard, and the count
 * below only turns its rejection into a sentence before any invoice is
 * touched (as the takeover does).
 *
 * Billed to the event's own member: member_id is copied from the event so
 * invoicing and rebilling run unchanged. An event with no member can still be
 * featured, but only unpriced — there is no one to invoice.
 */
export async function saveFeaturedEventPlacement(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "");
  const back = id ? `${FEATURED_EVENT_LIST}/${id}` : FEATURED_EVENT_LIST;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  const price = penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") return fail(priceError("100"));
  if (!startsOn || !endsOn) return fail("Pick a start and an end date.");
  if (endsOn < startsOn) return fail("The end date is before the start date.");

  const { data: event } = UUID_RE.test(eventId)
    ? await db.from("events").select("id, title, status, starts_on, ends_on, member_id").eq("id", eventId).maybeSingle()
    : { data: null };
  if (!event) return fail("Pick an event to feature.");
  if (event.status !== "published") return fail(`“${event.title}” isn't published, so it can't be featured.`);
  const lastDay = eventLastDay(event);
  if (endsOn > lastDay) return fail(`“${event.title}” is over on ${lastDay} — end the booking on or before that day.`);
  if (price && !event.member_id) return fail("This event has no member to invoice — book it unpriced, or link a member to the event first.");
  const memberId = event.member_id;

  let plan: Reprice = { action: "keep" };
  if (id) {
    const { data: slot } = await db.from("placements").select("id").eq("id", id).eq("kind", "featured_event").maybeSingle();
    if (!slot) redirect(`${FEATURED_EVENT_LIST}?error=${encodeURIComponent("That Featured Event booking no longer exists.")}`);
    plan = await rebillBeforeSave({ placement_id: id }, { memberId, pricePennies: price }, back);
  }

  let clash = db.from("placements").select("id", { count: "exact", head: true })
    .eq("kind", "featured_event").lte("starts_on", endsOn).gte("ends_on", startsOn);
  if (id) clash = clash.neq("id", id);
  const { count } = await clash;
  if (count) return fail(FEATURED_EVENT_CLASH);

  if (id) await voidBeforeSave({ placement_id: id }, plan, back);

  const values = { event_id: event.id, member_id: memberId, starts_on: startsOn, ends_on: endsOn, price_pennies: price };
  const { data: saved, error } = id
    ? await db.from("placements").update(values).eq("id", id).eq("kind", "featured_event").select("id").maybeSingle()
    : await db.from("placements").insert({ kind: "featured_event", ...values, awaiting_payment: holdsForPayment(price) }).select("id").single();
  if (error) {
    return fail(error.message.includes("placements_featured_event_no_overlap")
      ? FEATURED_EVENT_CLASH
      : dbProblem("action:saveFeaturedEventPlacement", error));
  }
  if (id && !saved) redirect(`${FEATURED_EVENT_LIST}?error=${encodeURIComponent("That Featured Event booking no longer exists.")}`);

  let message: string | null = null;
  if (!id && saved && price && memberId) {
    const invoice = await invoiceAdvertising(memberId, price, { placement_id: saved.id, description: `Featured Event (${startsOn} to ${endsOn})` });
    if (invoice && !invoice.ok) message = invoiceFailedMessage(invoice.error);
  }
  if (id) message = await rebillAfterSave({ placement_id: id }, plan, price);

  revalidateFeaturedEvent(id ? back : undefined);
  redirect(savedOr(message && !id && saved ? `${FEATURED_EVENT_LIST}/${saved.id}` : back, message));
}

/**
 * The backup event: what the homepage's top card shows on any day nothing is
 * booked (queries.ts featuredEvent()). A settings row, not a placement — it
 * has no term and no price. An empty event_id unpins it, and the card then
 * falls back to the next upcoming event.
 */
export async function setFeaturedEventBackup(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const eventId = String(formData.get("event_id") ?? "");
  const fail = (message: string): never => redirect(`${FEATURED_EVENT_LIST}?error=${encodeURIComponent(message)}`);
  if (eventId) {
    const { data: event } = UUID_RE.test(eventId)
      ? await db.from("events").select("id, title, status").eq("id", eventId).maybeSingle()
      : { data: null };
    if (!event) return fail("Pick an event to pin as the backup.");
    if (event.status !== "published") return fail(`“${event.title}” isn't published, so it can't be the backup.`);
  }
  const { error } = eventId
    ? await db.from("settings").upsert({ key: FEATURED_EVENT_BACKUP_KEY, value: { event_id: eventId } })
    : await db.from("settings").delete().eq("key", FEATURED_EVENT_BACKUP_KEY);
  if (error) return fail(dbProblem("action:setFeaturedEventBackup", error));
  revalidateFeaturedEvent();
  redirect(`${FEATURED_EVENT_LIST}?${eventId ? "pinned" : "unpinned"}=1`);
}

/* ---------- adverts ---------- */

/** What an advert invoice says it is for — shown to the member and on Stripe's receipt. */
function runDescription(name: string | null | undefined, startsOn: string, endsOn: string): string {
  return `Advert: ${name ?? "advert run"} (${startsOn} to ${endsOn})`;
}

/**
 * An admin booking an advert is selling it, which is also approving it — there
 * is nobody else to ask. So it lands 'scheduled' with the approval stamped,
 * rather than sitting in a queue waiting for the person who just created it.
 */
export async function saveBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const now = new Date().toISOString();
  const price = penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") {
    redirect(`/console/adverts?error=${encodeURIComponent(priceError("650 or 650.00"))}`);
  }
  const startsOn = String(formData.get("starts_on"));
  const endsOn = String(formData.get("ends_on"));
  const { data: created, error } = await db.from("advert_bookings").insert({
    advert_id: String(formData.get("advert_id")),
    starts_on: startsOn,
    ends_on: endsOn,
    notes: String(formData.get("notes") ?? "") || null,
    price_pennies: price,
    bundle_id: String(formData.get("bundle_id") ?? "") || null,
    // A priced run waits for the member to pay before it can show (6 Oct).
    status: holdsForPayment(price) ? "awaiting_payment" : "scheduled",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    approved_by: user.userId,
    approved_at: now,
  }).select("id, advert:adverts(member_id, name)").single();
  // The overlap exclusion constraint is the likely rejection here: the same
  // artwork already has a run covering these dates.
  if (error) {
    redirect(`/console/adverts?error=${encodeURIComponent(
      error.message.includes("advert_bookings_no_overlap")
        ? "That advert already has a run covering those dates."
        : dbProblem("action:saveBooking", error),
    )}`);
  }
  // Invoice off the price agreed for this run (fix-list 77 — it used to come
  // off a rate-card product), with a pay link when the run is held for it.
  // Blank means unpriced: Jas invoices by hand.
  if (price && created?.advert?.member_id) {
    const invoice = await invoiceAdvertising(created.advert.member_id, price, {
      advert_booking_id: created.id,
      description: runDescription(created.advert.name, startsOn, endsOn),
    });
    // The run is written (and held, if priced) either way; without its
    // invoice it has no pay link, so say so where Raise invoice is.
    if (invoice && !invoice.ok) {
      revalidatePath("/console/adverts");
      redirect(`/console/adverts/${created.id}?error=${encodeURIComponent(invoiceFailedMessage(invoice.error))}`);
    }
  }
  revalidatePath("/console/adverts");
  // A booking that worked used to look exactly like one that was rejected —
  // the page re-rendered unchanged either way. The failure path above has
  // redirected with ?error= for a while; this is its other half (fix-list 73's
  // convention, applied to the adverts index). Must stay last: redirect throws.
  redirect("/console/adverts?saved=1");
}

/**
 * Ending a run early. Never touches the dates.
 *
 * This used to write ends_on = yesterday, which destroyed the term needed for
 * invoicing and — for a run starting today — produced ends_on < starts_on,
 * violating the table's own check constraint. The error was discarded, so the
 * button appeared to work while the advert kept running.
 *
 * The status is what stops it now: terminal beats dates in the render
 * predicate, so it comes down immediately. `.in(...)` makes it idempotent —
 * a double submit cannot re-end an ended run.
 */
export async function endBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, status, ends_on, bundle_id, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  // a run still held for payment can be called off too (6 Oct)
  if (!booking || !["awaiting_payment", "scheduled", "live"].includes(booking.status)) return;

  const now = new Date().toISOString();
  const { data: ended } = await db
    .from("advert_bookings")
    .update({
      status: "ended",
      ended_at: now,
      ended_by: user.userId,
      ended_reason: "ended_early",
      ended_note: String(formData.get("note") ?? "") || null,
      // stamped so the nightly sweep does not also send a renew prompt
      ended_notified_for: booking.ends_on,
      updated_at: now,
    })
    .eq("id", id)
    // Conditional on the status just read, so what the run was before is
    // known for certain below — and a double submit can't re-end it.
    .eq("status", booking.status)
    .select("id");

  // Calling off a HELD run cancels its bill: nothing ran, nothing is owed. A
  // scheduled or live run's invoice stands — with payments off that's the
  // bill Jas collects by hand for a run that did go out, and with payments on
  // a scheduled run's invoice is already paid. voidInvoices() also expires an
  // open Stripe checkout, so a pay page left open stops taking money.
  let problem: string | null = null;
  if (ended?.length && booking.status === "awaiting_payment") {
    const voided = await voidInvoices({ advert_booking_id: id });
    if (!voided.ok) {
      logError({ source: "db", area: "action:endBooking", error: voided.error, context: { booking_id: id } });
      problem = "The run is called off, but its invoice couldn't be cancelled — the member can still pay it. Cancel the invoice by hand, or try again.";
    }
    else if (voided.paying.length) problem = "The run is called off, but the member was paying its invoice at that moment — check whether the payment went through before telling them anything.";
  }
  // A bundle has one invoice for all its parts: it stops being payable once
  // the last held part is called off, never before (voidBundleInvoiceIfAbandoned).
  if (ended?.length && booking.status === "awaiting_payment" && booking.bundle_id) {
    const bundle = await voidBundleInvoiceIfAbandoned(booking.bundle_id);
    if (!bundle.ok) {
      logError({ source: "db", area: "action:endBooking", error: bundle.error, context: { bundle_id: booking.bundle_id } });
      problem = "The run is called off, but the bundle's invoice couldn't be checked — look at the bundle before anything else.";
    }
    else if (bundle.paying) problem = "The run is called off, but the member was paying the bundle's invoice at that moment — check whether the payment went through.";
  }
  if (ended?.length && booking.advert?.member_id) {
    await enqueue("notify_member", { member_id: booking.advert.member_id, kind: "advert_ended", booking_id: id });
  }
  revalidatePath("/console/adverts");
  revalidatePath(`/console/adverts/${id}`);
  if (booking.bundle_id) revalidatePath(`/console/adverts/bundles/${booking.bundle_id}`);
  revalidatePath("/");
  if (problem) redirect(`/console/adverts/${id}?error=${encodeURIComponent(problem)}`);
}

/* ---------- bundles ---------- */

export async function saveBundle(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const member_id = String(formData.get("member_id"));
  const name = String(formData.get("name") ?? "").trim();
  const back = id ? `/console/adverts/bundles/${id}` : "/console/adverts/bundles";
  // Editing a bundle looked broken (fix-list 76): a save returned without a
  // redirect, so the page re-rendered unchanged whether it worked or not, and
  // these two failure paths were bare returns. Same fix-list 73 convention now.
  if (!member_id || !name) {
    redirect(`${back}?error=${encodeURIComponent("A bundle needs a member and a name.")}`);
  }
  const price_pennies = penniesFromPounds(formData.get("price_pounds"));
  if (price_pennies === "invalid") {
    redirect(`${back}?error=${encodeURIComponent(priceError("1200"))}`);
  }
  const values = {
    member_id,
    name,
    price_pennies,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (id) {
    // The bundle's one invoice follows its price and member, as a slot's does
    // (item-billing): a price added after parts were booked is billed now —
    // parts that haven't started are held for it — and an unpaid invoice at
    // the old terms is replaced rather than left payable.
    const plan = await rebillBeforeSave({ bundle_id: id }, { memberId: member_id, pricePennies: price_pennies }, back);
    await voidBeforeSave({ bundle_id: id }, plan, back);
    const { error } = await db.from("bundles").update(values).eq("id", id);
    if (error) redirect(`${back}?error=${encodeURIComponent(dbProblem("action:saveBundle", error))}`);
    const message = await rebillAfterSave({ bundle_id: id }, plan, price_pennies);
    revalidatePath("/console/adverts");
    revalidatePath("/console/adverts/bundles");
    revalidatePath(back);
    revalidatePath("/");
    redirect(savedOr(back, message));
  }
  const { data, error } = await db.from("bundles").insert(values).select("id").single();
  if (error || !data) redirect(`${back}?error=${encodeURIComponent(error ? dbProblem("action:saveBundle", error) : "The bundle could not be created.")}`);
  revalidatePath("/console/adverts/bundles");
  redirect(`/console/adverts/bundles/${data.id}`);
}

/**
 * Book several existing pieces of artwork under one bundle_id in one atomic
 * insert, so an overlap on one part fails the whole batch rather than leaving
 * a half-booked bundle. Also invoices off the bundle's price if it has one —
 * never touches src/lib/adverts.ts, bundle_id/price are display/pricing-only
 * (the neutrality rule: no weight/priority/bid input may ever reach rotation).
 */
export async function saveBundleBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const bundleId = String(formData.get("bundle_id"));
  const advertIds = formData.getAll("advert_ids").map(String);
  const startsOn = String(formData.get("starts_on"));
  const endsOn = String(formData.get("ends_on"));
  if (!advertIds.length) {
    redirect(`/console/adverts/bundles/${bundleId}?error=${encodeURIComponent("Pick at least one piece of artwork.")}`);
  }

  const { data: bundle } = await db.from("bundles").select("member_id, name, price_pennies").eq("id", bundleId).single();
  // Held while the bundle is priced and not yet paid for — a paid bundle's
  // later parts run on that payment. The invoice itself is raised (or found)
  // after the insert: ensureInvoice() is idempotent and the database allows
  // one issued invoice per bundle, so two batches booked at once — or a bundle
  // priced after its first parts — still end up with exactly one invoice.
  let held = false;
  if (holdsForPayment(bundle?.price_pennies)) {
    const { data: paid } = await db.from("invoices").select("id").eq("bundle_id", bundleId).eq("status", "paid").limit(1);
    held = !paid?.length;
  }
  const now = new Date().toISOString();
  const { error } = await db.from("advert_bookings").insert(advertIds.map((advert_id) => ({
    advert_id,
    bundle_id: bundleId,
    starts_on: startsOn,
    ends_on: endsOn,
    status: held ? "awaiting_payment" : "scheduled",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    approved_by: user.userId,
    approved_at: now,
  })));
  if (error) {
    redirect(`/console/adverts/bundles/${bundleId}?error=${encodeURIComponent(
      error.message.includes("advert_bookings_no_overlap")
        ? "One of these pieces already has a run covering those dates — the whole batch was not booked."
        : dbProblem("action:saveBundleBooking", error),
    )}`);
  }
  // Raises the bundle's invoice the first time it has parts and a price, and
  // returns the existing one every time after — never a second.
  const billed = await billItem({ bundle_id: bundleId }, { hold: true });
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/bundles");
  revalidatePath(`/console/adverts/bundles/${bundleId}`);
  revalidatePath("/");
  if (!billed.ok) redirect(`/console/adverts/bundles/${bundleId}?error=${encodeURIComponent(invoiceFailedMessage(billed.error))}`);
}

/** Approve a member-submitted run, or send it back with a reason they can read. */
export async function decideAdvertBooking(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  const db = serviceDb();
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, status, starts_on, ends_on, price_pennies, advert:adverts(member_id, name)")
    .eq("id", id)
    .single();
  // same idempotency guard as decideStory/decideVideo/decideEvent
  if (!booking || booking.status !== "awaiting_approval") return;
  // the DB enforces this too; catching it here keeps the redirect friendly
  if (decision !== "approve" && !reason) {
    redirect(`/console/adverts/${id}?error=${encodeURIComponent("Give the member a reason for the change.")}`);
  }
  // A member's own request arrives unpriced, so approving is where Jas sets the
  // price (fix-list 77 — it used to come off a rate-card product). The approve
  // form prefills it; a POST without the field keeps whatever is stored.
  const price = formData.has("price_pounds") ? penniesFromPounds(formData.get("price_pounds")) : booking.price_pennies;
  if (price === "invalid") {
    redirect(`/console/adverts/${id}?error=${encodeURIComponent(priceError("650 or 650.00"))}`);
  }

  const now = new Date().toISOString();
  const memberId = booking.advert?.member_id;
  const held = holdsForPayment(price);
  // Every write below is conditional on the run still awaiting approval, and
  // reads back what it changed. The guard above is only a read: a
  // double-clicked Approve (or two tabs) passed it twice and raised two
  // payable invoices and two pay-link emails. Now the second click changes
  // nothing and stops — no invoice, no email, no second audit row.
  let decided: { id: string }[] | null = null;
  let invoiceError: string | null = null;
  if (decision === "approve") {
    const { data, error } = await db.from("advert_bookings")
      // Priced → held until paid (6 Oct); the approval itself is stamped either way.
      .update({ status: held ? "awaiting_payment" : "scheduled", price_pennies: price, approved_by: user.userId, approved_at: now, review_reason: null, updated_at: now })
      .eq("id", id)
      .eq("status", "awaiting_approval")
      .select("id");
    decided = data;
    // The overlap exclusion constraint is the likely rejection here: another
    // booking on the same advert already covers these dates. Without this
    // check the code below would write an "approved" audit row and tell the
    // member their advert is scheduled while the booking is still stuck
    // awaiting_approval — a false record on top of a silent no-op.
    if (error) {
      redirect(`/console/adverts/${id}?error=${encodeURIComponent(
        error.message.includes("advert_bookings_no_overlap")
          ? "That advert already has a run covering those dates."
          : dbProblem("action:decideAdvertBooking", error),
      )}`);
    }
    if (!decided?.length) return;
    if (memberId && price) {
      // A held run's member gets "approved — payment due" with the pay link
      // from here, instead of "approved and scheduled", which it isn't yet.
      const invoice = await invoiceAdvertising(memberId, price, {
        advert_booking_id: id,
        description: runDescription(booking.advert?.name, booking.starts_on, booking.ends_on),
      });
      if (invoice && !invoice.ok) invoiceError = invoiceFailedMessage(invoice.error);
    }
    if (memberId && !held) await enqueue("notify_member", { member_id: memberId, kind: "advert_scheduled", booking_id: id });
  } else {
    const { data, error } = await db.from("advert_bookings")
      .update({ status: "review_required", review_reason: reason, updated_at: now })
      .eq("id", id)
      .eq("status", "awaiting_approval")
      .select("id");
    if (error) redirect(`/console/adverts/${id}?error=${encodeURIComponent(dbProblem("action:decideAdvertBooking", error))}`);
    decided = data;
    if (!decided?.length) return;
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_changes_needed", booking_id: id, reason });
  }
  await db.from("approvals").insert({
    kind: "advert_booking",
    subject_id: id,
    decision: decision === "approve" ? "approved" : "rejected",
    reason: reason || null,
    decided_by: user.userId,
  });
  revalidatePath("/console");
  revalidatePath("/console/adverts");
  revalidatePath(`/console/adverts/${id}`);
  revalidatePath("/");
  // Approved either way; without its invoice the held run has no pay link.
  if (invoiceError) redirect(`/console/adverts/${id}?error=${encodeURIComponent(invoiceError)}`);
}

/**
 * Rebook an ended run: same artwork, new dates. A fresh draft rather than a
 * reopened booking, so the finished run keeps its own record for invoicing.
 */
export async function renewBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: prev } = await db
    .from("advert_bookings")
    .select("advert_id, price_pennies, bundle_id, notes")
    .eq("id", id)
    .single();
  if (!prev) return;
  const { data: created, error } = await db.from("advert_bookings").insert({
    advert_id: prev.advert_id,
    // the last run's price as a starting point; approval can change it. Not
    // for a bundle part: the bundle is invoiced once, as a whole, so a part's
    // own price would bill it twice (20261016000033 un-priced the existing ones).
    price_pennies: prev.bundle_id ? null : prev.price_pennies,
    bundle_id: prev.bundle_id,
    notes: prev.notes,
    // dates are the point of a renewal, so they are filled in on the draft
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    status: "draft",
    source: "admin",
    renewed_from: id,
    submitted_by: user.userId,
  }).select("id").single();
  // Previously silent: an admin picking an invalid date range (e.g. ends_on
  // before starts_on) got no feedback and the page just re-rendered as if
  // nothing had been clicked.
  if (error) redirect(`/console/adverts/${id}?error=${encodeURIComponent(dbProblem("action:renewBooking", error, "The renewal couldn't be created — check the dates (the end can't be before the start) and try again."))}`);
  revalidatePath("/console/adverts");
  if (created) redirect(`/console/adverts/${created.id}`);
}

/**
 * Book the draft renewBooking left. The renewal is a draft so Jas can check it
 * first, but nothing ever moved one on: the booking page offered no action for
 * a draft, so a console rebook stopped there for good. This is the "book it"
 * that follows, with the outcome saveBooking gives a run booked from scratch —
 * an admin booking is its own approval, so it lands scheduled (held for
 * payment when priced) with the approval stamped, and is invoiced off the
 * price confirmed here.
 *
 * A bundle part takes no price of its own (renewBooking, 20261016000033): it is
 * billed through its bundle exactly as saveBundleBooking bills a batch — held
 * while the bundle is priced and unpaid, and run on the bundle's payment once
 * that is in.
 *
 * Only an admin's draft: a member's own is theirs to send. Conditional on it
 * still being a draft, so a double click books it once and invoices it once.
 */
/**
 * GAPS A2.12: a desk rebook draft (renewBooking) could be booked but not
 * changed or thrown away. Only that kind of draft: `source = 'admin'` and still
 * `draft`. A member's own draft is theirs, and the member may also submit the
 * desk's (Luiza, 22 Oct: it's an offer), after which it has moved on and these
 * refuse rather than overwrite what they sent.
 */
const DRAFT_MOVED_ON = "This draft has moved on (it was booked or sent in), so it can't be changed here any more.";

export async function updateDraftDates(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const back = `/console/adverts/${id}`;
  const startsOn = String(formData.get("starts_on") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "");
  // A draft holds no dates, so there's no overlap to check here; booking it does that.
  const problem = renewalDatesProblem(startsOn, endsOn, new Date().toISOString().slice(0, 10));
  if (problem) redirect(`${back}?error=${encodeURIComponent(problem)}`);
  const { data: changed, error } = await db.from("advert_bookings")
    .update({ starts_on: startsOn, ends_on: endsOn, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .eq("source", "admin")
    .select("id");
  if (error) redirect(`${back}?error=${encodeURIComponent(dbProblem("action:updateDraftDates", error))}`);
  if (!changed?.length) redirect(`${back}?error=${encodeURIComponent(DRAFT_MOVED_ON)}`);
  revalidatePath("/console/adverts");
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function deleteDraftBooking(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const back = `/console/adverts/${id}`;
  if (formData.get("confirm") !== "1") redirect(`${back}?error=${encodeURIComponent("Tick \"confirm\" to delete this draft.")}`);
  // Safe to remove outright: a draft raises no invoice and reserves no dates,
  // and what points at a booking (invoices, a later renewal) is `on delete set null`.
  const { data: deleted, error } = await db.from("advert_bookings")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .eq("source", "admin")
    .select("id");
  if (error) redirect(`${back}?error=${encodeURIComponent(dbProblem("action:deleteDraftBooking", error))}`);
  if (!deleted?.length) redirect(`${back}?error=${encodeURIComponent(DRAFT_MOVED_ON)}`);
  revalidatePath("/console/adverts");
  revalidatePath("/console");
  redirect("/console/adverts?deleted=1");
}

export async function bookDraftRun(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const back = `/console/adverts/${id}`;
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, status, source, starts_on, ends_on, bundle_id, advert:adverts(member_id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!booking || booking.status !== "draft" || booking.source !== "admin") return;
  const price = booking.bundle_id ? null : penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") redirect(`${back}?error=${encodeURIComponent(priceError("650 or 650.00"))}`);

  let held = holdsForPayment(price);
  if (booking.bundle_id) {
    const { data: bundle } = await db.from("bundles").select("price_pennies").eq("id", booking.bundle_id).maybeSingle();
    if (holdsForPayment(bundle?.price_pennies)) {
      const { data: paid } = await db.from("invoices").select("id").eq("bundle_id", booking.bundle_id).eq("status", "paid").limit(1);
      held = !paid?.length;
    }
  }

  const now = new Date().toISOString();
  const { data: booked, error } = await db.from("advert_bookings")
    .update({ status: held ? "awaiting_payment" : "scheduled", price_pennies: price, submitted_at: now, approved_by: user.userId, approved_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  // A draft reserves no dates, so this is where the overlap constraint can
  // first refuse it: the artwork was booked for those dates in the meantime.
  if (error) {
    redirect(`${back}?error=${encodeURIComponent(
      error.message.includes("advert_bookings_no_overlap")
        ? "That advert already has a run covering those dates."
        : dbProblem("action:bookDraftRun", error),
    )}`);
  }
  if (!booked?.length) return;

  let message: string | null = null;
  if (booking.bundle_id) {
    const billed = await billItem({ bundle_id: booking.bundle_id }, { hold: true });
    if (!billed.ok) message = invoiceFailedMessage(billed.error);
  } else if (price && booking.advert?.member_id) {
    const invoice = await invoiceAdvertising(booking.advert.member_id, price, {
      advert_booking_id: id,
      description: runDescription(booking.advert.name, booking.starts_on, booking.ends_on),
    });
    if (invoice && !invoice.ok) message = invoiceFailedMessage(invoice.error);
  }
  revalidatePath("/console");
  revalidatePath("/console/adverts");
  revalidatePath(back);
  if (booking.bundle_id) revalidatePath(`/console/adverts/bundles/${booking.bundle_id}`);
  revalidatePath("/");
  redirect(savedOr(back, message));
}

/** The artwork itself — name, format, link and the two images. */
export async function saveAdvertArtwork(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const name = String(formData.get("name") ?? "").trim();
  const member_id = String(formData.get("member_id") ?? "");
  const format = String(formData.get("format") ?? "");
  if (!name || !member_id || !format) return;
  // Before the upload, so a bad link doesn't leave orphaned artwork behind.
  const link = advertLinkFromForm(formData);
  if ("error" in link) redirect(`/console/adverts/artwork/${id || "new"}?error=${encodeURIComponent(link.error)}`);
  // Gap review area 5: a sponsored story carries its own words. Kept on any
  // format, so correcting a mis-set format doesn't lose them.
  const headline = String(formData.get("headline") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim() || null;
  const sponsoredStory = format === "sponsored_story";
  if (sponsoredStory && (!headline || !body)) {
    redirect(`/console/adverts/artwork/${id || "new"}?error=${encodeURIComponent("A sponsored story needs a headline and its text.")}`);
  }

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    // "panels" not "adverts": the public bucket path is in the URL, and
    // /adverts/ is an ad-blocker filename heuristic — see visit/[id]/route.ts.
    desktop_path = await uploadImage(await submittedFile(formData, "desktop", CONSOLE_UPLOADS), "panels");
    mobile_path = await uploadImage(await submittedFile(formData, "mobile", CONSOLE_UPLOADS), "panels");
  } catch (e) {
    redirect(`/console/adverts/artwork/${id || "new"}?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveAdvertArtwork"))}`);
  }

  const values = {
    name,
    member_id,
    format,
    link_url: link.url,
    headline,
    body,
    updated_at: new Date().toISOString(),
    ...(desktop_path ? { desktop_path } : {}),
    ...(mobile_path ? { mobile_path } : {}),
  };

  if (id) {
    await db.from("adverts").update(values).eq("id", id);
  } else {
    // A sponsored story has one image (600×400). Both columns are NOT NULL,
    // so it fills the mobile one too; removeMedia tolerates the shared path.
    if (sponsoredStory && desktop_path && !mobile_path) mobile_path = desktop_path;
    // both images are NOT NULL, so a new advert cannot be created without them
    if (!desktop_path || !mobile_path) {
      // the one that did upload has nothing to belong to
      await removeMedia(desktop_path);
      await removeMedia(mobile_path);
      redirect(`/console/adverts/artwork/new?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
    }
    await db.from("adverts").insert({ ...values, desktop_path, mobile_path });
  }
  revalidatePath("/console/adverts/artwork");
  redirect("/console/adverts/artwork");
}

/**
 * Admin proposing a swap on a member's behalf: fulfilling it, same reasoning
 * saveBooking already applies to bookings — there is nobody else to ask, so it
 * applies immediately. Recorded already-'approved' so the audit trail (and the
 * member-facing history) shows the same shape whoever raised it.
 */
export async function proposeArtworkSwap(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const advertId = String(formData.get("advert_id"));
  const bookingId = String(formData.get("booking_id") ?? "") || null;
  const back = bookingId ? `/console/adverts/${bookingId}` : `/console/adverts/artwork/${advertId}`;

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(await submittedFile(formData, "desktop", CONSOLE_UPLOADS), "panels");
    mobile_path = await uploadImage(await submittedFile(formData, "mobile", CONSOLE_UPLOADS), "panels");
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent(uploadFailureMessage(e, "action:proposeArtworkSwap"))}`);
  }
  if (!desktop_path || !mobile_path) {
    redirect(`${back}?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
  }

  const now = new Date().toISOString();
  await db.from("adverts").update({ desktop_path, mobile_path, updated_at: now }).eq("id", advertId);
  const { data: proposal } = await db.from("advert_artwork_proposals").insert({
    advert_id: advertId,
    desktop_path,
    mobile_path,
    status: "approved",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    decided_by: user.userId,
    decided_at: now,
  }).select("id").single();
  if (proposal) {
    await db.from("approvals").insert({ kind: "advert_artwork", subject_id: proposal.id, decision: "approved", decided_by: user.userId });
  }
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/artwork");
  redirect(bookingId ? back : "/console/adverts/artwork");
}

/** Approve a member-proposed swap, or send it back with a reason they can read. */
export async function decideArtworkSwap(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  const db = serviceDb();
  const { data: proposal } = await db
    .from("advert_artwork_proposals")
    .select("id, advert_id, desktop_path, mobile_path, status, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!proposal || proposal.status !== "pending") return;
  if (decision !== "approve" && !reason) {
    redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent("Give the member a reason for the change.")}`);
  }

  const now = new Date().toISOString();
  const memberId = proposal.advert?.member_id;
  if (decision === "approve") {
    // the live image only changes here, at approval — never at submission
    const { error: artworkError } = await db.from("adverts")
      .update({ desktop_path: proposal.desktop_path, mobile_path: proposal.mobile_path, updated_at: now })
      .eq("id", proposal.advert_id);
    if (artworkError) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(dbProblem("action:decideArtworkSwap", artworkError))}`);
    const { error } = await db.from("advert_artwork_proposals")
      .update({ status: "approved", decided_by: user.userId, decided_at: now, updated_at: now })
      .eq("id", id);
    if (error) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(dbProblem("action:decideArtworkSwap", error))}`);
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_artwork_approved", advert_id: proposal.advert_id });
  } else {
    const { error } = await db.from("advert_artwork_proposals")
      .update({ status: "rejected", review_reason: reason, decided_by: user.userId, decided_at: now, updated_at: now })
      .eq("id", id);
    if (error) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(dbProblem("action:decideArtworkSwap", error))}`);
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_artwork_rejected", advert_id: proposal.advert_id, reason });
  }
  await db.from("approvals").insert({
    kind: "advert_artwork",
    subject_id: id,
    decision: decision === "approve" ? "approved" : "rejected",
    reason: reason || null,
    decided_by: user.userId,
  });
  revalidatePath("/console");
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/artwork");
}

/**
 * How many banner spots we sell, sitewide — Jas's number (A13). Shown against
 * bookings, never a rotation input and never a booking gate. A whole number of
 * at least one: zero or a typo must not quietly read as "sold out everywhere".
 */
export async function saveBannerSpots(formData: FormData) {
  await requireConsole();
  const raw = String(formData.get("count") ?? "").trim();
  const count = Number(raw);
  if (!raw || !Number.isInteger(count) || count < 1) {
    redirect(`/console/adverts/banners?error=${encodeURIComponent("Banner spots must be a whole number, 1 or more.")}`);
  }
  const { error } = await serviceDb().from("settings").upsert({ key: BANNER_SPOTS_KEY, value: { count } });
  if (error) redirect(`/console/adverts/banners?error=${encodeURIComponent(dbProblem("action:saveBannerSpots", error))}`);
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/banners");
  redirect("/console/adverts/banners?saved=1");
}

/* ---------- supplier logos and banners ---------- */

/**
 * Supplier logos (fix-list 78) and banners booked in one step: under the hood
 * each is the same two rows as any advert — an `adverts` row and an
 * `advert_bookings` run — but booking one meant making the artwork on one
 * page and the run on another. These do both from one form. `id` is the
 * booking's id when editing.
 *
 * A supplier logo has one image: the logo strip renders the mobile path at
 * 240×120 everywhere, so a second upload would only ever be a copy. A banner
 * has its two real sizes (1280×170 desktop, 370×280 mobile).
 */
type ArtworkRunKind = {
  formats: readonly string[];
  base: string;
  /** "logo" / "banner" — in error copy */
  noun: string;
  /** "supplier logo" / "banner" — the advert's name suffix and the invoice line */
  label: string;
  /** form field → which advert image it fills */
  images: { field: string; desktop: boolean; mobile: boolean }[];
  missingImages: string;
};

const SUPPLIER_LOGO: ArtworkRunKind = {
  formats: ["supplier_logo"],
  base: "/console/adverts/suppliers",
  noun: "logo",
  label: "supplier logo",
  images: [{ field: "logo", desktop: true, mobile: true }],
  missingImages: "Upload the logo.",
};

const BANNER: ArtworkRunKind = {
  // banner_narrow is retired from the pickers but existing runs still edit here
  formats: ["banner", "banner_narrow"],
  base: "/console/adverts/banners",
  noun: "banner",
  label: "banner",
  images: [
    { field: "desktop", desktop: true, mobile: false },
    { field: "mobile", desktop: false, mobile: true },
  ],
  missingImages: "Upload both the desktop and the mobile image.",
};

async function saveArtworkRun(kind: ArtworkRunKind, formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const back = id ? `${kind.base}/${id}` : kind.base;
  const fail = (to: string, message: string): never =>
    redirect(`${to}?error=${encodeURIComponent(
      message.includes("advert_bookings_no_overlap") ? `That ${kind.noun} already has a run covering those dates.` : message,
    )}`);
  const member_id = String(formData.get("member_id") ?? "");
  const starts_on = String(formData.get("starts_on") ?? "");
  const ends_on = String(formData.get("ends_on") ?? "");
  const link = advertLinkFromForm(formData);
  if ("error" in link) return fail(back, link.error);
  const link_url = link.url;
  if (!id && !member_id) return fail(back, `Pick the member the ${kind.noun} belongs to.`);
  if (!starts_on || !ends_on) return fail(back, "A start and an end date are both required.");
  const price = penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") return fail(back, priceError("100"));

  // Everything that can refuse the save is checked before anything is
  // uploaded, so a refusal leaves no orphaned image in storage.
  let existing: { id: string; advert_id: string; bundle_id: string | null } | null = null;
  let member: { name: string } | null = null;
  let plan: Reprice = { action: "keep" };
  if (id) {
    const { data: booking } = await db
      .from("advert_bookings")
      .select("id, advert_id, bundle_id, price_pennies, advert:adverts(format, member_id)")
      .eq("id", id)
      .maybeSingle();
    if (!booking || !kind.formats.includes(booking.advert?.format ?? "")) {
      return fail(kind.base, `That ${kind.label} booking no longer exists.`);
    }
    existing = booking;
    // The run's invoice follows its price (item-billing). A bundle part with
    // no price of its own is billed through the bundle and left alone here.
    if (!booking.bundle_id || booking.price_pennies || price) {
      plan = await rebillBeforeSave({ advert_booking_id: id }, { memberId: booking.advert?.member_id ?? null, pricePennies: price }, back);
      if (plan.action === "replace") {
        // The overlap constraint is the one refusal the date update can still
        // meet — asked first, so it can't strike after the invoice is voided.
        const { count: clash } = await db.from("advert_bookings").select("id", { count: "exact", head: true })
          .eq("advert_id", booking.advert_id).neq("id", id).in("status", ["awaiting_payment", "scheduled", "live"])
          .lte("starts_on", ends_on).gte("ends_on", starts_on);
        if (clash) return fail(back, `That ${kind.noun} already has a run covering those dates.`);
      }
    }
  } else {
    // A new run needs both image slots filled; refuse an empty file input
    // here, before uploading the one that was chosen.
    const chosen = kind.images.filter((img) => hasSubmittedFile(formData, img.field));
    if (!chosen.some((img) => img.desktop) || !chosen.some((img) => img.mobile)) return fail(back, kind.missingImages);
    const { data } = await db.from("members").select("name").eq("id", member_id).maybeSingle();
    if (!data) return fail(back, "That member no longer exists.");
    member = data;
  }

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  const uploaded: string[] = [];
  // Any refusal from here on: drop what this request uploaded, then say why.
  const failClean = async (to: string, message: string): Promise<never> => {
    for (const path of uploaded) await removeMedia(path);
    return fail(to, message);
  };
  try {
    for (const img of kind.images) {
      // "panels" not "adverts" — same ad-blocker reasoning as saveAdvertArtwork.
      const path = await uploadImage(await submittedFile(formData, img.field, CONSOLE_UPLOADS), "panels");
      if (!path) continue;
      uploaded.push(path);
      if (img.desktop) desktop_path = path;
      if (img.mobile) mobile_path = path;
    }
  } catch (e) {
    return failClean(back, uploadFailureMessage(e, "action:saveArtworkRun"));
  }
  const now = new Date().toISOString();

  if (existing) {
    if (plan.action === "replace") {
      const voided = await voidForReprice({ advert_booking_id: id });
      if (!voided.ok) return failClean(back, voided.error);
    }
    // Dates first: they're what can be refused (advert_bookings_no_overlap,
    // ends before starts). Updating the artwork first put new images and a new
    // link live on a save that then reported an error.
    const { error } = await db
      .from("advert_bookings")
      .update({ starts_on, ends_on, price_pennies: price, updated_at: now })
      .eq("id", id);
    // An overlap is Jas's to fix (fail() words it); anything else goes to the log.
    if (error) return failClean(back, error.message.includes("advert_bookings_no_overlap") ? error.message : dbProblem("action:saveArtworkRun", error));
    // The images and link live on the `adverts` row, which every run of this
    // advert shares — a renewal is a new run on the same advert — so this
    // changes them for its other runs too.
    const { error: advertError } = await db
      .from("adverts")
      .update({ link_url, updated_at: now, ...(desktop_path ? { desktop_path } : {}), ...(mobile_path ? { mobile_path } : {}) })
      .eq("id", existing.advert_id);
    if (advertError) {
      return failClean(back, dbProblem("action:saveArtworkRun", advertError, `The dates and price were saved, but the ${kind.noun} and link weren't — save again to retry.`));
    }
    // A bundle part's hold belongs to its bundle, so clearing a price of its
    // own never releases it.
    const message = !existing.bundle_id || plan.action !== "keep" || price
      ? await rebillAfterSave({ advert_booking_id: id }, plan, price, { mayRelease: !existing.bundle_id })
      : null;
    revalidatePath("/console/adverts");
    revalidatePath(kind.base);
    revalidatePath(back);
    revalidatePath("/");
    redirect(savedOr(back, message));
  }

  if (!desktop_path || !mobile_path) return failClean(back, kind.missingImages);
  if (!member) return failClean(back, "That member no longer exists.");
  const name = `${member.name} ${kind.label}`;
  const { data: advert, error: advertError } = await db
    .from("adverts")
    .insert({ member_id, name, format: kind.formats[0], desktop_path, mobile_path, link_url })
    .select("id")
    .single();
  if (advertError || !advert) return failClean(back, advertError ? dbProblem("action:saveArtworkRun", advertError) : `The ${kind.noun} could not be saved.`);
  // Admin-booked, so approved on the spot — same reasoning as saveBooking,
  // and held for payment the same way when priced.
  const { data: booking, error } = await db.from("advert_bookings").insert({
    advert_id: advert.id,
    starts_on,
    ends_on,
    price_pennies: price,
    status: holdsForPayment(price) ? "awaiting_payment" : "scheduled",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    approved_by: user.userId,
    approved_at: now,
  }).select("id").single();
  if (error || !booking) {
    // Don't leave orphan artwork behind a run that was never booked.
    await db.from("adverts").delete().eq("id", advert.id);
    return failClean(back, error?.message.includes("advert_bookings_no_overlap") ? error.message : error ? dbProblem("action:saveArtworkRun", error, "The run could not be booked — try again.") : "The run could not be booked.");
  }
  let message: string | null = null;
  if (price) {
    const invoice = await invoiceAdvertising(member_id, price, {
      advert_booking_id: booking.id,
      description: runDescription(name, starts_on, ends_on),
    });
    if (invoice && !invoice.ok) message = invoiceFailedMessage(invoice.error);
  }
  revalidatePath("/console/adverts");
  revalidatePath(kind.base);
  revalidatePath("/");
  // A failed invoice is said on the run's own page, where Raise invoice is.
  redirect(message ? savedOr(`${kind.base}/${booking.id}`, message) : `${back}?saved=1`);
}

export async function saveSupplierLogo(formData: FormData) {
  return saveArtworkRun(SUPPLIER_LOGO, formData);
}

/** Banners booked in one step, from the Banners page — same shape as supplier logos. */
export async function saveBannerRun(formData: FormData) {
  return saveArtworkRun(BANNER, formData);
}

/* ---------- advert payments ---------- */

/**
 * Jas recording a payment made outside Stripe — a bank transfer, a cheque.
 * Same seam as the webhook (settleInvoice), so it releases exactly what a
 * card payment would and the member gets the same receipt.
 */
export async function markInvoicePaid(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("invoice_id") ?? "");
  // console pages only — a direct POST must not turn this into an open redirect
  const requested = safeInternalPath(String(formData.get("return_to") ?? ""));
  const back = requested?.startsWith("/console/") ? requested : "/console/adverts";
  const sep = back.includes("?") ? "&" : "?";
  if (!UUID_RE.test(id)) redirect(`${back}${sep}error=${encodeURIComponent("That invoice could not be found.")}`);
  if (formData.get("confirm") !== "1") redirect(`${back}${sep}error=${encodeURIComponent("Tick the box to confirm the payment arrived.")}`);
  // settleInvoice throws on a database error (so the webhook can be retried);
  // here there is nobody to retry but Jas, so it's said on the page instead.
  let result: Awaited<ReturnType<typeof settleInvoice>>;
  try {
    result = await settleInvoice(id);
  } catch (e) {
    logError({ source: "db", area: "action:markInvoicePaid", error: e, context: { invoice_id: id } });
    redirect(`${back}${sep}error=${encodeURIComponent("The payment couldn't be recorded — nothing was changed. Try again in a moment.")}`);
  }
  if (!result.settled) {
    const why = {
      paid: "That invoice is already paid — nothing more to record.",
      void: "That invoice was cancelled, so it can't be marked paid. If they paid anyway, raise a new invoice and mark that paid.",
      missing: "That invoice could not be found.",
      amount_mismatch: "That invoice's amount doesn't match the payment, so it wasn't marked paid.",
    }[result.reason];
    redirect(`${back}${sep}error=${encodeURIComponent(why)}`);
  }
  revalidatePath(back.split("?")[0]);
  redirect(`${back}${sep}saved=1`);
}

/**
 * "Raise invoice" (InvoicePanel) for a priced run, bundle or placement with no
 * invoice — the recovery for a booking whose invoice failed, and for one
 * priced while payments were off. Billed exactly as booking it priced would
 * have been (item-billing billItem): idempotent, so a double click raises one
 * invoice and sends one pay link; held for payment if it hasn't started and
 * payments are live; left on the site if it's already running.
 */
export async function raiseItemInvoice(formData: FormData) {
  await requireConsole();
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  const requested = safeInternalPath(String(formData.get("return_to") ?? ""));
  const back = requested?.startsWith("/console/") ? requested.split("?")[0] : "/console/adverts";
  const target: BillTarget | null = !UUID_RE.test(id)
    ? null
    : kind === "booking" ? { advert_booking_id: id }
      : kind === "bundle" ? { bundle_id: id }
        : kind === "placement" ? { placement_id: id }
          : null;
  if (!target) redirect(`${back}?error=${encodeURIComponent("That booking could not be found.")}`);
  const billed = await billItem(target, { hold: true });
  if (!billed.ok) redirect(`${back}?error=${encodeURIComponent(`The invoice couldn't be raised: ${billed.error}`)}`);
  if (!billed.invoice) redirect(`${back}?error=${encodeURIComponent("There's nothing to invoice — it has no price, or it isn't approved yet.")}`);
  revalidatePath(back);
  revalidatePath("/console/adverts");
  revalidatePath("/");
  redirect(`${back}?saved=1`);
}

/** Turn a member's expression of interest into a draft run for Jas to fill in. */
export async function startAdvertFromInterest(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  // Same parser and limits as every other price field: Number() read "1e5" as
  // £100,000 and rounded a third decimal place silently.
  const amount = penniesFromPounds(formData.get("amount_pounds"));
  if (amount === "invalid") redirect(`/console/adverts/interest?error=${encodeURIComponent(priceError("250"))}`);
  const { data: request } = await db
    .from("visibility_requests")
    .select("id, member_id, product")
    .eq("id", id)
    .single();
  if (!request) return;
  await db.from("visibility_requests").update({ status: "confirmed" }).eq("id", id);
  // The member asked for this and was previously told nothing either way (A2.6).
  if (request.member_id) {
    await enqueue("notify_member", { member_id: request.member_id, kind: "visibility_confirmed", request_id: id });
    // visibility_requests has no product_id/rate to invoice off automatically
    // (just a free-text product column) — Jas quotes the amount at confirm time.
    // Payable online from the member's billing page; nothing is held, since
    // there is no run yet to hold.
    if (amount) {
      const invoice = await raiseInvoice(request.member_id, amount, "VIS", { description: `Visibility: ${request.product}` });
      if (!invoice) {
        revalidatePath("/console/adverts/interest");
        redirect(`/console/adverts/interest?error=${encodeURIComponent("Confirmed, but the invoice couldn't be raised — raise it by hand from the member's billing.")}`);
      }
    }
  }
  revalidatePath("/console/adverts/interest");
  // No artwork yet — that is the whole point of the interest route, so this
  // lands on the artwork form with the member prefilled.
  redirect(`/console/adverts/artwork/new?member_id=${request.member_id}&from=interest`);
}

/** The advertising media pack — a PDF readers download from /advertising. */
export async function saveMediaPack(formData: FormData) {
  await requireConsole();
  let path: string | null = null;
  try {
    path = await uploadDocument(await submittedFile(formData, "pack", CONSOLE_UPLOADS), "media-pack");
  } catch (e) {
    redirect(`/console/advertising?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveMediaPack"))}`);
  }
  if (!path) return;
  await serviceDb().from("settings").upsert({ key: "media_pack", value: { path, updated_at: new Date().toISOString() } });
  // The media pack is website content, not inventory, so it now lives under
  // Site Config (fix-list 74). The public /advertising revalidate stays.
  revalidatePath("/console/advertising");
  revalidatePath("/advertising");
}

export async function saveAdvertFormats(formData: FormData) {
  await requireConsole();
  // Validate before the settings read and the uploads — invalid input must
  // touch neither the database nor the bucket (same rule as saveStory's
  // canWrite-before-upload).
  const fields = AD_FORMAT_KEYS.map((key) => ({
    key,
    name: String(formData.get(`name_${key}`) ?? "").trim(),
    detail: String(formData.get(`detail_${key}`) ?? "").trim(),
  }));
  if (fields.some((f) => !f.name || !f.detail)) return;
  const db = serviceDb();
  // Empty file inputs keep the stored example images, so read the current value to merge.
  const { data: existing } = await db.from("settings").select("value").eq("key", "advert_formats").maybeSingle();
  const currentByKey = new Map(((existing?.value as AdFormat[] | null) ?? []).map((f) => [f.key, f]));
  let value: AdFormat[];
  try {
    value = await Promise.all(
      fields.map(async (f): Promise<AdFormat> => {
        const uploaded = await uploadImage(await submittedFile(formData, `example_${f.key}`, CONSOLE_UPLOADS), "advert-formats");
        const example_path = uploaded ?? currentByKey.get(f.key)?.example_path;
        return { ...f, ...(example_path ? { example_path } : {}) };
      }),
    );
  } catch (e) {
    redirect(`/console/advertising?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveAdvertFormats"))}`);
  }
  await db.from("settings").upsert({ key: "advert_formats", value });
  // As above — the A–F cards are the public advertising page's own copy.
  revalidatePath("/console/advertising");
  revalidatePath("/advertising");
}

/* ---------- site-wide homepage design (GAPS A8.2) ---------- */

/**
 * A28: switch what every visitor gets between the two built designs, with no
 * redeploy. Browsers holding their own `smi-theme` cookie (the admin switcher)
 * keep their choice — including the admin saving this, which is why the page
 * says so and offers clearMyVariantOverride.
 */
export async function saveSiteVariant(formData: FormData) {
  await requireConsole();
  const value = formData.get("variant");
  if (!isVariant(value)) redirect(`/console/pages?error=${encodeURIComponent("Choose Forge or Grid.")}`);
  const { error } = await serviceDb().from("settings").upsert({ key: SITE_VARIANT_KEY, value });
  if (error) redirect(`/console/pages?error=${encodeURIComponent(dbProblem("action:saveSiteVariant", error))}`);
  // Every public route renders per request already; this drops any client
  // router cache still holding the old design.
  revalidatePath("/", "layout");
  redirect("/console/pages?saved=variant");
}

/* ---------- feature flags (/console/features) ---------- */

/**
 * Switch one feature flag on or off. One `settings` row per flag
 * (lib/feature-flags.ts), so this never touches any other flag. An unknown
 * flag name is refused rather than written: the registry is the only list of
 * flags that exist.
 */
export async function saveFeatureFlag(formData: FormData) {
  await requireConsole();
  const flag = formData.get("flag");
  const state = formData.get("state");
  if (!isFeatureFlag(flag) || (state !== "on" && state !== "off")) {
    redirect(`/console/features?error=${encodeURIComponent("That switch isn't recognised — reload the page and try again.")}`);
  }
  const { error } = await serviceDb().from("settings").upsert({ key: featureFlagKey(flag), value: state === "on" });
  if (error) redirect(`/console/features?error=${encodeURIComponent(dbProblem("action:saveFeatureFlag", error))}`);
  // Flags gate member-area pages and nav; drop any client router cache still
  // holding the old state.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/console/features");
  revalidatePath("/console/sources"); // shows whether the story crawler is on
  revalidatePath("/", "layout"); // industries_public changes the public header and pages
  redirect(`/console/features?saved=${flag}`);
}

/**
 * The grid homepage's below-the-fold sections: order and visibility (A13,
 * GAPS A1.7). One form: the current order rides in a hidden `order` field, an
 * up/down button adds `move=<id>:<up|down>`, and each hideable section posts a
 * `show_<id>` checkbox. resolveHomeSections is the authority on what's legal —
 * it drops unknown ids, restores anything missing, and refuses to hide a
 * section carrying a paid placement even if a crafted POST asks it to.
 */
export async function saveHomeSections(formData: FormData) {
  await requireConsole();
  let order = resolveHomeSections({ order: String(formData.get("order") ?? "").split(",") }).order;
  const move = String(formData.get("move") ?? "");
  const [moveId, direction] = move.split(":");
  if ((HOME_SECTION_IDS as readonly string[]).includes(moveId) && (direction === "up" || direction === "down")) {
    order = moveHomeSection(order, moveId as HomeSectionId, direction);
  }
  const hidden = HOME_SECTION_IDS.filter((id) => !LOCKED_VISIBLE.has(id) && formData.get(`show_${id}`) !== "on");
  const value = resolveHomeSections({ order, hidden });
  const { error } = await serviceDb().from("settings").upsert({ key: HOME_SECTIONS_KEY, value });
  if (error) redirect(`/console/pages?error=${encodeURIComponent(dbProblem("action:saveHomeSections", error))}`);
  revalidatePath("/");
  redirect("/console/pages?saved=sections#home-sections");
}

/* ---------- error log (docs/logging.md) ---------- */

/**
 * Resolve, ignore or reopen an error. Developer-only, like the page: an admin
 * who isn't on DEVELOPER_EMAILS gets the same 404 the page gives them.
 */
export async function setErrorStatus(formData: FormData) {
  const { requireDeveloper } = await import("@/lib/developer");
  await requireDeveloper();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID_RE.test(id) || !["open", "resolved", "ignored"].includes(status)) return;
  await serviceDb()
    .from("error_events")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/console/errors");
  redirect(`/console/errors/${id}?saved=1`);
}

/** Forget this browser's own switcher choice, so it sees the site-wide default again. */
export async function clearMyVariantOverride() {
  await requireConsole();
  (await cookies()).delete(VARIANT_COOKIE);
  revalidatePath("/", "layout");
  redirect("/console/pages?saved=override");
}

export async function saveSocialCaps(formData: FormData) {
  await requireConsole();
  const value: SocialCaps = {
    per_day: Math.max(1, Number(formData.get("per_day") ?? DEFAULT_SOCIAL_CAPS.per_day)),
    delay_minutes: Math.max(0, Number(formData.get("delay_minutes") ?? DEFAULT_SOCIAL_CAPS.delay_minutes)),
  };
  await serviceDb().from("settings").upsert({ key: "social_caps", value });
  revalidatePath("/console/stories");
}

/**
 * GAPS B4.4: which Buffer-connected channels auto-posts go to. Buffer's GraphQL
 * API takes one `channelId` per mutation, so this list is what the publisher
 * fans out over. Writing channel ids here also clears any stale v1 `profileIds`
 * left in the row, since the upsert replaces the whole value.
 */
export async function saveSocialChannels(formData: FormData) {
  await requireConsole();
  const channelIds = String(formData.get("channel_ids") ?? "")
    .split(/[\n,]/)
    .map((id) => id.trim())
    .filter(Boolean);
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const value: SocialChannels = { channelIds: [...new Set(channelIds)], ...(organizationId ? { organizationId } : {}) };
  // Back to the same tab of the stories page, at the channels section.
  const view = parseStoryView(formData.get("view"));
  const back = (query: string) => `/console/stories?${view === "board" ? "" : `view=${view}&`}${query}#buffer-channels`;
  const { error } = await serviceDb().from("settings").upsert({ key: "social_channels", value });
  if (error) {
    logError({ source: "db", area: "action:saveSocialChannels", error: error.message, context: { code: error.code ?? null } });
    redirect(back("channels=edit&channels_error=1"));
  }
  // A new organisation id must show its own channels, not the cached ones.
  clearChannelDetailsCache();
  revalidatePath("/console/stories");
  redirect(back("saved=channels"));
}

/**
 * Homepage takeover (V17/A12): one advertiser's colour + banner across the
 * public site for a paid period. Same date-driven pattern as every other
 * placement — no job flips it live or ends it, activeTakeover() just reads
 * the dates. The overlap exclusion constraint (placements_takeover_no_overlap)
 * stops two clients' colours ever being booked over the same days.
 */
export async function saveTakeoverPlacement(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  // Present when editing a booked takeover (fix-list 76) — there used to be no
  // way to change one once booked.
  const id = String(formData.get("id") ?? "");
  const back = id ? `/console/adverts/takeover/${id}` : "/console/adverts/takeover";
  const member_id = String(formData.get("member_id"));
  const hex = String(formData.get("hex") ?? "").trim();
  const starts_on = String(formData.get("starts_on"));
  const ends_on = String(formData.get("ends_on"));
  const price = penniesFromPounds(formData.get("price_pounds"));
  if (price === "invalid") redirect(`${back}?error=${encodeURIComponent(priceError("1500"))}`);
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    redirect(`${back}?error=${encodeURIComponent("Enter a 6-digit hex colour, e.g. #ac5800.")}`);
  }
  // Checked against the site's own paper background — the takeover banner and
  // top-of-page chrome sit on white, same pairing globals.css documents for brand.
  if (!meetsWcagAA(hex, "#ffffff", { largeText: true })) {
    redirect(`${back}?error=${encodeURIComponent("That colour is too close to white to read — it needs at least 3:1 contrast (WCAG AA, large text/UI).")}`);
  }

  // An edit keeps the banner it already has unless a new one is uploaded.
  // config is jsonb and activeTakeover() needs both keys, so it is rewritten
  // whole rather than patched. Checked before the upload, so a stale id
  // leaves no orphaned banner in storage.
  let existing: { config: unknown } | null = null;
  let plan: Reprice = { action: "keep" };
  if (id) {
    const { data } = await db.from("placements").select("config").eq("id", id).eq("kind", "takeover").maybeSingle();
    if (!data) redirect(`/console/adverts/takeover?error=${encodeURIComponent("That takeover no longer exists.")}`);
    existing = data;
    // As Featured Member: a paid takeover can't change hands; an unpaid one
    // that changes advertiser or price gets a fresh invoice.
    plan = await rebillBeforeSave({ placement_id: id }, { memberId: member_id, pricePennies: price }, back);
    if (plan.action === "replace") {
      // The one refusal the save can still meet is the overlap constraint —
      // asked here first, so it can't strike after the old invoice is voided.
      // The constraint itself (placements_takeover_no_overlap) stays the guard.
      const { count: clash } = await db.from("placements").select("id", { count: "exact", head: true })
        .eq("kind", "takeover").neq("id", id).lte("starts_on", ends_on).gte("ends_on", starts_on);
      if (clash) redirect(`${back}?error=${encodeURIComponent("Another takeover already covers those dates — only one can run at a time.")}`);
    }
  }

  let banner_path: string | null = null;
  try {
    banner_path = await uploadImage(await submittedFile(formData, "banner", CONSOLE_UPLOADS), "takeovers");
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveTakeoverPlacement"))}`);
  }
  const previousBanner = (existing?.config as { banner_path?: unknown } | null)?.banner_path;
  const banner = banner_path ?? (typeof previousBanner === "string" ? previousBanner : null);
  if (!banner) {
    redirect(`${back}?error=${encodeURIComponent("A banner image is required.")}`);
  }

  if (id && plan.action === "replace") {
    const voided = await voidForReprice({ placement_id: id });
    if (!voided.ok) {
      if (banner_path) await removeMedia(banner_path);
      redirect(`${back}?error=${encodeURIComponent(voided.error)}`);
    }
  }

  const values = { member_id, config: { hex, banner_path: banner }, starts_on, ends_on, price_pennies: price };
  const { data: saved, error } = id
    ? await db.from("placements").update(values).eq("id", id).eq("kind", "takeover").select("id").maybeSingle()
    : await db.from("placements").insert({ kind: "takeover", ...values, awaiting_payment: holdsForPayment(price) }).select("id").single();
  if (error || (id && !saved)) {
    // Nothing points at a just-uploaded banner yet — don't leave it in storage.
    if (banner_path) await removeMedia(banner_path);
    if (!error) redirect(`/console/adverts/takeover?error=${encodeURIComponent("That takeover no longer exists.")}`);
    redirect(`${back}?error=${encodeURIComponent(
      error.message.includes("placements_takeover_no_overlap")
        ? "Another takeover already covers those dates — only one can run at a time."
        : dbProblem("action:saveTakeoverPlacement", error),
    )}`);
  }
  let message: string | null = null;
  if (!id && saved && price) {
    const invoice = await invoiceAdvertising(member_id, price, {
      placement_id: saved.id,
      description: `Homepage takeover (${starts_on} to ${ends_on})`,
    });
    if (invoice && !invoice.ok) message = invoiceFailedMessage(invoice.error);
  }
  if (id) message = await rebillAfterSave({ placement_id: id }, plan, price);
  // The old banner file is left in storage on a replace: removeMedia on a path
  // another row might share is not worth the risk for one image.
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/takeover");
  if (id) revalidatePath(back);
  revalidatePath("/");
  redirect(savedOr(message && !id && saved ? `/console/adverts/takeover/${saved.id}` : back, message));
}

/**
 * Call off a Featured Member slot or takeover that hasn't been paid for and
 * hasn't run (review finding, 16 Oct). There was no way to: a held takeover
 * kept its dates reserved against every other advertiser, and a held slot
 * kept counting towards the cap, until somebody paid.
 *
 * Deleted rather than marked: placements have no status, and every reader
 * (the cap count, the takeover overlap constraint, the homepage) would need
 * teaching to skip a "cancelled" row. The invoice survives as the record —
 * invoices.placement_id is `on delete set null` — after it's voided here, which
 * also expires any open Stripe checkout so a pay page left open stops taking
 * money. Refused once paid (refunds are by hand, in Stripe) or once it has
 * started running unheld (that's a bill for something that went out).
 * Requires the confirm box, per the console's delete convention.
 */
/** The placement kinds cancelPlacement handles, and the list page each returns to. */
const CANCELLABLE_PLACEMENTS = {
  featured_member: "/console/adverts/featured-member",
  takeover: "/console/adverts/takeover",
  featured_event: FEATURED_EVENT_LIST,
} as const;

export async function cancelPlacement(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const { data: p } = UUID_RE.test(id)
    ? await db.from("placements").select("id, kind, starts_on, awaiting_payment").eq("id", id).in("kind", Object.keys(CANCELLABLE_PLACEMENTS) as (keyof typeof CANCELLABLE_PLACEMENTS)[]).maybeSingle()
    : { data: null };
  if (!p) redirect(`/console/adverts?error=${encodeURIComponent("That booking no longer exists.")}`);
  const list = CANCELLABLE_PLACEMENTS[p.kind as keyof typeof CANCELLABLE_PLACEMENTS];
  const back = `${list}/${id}`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  if (formData.get("confirm") !== "1") return fail("Tick the box to confirm — cancelling deletes the booking.");
  const today = new Date().toISOString().slice(0, 10);
  if (!p.awaiting_payment && p.starts_on <= today) return fail("This one has already started running, so it can't be cancelled here — change its end date instead.");

  const onRecord = await invoiceOnRecord({ placement_id: id });
  if (!onRecord.ok) return fail(onRecord.error);
  if (onRecord.invoice?.status === "paid") return fail(`${onRecord.invoice.number} is already paid, so this can't be cancelled here — a refund is made in Stripe, by hand.`);
  const voided = await voidInvoices({ placement_id: id });
  if (!voided.ok) {
    logError({ source: "db", area: "action:cancelPlacement", error: voided.error, context: { placement_id: id } });
    return fail("Its invoice couldn't be cancelled just now, so nothing was changed. Try again.");
  }
  if (voided.paying.length) return fail("The member is paying its invoice right now, so nothing was cancelled. Look again in a few minutes.");

  const { error } = await db.from("placements").delete().eq("id", id);
  if (error) return fail(dbProblem("action:cancelPlacement", error, "Its invoice is cancelled, but the booking itself couldn't be deleted — try Cancel again."));
  revalidatePath("/console/adverts");
  revalidatePath(list);
  revalidatePath(back);
  // the Events page's Featured Event card
  if (p.kind === "featured_event") revalidatePath("/console/events");
  revalidatePath("/console");
  revalidatePath("/");
  redirect(`${list}?cancelled=1`);
}

export async function declineInterest(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "");
  const { data: request } = await db
    .from("visibility_requests")
    .select("id, member_id")
    .eq("id", id)
    .single();
  await db.from("visibility_requests").update({ status: "declined" }).eq("id", id);
  // A decline is still an answer — the member is owed one either way (A2.6).
  if (request?.member_id) {
    await enqueue("notify_member", { member_id: request.member_id, kind: "visibility_declined", request_id: id, reason });
  }
  revalidatePath("/console/adverts/interest");
}

/* ---------- newsletter ---------- */

/** Turns the composer's ordered picks into newsletter_items rows; position 0 is the lead story. */
function newsletterItemRows(issueId: string, refs: IssueItemRef[]) {
  return refs.map((ref, position) =>
    ref.kind === "story" ? { issue_id: issueId, story_id: ref.id, position } : { issue_id: issueId, video_id: ref.id, position },
  );
}

/** The create form still has two checklists; its picks start as stories then videos, and are reordered on the issue page. */
const createFormItems = (formData: FormData): IssueItemRef[] => [
  ...formData.getAll("stories").map((id) => ({ kind: "story" as const, id: String(id) })),
  ...formData.getAll("videos").map((id) => ({ kind: "video" as const, id: String(id) })),
];

export async function createIssue(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const { data: last } = await db.from("newsletter_issues").select("number").order("number", { ascending: false }).limit(1).single();
  const number = (last?.number ?? 46) + 1;
  const subject = String(formData.get("subject") ?? `SMI Monthly — issue ${number}`);
  const { data } = await db.from("newsletter_issues").insert({
    number, subject, intro: String(formData.get("intro") ?? ""), web_slug: `issue-${number}`, created_by: user.userId,
  }).select("id").single();
  const rows = newsletterItemRows(data!.id, createFormItems(formData));
  if (rows.length) await db.from("newsletter_items").insert(rows);
  revalidatePath("/console/newsletter");
}

const ISSUE_EDITABLE_STATUSES = new Set(["draft", "scheduled", "send_failed"]);

const issueFail = (id: string, message: string): never =>
  redirect(`/console/newsletter/${id}?error=${encodeURIComponent(message)}`);

/**
 * GAPS B5.5: no test, approval, schedule or send while a picked story or video
 * has left the site. The send job checks again, for anything already queued.
 */
async function refuseNotLiveItems(id: string) {
  const [{ issueItemsNotLive }, { notLiveMessage }] = await Promise.all([
    import("@/lib/adapters/newsletter"),
    import("@/lib/newsletter-picker"),
  ]);
  const notLive = await issueItemsNotLive(id);
  if (notLive.length) issueFail(id, notLiveMessage(notLive));
}

/** Drops the issue's queued send, so a pending job can't fire after it was pulled back. */
async function cancelPendingIssueSend(db: ReturnType<typeof serviceDb>, id: string) {
  await db.from("jobs").delete().eq("kind", "newsletter_send").eq("status", "pending").filter("payload->>issue_id", "eq", id);
}

/**
 * Gap review area 4: any change to an issue's content withdraws its approval
 * and its test-send stamp, because what was proofed is no longer what would
 * go out. The checklist ticks stay — the SOP's second round re-checks only
 * what changed. A scheduled issue is pulled back to draft, since it is no
 * longer approved to send.
 */
async function markIssueEdited(db: ReturnType<typeof serviceDb>, id: string, userId: string) {
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", id).single();
  const unschedule = issue?.status === "scheduled";
  if (unschedule) await cancelPendingIssueSend(db, id);
  await db.from("newsletter_issues").update({
    last_edited_by: userId,
    last_edited_at: new Date().toISOString(),
    approved_at: null,
    approved_by: null,
    approved_recipients: null,
    last_test_sent_at: null,
    last_test_sent_by: null,
    ...(unschedule ? { status: "draft", scheduled_at: null } : {}),
  }).eq("id", id);
}

/** Takes an issue's approval away; a scheduled one goes back to draft, since it can no longer send. */
async function clearApproval(db: ReturnType<typeof serviceDb>, id: string, status: string) {
  if (status === "scheduled") await cancelPendingIssueSend(db, id);
  await db.from("newsletter_issues").update({
    approved_at: null,
    approved_by: null,
    approved_recipients: null,
    ...(status === "scheduled" ? { status: "draft", scheduled_at: null } : {}),
  }).eq("id", id);
}

/** Who the issue would go to right now (lib/newsletter-audience). Not exported: this is a "use server" module. */
async function subscriberCount(db: ReturnType<typeof serviceDb>): Promise<number> {
  const { count } = await newsletterAudience(db);
  return count ?? 0;
}

/**
 * B5.3: no way to edit an issue after creation — subject/intro and the
 * story/video pick were locked in at createIssue and never revisitable.
 * Full replace of newsletter_items rather than a diff, matching createIssue's
 * own shape; the composer's picker is small enough that this is simpler than
 * reconciling adds/removes.
 */
export async function updateIssue(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) {
    redirect(`/console/newsletter/${id}?error=${encodeURIComponent("This issue can no longer be edited.")}`);
  }
  await db.from("newsletter_issues").update({
    subject: String(formData.get("subject") ?? ""),
    intro: String(formData.get("intro") ?? ""),
    preview_text: String(formData.get("preview_text") ?? "").trim() || null,
  }).eq("id", id);

  await db.from("newsletter_items").delete().eq("issue_id", id);
  // One ordered list (gap review area 5), so stories and videos mix and the
  // first is the lead. Every picked item is posted however old, so a save
  // can't drop one (lib/newsletter-picker).
  const rows = newsletterItemRows(id, parseIssueItems(formData.getAll("items").map(String)));
  if (rows.length) await db.from("newsletter_items").insert(rows);
  await markIssueEdited(db, id, user.userId);

  revalidatePath(`/console/newsletter/${id}`);
  revalidatePath("/console/newsletter");
}

/**
 * newsletter_ads is dateless/statusless (PK just issue_id+advert_id), with no
 * link to advert_bookings or a rate card — attach/detach is the whole write
 * surface, one issue at a time. The PK also means a double-click race can't
 * duplicate a row.
 */
export async function attachNewsletterAd(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const advertId = String(formData.get("advert_id"));
  // The masthead has room for one "In association with" logo, and the SOP has
  // one sponsored story (area 5).
  const { data: advert } = await db.from("adverts").select("format").eq("id", advertId).maybeSingle();
  if (advert && ONE_PER_ISSUE_FORMATS.has(advert.format)) {
    const { data: attached } = await db.from("newsletter_ads").select("advert:adverts(format)").eq("issue_id", issueId);
    if ((attached ?? []).some((row) => row.advert?.format === advert.format)) {
      issueFail(issueId, advert.format === "association_logo"
        ? "This issue already has an “In association with” logo. Remove it first to use another."
        : "This issue already has a sponsored story. Remove it first to use another.");
    }
  }
  const { count } = await db.from("newsletter_ads").select("*", { count: "exact", head: true }).eq("issue_id", issueId);
  await db.from("newsletter_ads").insert({ issue_id: issueId, advert_id: advertId, position: count ?? 0 });
  await markIssueEdited(db, issueId, user.userId);
  revalidatePath(`/console/newsletter/${issueId}`);
  revalidatePath("/console/newsletter");
}

export async function detachNewsletterAd(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const advertId = String(formData.get("advert_id"));
  await db.from("newsletter_ads").delete().eq("issue_id", issueId).eq("advert_id", advertId);
  await markIssueEdited(db, issueId, user.userId);
  revalidatePath(`/console/newsletter/${issueId}`);
  revalidatePath("/console/newsletter");
}

/**
 * The issue's supplier directory (gap review area 5, SOP §1b): members Jas
 * picks, listed near the footer in name order. Changing it changes the issue,
 * so it withdraws approval like any other edit.
 */
export async function addDirectoryMember(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const memberId = String(formData.get("member_id") ?? "");
  if (!UUID_RE.test(memberId)) issueFail(issueId, "Choose a member to add to the directory.");
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", issueId).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) issueFail(issueId, "This issue can no longer be edited.");
  // The primary key makes a double-click a no-op rather than a duplicate.
  await db.from("newsletter_directory").upsert({ issue_id: issueId, member_id: memberId }, { onConflict: "issue_id,member_id", ignoreDuplicates: true });
  await markIssueEdited(db, issueId, user.userId);
  revalidatePath(`/console/newsletter/${issueId}`);
}

export async function removeDirectoryMember(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const memberId = String(formData.get("member_id") ?? "");
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", issueId).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) issueFail(issueId, "This issue can no longer be edited.");
  await db.from("newsletter_directory").delete().eq("issue_id", issueId).eq("member_id", memberId);
  await markIssueEdited(db, issueId, user.userId);
  revalidatePath(`/console/newsletter/${issueId}`);
}

/**
 * Where an attached advert sits: "after item N", or blank for the automatic
 * rule (lib/newsletter-layout). A number past the issue's end is kept and
 * clamped at render time, so removing a story never invalidates it.
 */
export async function placeNewsletterAd(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const advertId = String(formData.get("advert_id"));
  const raw = String(formData.get("after_item") ?? "").trim();
  const afterItem = raw === "" ? null : Number(raw);
  if (afterItem !== null && (!Number.isInteger(afterItem) || afterItem < 1)) {
    issueFail(issueId, "An advert's place is a whole number of items, 1 or more — or blank to place it automatically.");
  }
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", issueId).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) issueFail(issueId, "This issue can no longer be edited.");
  await db.from("newsletter_ads").update({ after_item: afterItem }).eq("issue_id", issueId).eq("advert_id", advertId);
  await markIssueEdited(db, issueId, user.userId);
  revalidatePath(`/console/newsletter/${issueId}`);
  revalidatePath("/console/newsletter");
}

/**
 * The issue editor's picker search (gap review area 5): published stories and
 * videos by title, optionally since a date, instead of only the latest 20.
 * Returns at most 25 of each, newest first.
 */
export async function searchIssueContent(query: string, since: string): Promise<IssueContentResult[]> {
  await requireConsole();
  const db = serviceDb();
  const term = query.trim().slice(0, 100);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null;
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search = (table: "stories" | "videos") => {
    let q = db.from(table).select("id, title, published_at, status").eq("status", "published");
    if (term) q = q.ilike("title", pattern);
    if (from) q = q.gte("published_at", from);
    return q.order("published_at", { ascending: false }).limit(25);
  };
  const [stories, videos] = await Promise.all([search("stories"), search("videos")]);
  return [
    ...(stories.data ?? []).map((row) => ({ ...row, kind: "story" as const })),
    ...(videos.data ?? []).map((row) => ({ ...row, kind: "video" as const })),
  ].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

/** Ticks on the proof checklist (lib/newsletter-proof). Saved on their own, so a half-done proof isn't lost. */
export async function saveProofChecks(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status, approved_at").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) return issueFail(id, "This issue has been sent; its proof can no longer change.");
  const ticked = new Set(formData.getAll("checks").map(String));
  const proof_checks = Object.fromEntries(PROOF_KEYS.filter((key) => ticked.has(key)).map((key) => [key, true]));
  await db.from("newsletter_issues").update({ proof_checks }).eq("id", id);
  // Unticking something on an approved issue means the proof no longer holds.
  if (issue.approved_at && missingChecks(proof_checks).length) await clearApproval(db, id, issue.status);
  revalidatePath(`/console/newsletter/${id}`);
  revalidatePath("/console/newsletter");
}

/**
 * Gap review area 6: the footer's postal address and reason-for-receiving
 * line, one `settings` row (lib/newsletter-footer.ts). Every unsent issue picks
 * the change up on its next render; nothing already sent changes.
 */
export async function saveNewsletterFooter(formData: FormData) {
  await requireConsole();
  const parsed = newsletterFooterFromForm(formData);
  if ("error" in parsed) redirect(`/console/newsletter?footer_error=${encodeURIComponent(parsed.error)}#footer`);
  const { error } = await serviceDb().from("settings").upsert({ key: NEWSLETTER_FOOTER_KEY, value: parsed.value });
  if (error) {
    logError({ source: "server", area: "action:saveNewsletterFooter", error });
    redirect(`/console/newsletter?footer_error=${encodeURIComponent("The footer couldn't be saved. Try again in a minute.")}#footer`);
  }
  revalidatePath("/console/newsletter", "layout");
  redirect("/console/newsletter?footer=saved#footer");
}

/**
 * SOP Step 2, round 1: a test email of the issue as it stands, to the signed-in
 * admin only (Luiza, 20 Oct). Same render as the real send, sent as a single
 * email through the transactional sender — Mailpit in dev — but from the
 * newsletter's own sender, so the proof's sender check sees the real name.
 */
export async function sendTestIssue(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) return issueFail(id, "This issue has been sent; there's nothing left to test.");
  await refuseNotLiveItems(id);
  const [{ renderIssueHtml }, { getEmailSender, newsletterFrom }] = await Promise.all([
    import("@/lib/adapters/newsletter"),
    import("@/lib/adapters/email"),
  ]);
  const content = await renderIssueHtml(id, { unsubscribeUrl: `${siteUrl()}/unsubscribe` });
  if (!content) return issueFail(id, "This issue couldn't be built for a test.");
  // The same refusal the real send makes, so the test can't pass a wrapper the broadcast will reject.
  const [{ newsletterTemplateProblem }, { loadEmailTemplates }] = await Promise.all([
    import("@/lib/email/templates"),
    import("@/lib/email/store"),
  ]);
  const templateProblem = newsletterTemplateProblem(await loadEmailTemplates());
  if (templateProblem) return issueFail(id, templateProblem);
  try {
    await getEmailSender().send({ to: user.email, from: newsletterFrom(), subject: `[TEST] ${content.subject}`, html: content.html, text: content.text });
  } catch (error) {
    logError({ source: "server", area: "action:sendTestIssue", error, context: { issue_id: id } });
    return issueFail(id, "The test email couldn't be sent. Nothing was recorded; try again in a minute.");
  }
  await db.from("newsletter_issues").update({ last_test_sent_at: new Date().toISOString(), last_test_sent_by: user.userId }).eq("id", id);
  redirect(`/console/newsletter/${id}?tested=1`);
}

/**
 * SOP Step 2, "Approved to send": only once every checklist item is ticked and
 * a test has gone out since the last edit (edits clear the stamp). The audience
 * count is recorded with it. A count more than 5% off last month is shown, not
 * blocked — the SOP says investigate.
 */
export async function approveIssue(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status, proof_checks, last_test_sent_at").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) return issueFail(id, "This issue has been sent; it can't be approved again.");
  const missing = missingChecks(issue.proof_checks);
  if (missing.length) return issueFail(id, `Not approved: ${missing.length} proof ${missing.length === 1 ? "item is" : "items are"} still unticked.`);
  if (!issue.last_test_sent_at) return issueFail(id, "Not approved: send a test since the last change first.");
  await refuseNotLiveItems(id);
  await db.from("newsletter_issues").update({
    approved_at: new Date().toISOString(),
    approved_by: user.userId,
    approved_recipients: await subscriberCount(db),
  }).eq("id", id);
  revalidatePath(`/console/newsletter/${id}`);
  revalidatePath("/console/newsletter");
}

export async function withdrawApproval(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) return issueFail(id, "This issue has been sent; its approval can't be withdrawn.");
  await clearApproval(db, id, issue.status);
  revalidatePath(`/console/newsletter/${id}`);
  revalidatePath("/console/newsletter");
}

/** Refuses an issue nobody approved (gap review area 4). The send job checks again. */
async function requireApprovedIssue(db: ReturnType<typeof serviceDb>, id: string) {
  const { data: issue } = await db.from("newsletter_issues").select("approved_at").eq("id", id).single();
  if (!issue?.approved_at) issueFail(id, "This issue isn't approved to send yet — finish the proof and approve it first.");
  await refuseNotLiveItems(id);
}

export async function sendIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const db = serviceDb();
  // Mails the whole list at once, so it takes the same ticked "confirm" a
  // delete does — server-side too, since a form can be posted without it.
  if (formData.get("confirm") !== "1") return issueFail(id, "Tick \"confirm\" to send to the whole list.");
  await requireApprovedIssue(db, id);
  // Doubles as the retry for a failed send: clear the previous error and drop
  // back to draft so the board doesn't show a stale failure while it reruns.
  await db
    .from("newsletter_issues")
    .update({ status: "draft", send_error: null })
    .eq("id", id)
    .eq("status", "send_failed");
  await enqueue("newsletter_send", { issue_id: id });
  revalidatePath("/console/newsletter");
  revalidatePath("/console");
}

export async function scheduleIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  if (!when) return;
  // GAPS A3.9: the input is UK wall-clock time, not the server's (UTC on Vercel).
  const at = parseLondonInput(when);
  if (!at) return issueFail(id, "That send time isn't a date and time we can read.");
  const db = serviceDb();
  await requireApprovedIssue(db, id);
  await db.from("newsletter_issues").update({ status: "scheduled", scheduled_at: at.toISOString() }).eq("id", id);
  await enqueue("newsletter_send", { issue_id: id }, at);
  revalidatePath("/console/newsletter");
}

export async function unscheduleIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const db = serviceDb();
  // the pending job would otherwise still fire at the original time — reverting
  // the row to draft alone doesn't stop it (src/lib/jobs.ts). Approval stays:
  // the content hasn't changed, only the timing.
  await cancelPendingIssueSend(db, id);
  await db.from("newsletter_issues").update({ status: "draft", scheduled_at: null }).eq("id", id);
  revalidatePath("/console/newsletter");
}

/* ---------- CRM ---------- */

const contactsFail = (message: string): never =>
  redirect(`/console/crm?error=${encodeURIComponent(message)}`);

/** A19/A20 — edit a mirrored contact in place; changes write through to Bigin. */
export async function saveContact(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  const { data: contact } = await db.from("contacts")
    .select("id, email, name, subscribed, unsubscribed_at, bounced_at").eq("id", id).single();
  if (!contact) return;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return contactsFail("That is not a valid email address.");
  // Compared normalised: a stored address with capitals (an older row, a
  // Mailchimp import) must not read as "changed" on every save.
  const emailChanged = email !== contact.email.trim().toLowerCase();
  if (emailChanged) {
    const { data: clash } = await db.from("contacts").select("id").eq("email", email).neq("id", id).maybeSingle();
    if (clash) return contactsFail(`${email} is already on another contact.`);
  }

  const choice = String(formData.get("newsletter") ?? "");
  if (!NEWSLETTER_CHOICES.includes(choice as NewsletterChoice)) return;
  const optIn = applyOptIn(contact, {
    newsletter: choice as NewsletterChoice,
    reOptIn: formData.get("re_opt_in") === "on",
  });

  const name = String(formData.get("name") ?? "").trim() || null;
  const company = String(formData.get("company") ?? "").trim() || null;
  // The Bigin company picker posts both hidden fields; absent means the form
  // predates the picker (or it was disabled), so leave the link alone.
  const biginCompany = formData.has("bigin_company_id")
    ? {
      bigin_company_id: String(formData.get("bigin_company_id") ?? "").trim() || null,
      bigin_company_name: String(formData.get("bigin_company_name") ?? "").trim() || null,
    }
    : {};
  // Gap review area 6: an admin putting someone (back) on the list is an
  // opt-in by the console route. Staying subscribed restamps nothing.
  const optedIn = optIn.subscribed && (!contact.subscribed || !!contact.unsubscribed_at);
  // Gap review area 7: a hard bounce belongs to the address, so a new address
  // clears it, as does the admin saying the address is fixed. Not an opt-in
  // change, so nothing about it goes to Bigin.
  const clearBounce = !!contact.bounced_at && (emailChanged || formData.get("clear_bounce") === "on");
  // last_synced_at means "reconciled with Bigin", not "edited here" — leave it
  const { error } = await db.from("contacts").update({
    email, name, company,
    member_id: String(formData.get("member_id") ?? "") || null,
    ...biginCompany,
    ...optIn,
    ...(optedIn ? optInEvidence("console") : {}),
    ...(clearBounce ? { bounced_at: null } : {}),
  }).eq("id", id);
  if (error) return contactsFail(error.code === "23505" ? `${email} is already on another contact.` : dbProblem("action:saveContact", error));

  // never throws — a failed push is queued for retry and shows as "Push pending"
  const { syncContactToCrm } = await import("@/lib/adapters/crm");
  await syncContactToCrm(id, {
    nameChanged: name !== contact.name,
    reOptIn: !!contact.unsubscribed_at && !optIn.unsubscribed_at,
  });
  revalidatePath("/console/crm");
  redirect("/console/crm?saved=1");
}

export async function addContact(formData: FormData) {
  await requireConsole();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  const db = serviceDb();
  const { data: existing } = await db.from("contacts").select("id").eq("email", email).maybeSingle();
  if (!existing) {
    const { data: created } = await db.from("contacts").insert({
      email,
      name: String(formData.get("name") ?? "").trim() || null,
      company: String(formData.get("company") ?? "").trim() || null,
      source: "console",
      // subscribed defaults to true, so adding a contact is a console opt-in
      ...optInEvidence("console"),
    }).select("id").single();
    if (created) {
      // write-through to Bigin — the whole row, not just the email
      const { syncContactToCrm } = await import("@/lib/adapters/crm");
      await syncContactToCrm(created.id);
    }
  }
  revalidatePath("/console/crm");
}

/** Console picker: existing Bigin companies matching `q`. Never creates one. */
export async function searchBiginCompanies(q: string): Promise<{ id: string; name: string; website?: string | null }[]> {
  await requireConsole();
  const { getCrmSync } = await import("@/lib/adapters/crm");
  try {
    return await getCrmSync().searchCompanies(String(q ?? "").slice(0, 100));
  } catch (e) {
    logError({ source: "adapter", area: "action:searchBiginCompanies", error: e });
    return [];
  }
}

/** Dry run of a pull — counts what would change, writes nothing to contacts. */
export async function previewBiginPull() {
  await requireConsole();
  const { getCrmSync, saveLastRun } = await import("@/lib/adapters/crm");
  let message: string | null = null;
  try {
    const pulled = await getCrmSync().pull({ dryRun: true, allowFirstImport: true });
    await saveLastRun({ at: new Date().toISOString(), preview: true, pulled, pushed: 0, pushFailed: 0, watch: "skipped" });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/console/crm");
  if (message) contactsFail(`Bigin preview failed: ${message}`);
  redirect("/console/crm?synced=preview");
}

/**
 * "Sync with Bigin now" — the crm_sync job, on demand. This is also the only
 * way the first import runs: it changes who the next newsletter goes to, so it
 * waits for a person to have looked at the preview.
 */
export async function runBiginSync() {
  await requireConsole();
  const { getCrmSync, firstImportDone, readLastRun } = await import("@/lib/adapters/crm");
  // The preview requirement is enforced here, not just by which button the
  // page shows: before the first import, only a recent preview lets it run.
  const [imported, lastRun] = await Promise.all([firstImportDone(), readLastRun()]);
  if (!imported && !firstImportPreviewFresh(lastRun)) {
    contactsFail("Preview the import first — it runs only within an hour of a preview, so the numbers you saw are the ones that land.");
  }
  let message: string | null = null;
  try {
    await getCrmSync().sync({ allowFirstImport: !imported });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/console/crm");
  revalidatePath("/console/newsletter");
  revalidatePath("/console");
  if (message) contactsFail(`Bigin sync finished with a problem: ${message}`);
  redirect("/console/crm?synced=1");
}

/* ---------- members ---------- */

const memberFail = (id: string, message: string): never =>
  redirect(`/console/members/${id}?error=${encodeURIComponent(message)}`);

/** The audit trail + member email that activation owes, wherever it came from. */
async function recordActivation(memberId: string, userId: string) {
  await serviceDb().from("approvals").insert({
    kind: "member_activation", subject_id: memberId, decision: "approved", decided_by: userId,
  });
  await enqueue("notify_member", { member_id: memberId, kind: "page_live" });
}

/** A17 — the full member record, editable by Jas without the revision queue. */
export async function saveMember(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  // explicit columns: select("*") would drag the search_tsv vector across the wire
  const { data: member } = await db.from("members")
    .select("id, slug, status, social, address, lat, lng").eq("id", id).single();
  if (!member) return;

  // uploadImage throws on >8MB and on storage errors; redirect() must stay
  // outside the try or its NEXT_REDIRECT gets swallowed as an upload failure
  let uploaded: { logo_path: string | null; hero_path: string | null };
  let uploadError: string | null = null;
  try {
    const [logo_path, hero_path] = await Promise.all([
      submittedFile(formData, "logo", CONSOLE_UPLOADS).then((file) => uploadImage(file, `members/${id}`)),
      submittedFile(formData, "hero", CONSOLE_UPLOADS).then((file) => uploadImage(file, `members/${id}`)),
    ]);
    uploaded = { logo_path, hero_path };
  } catch (e) {
    uploaded = { logo_path: null, hero_path: null };
    uploadError = uploadFailureMessage(e, "action:saveMember");
  }
  if (uploadError) return memberFail(id, uploadError);

  const result = memberValuesFromForm(formData, member, uploaded);
  if ("error" in result) return memberFail(id, result.error);
  const { values, industryIds, activatingDraft } = result;

  // Same rule as the member's own save — the two run the same form, so they
  // must derive the map pin the same way. Previously only the member side
  // geocoded, so an operator saving a member with a new address and no typed
  // coordinates left them without a map.
  const coords = await resolveCoordinates(
    { lat: values.lat ?? null, lng: values.lng ?? null },
    member,
    String(values.address ?? ""),
  );
  values.lat = coords.lat;
  values.lng = coords.lng;

  const slug = values.slug!;
  const slugChanged = slug !== member.slug;
  if (slugChanged) {
    // a draft has no public URL to break; a live one needs the operator to mean it
    if (member.status !== "draft" && formData.get("confirm_slug") !== "on") {
      return memberFail(id, "Changing the web address of a live member breaks existing links — tick the confirmation to go ahead.");
    }
    const { data: clash } = await db.from("members").select("id").eq("slug", slug).neq("id", id).maybeSingle();
    if (clash) return memberFail(id, `The web address “${slug}” is already used by another member.`);
  }

  const { error } = await db.from("members").update(values).eq("id", id);
  if (error) {
    return memberFail(id, error.code === "23505" ? "That web address is already taken — choose another." : dbProblem("action:saveMember", error));
  }

  // Membership types (GAPS A8.1) live in a join table, not a members column —
  // synced separately from the plain update above, through the same helper the
  // member's own save and revision approval use, so the cap applies here too.
  try {
    await replaceMemberMembershipTypes(db, id, membershipTypeIdsFromForm(formData));
  } catch (e) {
    return memberFail(id, e instanceof Error ? e.message : "Could not save membership types.");
  }

  // Services, the same way — the console had no way to edit these at all until
  // the two member forms were merged (GO-LIVE §3.2).
  try {
    await replaceMemberServices(db, id, formData.getAll("services").map(Number).filter(Boolean));
  } catch (e) {
    return memberFail(id, e instanceof Error ? e.message : "Could not save services.");
  }

  // Industries: a set plus the primary already written above as industry_id
  // (migration 20261012000001), reconciled by memberValuesFromForm.
  try {
    await replaceMemberIndustries(db, id, industryIds);
  } catch (e) {
    return memberFail(id, e instanceof Error ? e.message : "Could not save industries.");
  }

  if (slugChanged && member.status !== "draft") {
    // keep inbound links and search results working — honoured by /member/[slug].
    // recordRename also clears the reverse row, so renaming back doesn't leave
    // two rows pointing at each other (see lib/redirects).
    await recordRename(`/member/${member.slug}`, `/member/${slug}`);
  }
  if (activatingDraft) await recordActivation(id, user.userId);
  await audit({ action: "member_updated", actorUserId: user.userId, actorRole: "admin", memberId: id });

  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${id}?saved=1`);
}

/**
 * A17 — Jas onboards a member who signed up by phone. Same provisioning as the
 * public join flow, minus the funnel notifications: Jas is the actor here.
 */
export async function createMember(formData: FormData) {
  const admin = await requireConsole();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();

  const newFail = (message: string): never =>
    redirect(`/console/members/new?error=${encodeURIComponent(message)}`);
  if (!EMAIL_RE.test(email)) return newFail("Please enter a valid email.");
  if (password.length < 8) return newFail("Password needs at least 8 characters.");
  if (!company) return newFail("Company name is required.");

  const { provisionMember } = await import("@/lib/membership");
  const result = await provisionMember({ email, password, company });
  if ("error" in result) {
    // provisionMember's copy addresses the member ("try logging in") — the
    // admin needs a different next step, so rewrite it here rather than there
    return newFail(/already exists/i.test(result.error)
      ? "An account with that email already exists — find them in the members list, or use a different address."
      : result.error);
  }

  // Jas is usually on the phone to them, so the typed password stays — it gets
  // them in right now. This is the durable half: the member is told the account
  // exists and can set a password only they know. The link is emailed directly
  // rather than queued, so a credential-equivalent never sits in the
  // `notifications` payload for anyone with console access to read.
  const invited = await sendAccountInvite(email);
  await audit({ action: "member_created", actorUserId: admin.userId, actorRole: "admin", memberId: result.memberId });

  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${result.memberId}?created=1${invited ? "" : "&invite=failed"}`);
}

/**
 * Emails a new member a set-your-own-password link. Returns false if it could
 * not be sent, so the caller can tell Jas to pass the details on by phone
 * instead — a silently undelivered invite is how someone ends up with an
 * account they never learn about.
 */
async function sendAccountInvite(email: string): Promise<boolean> {
  try {
    const { data, error } = await serviceDb().auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrl()}/reset/confirm` },
    });
    const link = data?.properties?.action_link;
    if (error || !link) return false;

    const { getEmailSender } = await import("@/lib/adapters/email");
    const { renderNotification } = await import("@/lib/email/templates");
    const { loadEmailTemplates } = await import("@/lib/email/store");
    await getEmailSender().send({
      to: email,
      ...renderNotification({ kind: "account_created", action_link: link }, await loadEmailTemplates()),
    });
    return true;
  } catch (e) {
    logError({ source: "adapter", area: "console:account-invite", error: e });
    return false;
  }
}

/**
 * A17 — record an offline payment or a comp. Goes through applyPaymentResult so
 * a manually-taken payment raises the same invoice a self-serve one does and
 * shows up under the member's Billing tab.
 */
export async function recordMemberPayment(formData: FormData) {
  const admin = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const months = Number(formData.get("months") || 0);
  const comping = String(formData.get("kind")) === "comped";
  if (comping && (!Number.isInteger(months) || months < 1 || months > 60)) {
    return memberFail(id, "Comp length must be a whole number of months (1–60).");
  }

  const { applyPaymentResult } = await import("@/lib/membership");
  await applyPaymentResult(id, comping ? { kind: "comped", months } : { kind: "paid" });
  await audit({
    action: "member_payment_recorded", actorUserId: admin.userId, actorRole: "admin", memberId: id,
    detail: comping ? { kind: "comped", months } : { kind: "paid" },
  });
  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${id}?saved=1`);
}

export async function setMemberStatus(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return;
  const db = serviceDb();
  const { data: member } = await db.from("members").select("status, paid_at, comped_until").eq("id", id).single();
  if (!member) return;

  // V13 step 4 — activating a new member requires payment first (form is POSTable directly)
  if (activationBlocked(member, { status, paid_at: member.paid_at, comped_until: member.comped_until })) return;

  await db.from("members").update({ status }).eq("id", id);
  if (member.status === "draft" && status === "active") await recordActivation(id, user.userId);
  await audit({ action: "member_status_changed", actorUserId: user.userId, actorRole: "admin", memberId: id, detail: { from: member.status, to: status } });
  revalidatePath("/console/members");
  revalidatePath("/console");
}

/* ---------- members: archive and delete (fix list 72) ---------- */

/**
 * Every cached surface an archive, unarchive or delete changes. Archiving is
 * enforced in the database (`public_read_active_members`, 20260923000002), so
 * the public directory and the member's own page both go stale the moment the
 * flag flips — revalidating only the console would leave the site showing a
 * member Jas has just hidden.
 *
 * Not exported: this file is "use server", where every export must be an async
 * server action.
 */
function revalidateMemberSurfaces(id: string, slug: string | null) {
  revalidatePath("/console/members");
  revalidatePath(`/console/members/${id}`);
  revalidatePath("/console");
  revalidatePath("/member"); // the public directory — "find a member"
  if (slug) revalidatePath(`/member/${slug}`);
}

/**
 * Hide a member from the public site without losing anything they are tagged
 * on. Reversible by design — see unarchiveMember — and orthogonal to `status`,
 * which keeps describing where they sit in the billing lifecycle.
 */
export async function archiveMember(formData: FormData) {
  const admin = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  const { data: member } = await db.from("members").select("slug").eq("id", id).maybeSingle();
  if (!member) return;

  const { error } = await db.from("members").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return memberFail(id, dbProblem("action:archiveMember", error));
  await audit({ action: "member_archived", actorUserId: admin.userId, actorRole: "admin", memberId: id });
  revalidateMemberSurfaces(id, member.slug);
  redirect(`/console/members/${id}?saved=1`);
}

/** The way back out. Archiving must never be a one-way door. */
export async function unarchiveMember(formData: FormData) {
  const admin = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  const { data: member } = await db.from("members").select("slug").eq("id", id).maybeSingle();
  if (!member) return;

  const { error } = await db.from("members").update({ archived_at: null }).eq("id", id);
  if (error) return memberFail(id, dbProblem("action:unarchiveMember", error));
  await audit({ action: "member_unarchived", actorUserId: admin.userId, actorRole: "admin", memberId: id });
  revalidateMemberSurfaces(id, member.slug);
  redirect(`/console/members/${id}?saved=1`);
}

/**
 * Permanently remove a member — and REFUSE to when that would take a commercial
 * record with it.
 *
 * WHY THE COUNT CHECK IS THE WHOLE POINT. Nothing in the schema stops this
 * delete: every FK onto `members` is ON DELETE CASCADE or SET NULL, none is
 * RESTRICT. So `delete from members` succeeds silently while taking `invoices`,
 * `placements`, `adverts`, `bundles`, `visibility_requests`, `notifications`,
 * `engagement_audit`, `member_services`, `member_membership_types` and
 * `prospect_marks` with it. The first four are the financial record and live
 * booked advertising; losing those is not recoverable from this app.
 *
 * Hence: count them first and refuse by name. Deliberately a refusal and not a
 * silent fallback to archiving (the shape the old rate-card delete used for its
 * far cheaper rows) — someone who pressed Delete and got an archive would walk
 * away believing the record was gone.
 *
 * A permitted delete is for the spam signup and the typo'd account, and it has
 * to clean up what the cascade cannot reach: storage objects have no FK, and
 * `profiles.member_id` is ON DELETE SET NULL, so the login would otherwise
 * outlive the member as a member-role account attached to nothing.
 */
export async function deleteMember(formData: FormData) {
  const admin = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Same gate as deleteIndustry/deleteResource: the confirmation is part of the
  // request, so a direct POST cannot skip the dialog.
  if (formData.get("confirm") !== "1") {
    return memberFail(id, "Deleting a member is permanent — confirm in the dialog to go ahead.");
  }

  const db = serviceDb();
  const { data: member } = await db
    .from("members")
    .select("slug, name, logo_path, hero_path")
    .eq("id", id)
    .maybeSingle();
  if (!member) redirect(`/console/members?error=${encodeURIComponent("That member no longer exists.")}`);

  // head:true — these are counts, never rows; four separate calls rather than a
  // loop over table names so each stays typed against its own table.
  const [invoices, placements, adverts, bundles] = await Promise.all([
    db.from("invoices").select("*", { count: "exact", head: true }).eq("member_id", id),
    db.from("placements").select("*", { count: "exact", head: true }).eq("member_id", id),
    db.from("adverts").select("*", { count: "exact", head: true }).eq("member_id", id),
    db.from("bundles").select("*", { count: "exact", head: true }).eq("member_id", id),
  ]);
  const blocking = [
    { label: "invoice", n: invoices.count ?? 0 },
    { label: "featured placement", n: placements.count ?? 0 },
    { label: "advert", n: adverts.count ?? 0 },
    { label: "bundle", n: bundles.count ?? 0 },
  ].filter((r) => r.n > 0);
  if (blocking.length) {
    const found = blocking.map((r) => `${r.n} ${r.label}${r.n === 1 ? "" : "s"}`).join(", ");
    return memberFail(
      id,
      `This member has ${found} on record — deleting would destroy that history too. Archive them instead: the page comes off the public site and everything stays.`,
    );
  }

  // Read the logins BEFORE the delete: profiles.member_id is ON DELETE SET
  // NULL, so afterwards there is nothing left linking the two.
  const { data: profiles } = await db.from("profiles").select("user_id").eq("member_id", id);

  const { error } = await db.from("members").delete().eq("id", id);
  if (error) {
    return memberFail(
      id,
      error.code === "23503"
        ? "Something else still references this member — archive them instead."
        : dbProblem("action:deleteMember", error),
    );
  }

  // The log has no foreign key to members, so this row — with the name, since
  // the member is gone — is the lasting record of who deleted them.
  await audit({ action: "member_deleted", actorUserId: admin.userId, actorRole: "admin", memberId: id, detail: { name: member.name } });

  // Storage objects are outside the database, so the cascade never touched them.
  await removeMedia(member.logo_path);
  await removeMedia(member.hero_path);

  for (const profile of profiles ?? []) {
    const { error: authError } = await db.auth.admin.deleteUser(profile.user_id);
    // Best-effort: the member row is already gone, and failing the action here
    // would tell Jas the delete did not happen when most of it did.
    if (authError) logError({ source: "db", area: "action:deleteMember", error: authError.message, userId: admin.userId, context: { member_id: id, auth_user_id: profile.user_id, step: "delete-auth-user" } });
  }

  revalidateMemberSurfaces(id, member.slug);
  redirect(`/console/members?deleted=${encodeURIComponent(member.name)}`);
}

/* ---------- inbox ---------- */

/**
 * Clear the whole unread queue (fix list). Scoped to what is on screen — the
 * kind currently filtered on, and since fix-list 71 the category too.
 *
 * The category scope is the important half: without it, "mark all read" while
 * looking at Messages would also silently clear every notification, which is
 * the one thing a split feed must never do. The button only ever clears what
 * the operator can see.
 */
export async function markAllInboxRead(formData: FormData) {
  await requireConsole();
  const kind = String(formData.get("kind") ?? "");
  const category = String(formData.get("category") ?? "");
  let q = serviceDb().from("inbox_messages").update({ read: true }).eq("read", false);
  if (category) q = q.eq("category", category);
  if (kind) q = q.eq("kind", kind);
  await q;
  revalidatePath("/console");
  revalidatePath("/console/notifications");
}

export async function markInboxRead(formData: FormData) {
  await requireConsole();
  // existing callers (the overview card) omit "read" and always mean "mark read"
  const read = formData.get("read") !== "0";
  await serviceDb().from("inbox_messages").update({ read }).eq("id", String(formData.get("id")));
  revalidatePath("/console");
  revalidatePath("/console/notifications");
  // Optional bounce. Two callers use it: the detail page marks itself read on
  // render, so its "mark unread" must land back on the list or it would undo
  // itself; and a notification row's "Open it" marks read and then jumps to the
  // thing the notification is about, in one action.
  const next = safeInternalPath(formData.get("next"));
  if (next) redirect(next);
}

/**
 * Admin reply to an inbox enquiry (fix-list 71b, GAPS B3.4).
 *
 * Three things changed from the fire-and-forget version:
 *
 *  1. The reply row is written BEFORE the send, then stamped with `sent_at` or
 *     `delivery_error`. A provider rejection used to redirect with an error and
 *     destroy whatever had just been typed — the thread now keeps it, and the
 *     detail page shows why it did not go.
 *  2. The wording goes through `renderReply`, so it carries the member shell and
 *     whatever Jas has edited the `admin_reply` template to say. The raw form
 *     fields are no longer what gets sent.
 *  3. Rows with nobody on the other end are refused outright rather than
 *     emailing the empty string. The page hides the form on those, but the
 *     action is reachable by direct POST and must not rely on that.
 */
export async function replyToInboxMessage(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const back = `/console/notifications/${id}`;
  if (!subject || !body) redirect(`${back}?error=${encodeURIComponent("Subject and message are required.")}`);

  const db = serviceDb();
  // `name` rides along for the reply's greeting; `category`/`email` decide
  // whether a reply is a coherent thing to send at all.
  const { data: m } = await db.from("inbox_messages").select("name, email, category").eq("id", id).single();
  if (!m) redirect(`${back}?error=${encodeURIComponent("Message not found.")}`);
  if (m.category !== "message") {
    redirect(`${back}?error=${encodeURIComponent("This is a notification, not a message — there is nobody to reply to.")}`);
  }
  if (!m.email) {
    redirect(`${back}?error=${encodeURIComponent("No email address came with this message, so there is nobody to reply to.")}`);
  }

  const { data: reply } = await db.from("inbox_replies")
    .insert({ message_id: id, subject, body, sent_by: user.userId })
    .select("id")
    .single();

  let failure: string | null = null;
  try {
    const [{ getEmailSender }, { renderReply }, { loadEmailTemplates }] = await Promise.all([
      import("@/lib/adapters/email"),
      import("@/lib/email/templates"),
      import("@/lib/email/store"),
    ]);
    const mail = renderReply({ name: m.name, subject, body }, await loadEmailTemplates());
    await getEmailSender().send({ to: m.email, ...mail });
  } catch (e) {
    logError({ source: "adapter", area: "action:replyToInboxMessage", error: e, userId: user.userId, context: { message_id: id } });
    failure = e instanceof Error ? e.message.slice(0, 300) : "The mail provider rejected it.";
  }

  const now = new Date().toISOString();
  if (failure) {
    if (reply) await db.from("inbox_replies").update({ delivery_error: failure }).eq("id", reply.id);
  } else {
    if (reply) await db.from("inbox_replies").update({ sent_at: now }).eq("id", reply.id);
    await db.from("inbox_messages").update({ replied_at: now }).eq("id", id);
  }

  revalidatePath("/console");
  revalidatePath("/console/notifications");
  revalidatePath(back);
  if (failure) {
    redirect(`${back}?error=${encodeURIComponent("Could not send — the mail provider rejected it. Your wording is saved below; try again.")}`);
  }
  redirect(`${back}?replied=1`);
}

/* ---------- media library ---------- */

export async function renameMedia(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await serviceDb()
    .from("media")
    .update({
      original_name: String(formData.get("original_name") ?? "").trim() || null,
      alt_text: String(formData.get("alt_text") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidatePath("/console/media");
}

export async function deleteMedia(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const path = String(formData.get("path") ?? "");
  if (!id || !path || formData.get("confirm") !== "1") return;
  await removeMedia(path);
  revalidatePath("/console/media");
}

/* ---------- content pages ---------- */

/**
 * Create or update a standalone page (About, Policies, the MACH magazine page…).
 *
 * Until now `static_pages` had no writer anywhere in the app — the four rows in
 * it came from scripts/seed.ts, so changing a word of the About page meant a
 * reseed. This is that missing surface. Note it is NOT /console/pages, which
 * arranges blocks; this one owns the words.
 */
export async function saveContentPage(formData: FormData) {
  await requireConsole();

  const originalSlug = String(formData.get("original_slug") ?? "").trim();
  const isNew = !originalSlug;
  const title = String(formData.get("title") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || title);
  const body = sanitizeRichText(String(formData.get("body") ?? ""));
  const collapsible = formData.get("collapsible") === "on";

  const fail = (message: string): never =>
    redirect(`/console/content-pages/${isNew ? "new" : originalSlug}?error=${encodeURIComponent(message)}`);
  if (!title) return fail("Give the page a title.");
  if (!slug) return fail("That title has no letters or numbers in it — add a web address by hand.");

  const db = serviceDb();
  const { data: clash } = await db.from("static_pages").select("slug").eq("slug", slug).maybeSingle();
  if (clash && slug !== originalSlug) return fail(`The web address “${slug}” is already used by another page.`);

  if (isNew) {
    const { error } = await db.from("static_pages").insert({ slug, title, body, collapsible });
    if (error) return fail(dbProblem("action:saveContentPage", error));
  } else {
    const { error } = await db
      .from("static_pages")
      .update({ slug, title, body, collapsible, updated_at: new Date().toISOString() })
      .eq("slug", originalSlug);
    if (error) return fail(dbProblem("action:saveContentPage", error));
    if (slug !== originalSlug) {
      // Same contract as the member rename: keep the old URL working, and let
      // recordRename clear the reverse row so renaming back cannot build a loop.
      await recordRename(`/pages/${originalSlug}`, `/pages/${slug}`);
    }
  }

  revalidatePath(`/pages/${slug}`);
  revalidatePath("/console/content-pages");
  redirect(`/console/content-pages/${slug}?saved=1`);
}

export async function deleteContentPage(formData: FormData) {
  await requireConsole();
  const slug = String(formData.get("slug") ?? "");
  if (!slug) return;
  await serviceDb().from("static_pages").delete().eq("slug", slug);
  revalidatePath("/console/content-pages");
  redirect("/console/content-pages?deleted=1");
}

/* ---------- news categories ---------- */

export async function saveCategory(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const slug = slugify(String(formData.get("slug") ?? "").trim() || name);
  const db = serviceDb();

  if (id) {
    await db.from("categories").update({ name, slug }).eq("id", Number(id));
  } else {
    const { error } = await db.from("categories").insert({ name, slug });
    if (error) {
      redirect(
        `/console/categories/new?error=${encodeURIComponent(
          error.code === "23505" ? "That slug is already used by another category." : dbProblem("action:saveCategory", error)
        )}`
      );
    }
  }
  revalidatePath("/console/categories");
  revalidatePath("/news");
  redirect("/console/categories?saved=1");
}

export async function deleteCategory(formData: FormData) {
  await requireConsole();
  const id = Number(formData.get("id"));
  if (!id || formData.get("confirm") !== "1") {
    redirect(`/console/categories/${id}?error=${encodeURIComponent("Tick the confirm box to delete this category.")}`);
  }
  const { error } = await serviceDb().from("categories").delete().eq("id", id);
  if (error) {
    redirect(`/console/categories/${id}?error=${encodeURIComponent(dbProblem("action:deleteCategory", error))}`);
  }
  revalidatePath("/console/categories");
  revalidatePath("/news");
  redirect("/console/categories?deleted=1");
}

/* ---------- industries ---------- */

export async function saveIndustry(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const slug = slugify(String(formData.get("slug") ?? "").trim() || name);
  const sort_order = Number(formData.get("sort_order")) || 0;
  const db = serviceDb();

  if (id) {
    await db.from("industries").update({ name, slug, sort_order }).eq("id", Number(id));
  } else {
    const { error } = await db.from("industries").insert({ name, slug, sort_order });
    if (error) {
      redirect(
        `/console/industries/new?error=${encodeURIComponent(
          error.code === "23505" ? "That slug is already used by another industry." : dbProblem("action:saveIndustry", error)
        )}`
      );
    }
  }
  // The industry strip is in the public layout, so it renders on every public
  // page — revalidating just /console/industries would leave the site stale.
  revalidatePath("/console/industries");
  revalidatePath("/", "layout");
  redirect("/console/industries?saved=1");
}

export async function deleteIndustry(formData: FormData) {
  await requireConsole();
  const id = Number(formData.get("id"));
  if (!id || formData.get("confirm") !== "1") {
    redirect(`/console/industries/${id}?error=${encodeURIComponent("Tick the confirm box to delete this industry.")}`);
  }
  const { error } = await serviceDb().from("industries").delete().eq("id", id);
  if (error) {
    redirect(
      `/console/industries/${id}?error=${encodeURIComponent(
        error.code === "23503"
          ? "This industry is still assigned to a member, story, video or event — reassign them first."
          : dbProblem("action:deleteIndustry", error)
      )}`
    );
  }
  revalidatePath("/console/industries");
  revalidatePath("/", "layout");
  redirect("/console/industries?deleted=1");
}

/* ---------- promo codes ---------- */

export async function savePromoCode(formData: FormData) {
  await requireConsole();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!code) return;
  const months = Number(formData.get("months") || 0);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    redirect(`/console/promo-codes?error=${encodeURIComponent("Months must be a whole number from 1 to 60.")}`);
  }
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  if (maxUsesRaw && (!Number.isInteger(maxUses) || (maxUses as number) < 1)) {
    redirect(`/console/promo-codes?error=${encodeURIComponent("Max uses must be a whole number, or left blank for unlimited.")}`);
  }
  const expiresAt = String(formData.get("expires_at") ?? "").trim() || null;

  const { error } = await serviceDb().from("promo_codes").insert({ code, months, max_uses: maxUses, expires_at: expiresAt });
  if (error) {
    redirect(`/console/promo-codes?error=${encodeURIComponent(
      error.code === "23505" ? "That code already exists." : dbProblem("action:savePromoCode", error)
    )}`);
  }
  revalidatePath("/console/promo-codes");
  redirect("/console/promo-codes?saved=1");
}

export async function setPromoCodeActive(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await serviceDb().from("promo_codes").update({ active: formData.get("active") === "1" }).eq("id", id);
  revalidatePath("/console/promo-codes");
}

/* ---------- member resources ---------- */

export async function saveResource(formData: FormData) {
  await requireConsole();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  if (!hasSubmittedFile(formData, "file")) redirect(`/console/resources?error=${encodeURIComponent("Choose a file to upload.")}`);

  let path: string | null = null;
  let isPdf = false;
  try {
    // The file itself, or the one staged for it (lib/staged-upload) — its
    // type, like a posted file's, picks which of the two checks it gets.
    const file = await submittedFile(formData, "file", CONSOLE_UPLOADS);
    isPdf = file?.type === "application/pdf";
    path = isPdf ? await uploadDocument(file, "resources") : await uploadImage(file, "resources");
  } catch (e) {
    redirect(`/console/resources?error=${encodeURIComponent(uploadFailureMessage(e, "action:saveResource"))}`);
  }
  if (!path) redirect(`/console/resources?error=${encodeURIComponent("Upload failed.")}`);

  const { error } = await serviceDb().from("resources").insert({ title, path, kind: isPdf ? "document" : "image" });
  if (error) {
    await removeMedia(path);
    redirect(`/console/resources?error=${encodeURIComponent(dbProblem("action:saveResource", error))}`);
  }
  revalidatePath("/console/resources");
  revalidatePath("/dashboard/resources");
  redirect("/console/resources?saved=1");
}

export async function deleteResource(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id || formData.get("confirm") !== "1") return;
  const { data: resource } = await serviceDb().from("resources").select("path").eq("id", id).single();
  await serviceDb().from("resources").delete().eq("id", id);
  if (resource?.path) await removeMedia(resource.path);
  revalidatePath("/console/resources");
  revalidatePath("/dashboard/resources");
  redirect("/console/resources?deleted=1");
}

/* ---------- dev board ---------- */

/** updated_at is stamped by hand — there is no trigger in this database, by convention. */

const devFail = (id: string, message: string): never =>
  redirect(`/console/dev/${id}?error=${encodeURIComponent(message)}`);

/** Mirrors the return_to allowlist at saveStory (line ~100) for /console/dev. */
function devBackTo(formData: FormData): string {
  const back = String(formData.get("return_to") ?? "");
  return /^\/console\/dev(\?[\w=&,%.-]*)?$/.test(back) ? back : "/console/dev";
}

/** Quick-add from a board column or the list view: title only, appended to the end of its column. */
export async function createDevTask(formData: FormData) {
  const user = await requireConsole();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return;

  const statusRaw = String(formData.get("status") ?? "");
  const status: DevStatus = (DEV_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as DevStatus) : "not_started";
  const assigneeRaw = String(formData.get("assignee") ?? "");
  const assignee = (DEV_ASSIGNEES as readonly string[]).includes(assigneeRaw) ? assigneeRaw : null;

  const db = serviceDb();
  const { data: last } = await db
    .from("dev_tasks")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  await db.from("dev_tasks").insert({
    title,
    status,
    assignee,
    created_by: user.userId,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  revalidatePath("/console/dev");
}

/**
 * Detail-page form: insert or update. On success, returns to the filtered
 * board the caller came from — Save is a quick in-and-out edit, not a
 * dedicated editing session. On a validation error, re-renders the same
 * detail page instead, so a rejected edit doesn't lose the in-progress form.
 */
export async function saveDevTask(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const parsed = devTaskValuesFromForm(formData);
  if ("error" in parsed) {
    redirect(`/console/dev/${id || "new"}?error=${encodeURIComponent(parsed.error)}`);
  }

  const db = serviceDb();
  if (id) {
    await db.from("dev_tasks").update({ ...parsed.values, updated_at: new Date().toISOString() }).eq("id", id);
  } else {
    const status = parsed.values.status ?? "not_started";
    const { data: last } = await db
      .from("dev_tasks")
      .select("sort_order")
      .eq("status", status)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    await db.from("dev_tasks").insert({ ...parsed.values, created_by: user.userId, sort_order: (last?.sort_order ?? -1) + 1 });
  }
  revalidatePath("/console/dev");
  const to = devBackTo(formData);
  redirect(`${to}${to.includes("?") ? "&" : "?"}saved=1`);
}

/** The card's status dropdown — the keyboard/no-JS path, and how a card leaves the board (via "canceled"). */
export async function setDevTaskStatus(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const statusRaw = String(formData.get("status") ?? "");
  if (!id || !(DEV_STATUSES as readonly string[]).includes(statusRaw)) return;
  const status = statusRaw as DevStatus;

  const db = serviceDb();
  const { data: last } = await db
    .from("dev_tasks")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  await db
    .from("dev_tasks")
    .update({ status, sort_order: (last?.sort_order ?? -1) + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/console/dev");
}

export async function deleteDevTask(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  if (formData.get("confirm") !== "1") return devFail(id, "Tick the confirm box to delete this task.");
  await serviceDb().from("dev_tasks").delete().eq("id", id);
  revalidatePath("/console/dev");
  const to = devBackTo(formData);
  redirect(`${to}${to.includes("?") ? "&" : "?"}deleted=1`);
}

/**
 * Drag-and-drop persistence — a typed server action called directly from a
 * client component rather than FormData from a <form action=>. New for this
 * repo, but standard Next; the arguments are still attacker-controlled, so
 * every value is checked against the const arrays / real rows before use.
 * orderedIds is the full, dense id list of the destination column after the
 * move — every id in it belongs to `status` now. Concurrent per-row updates,
 * not a single upsert: upsert()'s types require every Insert-only column
 * (title included), which a reorder that only ever touches existing rows has
 * no business setting.
 */
export async function moveDevTask(input: { id: string; status: string; orderedIds: string[] }) {
  await requireConsole();
  if (!(DEV_STATUSES as readonly string[]).includes(input.status)) return;
  const status = input.status as DevStatus;

  const db = serviceDb();
  const { data: existing } = await db.from("dev_tasks").select("id").in("id", input.orderedIds);
  const validIds = new Set((existing ?? []).map((r) => r.id));
  const orderedIds = input.orderedIds.filter((id) => validIds.has(id));
  if (!orderedIds.includes(input.id)) return;

  await Promise.all(orderedIds.map((id, index) => db.from("dev_tasks").update({ status, sort_order: index }).eq("id", id)));
  revalidatePath("/console/dev");
}

/* ---------- lead gen ---------- */

/**
 * GAPS A8.3 / USE-CASES A29: mark a prospect to call, email, or add to a
 * sequence. The prospect itself lives in the `LeadGenSource` adapter, not our
 * database, so all that is persisted is the mark — see the adapter for why
 * Phase 1's source is a fixture.
 */
export async function markProspect(formData: FormData) {
  await requireConsole();
  const ref = String(formData.get("ref") ?? "").trim();
  const action = String(formData.get("action") ?? "");
  // The DB check constraint is the backstop, not the gate.
  if (!ref || !isProspectAction(action)) return;

  await getLeadGenSource().mark(ref, action, { memberId: null });

  const q = String(formData.get("q") ?? "");
  revalidatePath("/console/leads");
  // Back to the same search, rather than dumping the operator on an empty panel.
  redirect(`/console/leads?${q ? `${q}&` : ""}saved=1`);
}

/* ---------- email templates ---------- */

/**
 * Editing the copy of every email the site sends (fix-list 63).
 *
 * `email_templates` is an override table: a blank field is stored as null and
 * falls back to the copy shipped in `src/lib/email/defaults.ts`, so a kind
 * nobody has touched still picks up copy fixes made in code. "Reset to default"
 * is therefore a DELETE, not a re-write.
 */

const templateFail = (kind: string, message: string): never =>
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?error=${encodeURIComponent(message)}`);

/** Blank means "fall back to the default", so it is stored as null rather than "". */
const orNull = (formData: FormData, field: string): string | null => {
  const value = String(formData.get(field) ?? "").trim();
  return value ? value : null;
};

export async function saveEmailTemplate(formData: FormData) {
  const user = await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();

  const { EDITABLE_KINDS, validateEmailTemplate } = await import("@/lib/email/templates");
  if (!EDITABLE_KINDS.includes(kind)) {
    redirect(`/console/email-templates?error=${encodeURIComponent("That email doesn't exist.")}`);
  }

  const fields = {
    subject: orNull(formData, "subject"),
    label: orNull(formData, "label"),
    body_html: orNull(formData, "body_html"),
    body_text: orNull(formData, "body_text"),
    cta_label: orNull(formData, "cta_label"),
  };

  // A mistyped token renders as literal braces in a member's inbox and the
  // person who typed it never finds out, so this refuses the save rather than
  // warning about it.
  const invalid = validateEmailTemplate(kind, fields);
  if (invalid) templateFail(kind, invalid);

  const { EMAIL_DEFAULTS } = await import("@/lib/email/defaults");
  const family = EMAIL_DEFAULTS[kind as keyof typeof EMAIL_DEFAULTS].family;

  const { error } = await serviceDb().from("email_templates").upsert({
    kind,
    family,
    ...fields,
    // Stamped by hand: no triggers in this database, by convention.
    updated_at: new Date().toISOString(),
    updated_by: user.userId,
  });
  if (error) templateFail(kind, dbProblem("action:saveEmailTemplate", error));

  revalidatePath("/console/email-templates");
  revalidatePath(`/console/email-templates/${kind}`);
  // The in-app notification feed reads its labels from the same row.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?saved=1`);
}

export async function resetEmailTemplate(formData: FormData) {
  await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!kind || formData.get("confirm") !== "1") {
    templateFail(kind, "Tick the confirm box to put this email back to its original wording.");
  }

  // Deleting the row IS the reset: with nothing stored, every field falls back
  // to the copy in src/lib/email/defaults.ts.
  const { error } = await serviceDb().from("email_templates").delete().eq("kind", kind);
  if (error) templateFail(kind, dbProblem("action:resetEmailTemplate", error));

  revalidatePath("/console/email-templates");
  revalidatePath(`/console/email-templates/${kind}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?reset=1`);
}

/**
 * Sends the logged-in admin a copy of this email, as it currently stands.
 *
 * Always to `user.email` and never to a typed address: a free-text recipient
 * field here would be an authenticated open relay on the SMI sending domain.
 */
export async function sendTestEmail(formData: FormData) {
  const user = await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!user.email) templateFail(kind, "Your console account has no email address to send to.");

  const [{ getEmailSender }, { renderPreview }, { loadEmailTemplates }] = await Promise.all([
    import("@/lib/adapters/email"),
    import("@/lib/email/templates"),
    import("@/lib/email/store"),
  ]);

  const mail = renderPreview(kind, await loadEmailTemplates());
  try {
    // The sender throws on a provider rejection by design, so that a bad key or
    // an unverified domain is visible rather than silent.
    await getEmailSender().send({ to: user.email!, subject: `[Test] ${mail.subject}`, text: mail.text, html: mail.html });
  } catch (e) {
    templateFail(kind, e instanceof Error ? e.message : "The test email could not be sent.");
  }
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?tested=1`);
}
