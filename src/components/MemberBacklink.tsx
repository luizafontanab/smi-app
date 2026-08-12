import Image from "next/image";
import Link from "next/link";

/** The member backlink + branding aside shown under stories — and in previews. */
export function MemberBacklink({ name, slug, logoUrl }: { name: string; slug: string; logoUrl?: string | null }) {
  return (
    <aside className="mt-8 rounded-lg border-2 border-amber bg-amber/5 p-5">
      <div className="flex items-center gap-4">
        {logoUrl && <Image src={logoUrl} alt="" width={56} height={56} className="rounded" unoptimized />}
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">This story features an SMI member</p>
          <Link href={`/members/${slug}`} className="text-lg font-bold text-navy hover:underline">
            {name} →
          </Link>
        </div>
      </div>
    </aside>
  );
}
