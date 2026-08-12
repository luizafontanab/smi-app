/**
 * Generated SVG artwork for seeded adverts. Shared by seed.ts and seed-real.ts.
 *
 * `sample: true` stamps a SAMPLE bar across the top — seed-real.ts brands its
 * banners with REAL member companies who have bought nothing, so the artwork
 * must never be mistakable for a live booking if a screenshot leaves the laptop.
 */

/** Member names come from WordPress and contain & — unescaped they break the SVG. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function svgBanner(
  text: string,
  w: number,
  h: number,
  bg: string,
  { sample = false }: { sample?: boolean } = {},
): Buffer {
  const barH = Math.max(18, Math.round(h / 8));
  const bar = sample
    ? `<rect width="${w}" height="${barH}" fill="#e8a020"/>
      <text x="50%" y="${barH / 2}" font-family="Arial" font-weight="bold" font-size="${Math.min(barH * 0.6, 13)}" fill="#16283f" text-anchor="middle" dominant-baseline="middle" letter-spacing="1">SAMPLE — NOT A LIVE BOOKING</text>`
    : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="${bg}"/>
      ${bar}
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.min(h / 3, 40)}" fill="#fff" text-anchor="middle" dominant-baseline="middle">${esc(text)}</text>
      <text x="50%" y="82%" font-family="Arial" font-size="${Math.min(h / 6, 16)}" fill="#ffffffaa" text-anchor="middle">${w}×${h} · seed placeholder</text>
    </svg>`
  );
}
