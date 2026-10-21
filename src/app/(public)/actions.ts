"use server";

import { applyOptIn } from "@/lib/contacts";
import { optInEvidence, signupWording } from "@/lib/newsletter-consent";
import { serviceDb } from "@/lib/db/server";
import { ADMIN_EMAIL } from "@/lib/notify-admin";
import { allowRequest, HOUR } from "@/lib/rate-limit";

const TOO_MANY = "Too many attempts just now — please try again shortly.";

export async function subscribeNewsletter(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Please enter a valid email." };
  if (!(await allowRequest("newsletter", 5, HOUR))) return { message: TOO_MANY };
  const db = serviceDb();

  // opt-outs are permanent: never re-subscribe an unsubscribed contact silently
  const { data: existing } = await db.from("contacts").select("id, subscribed, unsubscribed_at, opt_in_at, opt_in_source").eq("email", email).maybeSingle();
  if (existing?.unsubscribed_at) {
    return { message: "This address previously unsubscribed — contact us to re-opt-in." };
  }
  await db.from("newsletter_signups").insert({ email });
  // Gap review area 6: the time, route and wording this person signed up against.
  const evidence = optInEvidence("site_form", signupWording(formData.get("surface")));
  let contactId = existing?.id ?? null;
  if (!existing) {
    const { data: created } = await db.from("contacts").insert({ email, source: "newsletter", subscribed: true, ...evidence }).select("id").single();
    contactId = created?.id ?? null;
  } else if (!existing.subscribed) {
    // Known but never on the list — a member's contact, a CRM import (GAPS
    // B5.4). Signing up is the opt-in, so say it and mean it: this used to
    // answer "Subscribed" and leave `subscribed` false, which the newsletter
    // audience requires. applyOptIn keeps the permanence rule in one place —
    // unsubscribed_at is null here, so it can only ever turn the flag on.
    const { error } = await db.from("contacts")
      .update({ ...applyOptIn(existing, { newsletter: "subscribed", reOptIn: false }), ...evidence })
      .eq("id", existing.id).is("unsubscribed_at", null);
    if (error) {
      console.error("[newsletter] could not opt in an existing contact:", error.message);
      return { message: "Something went wrong — please try again in a moment." };
    }
  } else if (!existing.opt_in_at || existing.opt_in_source === "bigin") {
    // Already on the list, but with no consent record (a row older than the
    // record) or only Bigin's import date, which isn't one. This signup is,
    // so it replaces that. A contact with real evidence keeps it: staying
    // subscribed restamps nothing, as in the console. They are subscribed
    // either way, so a failure here is logged, not shown.
    const { error } = await db.from("contacts").update(evidence).eq("id", existing.id);
    if (error) console.error("[newsletter] could not record consent for an existing contact:", error.message);
  }
  // Write-through to Bigin (GAPS B6.2). Never throws: the signup is already
  // recorded above, and a CRM outage must not cost a visitor their
  // subscription confirmation — a failed push is queued for retry instead.
  if (contactId) {
    const { syncContactToCrm } = await import("@/lib/adapters/crm");
    await syncContactToCrm(contactId);
  }
  return { message: "Subscribed — see you next issue." };
}

export async function sendContactMessage(_prev: { message: string }, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const kind = formData.get("kind") === "advertising" ? "advertising" : "contact";
  if (!name || !email || !message) return { message: "All fields are required." };
  if (!(await allowRequest("contact", 5, HOUR))) return { message: TOO_MANY };
  const db = serviceDb();
  await db.from("inbox_messages").insert({ kind, name, email, message });
  // ADMIN_EMAIL has no fallback by design (see lib/notify-admin) — the enquiry
  // is already safe in the console inbox, so a missing address must not throw.
  if (!ADMIN_EMAIL) {
    console.warn("[contact] ADMIN_EMAIL is not set — inbox row written, no email sent.");
    return { message: "Thanks — we'll come back to you shortly." };
  }
  try {
    // Not routed through notifyAdminFunnel: the inbox row above is written with
    // this form's own `kind` ('contact' / 'advertising'), which the funnel
    // helper would overwrite with 'membership'. The wording still comes from
    // the same editable template table (fix-list 63).
    const [{ getEmailSender }, { renderAdminEmail }, { loadEmailTemplates }] = await Promise.all([
      import("@/lib/adapters/email"),
      import("@/lib/email/templates"),
      import("@/lib/email/store"),
    ]);
    const mail = renderAdminEmail(
      "admin_contact_enquiry",
      { name, email, message, enquiry_kind: kind },
      await loadEmailTemplates(),
    );
    await getEmailSender().send({ to: ADMIN_EMAIL, ...mail });
  } catch (e) {
    // The sender throws on a provider rejection so failures are visible. The
    // enquiry is already safe in the console inbox (line 35), so the visitor
    // must still get their acknowledgement — losing the send is not losing
    // the message.
    console.error("[contact] admin notification failed:", e);
  }
  return { message: "Thanks — we'll come back to you shortly." };
}
