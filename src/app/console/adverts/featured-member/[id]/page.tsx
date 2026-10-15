import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";
import { InvoicePanel } from "@/components/console/InvoicePanel";
import { saveFeaturedMemberPlacement } from "../../../actions";

export const dynamic = "force-dynamic";

/**
 * Edit one booked Featured Member slot (fix-list 76). Slots could be booked
 * but never changed, so a wrong date or member meant asking a developer.
 */
export default async function FeaturedMemberSlotPage(props: PageProps<"/console/adverts/featured-member/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();

  const [slot, members] = await Promise.all([
    must(
      db.from("placements").select("id, member_id, starts_on, ends_on, price_pennies, awaiting_payment, member:members(name)").eq("id", id).eq("kind", "featured_member").maybeSingle(),
      "console/featured-member slot",
    ),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/featured-member members"),
  ]);
  if (!slot) notFound();
  // The picker lists active members only. A slot whose member has since lapsed
  // must still show them, or the <select> would fall back to its first option
  // and a save would silently hand the slot to someone else.
  const options = [...(members ?? [])];
  if (slot.member_id && !options.some((m) => m.id === slot.member_id)) {
    options.unshift({ id: slot.member_id, name: `${slot.member?.name ?? "Unknown member"} (not active)` });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/featured-member" className="text-sm text-graphite hover:text-ink">← Featured Member</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Edit Featured Member slot</h1>
      {slot.awaiting_payment && <p className="mt-1 text-sm font-semibold text-brand-text">Held — not on the site until it&apos;s paid.</p>}
      <p className="mt-1 text-sm text-graphite">Up to {FEATURED_SLOTS.cap} can run at once; this slot doesn&apos;t count against itself.</p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveFeaturedMemberPlacement} className="mt-4 space-y-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={slot.id} />
        <div>
          <label htmlFor="member_id" className="text-sm font-medium">Member</label>
          <select id="member_id" name="member_id" required defaultValue={slot.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">Start<input type="date" name="starts_on" required defaultValue={slot.starts_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required defaultValue={slot.ends_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
        </div>
        <label className="block text-sm sm:max-w-[12rem]">Price (£)
          <input name="price_pounds" inputMode="decimal" placeholder="optional" defaultValue={slot.price_pennies != null ? (slot.price_pennies / 100).toFixed(2) : ""} className="mt-1 block w-full rounded border px-3 py-2" />
        </label>
        <p className="text-xs text-graphite">Changing the price records it; it doesn&apos;t raise or change an invoice.</p>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      <InvoicePanel target={{ placement_id: slot.id }} returnTo={`/console/adverts/featured-member/${slot.id}`} />
    </div>
  );
}
