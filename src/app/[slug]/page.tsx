import { notFound, permanentRedirect, redirect } from "next/navigation";
import { publicDb } from "@/lib/db/server";
import { resolveRedirect } from "@/lib/redirects";

export const dynamic = "force-dynamic";

/**
 * Catch-all for the old WordPress URL space at the root.
 *
 * That site put every article at `/{slug}/` with no section prefix, alongside
 * its pages — so the only way to tell `/plans-in-place-for-future-growth` from
 * `/about` is to look them up. A next.config rule can't express that without
 * matching the entire site, which is why this route exists rather than another
 * entry in `legacyRedirects`.
 *
 * Static segments beat dynamic ones in the App Router, so every real route
 * (/news, /member, /console, /dashboard…) resolves before this file is reached.
 * What lands here is what would otherwise have been a 404 — which is the budget
 * this is written against: up to three queries, none of them on a hot path.
 *
 * Deliberately OUTSIDE the (public) group, even though everything it redirects
 * to is inside it. That group has a loading.tsx, so its routes stream: Next
 * flushes the shell — status 200, already committed — before an awaited lookup
 * finishes, and the redirect degrades to a client-side one. A crawler following
 * a decade of inbound links needs a real 308 in the response headers, which is
 * the whole reason this file exists. No Suspense boundary above it, no early
 * flush, real status code. The cost is that notFound() here renders the root
 * app/not-found.tsx rather than the public one with its header and footer.
 */
export default async function LegacyRootSlug(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const db = publicDb();

  // Articles are the bulk of the old index (~900 URLs), so they go first.
  const { data: story } = await db
    .from("stories")
    .select("slug")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (story) permanentRedirect(`/news/${story.slug}`);

  const { data: page } = await db.from("static_pages").select("slug").eq("slug", slug).maybeSingle();
  if (page) permanentRedirect(`/pages/${page.slug}`);

  // Renames recorded since launch. Last, because it is the only lookup needing
  // the service key — `redirects` has RLS on with no public policy.
  const hit = await resolveRedirect(`/${slug}`);
  // honour the stored status_code — the table can hold deliberate 302/307 rows,
  // and baking one of those into a browser cache as a 308 is not undoable
  if (hit) (hit.permanent ? permanentRedirect : redirect)(hit.to);

  notFound();
}
