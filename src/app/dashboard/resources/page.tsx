import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resources" };

export default async function ResourcesPage() {
  const user = await requireMember();
  const { data: m } = await serviceDb().from("members").select("name, slug").eq("id", user.memberId).single();
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#16283f"/>
      <text x="600" y="260" font-family="Arial" font-size="44" fill="#ffffff" text-anchor="middle">We're a proud member of</text>
      <text x="600" y="330" font-family="Arial" font-size="60" font-weight="bold" fill="#e8a020" text-anchor="middle">Sheet Metal Industries</text>
      <text x="600" y="420" font-family="Arial" font-size="34" fill="#ffffff" text-anchor="middle">${(m?.name ?? "").replace(/&/g, "&amp;")}</text>
      <text x="600" y="560" font-family="Arial" font-size="24" fill="#9fb3c8" text-anchor="middle">sheetmetalindustries.com/member/${m?.slug}</text>
    </svg>`
  );
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Resources</h1>
      <p className="mt-1 text-sm text-gray-500">Share your membership on your own channels — the graphic links readers back to your SMI page.</p>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml,${svg}`} alt="Proud member graphic" className="w-full rounded border" />
        <a
          download={`smi-member-${m?.slug}.svg`}
          href={`data:image/svg+xml,${svg}`}
          className="mt-4 inline-block rounded bg-ink px-5 py-2.5 text-sm text-white"
        >
          Download graphic
        </a>
      </div>
    </div>
  );
}
