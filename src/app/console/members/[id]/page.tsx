import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canWrite, requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { socialFieldName } from "@/lib/member-form";
import { renderableHtml } from "@/lib/sanitize";
import { SOCIAL_CHANNELS } from "@/lib/social";
import { Badge, Card, SectionTitle } from "@/components/console/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { SubmitButton } from "@/components/SubmitButton";
import {
  consoleUploadImage, createMember, decideRevision, recordMemberPayment, saveMember,
} from "../../actions";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "green", grace: "brand", lapsed: "red", draft: "neutral" } as const;

const field = "mt-1 w-full rounded border px-3 py-2";
const label = "text-sm font-medium";

export default async function MemberEditor(props: PageProps<"/console/members/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireConsole();
  const editable = canWrite(user);
  const db = serviceDb();
  const error = typeof sp.error === "string" ? sp.error : null;

  if (id === "new") {
    return (
      <div className="mx-auto max-w-lg">
        <Link href="/console/members" className="text-sm text-gray-400 hover:text-ink">← Members &amp; CRM</Link>
        <h1 className="mt-1 text-xl font-bold text-ink">New member</h1>
        <p className="mt-1 text-sm text-gray-500">
          Creates their login and a draft company page. Category, page content and billing come next, on the edit screen.
        </p>
        {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <Card className="mt-4">
          <form action={createMember} className="space-y-4">
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
              <p className="mt-1 text-xs text-gray-400">
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

  const [{ data: member }, { data: cats }, { data: revisions }] = await Promise.all([
    db.from("members").select(
      "id, slug, name, status, category_id, description, address, lat, lng, phone, website, logo_path, hero_path, video_url, social, testimonials, billing_mode, stripe_customer_id, joined_at, grace_until, paid_at, comped_until, draft_submitted_at, contact_email",
    ).eq("id", id).single(),
    db.from("categories").select("id, name").eq("kind", "member").order("name"),
    db.from("member_revisions").select("id, created_at").eq("member_id", id).eq("status", "awaiting_approval").limit(1),
  ]);
  if (!member) notFound();

  // the renewal-call view — same merge the members list used to do inline
  const [stories, placements, invoices, notifications] = await Promise.all([
    db.from("stories").select("title, published_at").eq("member_id", id).eq("status", "published").order("published_at", { ascending: false }).limit(10),
    db.from("placements").select("kind, starts_on").eq("member_id", id).order("starts_on", { ascending: false }).limit(5),
    db.from("invoices").select("number, issued_on, status").eq("member_id", id).order("issued_on", { ascending: false }).limit(5),
    db.from("notifications").select("kind, created_at").eq("member_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  const timeline = [
    ...(stories.data ?? []).map((s) => ({ when: s.published_at ?? "", what: `Story published: ${s.title}` })),
    ...(placements.data ?? []).map((p) => ({ when: p.starts_on, what: `Placement: ${p.kind.replace("_", " ")}` })),
    ...(invoices.data ?? []).map((i) => ({ when: i.issued_on, what: `Invoice ${i.number} (${i.status})` })),
    ...(notifications.data ?? []).map((n) => ({ when: n.created_at, what: `Notified: ${n.kind}` })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 15);

  const social = (member.social ?? {}) as Record<string, string>;
  const testimonials = Array.isArray(member.testimonials) ? (member.testimonials as unknown[]) : [];
  const logo = mediaUrl(member.logo_path);
  const hero = mediaUrl(member.hero_path);
  const isDraft = member.status === "draft";
  const isPublic = member.status === "active" || member.status === "grace";
  const pendingRevision = revisions?.[0];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/members" className="text-sm text-gray-400 hover:text-ink">← Members &amp; CRM</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          {member.name} <Badge tone={STATUS_TONE[member.status]}>{member.status}</Badge>
        </h1>
        <span className="flex gap-4 text-sm">
          {isPublic && <a href={`/member/${member.slug}`} className="text-graphite underline">View public page</a>}
          <Link href={`/console/pages?type=member_profile&entity=${id}`} className="text-graphite underline">Page layout</Link>
        </span>
      </div>

      {typeof sp.created === "string" && (
        <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Member created — finish their details below.</p>
      )}
      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Saved.</p>}
      {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      {!editable && (
        <p className="mt-3 rounded bg-gray-100 p-2 text-sm text-gray-500">Your role can view this record but not change it.</p>
      )}

      {pendingRevision && (
        <Card className="mt-4 border-brand/40 bg-brand/5">
          <SectionTitle>Changes awaiting approval</SectionTitle>
          <p className="mt-1 text-sm text-gray-600">
            This member submitted edits on {pendingRevision.created_at.slice(0, 10)}. Approving applies their whole
            submission and will overwrite anything you change here — decide this first.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action={decideRevision}>
              <input type="hidden" name="id" value={pendingRevision.id} />
              <input type="hidden" name="decision" value="approve" />
              <button className="rounded bg-green-600 px-4 py-2 text-sm text-white">Approve &amp; apply</button>
            </form>
            <form action={decideRevision} className="flex flex-1 gap-2">
              <input type="hidden" name="id" value={pendingRevision.id} />
              <input type="hidden" name="decision" value="reject" />
              <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
              <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Reject</button>
            </form>
          </div>
        </Card>
      )}

      <form action={saveMember} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={id} />

        <Card>
          <SectionTitle>Company page</SectionTitle>
          <fieldset disabled={!editable} className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className={label}>Company name</label>
                <input id="name" name="name" defaultValue={member.name} required className={field} />
              </div>
              <div>
                <label htmlFor="category_id" className={label}>Category</label>
                <select id="category_id" name="category_id" defaultValue={member.category_id ?? ""} className={field}>
                  <option value="">— none —</option>
                  {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="slug" className={label}>Web address</label>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-gray-400">/member/</span>
                <input id="slug" name="slug" defaultValue={member.slug} className="w-full rounded border px-3 py-2" />
              </div>
              {!isDraft && (
                <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
                  <input type="checkbox" name="confirm_slug" />
                  Changing this changes their public URL — old links will be redirected automatically.
                </label>
              )}
            </div>
            <div>
              <span className={label}>About the company</span>
              <RichTextEditor
                name="description" ariaLabel="About the company"
                initialHtml={renderableHtml(member.description)}
                uploadImage={consoleUploadImage}
                minHeightClass="min-h-56"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="logo" className={label}>Company logo</label>
                {logo && <Image src={logo} alt="" width={64} height={64} className="mt-1 rounded border" unoptimized />}
                <input id="logo" type="file" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
                {logo && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <input type="checkbox" name="remove_logo" /> Remove the current logo
                  </label>
                )}
              </div>
              <div>
                <label htmlFor="hero" className={label}>Cover photo</label>
                {hero && <Image src={hero} alt="" width={128} height={64} className="mt-1 rounded border object-cover" unoptimized />}
                <input id="hero" type="file" name="hero" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
                {hero && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <input type="checkbox" name="remove_hero" /> Remove the current cover
                  </label>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="address" className={label}>Address</label><input id="address" name="address" defaultValue={member.address ?? ""} className={field} /></div>
              <div><label htmlFor="phone" className={label}>Phone</label><input id="phone" name="phone" defaultValue={member.phone ?? ""} className={field} /></div>
              <div><label htmlFor="website" className={label}>Website</label><input id="website" name="website" defaultValue={member.website ?? ""} className={field} /></div>
              <div><label htmlFor="video_url" className={label}>YouTube video URL</label><input id="video_url" name="video_url" defaultValue={member.video_url ?? ""} className={field} /></div>
              <div>
                <label htmlFor="lat" className={label}>Latitude</label>
                <input id="lat" name="lat" defaultValue={member.lat ?? ""} inputMode="decimal" className={field} />
              </div>
              <div>
                <label htmlFor="lng" className={label}>Longitude</label>
                <input id="lng" name="lng" defaultValue={member.lng ?? ""} inputMode="decimal" className={field} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-gray-400">Latitude and longitude place the map on their profile. Leave both empty for no map.</p>
            <fieldset>
              <legend className={label}>Social profiles</legend>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                {SOCIAL_CHANNELS.map((c) => (
                  <label key={c.key} className="text-sm">
                    <span className="text-gray-500">{c.label}</span>
                    <input name={socialFieldName(c.key)} defaultValue={social[c.key] ?? ""} placeholder={c.placeholder} className={field} />
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="testimonials" className={label}>Testimonials</label>
              <textarea id="testimonials"
                name="testimonials"
                rows={3}
                defaultValue={testimonials.filter((t) => typeof t === "string").join("\n")}
                className={field}
              />
              <p className="mt-1 text-xs text-gray-400">One per line.</p>
            </div>
          </fieldset>
        </Card>

        <Card>
          <SectionTitle>Membership</SectionTitle>
          <fieldset disabled={!editable} className="mt-3 space-y-4">
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
                  <p className="mt-1 text-xs text-gray-400">
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
                <input id="paid_at" type="datetime-local" name="paid_at" defaultValue={member.paid_at?.slice(0, 16) ?? ""} className={field} />
                <p className="mt-1 text-xs text-gray-400">For corrections — use “Record payment” below to raise an invoice too.</p>
              </div>
              <div><label htmlFor="comped_until" className={label}>Comped until</label><input id="comped_until" type="date" name="comped_until" defaultValue={member.comped_until ?? ""} className={field} /></div>
              <div className="sm:col-span-2">
                <label htmlFor="contact_email" className={label}>Contact email</label>
                <input id="contact_email" name="contact_email" type="email" defaultValue={member.contact_email ?? ""} className={field} />
                <p className="mt-1 text-xs text-gray-400">
                  Where their notifications go. This is not their login — changing it here does not change how they sign in.
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Page submitted: {member.draft_submitted_at?.slice(0, 10) ?? "not yet"}
              {member.stripe_customer_id && ` · Stripe customer ${member.stripe_customer_id}`}
            </p>
          </fieldset>
        </Card>

        {editable && (
          <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
            Save changes
          </SubmitButton>
        )}
      </form>

      {editable && (
        <Card className="mt-4">
          <SectionTitle>Record a payment</SectionTitle>
          <p className="mt-1 text-sm text-gray-500">
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
      )}

      <Card className="mt-4">
        <SectionTitle>Activity</SectionTitle>
        <ul className="mt-2 space-y-1.5 text-sm">
          {timeline.map((t, i) => (
            <li key={i} className="flex gap-3 border-t pt-1.5">
              <span className="w-24 shrink-0 text-xs text-gray-400">{t.when?.slice(0, 10)}</span>
              <span>{t.what}</span>
            </li>
          ))}
          {timeline.length === 0 && <p className="text-sm text-gray-400">No activity yet.</p>}
        </ul>
      </Card>
    </div>
  );
}
