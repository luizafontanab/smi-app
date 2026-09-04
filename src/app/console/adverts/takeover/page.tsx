import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { TakeoverColorPicker } from "@/components/console/TakeoverColorPicker";
import { saveTakeoverPlacement } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TakeoverPage(props: PageProps<"/console/adverts/takeover">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: members }, { data: takeovers }] = await Promise.all([
    db.from("members").select("id, name").eq("status", "active").order("name"),
    db.from("placements").select("id, config, starts_on, ends_on, member:members(name)").eq("kind", "takeover").order("starts_on", { ascending: false }),
  ]);
  const live = (takeovers ?? []).find((t) => t.starts_on <= today && t.ends_on >= today);
  const liveBanner = live ? mediaUrl((live.config as { banner_path?: string }).banner_path ?? null) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Adverts &amp; Inventory</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Homepage takeover</h1>
      <p className="mt-1 text-sm text-graphite">
        One advertiser&apos;s colours and top banner across the whole public site for a paid period — reverts on its own once the dates end.
      </p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Book a takeover</h2>
        <form action={saveTakeoverPlacement} className="mt-3 space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Advertiser</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <TakeoverColorPicker />
          <div>
            <label htmlFor="banner" className="text-sm font-medium">Top banner</label>
            <input id="banner" name="banner" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Book takeover</button>
        </form>
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Booked</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Advertiser</th><th scope="col">Colour</th><th scope="col">From</th><th scope="col">To</th><th scope="col" /></tr></thead>
          <tbody>
            {(takeovers ?? []).map((t) => {
              const config = t.config as { hex?: string; banner_path?: string };
              const isLive = t.starts_on <= today && t.ends_on >= today;
              return (
                <tr key={t.id} className="border-t">
                  <td className="py-2">{t.member?.name}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-4 w-4 rounded border" style={{ background: config.hex }} aria-hidden />
                      <span className="font-mono text-xs">{config.hex}</span>
                    </span>
                  </td>
                  <td>{t.starts_on}</td>
                  <td>{t.ends_on}</td>
                  <td className="text-right">{isLive && <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">live</span>}</td>
                </tr>
              );
            })}
            {!takeovers?.length && (
              <tr><td colSpan={5} className="py-4 text-center text-graphite">None booked yet.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      {liveBanner && (
        <p className="mt-3 text-xs text-graphite">
          Preview:
          <Image src={liveBanner} alt="" width={1280} height={170} className="mt-2 h-auto w-full rounded border" unoptimized />
        </p>
      )}
    </div>
  );
}
