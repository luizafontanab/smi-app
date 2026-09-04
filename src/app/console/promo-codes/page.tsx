import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { Card, SectionTitle } from "@/components/console/ui";
import { savePromoCode, setPromoCodeActive } from "../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promo codes" };

export default async function PromoCodesPage(props: PageProps<"/console/promo-codes">) {
  await requireConsole();
  const sp = await props.searchParams;
  const { data: codes } = await serviceDb().from("promo_codes")
    .select("id, code, months, active, max_uses, used_count, expires_at")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Promo codes</h1>
      <p className="mt-1 text-sm text-graphite">
        Comp membership months via a shareable code — the join flow and /dashboard/pay both redeem here.
      </p>
      {sp.saved && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Code created.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <Card className="mt-4">
        <SectionTitle>New code</SectionTitle>
        <form action={savePromoCode} className="mt-3 grid gap-4 sm:grid-cols-4">
          <UnsavedChangesGuard />
          <div className="sm:col-span-2">
            <label htmlFor="code" className="text-sm font-medium">Code</label>
            <input id="code" name="code" required className="mt-1 w-full rounded border px-3 py-2" placeholder="SMI-FREE-MONTH" />
          </div>
          <div>
            <label htmlFor="months" className="text-sm font-medium">Months</label>
            <input id="months" name="months" type="number" min={1} max={60} required defaultValue={1} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="max_uses" className="text-sm font-medium">Max uses</label>
            <input id="max_uses" name="max_uses" type="number" min={1} className="mt-1 w-full rounded border px-3 py-2" placeholder="Unlimited" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="expires_at" className="text-sm font-medium">Expires</label>
            <input id="expires_at" name="expires_at" type="date" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div className="flex items-end sm:col-span-2">
            <button className="rounded bg-ink px-5 py-2.5 text-sm text-white">Create code</button>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <SectionTitle>All codes</SectionTitle>
        <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-graphite">
              <th scope="col" className="py-1">Code</th><th scope="col">Months</th><th scope="col">Uses</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col" />
            </tr>
          </thead>
          <tbody>
            {(codes ?? []).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-2 font-mono font-medium">{c.code}</td>
                <td>{c.months}</td>
                <td>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ""}</td>
                <td>{c.expires_at ?? "—"}</td>
                <td>{c.active ? <span className="text-success">active</span> : <span className="text-graphite">inactive</span>}</td>
                <td className="text-right">
                  <form action={setPromoCodeActive}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                    <button type="submit" className="text-xs text-graphite underline">{c.active ? "Deactivate" : "Reactivate"}</button>
                  </form>
                </td>
              </tr>
            ))}
            {(codes ?? []).length === 0 && <tr><td colSpan={6} className="py-3 text-graphite">No promo codes yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
