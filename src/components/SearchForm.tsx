/**
 * The universal search form — Jas asked for it on home, news, videos and
 * members (one tool, and the query log steers SEO decisions later).
 * `/member` and `/search` keep their own hand-rolled forms: both carry extra
 * fields (a hidden category, autoFocus/defaultValue) this shape doesn't need.
 */
export function SearchForm({
  placeholder = "Search news, members, machines…",
  className = "mt-6 flex gap-2",
}: {
  placeholder?: string;
  className?: string;
}) {
  return (
    <form action="/search" className={className}>
      <input
        name="q"
        type="search"
        aria-label="Search the site"
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-line px-4 py-2.5 text-sm"
      />
      <button className="rounded bg-brand px-5 py-2.5 text-sm font-bold text-ink hover:brightness-110">Search</button>
    </form>
  );
}
