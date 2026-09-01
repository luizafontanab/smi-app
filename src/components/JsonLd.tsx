/**
 * Renders schema.org structured data (builders in lib/jsonld.ts). `</` is
 * escaped so content containing "</script>" cannot break out of the tag.
 * Works under the current CSP because script-src keeps 'unsafe-inline'
 * (next.config.ts) — if that ever moves to nonces, this tag needs one too
 * (HUMAN-TODO §8.4).
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
