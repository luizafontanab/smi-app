import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { CompanyPageForm } from "@/components/member/CompanyPageForm";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { memberUploadImage, submitProfileEdit } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your page" };

const SELECT =
  "name, slug, status, industry_id, description, address, phone, website, video_url, social, contact_email, lat, lng, logo_path, hero_path";

/**
 * The member editing their own company page.
 *
 * The form itself is `CompanyPageForm`, shared verbatim with
 * `/console/members/[id]` — same row, same edit, so the same fields in the same
 * order with the same labels. The console differs only by what it adds *below*
 * the form: membership status and billing, recording a payment, the activity
 * timeline and the approve/reject panel. None of that belongs here.
 */
export default async function MemberProfilePage(props: PageProps<"/dashboard/profile">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [{ data: m }, { data: pendingRev }, { data: inds }, { data: svcs }, { data: mySvcs }, { data: types }, { data: myTypes }] =
    await Promise.all([
      db.from("members").select(SELECT).eq("id", user.memberId).single(),
      db.from("member_revisions").select("id").eq("member_id", user.memberId).eq("status", "awaiting_approval").limit(1),
      db.from("industries").select("id, name").order("sort_order"),
      db.from("services").select("id, name").order("name"),
      db.from("member_services").select("service_id").eq("member_id", user.memberId),
      db.from("membership_types").select("id, name").order("sort_order"),
      db.from("member_membership_types").select("membership_type_id").eq("member_id", user.memberId),
    ]);
  if (!m) return null;

  const isDraft = m.status === "draft";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="mx-auto max-w-4xl">
      {isDraft && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-text">Step 3 of 4</p>}
      <h1 className="mt-1 text-xl font-bold text-ink">{isDraft ? "Build your company page" : "Update your page"}</h1>
      {isDraft ? (
        <p className="mt-1 text-sm text-graphite">Submitting sends your page to Jas for review — once approved, you&apos;re live in the directory.</p>
      ) : pendingRev?.length ? (
        <p className="mt-2 rounded bg-brand/10 p-2 text-sm text-graphite">You have changes awaiting approval — new edits replace them.</p>
      ) : (
        <p className="mt-1 text-sm text-graphite">Changes go live after a quick editorial check.</p>
      )}
      {error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}

      <form action={submitProfileEdit} className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <UnsavedChangesGuard />
        <CompanyPageForm
          mode="member"
          member={m}
          industries={inds ?? []}
          services={svcs ?? []}
          membershipTypes={types ?? []}
          selectedServiceIds={new Set((mySvcs ?? []).map((r) => r.service_id))}
          selectedMembershipTypeIds={new Set((myTypes ?? []).map((r) => r.membership_type_id))}
          uploadImage={memberUploadImage}
          logoUrl={mediaUrl(m.logo_path)}
          heroUrl={mediaUrl(m.hero_path)}
        />
        <button className="mt-4 rounded bg-ink px-5 py-2.5 text-white">
          {isDraft ? "Submit page for approval" : "Submit changes"}
        </button>
      </form>
    </div>
  );
}
