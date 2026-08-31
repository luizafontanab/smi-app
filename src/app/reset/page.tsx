import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { currentUser } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { allowRequest, HOUR } from "@/lib/rate-limit";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Reset your password" };

/**
 * Password recovery (GAPS A4.1). Until this existed the login page advertised a
 * reset link that did not exist, and with one shared login and no admin
 * user-management UI a locked-out member had no recovery path at all.
 *
 * Supabase issues and validates the token — we do not mint our own. Mail leaves
 * via Resend because Supabase Auth's SMTP is pointed at it (set in the hosted
 * dashboard, never in config.toml).
 */
export default async function ResetPage(props: PageProps<"/reset">) {
  const sp = await props.searchParams;
  const user = await currentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/console");
  const sent = sp.sent === "1";

  async function requestReset(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // Deliberately generous: locking someone out of the *unlock* flow is worse
    // than a few extra emails, and Supabase rate-limits the send itself.
    if (email && (await allowRequest("reset", 5, HOUR))) {
      const db = await sessionDb();
      await db.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/reset/confirm` });
    }
    // Always the same answer, whether or not the address has an account —
    // otherwise this page becomes a way to test which emails are members.
    redirect("/reset?sent=1");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <p className="text-center text-lg font-bold text-ink">Sheet Metal <span className="text-brand">Industries</span></p>

        {sent ? (
          <>
            <p className="mt-4 rounded bg-green-50 p-3 text-center text-sm text-green-800">
              If that address has an account, a reset link is on its way. The link is valid for one hour.
            </p>
            <p className="mt-4 text-center text-sm">
              <Link href="/login" className="underline">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form action={requestReset}>
            <p className="mt-1 text-center text-sm text-gray-500">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            <label htmlFor="email" className="mt-5 block text-sm font-medium">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border px-3 py-2" />
            <div className="mt-5">
              <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
            </div>
            <p className="mt-3 text-center text-sm">
              <Link href="/login" className="underline text-gray-500">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
