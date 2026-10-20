import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { currentUser } from "@/lib/auth";
import { safeInternalPath } from "@/lib/validate";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Login" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const user = await currentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/console");
  const next = safeInternalPath(sp.next) ?? "";
  const failed = sp.error === "1";
  const resetFailed = sp.error === "reset";
  const emailChangeFailed = sp.error === "email-change";

  async function signIn(formData: FormData) {
    "use server";
    const db = await sessionDb();
    const email = String(formData.get("email") ?? "");
    const { error } = await db.auth.signInWithPassword({
      email,
      password: String(formData.get("password") ?? ""),
    });
    // Re-validated here, not just at render: the hidden field is client-editable.
    const dest = safeInternalPath(formData.get("next")) ?? "";
    const { audit } = await import("@/lib/audit");
    if (error) {
      // The attempted address (capped) is what makes repeated failures against
      // one account visible; it's stripped from the log after 90 days.
      await audit({ action: "sign_in_failed", detail: { email: email.trim().toLowerCase().slice(0, 254) } });
      redirect(`/login?error=1${dest ? `&next=${encodeURIComponent(dest)}` : ""}`);
    }
    const { currentUser } = await import("@/lib/auth");
    const user = await currentUser();
    if (user) await audit({ action: "sign_in", actorUserId: user.userId, actorRole: user.role, memberId: user.memberId });
    if (dest) redirect(dest);
    if (!user) redirect("/login?error=1");
    redirect(user.role === "member" ? "/dashboard" : "/console");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form action={signIn} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        {/* text-xl, not lg: at 18px bold the orange half sits just under
            WCAG's large-text threshold (18.66px bold) and its 3.3:1 contrast
            fails AA; at 20px bold it qualifies as large text and passes. */}
        <p className="text-center text-xl font-bold text-ink">Sheet Metal <span className="text-brand-text">Industries</span></p>
        <p className="mt-1 text-center text-sm text-graphite">Member &amp; editor login</p>
        {failed && <p className="mt-3 rounded bg-danger/10 p-2 text-center text-sm text-danger">Wrong email or password.</p>}
        {resetFailed && <p className="mt-3 rounded bg-danger/10 p-2 text-center text-sm text-danger">That reset link has expired or was already used. <Link href="/reset" className="underline">Request a new one</Link>.</p>}
        {emailChangeFailed && <p className="mt-3 rounded bg-danger/10 p-2 text-center text-sm text-danger">That email-change link has expired or was already used. Log in and request the change again from Settings.</p>}
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="mt-5 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded border px-3 py-2" />
        <label htmlFor="password" className="mt-3 block text-sm font-medium">Password</label>
        {/* Fix-list 14 ("return on password should log in"): Enter has always
            submitted this native form — not reproducible in Chromium or WebKit
            at any hydration timing, even with JS blocked. The one mechanism
            that matches the report is the password-manager layer: without
            autocomplete tokens, browsers can misclassify the field and their
            suggestion overlay swallows the first Enter. The tokens make the
            fields unambiguous to autofill. */}
        <input id="password" name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded border px-3 py-2" />
        <div className="mt-5">
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </div>
        <p className="mt-3 text-center text-sm text-graphite">
          <Link href="/reset" className="underline">Forgotten your password?</Link>
        </p>
      </form>
    </div>
  );
}
