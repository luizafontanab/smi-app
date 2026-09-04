import type { SVGProps } from "react";

/**
 * The app's drawn icon set — one stroke family (1.75/round) so every glyph
 * reads as the same hand. These replaced the emoji tiles: emoji render
 * differently per OS, can't take the palette, and screen readers announce
 * them before the card title. All icons are decorative (aria-hidden);
 * meaning always comes from the adjacent text.
 */

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  } as const;
}

/** Company page: a workshop building with a doorway. */
export function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 21V9.5L12 4l9 5.5V21" />
      <path d="M3 21h18" />
      <path d="M9.5 21v-6h5v6" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
    </svg>
  );
}

/** Content: a front page with a lead story block. */
export function IconNewspaper(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5Z" />
      <path d="M17 9h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2" />
      <path d="M7 9h7M7 12.5h7M7 16h4" />
    </svg>
  );
}

/** Advertising: a megaphone. */
export function IconMegaphone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l9 4.5V6L7 10.5H4.5A1.5 1.5 0 0 0 3 12" />
      <path d="M16 9.5a3 3 0 0 1 0 5" />
      <path d="M7.5 15.5 9 20a1 1 0 0 0 1 .75h1" />
    </svg>
  );
}

/** Statistics: a rising bar chart. */
export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h16" />
      <path d="M6.5 20v-5.5M11 20V9.5M15.5 20v-8M20 20V6" />
    </svg>
  );
}

/** Billing: a receipt with a zigzag foot. */
export function IconReceipt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12v17l-2-1.4L14 20l-2-1.4L10 20l-2-1.4L6 20V3Z" />
      <path d="M9 7.5h6M9 11h6M9 14.5h3.5" />
    </svg>
  );
}

/** Account: head-and-shoulders — the signed-in menu trigger in every header. */
export function IconAccount(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

/** Notifications: a bell — the console header's messages link. */
export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** Search: a magnifier — the header's icon-only search link. */
export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m20 20-4.8-4.8" />
    </svg>
  );
}
