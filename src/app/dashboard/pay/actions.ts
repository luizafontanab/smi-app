"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { getPayments, paymentsAreLive } from "@/lib/adapters/payments";
import { applyPaymentResult } from "@/lib/membership";
import { notifyAdminFunnel } from "@/lib/notify-admin";

/** V13 step 2 of 4 — card via Stripe (stubbed locally) or promo code. Console-only funnel note. */
export async function payMembership(_prev: { message: string }, formData: FormData) {
  const user = await requireMember();
  const { data: member } = await serviceDb()
    .from("members").select("id, name, paid_at, comped_until").eq("id", user.memberId).single();
  if (!member) return { message: "Could not load your membership — please sign in again." };
  if (member.paid_at || member.comped_until) redirect("/dashboard"); // already settled

  const promoCode = String(formData.get("promo") ?? "").trim() || undefined;
  const payment = await getPayments().createCheckout({ memberId: member.id, email: user.email, companyName: member.name, promoCode });
  if (payment.kind === "error") return { message: payment.message };
  if (payment.kind === "redirect") redirect(payment.url); // Stripe-hosted checkout (production)

  await applyPaymentResult(member.id, payment);
  await notifyAdminFunnel({
    category: "notification",
    kind: "payment_taken",
    name: member.name,
    email: user.email,
    memberId: member.id,
    payload: { member_id: member.id },
    message: payment.kind === "comped"
      ? `Redeemed promo code ${promoCode?.toUpperCase()} — comped ${payment.months} month${payment.months === 1 ? "" : "s"}. Next step: build their page.`
      : `Paid £40/month by card${paymentsAreLive() ? "" : " (simulated)"}. Next step: build their page.`,
  });
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=paid");
}
