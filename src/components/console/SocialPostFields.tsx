import { londonInputValue } from "@/lib/london-time";
import type { SocialCaps } from "@/lib/social-caps";
import { SOCIAL_LEAD_MAX, trimLead } from "@/lib/social-push";

/**
 * The "Social post" fieldset in the story and video editors (Area 3 of Jas's
 * 16 Oct flow chart): the item's own post time, its lead-in and an opt-out.
 * Sits inside the editor's main form, so the one Save button and the
 * unsaved-changes guard cover it. Parsed by socialFieldsFromForm.
 */
export function SocialPostFields({
  item,
  fallback,
  fallbackName,
  caps,
  status,
}: {
  item: { social_text: string | null; social_at: string | null; social_skip: boolean } | null;
  /** What the lead-in follows when left alone: the story summary or video description. */
  fallback: string;
  fallbackName: "summary" | "description";
  caps: SocialCaps;
  /** socialStatusLine for a saved item; absent on a new one. */
  status?: string;
}) {
  const prefill = trimLead(fallback);
  return (
    <fieldset id="social">
      <legend className="text-sm font-medium">Social post</legend>
      {status && <p className="mt-0.5 text-xs text-ink">{status}</p>}
      <div className="mt-2">
        <label htmlFor="social_text" className="text-xs font-medium">Lead-in</label>
        <input type="hidden" name="social_text_default" value={prefill} />
        <textarea
          id="social_text"
          name="social_text"
          rows={3}
          maxLength={SOCIAL_LEAD_MAX}
          defaultValue={item?.social_text ?? prefill}
          aria-describedby="social_text-hint"
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        />
        <p id="social_text-hint" className="mt-1 text-xs text-graphite">
          Posted with the link, up to {SOCIAL_LEAD_MAX} characters. Prefilled from the {fallbackName}; left as it is, it
          follows the {fallbackName} when that changes. Members are tagged after it automatically.
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="social_at" className="text-xs font-medium">Post at (UK time)</label>
          <input
            id="social_at"
            name="social_at"
            type="datetime-local"
            defaultValue={londonInputValue(item?.social_at)}
            aria-describedby="social_at-hint"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
          <p id="social_at-hint" className="mt-1 text-xs text-graphite">
            Leave empty to post {caps.delay_minutes} minutes after it goes live. It never posts before it&apos;s live,
            goes out on the site&apos;s next scheduled run after this time, and the daily limit of {caps.per_day} can
            move it to the next morning.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm sm:mt-6">
          <input type="checkbox" name="social_skip" defaultChecked={item?.social_skip ?? false} className="mt-1" />
          Don&apos;t post this to social media
        </label>
      </div>
    </fieldset>
  );
}
