import Link from "next/link";
import { currentUser } from "@/lib/auth";

/**
 * The "Become a Member" band — used on the homepage and as a layout block.
 * Renders nothing for signed-in visitors; they've already joined.
 *
 * Light, not ink (#33 E18): on a phone the near-black band ran straight into
 * the dark footer, about 1000px of continuous dark at the foot of the page.
 * A pale warm tint keeps it apart from the grey newsletter box that usually
 * follows it, with the orange button still the one solid fill.
 */
export async function JoinCta() {
  if (await currentUser()) return null;
  return (
    <section data-part="join-cta" className="my-10 rounded-xl border border-brand/30 bg-brand/10 p-6 text-center text-ink sm:p-8">
      <h2 data-part="section-title" className="text-2xl font-bold">Join the UK&apos;s sheet metal community</h2>
      <p data-part="join-cta-intro" className="mx-auto mt-2 max-w-xl text-graphite">
        A member page, your news on our channels, and analytics showing which companies are looking at you — £40/month.
      </p>
      <Link data-part="button-primary" href="/join" className="mt-4 inline-block rounded bg-brand px-6 py-3 font-semibold text-ink">Become a Member</Link>
    </section>
  );
}
