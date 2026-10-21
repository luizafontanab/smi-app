import { must } from "./db/must";
import type { serviceDb } from "./db/server";

type Db = ReturnType<typeof serviceDb>;

/**
 * The newsletter footer's compliance lines (gap review area 6, Jas's SOP
 * Step 2: "Postal address and reason-for-receiving line are in the footer").
 *
 * Both live in one `settings` row so Jas can set them in the console without a
 * deploy. The address starts empty because only SMI knows it (ask-jas); while
 * it is empty the footer simply leaves the line out and the console warns —
 * approval is deliberately not blocked (Luiza, 21 Oct). The reason line has a
 * drafted default, awaiting Jas's wording, and a blank one falls back to it so
 * an issue can never go out saying nothing about why it arrived.
 */

export const NEWSLETTER_FOOTER_KEY = "newsletter_footer";

export const DEFAULT_REASON_LINE =
  "You're receiving this because you signed up for SMI Monthly at sheetmetalindustries.com, or because your business is in contact with Sheet Metal Industries.";

export const POSTAL_ADDRESS_MAX = 300;
export const REASON_LINE_MAX = 300;

export type NewsletterFooter = { postal_address: string; reason_line: string };

/** A stored value, read tolerantly: anything missing or malformed takes the default. */
export function parseNewsletterFooter(value: unknown): NewsletterFooter {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    postal_address: text(record.postal_address),
    reason_line: text(record.reason_line) || DEFAULT_REASON_LINE,
  };
}

/**
 * Throws on a failed read, like every other read on the render and send path:
 * a swallowed error here would send the whole list an issue with no address
 * and the drafted reason line, and report success.
 */
export async function readNewsletterFooter(db: Db): Promise<NewsletterFooter> {
  const row = await must(db.from("settings").select("value").eq("key", NEWSLETTER_FOOTER_KEY).maybeSingle(), "newsletter footer");
  return parseNewsletterFooter(row?.value);
}

/** The address as one footer line: typed on several lines, shown comma-separated. */
export function addressLine(address: string): string {
  return address
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .join(", ");
}

/** The console form → the stored value, or a message naming what's wrong. */
export function newsletterFooterFromForm(formData: FormData): { value: NewsletterFooter } | { error: string } {
  const postal = String(formData.get("postal_address") ?? "").trim();
  const reason = String(formData.get("reason_line") ?? "").replace(/\s+/g, " ").trim();
  if (postal.length > POSTAL_ADDRESS_MAX) return { error: `Keep the postal address to ${POSTAL_ADDRESS_MAX} characters.` };
  if (reason.length > REASON_LINE_MAX) return { error: `Keep the reason line to ${REASON_LINE_MAX} characters.` };
  // A blank reason line is stored blank and read back as the default.
  return { value: { postal_address: postal, reason_line: reason } };
}
