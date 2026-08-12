import Link from "next/link";

type Props = { paid: boolean; pageSubmitted: boolean };

/** V13 — join-funnel progress for draft members; disappears once Jas activates the page. */
export function OnboardingChecklist({ paid, pageSubmitted }: Props) {
  const steps: { title: string; done: boolean; href?: string; cta?: string }[] = [
    { title: "Create your account", done: true },
    { title: "Pay £40/month", done: paid, href: "/member/pay", cta: "Pay now" },
    { title: "Build & submit your company page", done: pageSubmitted, href: "/member/profile", cta: "Build your page" },
    { title: "We verify and approve", done: false },
  ];
  const next = steps.find((s) => !s.done);
  const awaitingApproval = paid && pageSubmitted;

  return (
    <section className="mb-6 rounded-xl border-2 border-amber bg-white p-5 shadow-sm">
      <h2 className="font-bold text-navy">Finish setting up your membership</h2>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => {
          const isNext = s === next && !awaitingApproval;
          return (
            <li key={s.title} className="flex items-center gap-3 text-sm">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                s.done ? "bg-green-100 text-green-700" : isNext ? "bg-amber text-navy" : "bg-gray-100 text-gray-400"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <span className={s.done ? "text-gray-400 line-through" : isNext ? "font-semibold text-navy" : "text-gray-500"}>
                {s.title}
              </span>
              {isNext && s.href && (
                <Link href={s.href} className="ml-auto rounded bg-navy px-3 py-1 text-xs font-semibold text-white">
                  {s.cta} →
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {awaitingApproval && (
        <p className="mt-3 rounded bg-amber/10 p-2 text-sm text-gray-600">
          All done on your side — Jas is reviewing your page and you&apos;ll be live in the directory once it&apos;s approved.
        </p>
      )}
    </section>
  );
}
