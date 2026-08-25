import Link from "next/link";
import { currentUser } from "@/lib/auth";

/**
 * The "Become a Member" band — used on the homepage and as a layout block.
 * Renders nothing for signed-in visitors; they've already joined.
 */
export async function JoinCta() {
  if (await currentUser()) return null;
  return (
    <section className="my-10 rounded-xl bg-ink p-8 text-center text-white">
      <h2 className="text-2xl font-bold">Join the UK&apos;s sheet metal community</h2>
      <p className="mx-auto mt-2 max-w-xl text-white/80">
        A member page, your news on our channels, and analytics showing which companies are looking at you — £40/month.
      </p>
      <Link href="/join" className="mt-4 inline-block rounded bg-brand px-6 py-3 font-semibold text-ink">Become a Member</Link>
    </section>
  );
}
