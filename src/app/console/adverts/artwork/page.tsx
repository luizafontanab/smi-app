import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";

export const dynamic = "force-dynamic";

export default async function AdvertArtworkPage() {
  await requireConsole();
  const db = serviceDb();
  const adverts = await must(
    db.from("adverts")
      .select("id, name, format, desktop_path, member:members(name), bookings:advert_bookings(id, status)")
      .order("created_at"),
    "console/adverts artwork list",
  );

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Artwork</h1>
        <Link href="/console/adverts/artwork/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New artwork</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        The banners themselves. One piece of artwork can run many times — book its dates from{" "}
        <Link href="/console/adverts" className="underline">Bookings</Link>.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-graphite">
              <th scope="col" className="py-1">Preview</th><th scope="col">Name</th><th scope="col">Member</th><th scope="col">Format</th><th scope="col">Runs</th><th scope="col" />
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
                  <td className="text-graphite">{a.member?.name}</td>
                  <td className="text-graphite">{a.format.replace(/_/g, " ")}</td>
                  <td className="text-graphite">{runs.length}{liveNow ? ` · ${liveNow} live` : ""}</td>
                  <td className="text-right">
                    <Link href={`/console/adverts/artwork/${a.id}`} className="text-xs text-ink hover:underline">edit</Link>
                  </td>
                </tr>
              );
            })}
            {!adverts?.length && (
              <tr><td colSpan={6} className="py-4 text-center text-graphite">No artwork yet.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
