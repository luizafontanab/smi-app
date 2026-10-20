import { requireMemberView } from "@/lib/auth";
import { VISIBILITY_PRODUCTS } from "@/lib/visibility-products";
import { requestVisibility, submitAdvert } from "../../actions";
import { AdvertForm } from "../../advert/AdvertForm";
import { AdvertisingTabs } from "../AdvertisingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buy advertising" };

export default async function AdvertisingBuyPage(props: PageProps<"/dashboard/advertising/buy">) {
  const sp = await props.searchParams;
  await requireMemberView();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Buy advertising</h1>
      <p className="mt-1 text-sm text-graphite">
        Pick what you&apos;re interested in — Jas confirms availability and schedules it, and you can pay the invoice by card from your account.
      </p>
      <AdvertisingTabs active="buy" />

      <section className="mt-5">
        <h2 className="font-bold text-ink">Visibility products</h2>
        <div className="mt-3 space-y-3">
          {VISIBILITY_PRODUCTS.map((p) => (
            <form key={p.key} action={requestVisibility} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 shadow-sm">
              <input type="hidden" name="product" value={p.key} />
              <div>
                <p className="font-bold text-ink">{p.name}</p>
                <p className="text-sm text-graphite">{p.detail}</p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={`buy-message-${p.key}`} className="sr-only">Timing / notes (optional)</label>
                <input id={`buy-message-${p.key}`} name="message" placeholder="Timing / notes (optional)" className="rounded border px-3 py-1.5 text-sm" />
                <button className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Buy</button>
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-bold text-ink">Book a banner advert</h2>
        <p className="mt-1 text-sm text-graphite">
          Upload your artwork and tell us when you would like it to run.
        </p>
        {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
        <AdvertForm action={submitAdvert} />
      </section>
    </div>
  );
}
