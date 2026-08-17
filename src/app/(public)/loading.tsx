/**
 * Every public page is force-dynamic and queries Supabase, currently in
 * ca-central-1, so a navigation is a full transatlantic round-trip. Without a
 * Suspense fallback the browser sits on the previous page with no feedback at
 * all. This is deliberately a plain shape, not a per-page skeleton — the point
 * is "something is happening", and one file covers every route in the group.
 */
export default function PublicLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-2/3 rounded bg-gray-200" />
      <div className="mt-3 h-4 w-1/3 rounded bg-gray-200" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[16/10] w-full rounded bg-gray-200" />
            <div className="mt-3 h-4 w-full rounded bg-gray-200" />
            <div className="mt-2 h-4 w-4/5 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
