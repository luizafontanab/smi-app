import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { currentUser } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Login" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const user = await currentUser();
  if (user) redirect(user.role === "member" ? "/member" : "/console");
  const next = typeof sp.next === "string" ? sp.next : "";
  const failed = sp.error === "1";

  async function signIn(formData: FormData) {
    "use server";
    const db = await sessionDb();
    const { error } = await db.auth.signInWithPassword({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    const dest = String(formData.get("next") ?? "");
    if (error) redirect(`/login?error=1${dest ? `&next=${encodeURIComponent(dest)}` : ""}`);
    if (dest) redirect(dest);
    const { currentUser } = await import("@/lib/auth");
    const user = await currentUser();
    redirect(user?.role === "member" ? "/member" : "/console");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form action={signIn} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <p className="text-center text-lg font-bold text-navy">Sheet Metal <span className="text-amber">Industries</span></p>
        <p className="mt-1 text-center text-sm text-gray-500">Member &amp; editor login</p>
        {failed && <p className="mt-3 rounded bg-red-50 p-2 text-center text-sm text-red-600">Wrong email or password.</p>}
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="mt-5 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
        <label htmlFor="password" className="mt-3 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required className="mt-1 w-full rounded border px-3 py-2" />
        <div className="mt-5">
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </div>
        <p className="mt-3 text-center text-xs text-gray-400">Forgotten password? Use the reset link (coming with email adapter).</p>
      </form>
    </div>
  );
}
