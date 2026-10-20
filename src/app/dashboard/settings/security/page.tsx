import Link from "next/link";
import { requireMemberView } from "@/lib/auth";
import { changeLoginEmail, changePassword } from "../../actions";
import { RequiredMark } from "@/components/RequiredMark";
import { SettingsTabs } from "../SettingsTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security" };
const PASSWORD_MIN_LENGTH = 8;

export default async function SecuritySettingsPage(props: PageProps<"/dashboard/settings/security">) {
  const user = await requireMemberView();
  const sp = await props.searchParams;

  const perror = typeof sp.perror === "string" ? sp.perror : "";
  const passwordMessage =
    perror === "short" ? `Please use at least ${PASSWORD_MIN_LENGTH} characters.`
    : perror === "mismatch" ? "Those two passwords don't match."
    : perror === "failed" ? "That didn't work — please try again."
    : "";

  const eerror = typeof sp.eerror === "string" ? sp.eerror : "";
  const emailMessage =
    eerror === "invalid" ? "That isn't a valid email address."
    : eerror === "same" ? "That's already the address you log in with."
    : eerror === "taken" ? "That address can't be used — it may already belong to another account."
    : eerror === "limit" ? "Too many changes requested just now — please try again in an hour."
    : eerror === "failed" ? "That didn't work — please try again."
    : "";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Account security</h1>
      {sp.psaved && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Password updated.</p>}
      {passwordMessage && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{passwordMessage}</p>}
      <p className="mt-1 text-sm text-graphite">Change the password and email you log in with.</p>
      <SettingsTabs active="security" />
      <form action={changePassword} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm text-sm">
        <div>
          <label htmlFor="password" className="font-medium">New password<RequiredMark /></label>
          <input id="password" name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="confirm" className="font-medium">Confirm new password<RequiredMark /></label>
          <input id="confirm" name="confirm" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Update password</button>
      </form>

      {/* GAPS A4.12 — the login email, not the company page's contact email. */}
      <section aria-labelledby="login-email" className="mt-6 rounded-xl bg-white p-6 text-sm shadow-sm">
        <h2 id="login-email" className="font-bold text-ink">Login email</h2>
        <p className="mt-1 text-graphite">
          You log in as <b className="text-ink">{user.email}</b>. This is not the contact email shown on your company page —
          change that under <Link href="/dashboard/profile" className="underline">My page</Link>.
        </p>
        {sp.esent && (
          <p role="status" className="mt-3 rounded bg-success/10 p-2 text-success">
            We&apos;ve emailed a confirmation link — check the new address, and your current one too, as a link may go to
            each. Nothing changes until it&apos;s confirmed; until then, keep logging in with {user.email}.
          </p>
        )}
        {sp.econfirmed && (
          <p role="status" className="mt-3 rounded bg-success/10 p-2 text-success">
            Confirmed. If a second confirmation email arrived in your other inbox, click that one too.
          </p>
        )}
        {emailMessage && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-danger">{emailMessage}</p>}
        <form action={changeLoginEmail} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="email" className="font-medium">New login email<RequiredMark /></label>
            <input id="email" name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Change email</button>
        </form>
      </section>
    </div>
  );
}
