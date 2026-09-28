"use server";

import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { membershipTypeIdsFromForm, membershipTypesError } from "@/lib/member-services";
import { provisionMember } from "@/lib/membership";
import { notifyAdminFunnel } from "@/lib/notify-admin";
import { allowRequest, HOUR } from "@/lib/rate-limit";
import { EMAIL_RE, parsePhone } from "@/lib/validate";

/**
 * V13 step 1 of 4 — account + draft company page. Payment is step 2
 * (/dashboard/pay); the page goes public only once Jas activates it.
 * The one funnel step that emails Jas as well as the console inbox.
 */
export async function createAccount(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const membershipTypeIds = membershipTypeIdsFromForm(formData);

  if (!EMAIL_RE.test(email)) return { message: "Please enter a valid email." };
  if (password.length < 8) return { message: "Password needs at least 8 characters." };
  if (!company) return { message: "Company name is required." };
  const parsedPhone = parsePhone(phone);
  if (parsedPhone && typeof parsedPhone === "object") return { message: parsedPhone.error };
  const tooManyTypes = membershipTypesError(membershipTypeIds);
  if (tooManyTypes) return { message: tooManyTypes };
  // This creates a real auth user and a draft member row; unthrottled it is a
  // free account-and-record generator for anyone who finds the page.
  if (!(await allowRequest("join", 3, HOUR))) {
    return { message: "Too many attempts just now — please try again shortly." };
  }

  const result = await provisionMember({
    email, password, company,
    ...(phone ? { phone } : {}),
    ...(website ? { website } : {}),
    ...(address ? { address } : {}),
    ...(membershipTypeIds.length ? { membershipTypeIds } : {}),
  });
  if ("error" in result) return { message: result.error };

  // A notification, not a message: nobody is waiting on a reply to it. It links
  // through to the new member's console record — see console-notification-links.
  await notifyAdminFunnel({
    category: "notification",
    kind: "signup_started",
    name: company,
    email,
    message: `Started the join flow: account created, draft company page in place. Next step: payment.`,
    memberId: result.memberId,
    payload: { member_id: result.memberId },
    emailKind: "admin_new_signup",
  });

  // The member's own welcome. provisionMember sets email_confirm, so Supabase
  // sends nothing — without this a new member hears from us for the first time
  // only when Jas activates their page, which can be days later.
  //
  // Guarded for the same reason notifyAdminFunnel is: the account and the draft
  // page already exist by this point, so failing the signup over an unsent
  // welcome would strand a real member behind an error they cannot retry past.
  try {
    const { enqueue } = await import("@/lib/jobs");
    await enqueue("notify_member", { member_id: result.memberId, kind: "welcome" });
  } catch (e) {
    console.error("[join] welcome email could not be queued:", e);
  }

  const session = await sessionDb();
  await session.auth.signInWithPassword({ email, password });
  redirect("/dashboard/pay");
}
