import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { formatPounds } from "@/lib/advert-payments";
import { bundleGroup, bundleLive, groupBy, pendingReason, runGroup } from "@/lib/booking-groups";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/console/ui";
import { BookingCard, EmptyRow, HEAD_ROW, TABLE } from "@/components/console/BookingSections";
import { saveBundle } from "../../actions";

export const dynamic = "force-dynamic";

type Part = { status: string; starts_on: string; ends_on: string };

/** The one thing a pending bundle is waiting on — no parts yet, or its first pending part's reason. */
function bundleWaitingOn(parts: Part[], today: string): string {
  if (!parts.length) return "no parts booked yet";
  const pending = parts.find((p) => runGroup(p, today) === "pending");
  return (pending && pendingReason(pending, today)) ?? "—";
}

const term = (parts: Part[]) => {
  if (!parts.length) return "—";
  const from = parts.map((p) => p.starts_on).sort()[0];
  const to = parts.map((p) => p.ends_on).sort().at(-1);
  return `${from} → ${to}`;
};

/**
 * Booked → Pending → New bundle: the same order as the other Adverts booking
 * pages. A bundle is pending until it has parts and none is waiting on
 * anything (approval, changes or payment); past once every part has ended.
 */
export default async function BundlesPage(props: PageProps<"/console/adverts/bundles">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [members, bundles] = await Promise.all([
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/bundles members"),
    must(
      db.from("bundles")
        .select("id, name, price_pennies, member:members(name), parts:advert_bookings(status, starts_on, ends_on)")
        .order("created_at", { ascending: false }),
      "console/bundles list",
    ),
  ]);
  const rows = (bundles ?? []).map((b) => ({ ...b, parts: (b.parts ?? []) as Part[] }));
  const groups = groupBy(rows, (b) => bundleGroup(b.parts, today));

  const row = (b: (typeof rows)[number], status: React.ReactNode) => (
    <tr key={b.id} className="border-t">
      <td className="py-2">{b.member?.name}</td>
      <td><Link href={`/console/adverts/bundles/${b.id}`} className="font-medium text-ink hover:underline">{b.name}</Link></td>
      <td>{b.price_pennies != null ? formatPounds(b.price_pennies) : "—"}</td>
      <td>{b.parts.length}</td>
      <td className="whitespace-nowrap text-xs text-graphite">{term(b.parts)}</td>
      <td>{status}</td>
      <td className="text-right"><Link href={`/console/adverts/bundles/${b.id}`} className="text-xs text-ink hover:underline">edit</Link></td>
    </tr>
  );
  const head = (
    <thead><tr className={HEAD_ROW}><th scope="col" className="py-1">Member</th><th scope="col">Name</th><th scope="col">Price</th><th scope="col">Parts</th><th scope="col">Runs</th><th scope="col" /><th scope="col" /></tr></thead>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Bundles</h1>
      <p className="mt-1 text-sm text-graphite">
        Several ad formats sold together to one member under a single price. Add the artwork first via{" "}
        <Link href="/console/adverts/artwork" className="underline">Artwork</Link>, then book it into a bundle.
      </p>
      {/* saveBundle sends validation failures back here (fix-list 76). */}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <BookingCard title="Booked" count={groups.booked.length} hint="Confirmed — at least one part running or booked to run, nothing waiting.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            {head}
            <tbody>
              {groups.booked.map((b) => row(b, bundleLive(b.parts, today) ? <Badge tone="green">live</Badge> : <span className="text-graphite">upcoming</span>))}
              {!groups.booked.length && <EmptyRow colSpan={7}>Nothing booked right now.</EmptyRow>}
            </tbody>
          </table>
        </div>
        {groups.past.length > 0 && (
          <p className="mt-3 text-xs text-graphite">
            {groups.past.length} past bundle{groups.past.length === 1 ? "" : "s"}:{" "}
            {groups.past.map((b, i) => (
              <span key={b.id}>{i > 0 && ", "}<Link href={`/console/adverts/bundles/${b.id}`} className="underline">{b.name}</Link></span>
            ))}
          </p>
        )}
      </BookingCard>

      <BookingCard title="Pending" count={groups.pending.length} hint="Not confirmed yet — no parts booked, or a part waiting on approval, changes or payment.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            {head}
            <tbody>
              {groups.pending.map((b) => row(b, <Badge tone={b.parts.length ? "brand" : "neutral"}>{bundleWaitingOn(b.parts, today)}</Badge>))}
              {!groups.pending.length && <EmptyRow colSpan={7}>Nothing waiting.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </BookingCard>

      <BookingCard title="New bundle" hint="Create it, then book its parts from the bundle's page. A priced bundle is held until the member pays.">
        <form action={saveBundle} className="space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-sm font-medium">Bundle name</label>
              <input id="name" name="name" required className="mt-1 w-full rounded border px-3 py-2" />
            </div>
            <div>
              <label htmlFor="price_pounds" className="text-sm font-medium">Price (£, optional)</label>
              <input id="price_pounds" name="price_pounds" type="number" step="0.01" min="0" className="mt-1 w-full rounded border px-3 py-2" />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="text-sm font-medium">Notes</label>
            <input id="notes" name="notes" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <SubmitButton pendingLabel="Creating…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Create bundle</SubmitButton>
        </form>
      </BookingCard>
    </div>
  );
}
