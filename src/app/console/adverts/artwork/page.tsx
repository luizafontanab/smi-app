import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export default async function AdvertArtworkPage() {
  await requireConsole();
  const db = serviceDb();
  const { data: adverts } = await db
    .from("adverts")
    .select("id, name, format, desktop_path, member:members(name), bookings:advert_bookings(id, status)")
    .order("created_at");

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-gray-400 hover:text-ink">← Adverts &amp; Inventory</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Artwork</h1>
        <Link href="/console/adverts/artwork/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New artwork</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        The banners themselves. One piece of artwork can run many times — book its dates from{" "}
        <Link href="/console/adverts" className="underline">Bookings</Link>.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="py-1">Preview</th><th>Name</th><th>Member</th><th>Format</th><th>Runs</th><th />
            </tr>
          </thead>
          <tbody>
            {(adverts ?? []).map((a) => {
              const runs = a.bookings ?? [];
              const liveNow = runs.filter((b) => b.status === "live").length;
              return (
                <tr key={a.id} className="border-t">
                  <td className="py-2">
                    <Image src={mediaUrl(a.desktop_path)!} alt="" width={80} height={24} className="h-auto w-20 rounded" unoptimized />
                  </td>
                  <td className="font-medium text-ink">{a.name}</td>
                  <td className="text-gray-500">{a.member?.name}</td>
                  <td className="text-gray-500">{a.format.replace(/_/g, " ")}</td>
                  <td className="text-gray-500">{runs.length}{liveNow ? ` · ${liveNow} live` : ""}</td>
                  <td className="text-right">
                    <Link href={`/console/adverts/artwork/${a.id}`} className="text-xs text-ink hover:underline">edit</Link>
                  </td>
                </tr>
              );
            })}
            {!adverts?.length && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">No artwork yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
