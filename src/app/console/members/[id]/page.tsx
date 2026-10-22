import Link from "next/link";
import { notFound } from "next/navigation";
import { memberActivityTimeline } from "@/lib/activity";
import { requireConsole } from "@/lib/auth";
import { memberLogins, type MemberLogin } from "@/lib/member-logins";
import { memberAdminAccess, type AuditRow } from "@/lib/audit";
import { startViewAs } from "@/app/view-as/actions";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { londonInputValue } from "@/lib/london-time";
import { Badge, Card, SectionTitle } from "@/components/console/ui";
import { CompanyPageForm } from "@/components/member/CompanyPageForm";
import { SubmitButton } from "@/components/SubmitButton";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import {
  archiveMember, consoleUploadImage, createMember, decideRevision, deleteMember, recordMemberPayment,
  saveMember, setMemberStatus, unarchiveMember,
} from "../../actions";
import { DeleteMemberDialog } from "./DeleteMemberDialog";
import { parseRevisionPayload, revisionChanges } from "../../member-revision";
import { RevisionChanges } from "@/components/console/RevisionChanges";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "green", grace: "brand", lapsed: "red", draft: "neutral" } as const;

const field = "mt-1 w-full rounded border px-3 py-2";
const label = "text-sm font-medium";

export default async function MemberEditor(props: PageProps<"/console/members/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const error = typeof sp.error === "string" ? sp.error : null;

  if (id === "new") {
    return (
      <div className="mx-auto max-w-lg">
        <Link href="/console/members" className="text-sm text-graphite hover:text-ink">← Members</Link>
        <h1 className="mt-1 text-xl font-bold text-ink">New member</h1>
        <p className="mt-1 text-sm text-graphite">
          Creates their login and a draft company page. Industry, page content and billing come next, on the edit screen.
        </p>
        {error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
        <Card className="mt-4">
          <form action={createMember} className="space-y-4">
            <UnsavedChangesGuard />
            <div>
              <label htmlFor="company" className={label}>Company name</label>
              <input id="company" name="company" required className={field} />
            </div>
            <div>
              <label htmlFor="email" className={label}>Email (their login)</label>
              <input id="email" name="email" type="email" required className={field} />
            </div>
            <div>
              <label htmlFor="password" className={label}>Password</label>
              <input id="password" name="password" type="password" required minLength={8} className={field} />
              <p className="mt-1 text-xs text-graphite">
                At least 8 characters. Pass it to them yourself — no email is sent from here.
              </p>
            </div>
            <SubmitButton pendingLabel="Creating…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
              Create member
            </SubmitButton>
          </form>
        </Card>
      </div>
    );
  }

  // A malformed id would otherwise reach Postgres as an invalid uuid (22P02),
  // which must() now turns into a thrown error — a typo'd URL deserves the 404
  // it has always given, so screen it out first. Same guard as blocks/layouts.ts.
  if (!UUID_RE.test(id)) notFound();

  const [member, inds, memberInds, revisions, types, memberTypes, svcs, memberSvcs] = await Promise.all([
    // maybeSingle, not single: a member id that does not exist is an ordinary
    // 404 below, not a query failure worth throwing over.
    must(db.from("members").select(
      "id, slug, name, status, archived_at, industry_id, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, billing_mode, stripe_customer_id, joined_at, grace_until, paid_at, comped_until, draft_submitted_at, contact_email, is_bundle_account",
    ).eq("id", id).maybeSingle(), "console/members detail: member"),
    must(db.from("industries").select("id, name").order("sort_order"), "console/members detail: industries"),
    must(db.from("member_industries").select("industry_id").eq("member_id", id), "console/members detail: member industries"),
    must(db.from("member_revisions").select("id, created_at, payload").eq("member_id", id).eq("status", "awaiting_approval").order("created_at").limit(1), "console/members detail: revisions"),
    must(db.from("membership_types").select("id, name").order("sort_order"), "console/members detail: membership types"),
    must(db.from("member_membership_types").select("membership_type_id").eq("member_id", id), "console/members detail: member membership types"),
    // `services` has no sort_order column (20260909000001) — order by name.
    must(db.from("services").select("id, name").order("name"), "console/members detail: services"),
    must(db.from("member_services").select("service_id").eq("member_id", id), "console/members detail: member services"),
  ]);
  if (!member) notFound();
  const memberTypeIds = new Set((memberTypes ?? []).map((t) => t.membership_type_id));
  const memberServiceIds = new Set((memberSvcs ?? []).map((r) => r.service_id));
  const memberIndustryIds = new Set((memberInds ?? []).map((r) => r.industry_id));

  // the renewal-call view (A18) — stories, placements, invoices, notifications,
  // advert clicks and newsletter appearances (A5.8), merged in lib/activity.ts
  // so the CRM per-contact panel can reuse the exact same query.
  //
  // Logins: when each one last signed in, from Supabase Auth — the only
  // "do they use it" signal kept (fix-list 94; no tracking of our own).
  // Admin access: who viewed as or changed this member, from the security log
  // (lib/audit). The member's own sign-ins stay out of it.
  const [timeline, logins, adminAccess] = await Promise.all([memberActivityTimeline(id), memberLogins(id), memberAdminAccess(id)]);

  const logo = mediaUrl(member.logo_path);
  const hero = mediaUrl(member.hero_path);
  const isDraft = member.status === "draft";
  const isArchived = member.archived_at != null;
  // Two different things, and the link below needs both: `hasPage` is what
  // memberBySlug will serve at all, `isPublic` is whether anyone but an admin
  // can see it. Archiving is enforced in RLS (20260923000002), so an archived
  // member's page renders for an admin and 404s for everyone else.
  const hasPage = member.status === "active" || member.status === "grace";
  const isPublic = hasPage && !isArchived;
  const pendingRevision = revisions?.[0];
  // What Approve will actually write (member-revision.ts): allowlisted fields
  // only, compared against the page as it is now.
  const revision = pendingRevision ? parseRevisionPayload(pendingRevision.payload, id) : null;
  const revisionDiff = revision ? revisionChanges(revision.values, member) : [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/members" className="text-sm text-graphite hover:text-ink">← Members</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          {member.name}
          {/* An archived member is not publicly visible whatever their status,
              so the status badge drops its "live" green rather than saying two
              contradictory things side by side. */}
          <Badge tone={isArchived ? "neutral" : STATUS_TONE[member.status]}>{member.status}</Badge>
          {isArchived && <Badge tone="red">archived</Badge>}
          {!isArchived && member.status !== "active" && (
            isDraft && !member.paid_at && !member.comped_until ? (
              <span className="text-xs font-normal text-graphite">awaiting payment</span>
            ) : isDraft && !member.draft_submitted_at ? (
              <span className="text-xs font-normal text-graphite">awaiting page</span>
            ) : (
              <form action={setMemberStatus}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="active" />
                <button className="rounded bg-success px-3 py-1 text-xs font-semibold text-white">Activate</button>
              </form>
            )
          )}
        </h1>
        <span className="flex gap-4 text-sm">
          {hasPage && (
            <a href={`/member/${member.slug}`} className="text-graphite underline">
              {isPublic ? "View public page" : "Preview page (admin only)"}
            </a>
          )}
          <Link href={`/console/pages?type=member_profile&entity=${id}`} className="text-graphite underline">Page layout</Link>
          {/* Their real dashboard, read-only (fix-list 94) — a form, since it sets a cookie. */}
          <form action={startViewAs}>
            <input type="hidden" name="member_id" value={id} />
            <button className="text-graphite underline">View as member</button>
          </form>
        </span>
      </div>
      <LastSignedIn logins={logins} />

      {typeof sp.created === "string" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Member created — finish their details below.</p>
      )}
      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}

      {pendingRevision && (
        <Card id="changes" className="mt-4 border-brand/40 bg-brand/5">
          <SectionTitle>Changes awaiting approval</SectionTitle>
          <p className="mt-1 text-sm text-graphite">
            This member submitted edits on {pendingRevision.created_at.slice(0, 10)}. Approving applies the changes
            below and will overwrite anything you change here — decide this first.
          </p>
          {revision && (
            <RevisionChanges
              changes={revisionDiff}
              parsed={revision}
              mediaUrl={mediaUrl}
              sets={{
                services: { all: svcs ?? [], current: [...memberServiceIds] },
                membershipTypes: { all: types ?? [], current: [...memberTypeIds] },
                industries: { all: inds ?? [], current: [...memberIndustryIds] },
              }}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action={decideRevision}>
              <input type="hidden" name="id" value={pendingRevision.id} />
              <input type="hidden" name="decision" value="approve" />
              <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve &amp; apply</button>
            </form>
            <form action={decideRevision} className="flex flex-1 gap-2">
              <input type="hidden" name="id" value={pendingRevision.id} />
              <input type="hidden" name="decision" value="reject" />
              <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
              <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Reject</button>
            </form>
          </div>
        </Card>
      )}

      <form action={saveMember} className="mt-4 space-y-4">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={id} />

        <Card>
          <SectionTitle>Company page</SectionTitle>
          {/* Shared verbatim with /dashboard/profile — same row, same edit, so
              the same form. Anything admin-only belongs in the cards below. */}
          <div className="mt-3">
            <CompanyPageForm
              mode="console"
              member={member}
              industries={inds ?? []}
              services={svcs ?? []}
              membershipTypes={types ?? []}
              selectedServiceIds={memberServiceIds}
              selectedMembershipTypeIds={memberTypeIds}
              selectedIndustryIds={memberIndustryIds}
              uploadImage={consoleUploadImage}
              logoUrl={logo}
              heroUrl={hero}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle>Membership</SectionTitle>
          <fieldset className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="status" className={label}>Status</label>
                <select id="status" name="status" defaultValue={member.status} className={field}>
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="grace">grace</option>
                  <option value="lapsed">lapsed</option>
                </select>
                {isDraft && (
                  <p className="mt-1 text-xs text-graphite">
                    A draft can only go active once a payment or comp is on record.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="billing_mode" className={label}>Billing mode</label>
                <select id="billing_mode" name="billing_mode" defaultValue={member.billing_mode} className={field}>
                  <option value="card">card</option>
                  <option value="invoice">invoice</option>
                </select>
              </div>
              <div><label htmlFor="joined_at" className={label}>Joined</label><input id="joined_at" type="date" name="joined_at" defaultValue={member.joined_at ?? ""} className={field} /></div>
              <div><label htmlFor="grace_until" className={label}>Grace until</label><input id="grace_until" type="date" name="grace_until" defaultValue={member.grace_until ?? ""} className={field} /></div>
              <div>
                <label htmlFor="paid_at" className={label}>Paid at</label>
                <input id="paid_at" type="datetime-local" name="paid_at" defaultValue={londonInputValue(member.paid_at)} className={field} />
                <p className="mt-1 text-xs text-graphite">For corrections — use “Record payment” below to raise an invoice too.</p>
              </div>
              <div><label htmlFor="comped_until" className={label}>Comped until</label><input id="comped_until" type="date" name="comped_until" defaultValue={member.comped_until ?? ""} className={field} /></div>
            </div>
            {/* Contact email lives in the shared company-page form above, where
                the member edits it too. It was duplicated here briefly: two
                inputs of the same name in one form means the lower one silently
                wins, so an edit to the other would have been dropped. */}
            <p className="text-xs text-graphite">
              Page submitted: {member.draft_submitted_at?.slice(0, 10) ?? "not yet"}
              {member.stripe_customer_id && ` · Stripe customer ${member.stripe_customer_id}`}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="is_bundle_account" defaultChecked={member.is_bundle_account} className="mt-0.5" />
              <span>
                Bundle account
                <span className="block text-xs text-graphite">
                  Fulfilment tag only, for your own tracking — never affects which adverts rotate or how often.
                </span>
              </span>
            </label>
          </fieldset>
        </Card>

        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
          Save changes
        </SubmitButton>
      </form>

      <Card className="mt-4">
        <SectionTitle>Record a payment</SectionTitle>
        <p className="mt-1 text-sm text-graphite">
          For payments taken offline. A payment raises the £40 invoice the member sees under Billing; a comp just extends their free period.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <form action={recordMemberPayment}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value="paid" />
            <button className="rounded bg-ink px-4 py-2 text-sm text-white">Record £40 payment</button>
          </form>
          <form action={recordMemberPayment} className="flex items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value="comped" />
            <input type="number" name="months" defaultValue={12} min={1} max={60} className="w-20 rounded border px-3 py-1.5 text-sm" />
            <button className="rounded border border-ink px-4 py-1.5 text-sm text-ink">Comp for months</button>
          </form>
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Activity</SectionTitle>
        <ul className="mt-2 space-y-1.5 text-sm">
          {timeline.map((t, i) => (
            <li key={i} className="flex gap-3 border-t pt-1.5">
              <span className="w-24 shrink-0 text-xs text-graphite">{t.when?.slice(0, 10)}</span>
              <span>{t.what}</span>
            </li>
          ))}
          {timeline.length === 0 && <p className="text-sm text-graphite">No activity yet.</p>}
        </ul>
      </Card>

      <AdminAccessCard rows={adminAccess} />

      <Card className="mt-4 border-danger/30">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="mt-3 border-t pt-3">
          <p className="text-sm font-medium text-ink">
            {isArchived ? "Archived" : "Archive"}
            {isArchived && member.archived_at && (
              <span className="ml-2 text-xs font-normal text-graphite">since {member.archived_at.slice(0, 10)}</span>
            )}
          </p>
          <p className="mt-1 text-sm text-graphite">
            {isArchived ? (
              <>
                This member is hidden from the directory, the map, search and the sitemap. Their page is visible to you
                only. Stories, videos and events they are tagged on still exist, but the credit and the link to them are
                not rendered. Nothing has been deleted.
              </>
            ) : (
              <>
                Hides the member from the directory, the map, search and the sitemap, and stops their name linking out of
                anyone else&apos;s content. Everything is kept, and you can bring them back at any time.
              </>
            )}
          </p>
          <form action={isArchived ? unarchiveMember : archiveMember} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <SubmitButton
              pendingLabel={isArchived ? "Restoring…" : "Archiving…"}
              className="rounded border border-ink px-4 py-2 text-sm text-ink disabled:opacity-50"
            >
              {isArchived ? "Restore to the public site" : "Archive this member"}
            </SubmitButton>
          </form>
        </div>

        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium text-ink">Delete</p>
          <p className="mt-1 text-sm text-graphite">
            Permanent, and for mistakes only — a spam signup, or a duplicate. Refused outright if the member has any
            invoice, featured placement, advert or bundle on record, because deleting them would take that history too.
            Archive is the answer in every other case.
          </p>
          <div className="mt-3">
            <DeleteMemberDialog action={deleteMember} id={id} name={member.name} archived={isArchived} />
          </div>
        </div>
      </Card>
    </div>
  );
}

const signedInAt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

/**
 * When the member's login(s) last signed in. Supabase moves this only on a
 * real sign-in, not when a session refreshes — so it's "last signed in", never
 * "last seen". One shared login per company today; more get one line each.
 */
function LastSignedIn({ logins }: { logins: MemberLogin[] }) {
  if (logins.length === 0) return <p className="mt-1 text-sm text-graphite">No login yet.</p>;
  return (
    <ul className="mt-1 text-sm text-graphite">
      {logins.map((l) => (
        <li key={l.userId}>
          Last signed in: <span className="tabular-nums text-ink">{l.lastSignInAt ? signedInAt(l.lastSignInAt) : "Never"}</span>
          {logins.length > 1 && <> · {l.email ?? "unknown login"}</>}
        </li>
      ))}
    </ul>
  );
}

const ACCESS_LABEL: Partial<Record<AuditRow["action"], string>> = {
  view_as_start: "Viewed as member",
  view_as_stop: "Left the member view",
  member_created: "Created the member",
  member_updated: "Edited the member",
  member_status_changed: "Changed status",
  member_payment_recorded: "Recorded a payment",
  member_archived: "Archived",
  member_unarchived: "Unarchived",
};

/**
 * Admin access to this member, newest first (docs/GDPR.md §16). Read-only by
 * construction: the log can't be edited or deleted from the app.
 */
function AdminAccessCard({ rows }: { rows: AuditRow[] }) {
  return (
    <Card className="mt-4">
      <SectionTitle>Admin access</SectionTitle>
      <p className="mt-1 text-sm text-graphite">Who has viewed as this member or changed their record. Kept for 12 months; it can&apos;t be edited.</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-graphite">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3 border-t pt-1.5">
              <span className="w-36 shrink-0 text-xs tabular-nums text-graphite">{signedInAt(r.at)}</span>
              <span>
                {ACCESS_LABEL[r.action] ?? r.action}
                {r.action === "member_status_changed" && typeof r.detail.from === "string" && typeof r.detail.to === "string" && (
                  <> ({r.detail.from} → {r.detail.to})</>
                )}
                <span className="text-graphite"> · {r.actorName ?? "unknown admin"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
