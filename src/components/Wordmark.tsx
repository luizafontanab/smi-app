import Image from "next/image";

/**
 * The client's logo face, and only here — the supplied wide logo artwork
 * (public/logo-wide.svg, orange #ff8200 + white, so it needs a dark surface).
 * --smi-brand is matched to this artwork's orange, so mark and accent read as
 * one. Shared by the public header and the member area so the mark can't
 * drift (DESIGN.md); the footer uses the stacked lockup (logo-square.png)
 * instead. Deliberately not recoloured via --smi-brand:
 * official artwork stays as supplied, so it sits out sponsor-takeover
 * recolouring.
 */
export function Wordmark() {
  // Intrinsic ratio 1786.05 × 276.97 ≈ 6.45:1 — the mark is ~6.5× wider than
  // tall, so the height classes step with the header's own breakpoints: full
  // size only from xl (lg is where the header shows every nav link, and a
  // 413px logo plus the full nav overflows a 1024px viewport), mid-size from
  // sm, and compact below that so the mark, menu button and CTAs share a
  // phone-width row without wrapping.
  return (
    <Image
      src="/logo-wide.svg"
      alt="Sheet Metal Industries"
      width={413}
      height={64}
      className="h-8 w-auto sm:h-12 xl:h-16"
    />
  );
}
