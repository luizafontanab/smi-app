import { websiteUrl } from "@/lib/website-url";

/**
 * An advert's click-through link → what to store. /visit/[id] redirects
 * readers straight to it, so only an absolute http(s) web address will do:
 * the form's type=url is a browser hint, not a guard, and a `javascript:` or
 * `data:` link would otherwise be stored and served as the redirect target.
 * "www.acme.co.uk" gains https:// the way a member's website does
 * (lib/website-url). Shared by the console's and the member's advert forms.
 */
export function advertLinkFromForm(formData: FormData): { url: string | null } | { error: string } {
  const raw = String(formData.get("link_url") ?? "").trim();
  if (!raw) return { url: null };
  const url = websiteUrl(raw);
  return url ? { url } : { error: ADVERT_LINK_INVALID };
}

export const ADVERT_LINK_INVALID = "The click-through link must be a web address, e.g. https://www.example.co.uk.";
