import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { savePrefs } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification settings" };

export default async function SettingsPage(props: PageProps<"/member/settings">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const { data: prefs } = await serviceDb().from("notification_prefs").select("*").eq("member_id", user.memberId).maybeSingle();

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/member" className="text-sm text-gray-400 hover:text-navy">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">Notification settings</h1>
      {sp.saved && <p className="mt-2 rounded bg-green-50 p-2 text-sm text-green-700">Saved.</p>}
      <p className="mt-1 text-sm text-gray-500">We&apos;d rather email you too little than too much — you choose the cadence.</p>
      <form action={savePrefs} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm text-sm">
        <div>
          <label htmlFor="stats_frequency" className="font-medium">Statistics summaries</label>
          <select id="stats_frequency" name="stats_frequency" defaultValue={prefs?.stats_frequency ?? "quarterly"} className="mt-1 w-full rounded border px-3 py-2">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly (recommended)</option>
            <option value="never">Never — I&apos;ll check the dashboard</option>
          </select>
        </div>
        <div>
          <label htmlFor="leads_frequency" className="font-medium">Sales-lead alerts (companies engaging with you)</label>
          <select id="leads_frequency" name="leads_frequency" defaultValue={prefs?.leads_frequency ?? "weekly"} className="mt-1 w-full rounded border px-3 py-2">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (recommended — leads go cold)</option>
            <option value="never">Never</option>
          </select>
        </div>
        <button className="rounded bg-navy px-5 py-2.5 text-white">Save</button>
      </form>
    </div>
  );
}
