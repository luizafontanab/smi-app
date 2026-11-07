// Dark ground, white text: the badge sits over photography at small sizes, so
// it needs the highest-contrast pairing available rather than the accent — on
// the client's orange, white would be ~3.3:1, below AA at this size.
// "inline" drops the overlay positioning so the badge can sit in a row of
// pills (story page header).
//
// `label` defaults to the story wording because stories are the majority of
// call sites. VideoCard passes "Member video" — it reuses this badge, and
// before the prop existed a member's video was badged "Member news".
export function MemberBadge({ variant = "overlay", label = "Member news" }: {
  variant?: "overlay" | "inline";
  label?: string;
}) {
  const base = "bg-ink text-[11px] font-bold uppercase tracking-wide text-white";
  return variant === "inline" ? (
    <span data-part="card-badge" className={`rounded-full px-3 py-1 ${base}`}>{label}</span>
  ) : (
    <span data-part="card-badge" className={`absolute left-2 top-2 z-10 rounded px-2 py-0.5 ${base}`}>{label}</span>
  );
}
