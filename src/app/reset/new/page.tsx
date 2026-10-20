import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

/** Matches Supabase's own minimum; `config.toml` sets no stricter policy. */
const MIN_LENGTH = 8;

/**
 * Reached only via /reset/confirm, which has already turned the emailed token
 * into a session. The recovery session is what authorises the change, so this
 * page is guarded by "is there a user" rather than by a token of its own.
 */
export default async function NewPasswordPage(props: PageProps<"/reset/new">) {
  const sp = await props.searchParams;
  const db = await sessionDb();
  const { data: { user } } = await db.auth.getUser();
  // No session means the link was stale, already used, or opened in a different
  // browser than the one that requested it (the PKCE case).
  if (!user) redirect("/login?error=reset");

  const error = typeof sp.error === "string" ? sp.error : "";

  async function setPassword(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password.length < MIN_LENGTH) redirect("/reset/new?error=short");
    if (password !== confirm) redirect("/reset/new?error=mismatch");

    const db = await sessionDb();
    const { error } = await db.auth.updateUser({ password });
    if (error) redirect("/reset/new?error=failed");

    const { currentUser } = await import("@/lib/auth");
    const user = await currentUser();
    if (user) {
      const { audit } = await import("@/lib/audit");
      await audit({ action: "password_reset", actorUserId: user.userId, actorRole: user.role, memberId: user.memberId });
    }
    redirect(user?.role === "admin" ? "/console" : "/dashboard");
  }

  const message =
    error === "short" ? `Please use at least ${MIN_LENGTH} characters.`
    : error === "mismatch" ? "Those two passwords don't match."
    : error === "failed" ? "That didn't work — the link may have expired. Request a new one."
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form action={setPassword} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <p className="text-center text-lg font-bold text-ink">Sheet Metal <span className="text-brand">Industries</span></p>
        <p className="mt-1 text-center text-sm text-graphite">Set a new password for {user.email}</p>
        {message && <p className="mt-3 rounded bg-danger/10 p-2 text-center text-sm text-danger">{message}</p>}

        <label htmlFor="password" className="mt-5 block text-sm font-medium">New password</label>
        <input id="password" name="password" type="password" required minLength={MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />

        <label htmlFor="confirm" className="mt-3 block text-sm font-medium">Confirm new password</label>
        <input id="confirm" name="confirm" type="password" required minLength={MIN_LENGTH} autoComplete="new-password" className="mt-1 w-full rounded border px-3 py-2" />

        <div className="mt-5">
          <SubmitButton pendingLabel="Saving…">Save password</SubmitButton>
        </div>
        <p className="mt-3 text-center text-sm">
          <Link href="/reset" className="underline text-graphite">Request a new link</Link>
        </p>
      </form>
    </div>
  );
}
