import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmUnsubscribe, requestUnsubscribe } from "./actions";
import { AuthLogo } from "@/components/AuthLogo";
// Loads the design option's stylesheet: this page sits outside the public
// layout but is part of the public site (data-site="public" below).
import "@/components/design-option";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Every refusal the two actions can send back, worded for the reader. */
const ERRORS: Record<string, string> = {
  email: "That doesn't look like an email address — check it and try again.",
  limit: "Too many attempts just now — please try again in an hour.",
  expired: "That link has expired. Enter your address below and we'll send you a fresh one.",
  invalid: "That link isn't valid — it may have been copied only in part. Enter your address below and we'll send you a fresh one.",
  unavailable:
    "Unsubscribing by typing an address isn't available right now. Use the unsubscribe link at the foot of any SMI newsletter, or contact us and we'll take you off the list.",
};

/**
 * Reader-facing unsubscribe (GAPS B5.2). Broadcasts themselves use Resend's
 * hosted one-click unsubscribe, which is the compliant path and reports back
 * through /api/webhooks/resend — this page is the fallback for everywhere that
 * link isn't available, chiefly the web archive at /newsletters, and for anyone
 * who would simply rather type the address in.
 *
 * Typing an address no longer unsubscribes it: it emails that address a
 * signed, expiring link (lib/unsubscribe), so only its owner can act on it.
 * The link lands back here with `?t=`, which shows a confirm button.
 *
 * Confirmation is a POST, never a bare GET: mail clients and security scanners
 * prefetch links, and a GET that unsubscribed on sight would drop people off
 * the list who never clicked anything.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const prefill = typeof sp.email === "string" ? sp.email : "";
  const token = typeof sp.t === "string" ? sp.t : "";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  // Read only to word the page; confirmUnsubscribe checks the token again.
  const link = token ? verifyUnsubscribeToken(token) : null;
  const linkError = link && !link.ok ? ERRORS[link.reason === "unconfigured" ? "unavailable" : link.reason] : undefined;

  return (
    <div data-site="public" data-part="auth-page" className="mx-auto max-w-md px-4 py-16">
      <div data-part="auth-panel" className="rounded-xl bg-white p-8 shadow-sm">
        <AuthLogo />
        <h1 data-part="page-title" className="mt-4 text-xl font-bold text-ink">Unsubscribe</h1>

        {sp.done === "1" ? (
          <>
            <p className="mt-3 text-sm text-graphite">
              That address is unsubscribed from the SMI newsletter. You won&apos;t receive any further issues.
            </p>
            <p className="mt-2 text-sm text-graphite">
              Emails about your own membership — approvals, advert runs and account notices — are separate and will still be sent.
            </p>
            <p className="mt-5 text-sm"><Link href="/" className="tap underline">Back to Sheet Metal Industries</Link></p>
          </>
        ) : sp.sent === "1" ? (
          <>
            <p role="status" data-part="form-notice" className="mt-3 text-sm text-graphite">
              Check your inbox. If that address gets the SMI newsletter, we&apos;ve sent it an email with a link to confirm —
              nothing changes until you press the button it opens.
            </p>
            <p className="mt-2 text-sm text-graphite">Nothing arrived after a few minutes? Check your spam folder, or use the unsubscribe link at the foot of any newsletter.</p>
          </>
        ) : link?.ok ? (
          <form action={confirmUnsubscribe}>
            <input type="hidden" name="t" value={token} />
            <p className="mt-2 text-sm text-graphite">
              Stop sending the SMI newsletter to <strong className="text-ink">{link.email}</strong>?
            </p>
            <div className="mt-5">
              <SubmitButton pendingLabel="Unsubscribing…">Unsubscribe</SubmitButton>
            </div>
            <p className="mt-3 text-xs text-graphite">
              This only stops the newsletter. Notices about your own membership are sent separately.
            </p>
          </form>
        ) : (
          <form action={requestUnsubscribe}>
            {(linkError ?? error) && (
              <p role="alert" data-part="form-error" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{linkError ?? error}</p>
            )}
            <p className="mt-2 text-sm text-graphite">
              Enter the address you receive the SMI newsletter at. We&apos;ll email it a link to confirm, so only you can
              take it off the list.
            </p>
            <label data-part="form-label" htmlFor="email" className="mt-5 block text-sm font-medium">Email</label>
            <input
              data-part="form-input"
              id="email" name="email" type="email" required defaultValue={prefill} autoComplete="email"
              className="mt-1 w-full rounded border px-3 py-2"
            />
            <div className="mt-5">
              <SubmitButton pendingLabel="Sending…">Email me a link</SubmitButton>
            </div>
            <p className="mt-3 text-xs text-graphite">
              This only stops the newsletter. Notices about your own membership are sent separately.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
