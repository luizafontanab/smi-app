import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { applyOptIn } from "@/lib/contacts";

/**
 * Resend delivery events → our `contacts` table.
 *
 * Broadcasts carry Resend's own hosted unsubscribe (RFC 8058 one-click, with
 * the List-Unsubscribe headers set for us), which is the compliant thing to use
 * and not something worth hand-rolling. The consequence is that an unsubscribe
 * happens at Resend's end first, and without this route our table — the thing
 * every other part of the app reads — would quietly drift out of date and keep
 * counting someone as a subscriber after they left.
 *
 * Spam complaints are treated exactly like unsubscribes: continuing to mail
 * someone who pressed "this is spam" is both a deliverability problem and,
 * under PECR, not a choice we get to make.
 */

/** Reject anything older than this, so a captured request can't be replayed. */
const TOLERANCE_MS = 5 * 60_000;

/**
 * Svix signature check (Resend's webhook signing). The secret is
 * `whsec_<base64>`; the signed content is `id.timestamp.body`, and the header
 * may carry several space-separated versioned signatures.
 */
function verify(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > TOLERANCE_MS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value, "base64");
    // Length check first: timingSafeEqual throws on a mismatch.
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

type ResendEvent = {
  type?: string;
  data?: {
    email?: string;
    to?: string[];
    unsubscribed?: boolean;
    bounce?: { type?: string };
    broadcast_id?: string;
  };
};

/**
 * A5.4: attribute an open/click back to the issue it came from via the
 * broadcast id Resend returns at send time (stored as
 * newsletter_issues.provider_broadcast_id). Unverified against a live
 * account — see lib/adapters/newsletter.ts's docstring; if this field's name
 * or location differs in practice, this just no-ops (counts stay at 0)
 * rather than erroring the webhook.
 */
async function bumpNewsletterMetric(broadcastId: string | undefined, metric: "opens" | "clicks"): Promise<void> {
  if (!broadcastId) return;
  const { error } = await serviceDb().rpc("bump_newsletter_metric", { p_broadcast_id: broadcastId, p_metric: metric });
  if (error) console.error(`[resend-webhook] bump_newsletter_metric(${metric}) failed:`, error.message);
}

/** Stamp a contact as unsubscribed, honouring the permanence rule. */
async function unsubscribe(email: string, why: string): Promise<void> {
  const db = serviceDb();
  const { data: contact } = await db
    .from("contacts")
    .select("id, subscribed, unsubscribed_at")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!contact) return;
  if (contact.unsubscribed_at) return; // already off the list; never restamp

  // Reuse the tested state machine rather than writing the columns directly, so
  // there is one definition of what "unsubscribed" means (lib/contacts.ts).
  const next = applyOptIn(contact, { newsletter: "unsubscribed", reOptIn: false });
  await db.from("contacts").update(next).eq("id", contact.id);
  console.log(`[resend-webhook] unsubscribed ${email} (${why})`);
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Fails closed, like /api/cron: an unauthenticated endpoint that mutates
    // subscription state is worse than one that is switched off.
    console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET is not set — rejecting.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const body = await request.text();
  if (!verify(secret, request.headers, body)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const email = event.data?.email ?? (Array.isArray(event.data?.to) ? event.data?.to[0] : undefined);
  if (!email) return NextResponse.json({ ok: true, ignored: "no address" });

  switch (event.type) {
    case "contact.updated":
    case "contact.deleted":
      if (event.data?.unsubscribed || event.type === "contact.deleted") {
        await unsubscribe(String(email), event.type);
      }
      break;
    case "email.complained":
      await unsubscribe(String(email), "spam complaint");
      break;
    case "email.bounced":
      // Only permanent failures. A soft bounce is a full mailbox or a temporary
      // server problem, and dropping someone off the list for that would lose a
      // paying member's contact over a bad afternoon.
      if (event.data?.bounce?.type === "Permanent") {
        await unsubscribe(String(email), "hard bounce");
      }
      break;
    case "email.opened":
      await bumpNewsletterMetric(event.data?.broadcast_id, "opens");
      break;
    case "email.clicked":
      await bumpNewsletterMetric(event.data?.broadcast_id, "clicks");
      break;
    default:
      break; // delivered/sent — nothing to mirror
  }

  return NextResponse.json({ ok: true });
}
