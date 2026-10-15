"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { logError } from "@/lib/log";
import { allowRequest, HOUR } from "@/lib/rate-limit";
import { sendUnsubscribeLink, unsubscribeAddress, unsubscribeConfigured, verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { EMAIL_RE } from "@/lib/validate";

/**
 * Step one: an address was typed in. Whether or not it is on the list, the
 * answer is the same "check your inbox" — and the lookup and the send run
 * after the response, so not even its timing differs (lib/unsubscribe).
 */
export async function requestUnsubscribe(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) redirect("/unsubscribe?error=email");
  if (!unsubscribeConfigured()) {
    // Fail closed, loudly for the developer: without the secret no link can
    // be signed, and the old unsigned path is gone on purpose.
    logError({ source: "server", area: "unsubscribe:unconfigured", error: new Error("UNSUBSCRIBE_SECRET is not set — typed-address unsubscribe is off.") });
    redirect("/unsubscribe?error=unavailable");
  }
  if (!(await allowRequest("unsubscribe", 10, HOUR))) redirect("/unsubscribe?error=limit");
  after(() => sendUnsubscribeLink(email));
  redirect("/unsubscribe?sent=1");
}

/**
 * Step two: the confirm button on the page the emailed link opened. A POST,
 * because mail scanners prefetch every GET in a message; the signature and
 * expiry are checked again here, never trusted from the page that rendered it.
 */
export async function confirmUnsubscribe(formData: FormData) {
  if (!(await allowRequest("unsubscribe-confirm", 20, HOUR))) redirect("/unsubscribe?error=limit");
  const check = verifyUnsubscribeToken(String(formData.get("t") ?? ""));
  if (!check.ok) redirect(`/unsubscribe?error=${check.reason === "unconfigured" ? "unavailable" : check.reason}`);
  await unsubscribeAddress(check.email);
  redirect("/unsubscribe?done=1");
}
