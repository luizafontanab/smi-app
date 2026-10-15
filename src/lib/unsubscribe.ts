import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { applyOptIn } from "@/lib/contacts";
import { serviceDb } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { HOUR, withinLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { EMAIL_RE } from "@/lib/validate";

/**
 * The typed-address unsubscribe at /unsubscribe (GAPS B5.2), made safe.
 *
 * Newsletters carry Resend's hosted one-click link, which needs none of this.
 * This page is the fallback for the web archive and for anyone who would
 * rather type their address — and as first built, typing ANY address
 * permanently unsubscribed it, and (since GAPS B6.2) pushed that to Bigin. A
 * stranger could take a competitor's buyers off the list ten at a time.
 *
 * Now typing an address only sends that address an email. Its link carries an
 * HMAC-signed, expiring token naming the address; opening it shows a confirm
 * button, and only that POST — after the signature and the expiry are checked
 * — applies the opt-out. So only someone who can read the inbox can
 * unsubscribe it. POST, because mail scanners prefetch every GET in a message.
 *
 * Fails closed: with UNSUBSCRIBE_SECRET unset (or too short to be a key) no
 * link is signed and none is accepted, and the page says to use the link in
 * the newsletter instead.
 */

/** How long a confirmation link works. Long enough for a weekend; short enough that an old email isn't a standing key. */
export const UNSUBSCRIBE_LINK_HOURS = 72;

/** 32 characters minimum — `openssl rand -base64 32` gives 44. Anything shorter is treated as unset. */
const MIN_SECRET_LENGTH = 32;

/** Domain separation: this key signs nothing else, but the MAC says what it is for regardless. */
const MAC_LABEL = "smi-unsubscribe:v1:";

function secret(): string | null {
  const value = process.env.UNSUBSCRIBE_SECRET?.trim();
  return value && value.length >= MIN_SECRET_LENGTH ? value : null;
}

/** Whether typed-address unsubscribing can work at all on this deploy. */
export function unsubscribeConfigured(): boolean {
  return secret() !== null;
}

function mac(key: string, payload: string): string {
  return createHmac("sha256", key).update(`${MAC_LABEL}${payload}`).digest("base64url");
}

/** `<address, base64url>.<expiry, unix seconds>.<HMAC-SHA256, base64url>`, or null when unconfigured. */
export function signUnsubscribeToken(email: string, now: number = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const expires = Math.floor((now + UNSUBSCRIBE_LINK_HOURS * HOUR) / 1000);
  const payload = `${Buffer.from(email, "utf8").toString("base64url")}.${expires}`;
  return `${payload}.${mac(key, payload)}`;
}

export type UnsubscribeTokenCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "unconfigured" };

/**
 * The address a token was signed for, if the signature is ours and it hasn't
 * expired. The signature is checked first, in constant time, so nothing about
 * an unsigned token — its expiry included — is ever believed.
 */
export function verifyUnsubscribeToken(token: string, now: number = Date.now()): UnsubscribeTokenCheck {
  const key = secret();
  if (!key) return { ok: false, reason: "unconfigured" };
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [address, expires, signature] = parts;
  const expected = Buffer.from(mac(key, `${address}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 <= now) return { ok: false, reason: "expired" };
  const email = Buffer.from(address, "base64url").toString("utf8");
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid" };
  return { ok: true, email };
}

/**
 * Email `email` a confirmation link — if it is on the list at all. The caller
 * runs this after the response (next/server `after`) and answers the same way
 * whatever happens here, so neither the reply nor its timing says whether an
 * address is a contact. Never throws.
 *
 * Throttled per address as well as per caller: without it, the form would be
 * a way to fill a stranger's inbox with our confirmation emails.
 */
export async function sendUnsubscribeLink(email: string): Promise<void> {
  try {
    if (!withinLimit(`unsubscribe-mail:${email}`, 3, HOUR)) return;
    const { data: contact } = await serviceDb()
      .from("contacts").select("id, unsubscribed_at").eq("email", email).maybeSingle();
    // Not a contact, or already off the list for good: nothing to confirm.
    if (!contact || contact.unsubscribed_at) return;
    const token = signUnsubscribeToken(email);
    if (!token) return;
    const [{ getEmailSender }, { renderUnsubscribeConfirmation }] = await Promise.all([
      import("@/lib/adapters/email"),
      import("@/lib/email/templates"),
    ]);
    const mail = renderUnsubscribeConfirmation({
      link: `${siteUrl()}/unsubscribe?t=${encodeURIComponent(token)}`,
      validForHours: UNSUBSCRIBE_LINK_HOURS,
    });
    await getEmailSender().send({ to: email, ...mail });
  } catch (e) {
    logError({ source: "server", area: "unsubscribe:send-link", error: e });
  }
}

/**
 * Apply a confirmed opt-out: the permanent marker (lib/contacts applyOptIn),
 * then Bigin, which is the office's copy of the list. Already unsubscribed, or
 * not a contact: nothing to do — the outcome the person asked for is true.
 */
export async function unsubscribeAddress(email: string): Promise<void> {
  const db = serviceDb();
  const { data: contact } = await db
    .from("contacts").select("id, subscribed, unsubscribed_at").eq("email", email).maybeSingle();
  if (!contact || contact.unsubscribed_at) return;
  const { error } = await db.from("contacts")
    .update(applyOptIn(contact, { newsletter: "unsubscribed", reOptIn: false }))
    .eq("id", contact.id);
  if (error) throw new Error(`unsubscribe failed: ${error.message}`);
  // never throws; a failed push is queued for retry
  const { syncContactToCrm } = await import("@/lib/adapters/crm");
  await syncContactToCrm(contact.id);
}
