import Link from "next/link";
import { requestVisibility } from "../actions";

export const metadata = { title: "Buy visibility" };

const PRODUCTS = [
  { key: "featured_member", name: "Featured Member", detail: "Homepage carousel + higher directory ranking, by the month" },
  { key: "newsletter_slot", name: "Newsletter advert", detail: "560×300 banner in the monthly issue (~2,500 readers)" },
  { key: "banner_package", name: "Sitewide banners", detail: "Rotating banners across every page — impressions reported monthly" },
  { key: "featured_machine", name: "Featured Machine", detail: "Machine of the month promo page, by the week or month" },
];

export default function BuyPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Buy visibility</h1>
      <p className="mt-1 text-sm text-gray-500">
        Pick what you&apos;re interested in — Jas confirms availability, schedules it, and invoices you. No online payment.
      </p>
      <div className="mt-5 space-y-3">
        {PRODUCTS.map((p) => (
          <form key={p.key} action={requestVisibility} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 shadow-sm">
            <input type="hidden" name="product" value={p.key} />
            <div>
              <p className="font-bold text-ink">{p.name}</p>
              <p className="text-sm text-gray-500">{p.detail}</p>
            </div>
            <div className="flex items-center gap-2">
              <input name="message" placeholder="Timing / notes (optional)" className="rounded border px-3 py-1.5 text-sm" />
              <button className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Buy</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
