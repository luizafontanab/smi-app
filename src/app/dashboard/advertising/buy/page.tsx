import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { loadFeaturedMonths, type FeaturedMonth } from "@/lib/featured-availability";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { VISIBILITY_PRODUCTS } from "@/lib/visibility-products";
import { requestVisibility, submitAdvert } from "../../actions";
import { AdvertForm } from "../../advert/AdvertForm";
import { AdvertisingTabs } from "../AdvertisingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buy advertising" };

export default async function AdvertisingBuyPage(props: PageProps<"/dashboard/advertising/buy">) {
  const sp = await props.searchParams;
  await requireMemberView();
  // Counts only — which members hold the slots is never fetched.
  const months = await loadFeaturedMonths(serviceDb());
  return (
    <div className="max-w-2xl lg:mx-auto">
      <h1 className="mt-1 text-xl font-bold text-ink">Buy advertising</h1>
      <p className="mt-1 text-sm text-graphite">
        Pick what you&apos;re interested in — Jas confirms availability and schedules it, and you can pay the invoice by card from your account.
      </p>
      <AdvertisingTabs active="buy" />
      {typeof sp.error === "string" && <p role="alert" className="mt-4 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-5">
        <h2 className="font-bold text-ink">Visibility products</h2>
        <div className="mt-3 space-y-3">
          {VISIBILITY_PRODUCTS.map((p) => (
            <form key={p.key} action={requestVisibility} className="rounded-xl bg-white p-5 shadow-sm">
              <input type="hidden" name="product" value={p.key} />
              <p className="font-bold text-ink">{p.name}</p>
              <p className="text-sm text-graphite">{p.detail}</p>
              {/* Month choice before Buy, and a visible label on the notes box:
                  Buy used to sit above the months it submits, and the label was
                  only a placeholder clipped on phones (#33 M12, M13). */}
              {p.key === "featured_member" && <MonthPicker months={months} />}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`buy-message-${p.key}`} className="text-xs font-medium text-graphite">
                    Timing / notes <span className="font-normal">(optional)</span>
                  </label>
                  <input id={`buy-message-${p.key}`} name="message" className="mt-1 w-full rounded border px-3 py-2 text-base sm:py-1.5 sm:text-sm" />
                </div>
                <button className="tap justify-center rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Buy</button>
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
        <AdvertForm action={submitAdvert} />
      </section>
    </div>
  );
}

/** Featured Member's month choice: slots left per month, full months disabled. Optional. */
function MonthPicker({ months }: { months: FeaturedMonth[] }) {
  const tile =
    "flex cursor-pointer flex-col rounded border px-2.5 py-2 text-sm sm:py-1.5 sm:text-xs has-[:checked]:border-ink has-[:checked]:bg-brand/20 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink";
  return (
    // The rule sits on a wrapper: on the fieldset itself it strikes through the legend.
    <div className="mt-4 border-t pt-3">
    <fieldset>
      <legend className="text-sm font-medium text-ink">
        Preferred month <span className="font-normal text-graphite">(optional)</span>
      </legend>
      <p className="text-xs text-graphite">
        Up to {FEATURED_SLOTS.cap} members are featured at once. Jas confirms your month before anything is booked.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className={tile}>
          <input type="radio" name="preferred_month" value="" defaultChecked className="sr-only" />
          <span className="font-semibold text-ink">No preference</span>
          <span className="text-graphite">Any month</span>
        </label>
        {months.map((m) => (
          <label key={m.key} className={`${tile} ${m.left === 0 ? "cursor-not-allowed opacity-50" : ""}`}>
            <input type="radio" name="preferred_month" value={m.key} disabled={m.left === 0} className="sr-only" />
            <span className="font-semibold text-ink">{m.label}</span>
            <span className="text-graphite">{m.left === 0 ? "Full" : `${m.left} of ${FEATURED_SLOTS.cap} left`}</span>
          </label>
        ))}
      </div>
    </fieldset>
    </div>
  );
}
