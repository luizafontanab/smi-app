"use server";

import { redirect } from "next/navigation";
import { sessionDb } from "@/lib/db/server";
import { provisionMember } from "@/lib/membership";
import { notifyAdminFunnel } from "@/lib/notify-admin";
import { allowRequest, HOUR } from "@/lib/rate-limit";

/**
 * V13 step 1 of 4 — account + draft company page. Payment is step 2
 * (/dashboard/pay); the page goes public only once Jas activates it.
 * The one funnel step that emails Jas as well as the console inbox.
 */
export async function createAccount(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Please enter a valid email." };
  if (password.length < 8) return { message: "Password needs at least 8 characters." };
  if (!company) return { message: "Company name is required." };
  // This creates a real auth user and a draft member row; unthrottled it is a
  // free account-and-record generator for anyone who finds the page.
  if (!(await allowRequest("join", 3, HOUR))) {
    return { message: "Too many attempts just now — please try again shortly." };
  }

  const result = await provisionMember({ email, password, company });
  if ("error" in result) return { message: result.error };

  await notifyAdminFunnel({
    name: company,
    email,
    message: `Started the join flow: account created, draft company page in place. Next step: payment.`,
    emailSubject: `New member signup: ${company}`,
  });

  // The member's own welcome. provisionMember sets email_confirm, so Supabase
  // sends nothing — without this a new member hears from us for the first time
  // only when Jas activates their page, which can be days later.
  const { enqueue } = await import("@/lib/jobs");
  await enqueue("notify_member", { member_id: result.memberId, kind: "welcome" });

  const session = await sessionDb();
  await session.auth.signInWithPassword({ email, password });
  redirect("/dashboard/pay");
}
