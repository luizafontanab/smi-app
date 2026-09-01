import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { paymentsAreLive } from "@/lib/adapters/payments";
import { PayForm } from "./PayForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay for your membership" };

export default async function MemberPayPage() {
  const user = await requireMember();
  const { data: member } = await serviceDb()
    .from("members").select("status, paid_at, comped_until").eq("id", user.memberId).single();
  if (!member || member.paid_at || member.comped_until || member.status !== "draft") redirect("/dashboard");

  const isLocalStub = !paymentsAreLive();
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-xl bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">Step 2 of 4</p>
        <h1 className="mt-1 text-xl font-bold text-ink">Pay — £40/month</h1>
        <p className="mt-1 text-sm text-gray-500">
          Payment is handled by Stripe — card details never touch SMI&apos;s servers. Then you build your page and we approve it.
        </p>
        {isLocalStub && (
          <p className="mt-3 rounded bg-brand/10 p-2 text-xs text-gray-600">
            <strong>Simulated payment — no card is charged, no money moves.</strong> Clicking pay below will mark this
            membership as paid without Stripe. Promo codes <code>SMI-FREE-MONTH</code> / <code>SMI-FREE-YEAR</code> also work.
          </p>
        )}
        <PayForm />
      </div>
    </div>
  );
}
