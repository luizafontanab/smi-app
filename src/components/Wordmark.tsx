import { getImageProps } from "next/image";

/**
 * Below Tailwind's `sm`: the phone layout, where the stacked lockup shows.
 * The exact complement of `sm` (`width >= 40rem`), so no fractional width
 * falls between the two and gets the wide mark at phone height.
 */
export const PHONE_MEDIA = "(width < 40rem)";

/**
 * The client's logo face, and only here — shared by the public header, the
 * member area and the auth pages so the mark can't drift (DESIGN.md).
 * Deliberately not recoloured via --smi-brand: official artwork stays as
 * supplied, so it sits out sponsor-takeover recolouring.
 *
 * Two supplied lockups, chosen by viewport with <picture> so each device
 * downloads only the one it shows:
 *
 * - From `sm` up, the wide artwork (public/logo-wide.svg, orange #ff8200 +
 *   white, so it needs a dark surface). `tone="light"` swaps in
 *   logo-wide-ink.svg for a light header: the same file with its single
 *   fill="#fff" path — the wordmark text — set to --smi-ink. Generated, not
 *   redrawn: regenerate it from logo-wide.svg if the client supplies new
 *   artwork.
 * - On a phone, the stacked lockup (public/logo-stacked.png, the footer's
 *   mark) — the client's preferred mobile logo. It is the supplied 500×500
 *   "Deep orange" JPG with the canvas keyed out and its coral (#ff6b4b)
 *   corrected to the brand #ff8200. All one orange, so it reads on both tones.
 */
export function Wordmark({ tone = "dark" }: {
  /** The surface the mark sits on — "dark" is the near-black chrome header. */
  tone?: "dark" | "light";
}) {
  const alt = "Sheet Metal Industries";
  // Stacked lockup is 500 × 172 ≈ 2.9:1, shown 60px tall (≈175px wide). The
  // headers trim their phone padding to 6px so the bar stays ~73px tall; the
  // artwork itself has no margin to trim. The baked-in tagline is still small.
  const { props: { srcSet: phone } } = getImageProps({ alt, src: "/logo-stacked.png", width: 175, height: 60 });
  // Wide artwork is 1786.05 × 276.97 ≈ 6.45:1. Full size only from xl (lg is
  // where the header shows every nav link, and a 413px logo plus the full nav
  // overflows a 1024px viewport). Every header gives the mark's link shrink-0,
  // so it always renders at these sizes — never squeezed (#33).
  // Eager: the mark is the first thing in every page's header, so it must not
  // wait on lazy loading. `loading` sits on the <img>, so it covers the phone
  // <source> too.
  const { props: wide } = getImageProps({
    alt,
    src: tone === "light" ? "/logo-wide-ink.svg" : "/logo-wide.svg",
    width: 413,
    height: 64,
    loading: "eager",
  });
  return (
    <picture>
      <source media={PHONE_MEDIA} srcSet={phone} width={175} height={60} />
      <img {...wide} alt={alt} className="h-15 w-auto sm:h-12 xl:h-16" />
    </picture>
  );
}
