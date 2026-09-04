import { redirect } from "next/navigation";

/**
 * Billing moved under Settings (fix list item 19) — this route survives only
 * so old links (emails, bookmarks) keep working.
 */
export default function BillingRedirect() {
  redirect("/dashboard/settings/billing");
}
