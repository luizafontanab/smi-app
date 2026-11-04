import Link from "next/link";

const STOPS = [
  { href: "/dashboard/stats", icon: "📈", title: "Your statistics", sub: "Who's engaging with your page" },
  { href: "/dashboard/advertising", icon: "⭐", title: "Advertising", sub: "Adverts, featured slots & newsletter" },
  { href: "/dashboard/resources", icon: "🧾", title: "Resources", sub: "Brand assets to share" },
] as const;

/**
 * First-arrival nudge for a newly-activated member (A4.18) — OnboardingChecklist
 * only ever covers the draft-status funnel and disappears the moment Jas
 * activates the page, leaving nothing to orient a member who just went live.
 * Dismissible; `members.onboarding_seen` makes the dismissal permanent.
 */
export function WelcomePanel({ dismissAction }: { dismissAction: (formData: FormData) => Promise<void> }) {
  return (
    <section className="mb-6 rounded-xl border-2 border-brand bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-ink">You&apos;re live in the directory 🎉</h2>
          <p className="mt-1 text-sm text-graphite">A few places worth a look while you&apos;re here:</p>
        </div>
        <form action={dismissAction}>
          <button type="submit" className="tap shrink-0 px-1 text-sm text-graphite underline hover:text-ink sm:text-xs">Dismiss</button>
        </form>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {STOPS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="block rounded-lg border p-3 text-sm hover:border-brand hover:bg-brand/5">
              <span className="font-semibold text-graphite">{s.icon} {s.title}</span>
              <p className="mt-0.5 text-xs text-graphite">{s.sub}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
