import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { TakeoverColorPicker } from "@/components/console/TakeoverColorPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCard } from "@/components/console/BookingSections";
import { PlacementCards } from "@/components/console/PlacementCards";
import { saveTakeoverPlacement } from "../../actions";

export const dynamic = "force-dynamic";

/** Booked → Pending → Book a takeover: the same order as the other Adverts booking pages. */
export default async function TakeoverPage(props: PageProps<"/console/adverts/takeover">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [members, takeovers] = await Promise.all([
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/takeover members"),
    must(db.from("placements").select("id, config, starts_on, ends_on, price_pennies, awaiting_payment, member:members(name)").eq("kind", "takeover").order("starts_on", { ascending: false }), "console/takeover placements"),
  ]);
  const live = (takeovers ?? []).find((t) => !t.awaiting_payment && t.starts_on <= today && t.ends_on >= today);
  const liveBanner = live ? mediaUrl((live.config as { banner_path?: string }).banner_path ?? null) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Homepage takeover</h1>
      <p className="mt-1 text-sm text-graphite">
        One advertiser&apos;s colours and top banner across the whole public site for a paid period — reverts on its own once the dates end.
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <PlacementCards
        rows={takeovers ?? []}
        today={today}
        editBase="/console/adverts/takeover"
        noun="takeover"
        extra={{
          header: "Colour",
          cell: (t) => {
            const hex = (t.config as { hex?: string }).hex;
            return (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-4 w-4 rounded border" style={{ background: hex }} aria-hidden />
                <span className="font-mono text-xs">{hex}</span>
              </span>
            );
          },
        }}
      />

      <BookingCard title="Book a takeover" hint="Only one takeover can run at a time — a held one reserves its dates too. A priced takeover is held until the member pays.">
        <form action={saveTakeoverPlacement} className="space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Advertiser</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <TakeoverColorPicker />
          <div>
            <label htmlFor="banner" className="text-sm font-medium">Top banner</label>
            <input id="banner" name="banner" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">Price (£)<input name="price_pounds" inputMode="decimal" placeholder="optional" className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <SubmitButton pendingLabel="Booking…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Book takeover</SubmitButton>
        </form>
      </BookingCard>


      {liveBanner && (
        <p className="mt-4 text-xs text-graphite">
          Live now:
          <Image src={liveBanner} alt="" width={1280} height={170} className="mt-2 h-auto w-full rounded border" unoptimized />
        </p>
      )}
    </div>
  );
}
