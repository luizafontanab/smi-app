import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { TakeoverColorPicker } from "@/components/console/TakeoverColorPicker";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";
import { InvoicePanel } from "@/components/console/InvoicePanel";
import { CancelPlacementForm } from "@/components/console/CancelPlacementForm";
import { saveTakeoverPlacement } from "../../../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";

/**
 * Edit one booked takeover (fix-list 76): colour, dates, advertiser, and
 * optionally a new banner. Leaving the file empty keeps the current banner.
 */
export default async function TakeoverEditPage(props: PageProps<"/console/adverts/takeover/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();

  const today = new Date().toISOString().slice(0, 10);
  const [takeover, members, paid] = await Promise.all([
    must(
      db.from("placements").select("id, member_id, config, starts_on, ends_on, price_pennies, awaiting_payment, member:members(name)").eq("id", id).eq("kind", "takeover").maybeSingle(),
      "console/takeover edit",
    ),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/takeover members"),
    // a paid booking isn't cancelled from here (refunds are by hand)
    must(db.from("invoices").select("id").eq("placement_id", id).eq("status", "paid").limit(1), "console/takeover paid invoice"),
  ]);
  if (!takeover) notFound();
  const config = takeover.config as { hex?: string; banner_path?: string };
  const banner = mediaUrl(config.banner_path ?? null);
  // Same reasoning as the Featured Member editor: keep a lapsed advertiser
  // selectable, or the <select> silently reassigns the takeover on save.
  const options = [...(members ?? [])];
  if (takeover.member_id && !options.some((m) => m.id === takeover.member_id)) {
    options.unshift({ id: takeover.member_id, name: `${takeover.member?.name ?? "Unknown member"} (not active)` });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/takeover" className="text-sm text-graphite hover:text-ink">← Homepage takeover</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Edit takeover</h1>
      {takeover.awaiting_payment && <p className="mt-1 text-sm font-semibold text-brand-text">Held — not on the site until it&apos;s paid.</p>}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveTakeoverPlacement} className="mt-4 space-y-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={takeover.id} />
        <div>
          <label htmlFor="member_id" className="text-sm font-medium">Advertiser</label>
          <select id="member_id" name="member_id" required defaultValue={takeover.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <TakeoverColorPicker initial={config.hex ?? "#ff8200"} />
        <div>
          <label htmlFor="banner" className="text-sm font-medium">Top banner</label>
          {banner && <Image src={banner} alt="Current takeover banner" width={1280} height={170} className="mt-1 h-auto w-full rounded border" unoptimized />}
          <UploadField id="banner" name="banner" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Leave empty to keep the current banner.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">Start<input type="date" name="starts_on" required defaultValue={takeover.starts_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required defaultValue={takeover.ends_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
        </div>
        <label className="block text-sm sm:max-w-[12rem]">Price (£)
          <input name="price_pounds" inputMode="decimal" placeholder="optional" defaultValue={takeover.price_pennies != null ? (takeover.price_pennies / 100).toFixed(2) : ""} className="mt-1 block w-full rounded border px-3 py-2" />
        </label>
        <p className="text-xs text-graphite">A price added here is invoiced when you save, and held for payment if it hasn&apos;t started. A new price or member on an unpaid invoice replaces it; a paid one isn&apos;t re-billed.</p>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      <InvoicePanel
        target={{ placement_id: takeover.id }}
        returnTo={`/console/adverts/takeover/${takeover.id}`}
        raise={{ kind: "placement", id: takeover.id, pricePennies: takeover.price_pennies, billable: true }}
      />
      {/* Only while nothing has run and nothing is paid — cancelPlacement checks both again. */}
      {!paid?.length && (takeover.awaiting_payment || takeover.starts_on > today) && (
        <CancelPlacementForm id={takeover.id} noun="takeover" held={takeover.awaiting_payment} />
      )}
    </div>
  );
}
