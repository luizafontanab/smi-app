/**
 * WCAG 2.1 A — 2.4.1 Bypass Blocks. Every layout renders its nav before
 * <main>, so without this a keyboard or screen-reader user tabs the whole
 * header on every single navigation. Visually hidden until focused.
 *
 * Pair with `id="main"` on the layout's <main> element.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-brand focus:px-4 focus:py-2 focus:text-ink focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ink"
    >
      Skip to content
    </a>
  );
}
