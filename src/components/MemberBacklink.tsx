import { MemberTiles } from "@/components/MemberTiles";

/**
 * One member's backlink + branding box — the single-member case of
 * MemberTiles (Jas 13/10 item 12b), kept for callers with exactly one member
 * (the member video preview). Stories pass their whole tagged list to
 * MemberTiles directly.
 */
export function MemberBacklink({ name, slug, logoUrl, label }: { name: string; slug: string; logoUrl?: string | null; label?: string }) {
  return (
    <div data-part="member-backlink" className="mt-8">
      <MemberTiles members={[{ name, slug, logoUrl: logoUrl ?? null }]} layout="inline" label={label} />
    </div>
  );
}
