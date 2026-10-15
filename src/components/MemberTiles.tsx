import Image from "next/image";
import Link from "next/link";

export type MemberTile = { name: string; slug: string; logoUrl: string | null };

/**
 * The members a story features (Jas 13/10 item 12b): one boxed area, one tile
 * per member, primary first. Jas: promoting the member's brand logo matters
 * most — "as large as sensibly possible" — and the wording should invite the
 * click ("CLICK FOR MORE MEMBER INFO"). The whole tile is the link, not just
 * the name, so the logo itself is a target.
 *
 * `layout` follows where it sits: "sidebar" stacks one tile per row in the
 * story page's right column on desktop (and tiles two/three across on smaller
 * screens, where the sidebar falls below the article); "inline" is the same
 * box in a single column, for previews and forms.
 *
 * Callers pass members already gated by isMemberLinkable — this never decides
 * who is linkable, it only draws.
 */
export function MemberTiles({ members, layout = "sidebar", label }: {
  members: MemberTile[];
  layout?: "sidebar" | "inline";
  /** Defaults to the story wording; a video's preview says "video". */
  label?: string;
}) {
  if (members.length === 0) return null;
  const heading = label ?? (members.length === 1 ? "Featured SMI member" : "Featured SMI members");
  const grid =
    layout === "sidebar"
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-1"
      : members.length > 1
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1";
  return (
    <aside aria-label={heading} className="rounded-lg border-2 border-brand bg-brand/5 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-graphite">{heading}</p>
      <ul className={`mt-3 grid gap-3 ${grid}`}>
        {members.map((m) => (
          <li key={m.slug}>
            <Link
              href={`/member/${m.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-md border border-line bg-white transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="flex h-28 items-center justify-center p-3">
                {m.logoUrl ? (
                  // alt="" — the member's name follows as text, and is the link's name
                  <Image src={m.logoUrl} alt="" width={240} height={96} className="max-h-full w-auto object-contain" unoptimized />
                ) : (
                  <span aria-hidden="true" className="text-center text-xl font-bold leading-tight text-ink">{m.name}</span>
                )}
              </span>
              <span className="border-t border-line px-3 py-2.5">
                <span className="block font-bold leading-snug text-ink group-hover:underline">{m.name}</span>
                <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-wider text-brand-text">
                  Click for more member info →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
