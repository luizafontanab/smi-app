import Link from "next/link";
import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { applyOptIn } from "@/lib/contacts";
import { allowRequest, HOUR } from "@/lib/rate-limit";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Reader-facing unsubscribe (GAPS B5.2). Broadcasts themselves use Resend's
 * hosted one-click unsubscribe, which is the compliant path and reports back
 * through /api/webhooks/resend — this page is the fallback for everywhere that
 * link isn't available, chiefly the web archive at /newsletters, and for anyone
 * who would simply rather type the address in.
 *
 * Confirmation is a POST, never a bare GET: mail clients and security scanners
 * prefetch links, and a GET that unsubscribed on sight would drop people off
 * the list who never clicked anything.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const prefill = typeof sp.email === "string" ? sp.email : "";
  const done = sp.done === "1";

  async function unsubscribe(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (email && (await allowRequest("unsubscribe", 10, HOUR))) {
      const db = serviceDb();
      const { data: contact } = await db
        .from("contacts")
        .select("id, subscribed, unsubscribed_at")
        .eq("email", email)
        .maybeSingle();
      if (contact && !contact.unsubscribed_at) {
        await db
          .from("contacts")
          .update(applyOptIn(contact, { newsletter: "unsubscribed", reOptIn: false }))
          .eq("id", contact.id);
      }
    }
    // Same answer either way — this page must not become a way to check which
    // addresses are on the list.
    redirect("/unsubscribe?done=1");
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ink">Unsubscribe</h1>

        {done ? (
          <>
            <p className="mt-3 text-sm text-gray-600">
              That address is unsubscribed from the SMI newsletter. You won&apos;t receive any further issues.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Emails about your own membership — approvals, advert runs and account notices — are separate and will still be sent.
            </p>
            <p className="mt-5 text-sm"><Link href="/" className="underline">Back to Sheet Metal Industries</Link></p>
          </>
        ) : (
          <form action={unsubscribe}>
            <p className="mt-2 text-sm text-gray-600">
              Enter the address you receive the SMI newsletter at and we&apos;ll take it off the list.
            </p>
            <label htmlFor="email" className="mt-5 block text-sm font-medium">Email</label>
            <input
              id="email" name="email" type="email" required defaultValue={prefill} autoComplete="email"
              className="mt-1 w-full rounded border px-3 py-2"
            />
            <div className="mt-5">
              <SubmitButton pendingLabel="Unsubscribing…">Unsubscribe</SubmitButton>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              This only stops the newsletter. Notices about your own membership are sent separately.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
