import { requireMemberView } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resources" };

export default async function ResourcesPage() {
  const user = await requireMemberView();
  const [{ data: m }, { data: resources }] = await Promise.all([
    serviceDb().from("members").select("name, slug").eq("id", user.memberId).single(),
    serviceDb().from("resources").select("id, title, path, kind").order("created_at", { ascending: false }),
  ]);
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
    <div className="max-w-2xl lg:mx-auto">
      <h1 className="mt-1 text-xl font-bold text-ink">Resources</h1>
      <p className="mt-1 text-sm text-graphite">Brand assets and downloadables for your own channels.</p>

      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <p className="font-medium text-ink">Your &quot;proud member&quot; graphic</p>
        <p className="mt-1 text-sm text-graphite">Links readers back to your SMI page.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml,${svg}`} alt="Proud member graphic" className="mt-3 w-full rounded border" />
        <a
          download={`smi-member-${m?.slug}.svg`}
          href={`data:image/svg+xml,${svg}`}
          className="mt-4 inline-block rounded bg-ink px-5 py-2.5 text-sm text-white"
        >
          Download graphic
        </a>
      </div>

      {(resources ?? []).length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Brand pack</h2>
          <ul className="mt-2 divide-y">
            {(resources ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>{r.kind === "document" ? "📄" : "🖼️"} {r.title}</span>
                <a href={mediaUrl(r.path) ?? undefined} className="tap shrink-0 text-graphite underline">Download</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
