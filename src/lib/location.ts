/**
 * Legacy-tolerant location text — the events counterpart of renderableHtml.
 *
 * WP events carry an ACF Google-Map value: a PHP-serialized array
 * (`a:13:{s:7:"address";s:60:"…";s:3:"lat";d:53.6;…}`). The extract pipeline
 * now decodes it (handover-extract/scripts/lib.ts → acfMapText); rows seeded
 * before that fix still hold the blob, so it is unpicked again at render.
 *
 * Regex, not a parser: php-serialize is deliberately not an app dependency for
 * one legacy artefact, and the `s:N:` length is a BYTE count (the EuroBLECH
 * address is 51 chars / 54 bytes), so values are matched to the closing quote
 * and never sliced by the declared length. Unmatched → null: no location line
 * beats a wall of noise.
 */
const sub = (v: string, key: string) =>
  new RegExp(`s:\\d+:"${key}";s:\\d+:"([^"]*)"`).exec(v)?.[1]?.trim() ?? "";

export function displayLocation(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^a:\d+:\{/.test(value)) return value;
  const local = [sub(value, "city"), sub(value, "post_code")].filter(Boolean).join(", ");
  // country only when it isn't the UK — a UK trade audience needs to see "abroad"
  const abroad = sub(value, "country_short") !== "GB" ? sub(value, "country") : "";
  return [local, local && abroad].filter(Boolean).join(", ") || sub(value, "address") || null;
}
