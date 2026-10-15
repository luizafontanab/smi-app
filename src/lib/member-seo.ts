import type { Metadata } from "next";
import { excerptFromHtml } from "./sanitize";
import { OG_BASE, SITE_CARD } from "./seo";

/**
 * <head> metadata for a /member/[slug] profile. Pure — image URLs arrive
 * already resolved — so the rules below are unit-testable without a database.
 *
 * Every profile gets a description and a share image even when the member
 * has filled in neither: a missing meta description hands the snippet to the
 * search engine, and a summary_large_image card with no image renders as a
 * bare link.
 */

export type MemberSeoInput = {
  name: string;
  description: string | null;
  address: string | null;
  archived_at: string | null;
  industry?: { name: string } | null;
  services?: { name: string }[];
  heroUrl: string | null;
  logoUrl: string | null;
};

/** Built from the structured fields when the member has written no About text. */
export function fallbackMemberDescription(m: Pick<MemberSeoInput, "name" | "address" | "industry" | "services">): string {
  const services = (m.services ?? []).map((s) => s.name);
  const text = [
    `${m.name} — SMI member${m.industry ? ` · ${m.industry.name}` : ""}${m.address ? `, ${m.address}` : ""}.`,
    services.length ? `${services.join(", ")}.` : "",
  ].join(" ");
  return excerptFromHtml(text, 160) ?? m.name;
}

export function memberMetadata(m: MemberSeoInput | null, slug: string): Metadata {
  // A miss either 404s or follows a rename redirect — nothing worth describing.
  if (!m) return { title: "Member" };

  const path = `/member/${slug}`;
  const description = excerptFromHtml(m.description, 200) ?? fallbackMemberDescription(m);
  const own = m.heroUrl ?? m.logoUrl;
  const images = own ? [own] : [SITE_CARD];

  return {
    title: m.name,
    description,
    // An archived page is only ever served to a signed-in admin, so a crawler
    // gets the 404 regardless — but say it out loud rather than rely on that.
    robots: m.archived_at ? { index: false, follow: false } : undefined,
    alternates: { canonical: path },
    openGraph: { ...OG_BASE, type: "profile", url: path, title: m.name, description, images },
    twitter: { card: "summary_large_image", title: m.name, description, images },
  };
}
