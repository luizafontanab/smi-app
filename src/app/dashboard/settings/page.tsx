import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { changePassword, savePrefs } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };
const PASSWORD_MIN_LENGTH = 8;

export default async function SettingsPage(props: PageProps<"/dashboard/settings">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const { data: prefs } = await serviceDb().from("notification_prefs").select("*").eq("member_id", user.memberId).maybeSingle();

  const perror = typeof sp.perror === "string" ? sp.perror : "";
  const passwordMessage =
    perror === "short" ? `Please use at least ${PASSWORD_MIN_LENGTH} characters.`
    : perror === "mismatch" ? "Those two passwords don't match."
    : perror === "failed" ? "That didn't work — please try again."
    : "";

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Notification settings</h1>
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
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>

      <h2 className="mt-8 text-xl font-bold text-ink">Account security</h2>
      {sp.psaved && <p className="mt-2 rounded bg-green-50 p-2 text-sm text-green-700">Password updated.</p>}
      {passwordMessage && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{passwordMessage}</p>}
      <p className="mt-1 text-sm text-gray-500">Change the password you log in with.</p>
      <form action={changePassword} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm text-sm">
        <div>
          <label htmlFor="password" className="font-medium">New password</label>
          <input id="password" name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="confirm" className="font-medium">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Update password</button>
      </form>
    </div>
  );
}
