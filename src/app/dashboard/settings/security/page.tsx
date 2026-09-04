import { requireMember } from "@/lib/auth";
import { changePassword } from "../../actions";
import { SettingsTabs } from "../SettingsTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security" };
const PASSWORD_MIN_LENGTH = 8;

export default async function SecuritySettingsPage(props: PageProps<"/dashboard/settings/security">) {
  await requireMember();
  const sp = await props.searchParams;

  const perror = typeof sp.perror === "string" ? sp.perror : "";
  const passwordMessage =
    perror === "short" ? `Please use at least ${PASSWORD_MIN_LENGTH} characters.`
    : perror === "mismatch" ? "Those two passwords don't match."
    : perror === "failed" ? "That didn't work — please try again."
    : "";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Account security</h1>
      {sp.psaved && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Password updated.</p>}
      {passwordMessage && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{passwordMessage}</p>}
      <p className="mt-1 text-sm text-graphite">Change the password you log in with.</p>
      <SettingsTabs active="security" />
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
