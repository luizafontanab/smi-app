import { SubmitButton } from "@/components/SubmitButton";
import { requireMemberView } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { CompanyPageForm } from "@/components/member/CompanyPageForm";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { memberUploadImage, submitProfileEdit } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your page" };

const SELECT =
  "name, slug, status, description, address, phone, website, video_url, social, contact_email, lat, lng, logo_path, hero_path";

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
  const user = await requireMemberView();
  const sp = await props.searchParams;
  const db = serviceDb();
  // No industries: they are Jas's alone, set in the console.
  const [{ data: m }, { data: pendingRev }, { data: svcs }, { data: mySvcs }, { data: types }, { data: myTypes }] =
    await Promise.all([
      db.from("members").select(SELECT).eq("id", user.memberId).single(),
      db.from("member_revisions").select("id").eq("member_id", user.memberId).eq("status", "awaiting_approval").limit(1),
      db.from("services").select("id, name").order("name"),
      db.from("member_services").select("service_id").eq("member_id", user.memberId),
      db.from("membership_types").select("id, name").order("sort_order"),
      db.from("member_membership_types").select("membership_type_id").eq("member_id", user.memberId),
    ]);
  if (!m) return null;

  const isDraft = m.status === "draft";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="max-w-4xl lg:mx-auto">
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

      <form action={submitProfileEdit} className="mt-5 rounded-xl bg-white p-4 shadow-sm sm:p-6">
        <UnsavedChangesGuard />
        <CompanyPageForm
          mode="member"
          member={m}
          services={svcs ?? []}
          membershipTypes={types ?? []}
          selectedServiceIds={new Set((mySvcs ?? []).map((r) => r.service_id))}
          selectedMembershipTypeIds={new Set((myTypes ?? []).map((r) => r.membership_type_id))}
          uploadImage={memberUploadImage}
          logoUrl={mediaUrl(m.logo_path)}
          heroUrl={mediaUrl(m.hero_path)}
        />
        {/* Sticky to the bottom of the screen while the form is in view: on a
            phone the form is ~3,000px and the only submit sat at the very end
            (#33 M17). One form, one action — the bar just keeps it in reach. */}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-6 sm:-mx-6 sm:-mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-b-xl border-t bg-white/95 px-4 py-3 sm:px-6 backdrop-blur">
          <p className="text-xs text-graphite">
            {isDraft ? "Sent to Jas for review." : "Changes go live after a quick editorial check."}
          </p>
          <SubmitButton pendingLabel="Submitting…" className="rounded bg-ink px-5 py-2.5 text-white">
            {isDraft ? "Submit page for approval" : "Submit changes"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
