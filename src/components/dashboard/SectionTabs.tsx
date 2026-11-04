import Link from "next/link";

/**
 * A horizontal strip of section tabs under a page heading — server-rendered,
 * no client JS; the active tab comes from the route, not from state. Extracted
 * from the advertising hub's Information / Buy / Manage strip so other
 * dashboard sections can carry the same treatment.
 */
export function SectionTabs({ items, active, ariaLabel }: {
  items: readonly { key: string; href: string; label: string }[];
  active: string;
  ariaLabel: string;
}) {
  return (
    // Wraps by whole tab, never inside one: a label broken over two lines left
    // the row ragged and the underline adrift on phones (#33 M4). Wrapping
    // rather than scrolling keeps every tab in view.
    <nav aria-label={ariaLabel} className="mt-4 flex flex-wrap gap-x-1 border-b text-sm">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`tap whitespace-nowrap border-b-2 px-3 py-2 ${
            t.key === active ? "border-brand font-semibold text-ink" : "border-transparent text-graphite hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
