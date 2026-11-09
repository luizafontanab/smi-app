import { formatLondonShort, londonInputValue } from "@/lib/london-time";
import { mediaUrl } from "@/lib/db/server";
import type { SocialCaps } from "@/lib/social-caps";
import type { SocialPanel } from "@/lib/social-post";
import { SEEN_FIELD, socialSummary } from "@/lib/social-confirm";
import { LEAD_FIELD } from "@/lib/social-push";
import { leadMaxFor, SOCIAL_LEAD_MAX, trimLead } from "@/lib/social-text";
import { FormPendingSignal } from "@/components/FormPendingSignal";
import { SocialConfirmButton } from "./SocialConfirmButton";

/** The id of the editor's SocialConfirmForm, which Schedule / Publish now submit. */
export const SOCIAL_CONFIRM_FORM = "social-confirm";

/** The id of the editor's SocialToolForm, which Write with Claude / Send draft to Buffer submit (issue #101). */
export const SOCIAL_TOOL_FORM = "social-tool";

/**
 * The small form the per-channel tools submit: the item's id, plus what each
 * channel showed, so a draft is what the admin looked at. Render it outside
 * the editor's form, next to SocialConfirmForm.
 */
export function SocialToolForm({ action, id }: { action: (formData: FormData) => Promise<void>; id: string }) {
  return (
    <form id={SOCIAL_TOOL_FORM} action={action} hidden>
      <input type="hidden" name="id" value={id} />
      <FormPendingSignal />
    </form>
  );
}

/**
 * The small form Schedule / Publish now submit: the item's id, plus what each channel
 * showed (SocialPostFields puts those inputs in it with `form=`). Render it
 * outside the editor's form — forms can't nest.
 */
export function SocialConfirmForm({ action, id }: { action: (formData: FormData) => Promise<void>; id: string }) {
  return (
    <form id={SOCIAL_CONFIRM_FORM} action={action} hidden>
      <input type="hidden" name="id" value={id} />
      {/* the buttons live in the editor's form: this tells them when a request is running (#48) */}
      <FormPendingSignal />
    </form>
  );
}

/**
 * The "Social post" fieldset in the story and video editors (Area 3 of Jas's
 * 16 Oct flow chart; issue #43): the item's own post time, its lead-in, an
 * opt-out for the whole item, and one preview per connected channel — exactly
 * what that channel will receive — each with its own "Don't post" and
 * Confirm. Nothing goes out on a channel until it is confirmed.
 *
 * Sits inside the editor's main form, so the one Save button and the
 * unsaved-changes guard cover it. Confirm submits SocialConfirmForm instead,
 * with each channel's fingerprint as shown; its action reads the saved item,
 * not the form, and refuses if the post no longer matches what was shown.
 * Parsed by socialFieldsFromForm and channelSkipsFromForm.
 */
export function SocialPostFields({
  item,
  fallback,
  fallbackName,
  caps,
  panel,
  notes = [],
  confirmable = false,
  confirmed,
  mode,
  tools,
  written,
  drafted,
}: {
  item: { social_text: string | null; social_at: string | null; social_skip: boolean } | null;
  /** What the lead-in follows when left alone: the story summary or video description. */
  fallback: string;
  fallbackName: "summary" | "description";
  caps: SocialCaps;
  /** Each channel's preview and status, for a saved item; absent on a new one. */
  panel?: SocialPanel | null;
  /** Lines about the post as a whole: Buffer not connected here, a failed attempt. */
  notes?: string[];
  /** The page renders a SocialConfirmForm, so the Confirm buttons have somewhere to go. */
  confirmable?: boolean;
  /** `?confirmed=` after Schedule / Publish now: how many channels; `mode` which of the two. */
  confirmed?: string;
  mode?: string;
  /** The page renders a SocialToolForm; whether Claude and Buffer are set up here. */
  tools?: { writer: boolean; buffer: boolean };
  /** `?written=` / `?drafted=` after a tool: the channel id. */
  written?: string;
  drafted?: string;
}) {
  const prefill = trimLead(fallback);
  const waiting = panel?.channels.filter((c) => c.state === "waiting") ?? [];
  const lookupFailed = panel?.networks === "failed";
  const canConfirm = confirmable && !!panel;
  const labelOf = (channelId?: string) => panel?.channels.find((c) => c.post.channelId === channelId)?.label ?? "the channel";
  return (
    <fieldset id="social">
      <legend className="text-sm font-medium">Social post</legend>
      {panel && panel.channels.length > 0 && (
        <p className="mt-0.5 text-xs text-ink">{socialSummary(panel.channels.map((c) => c.state))}</p>
      )}
      {confirmed !== undefined && (
        <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">
          {mode === "now" ? "Publish now" : "Scheduled"} for {confirmed === "1" ? "1 channel" : `${Number(confirmed) || 0} channels`}.
          It goes to Buffer now if this is live, otherwise as soon as it goes live.
        </p>
      )}
      {written !== undefined && (
        <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">
          Claude wrote the wording for {labelOf(written)}. Read it, then Schedule or Publish now.
        </p>
      )}
      {drafted !== undefined && (
        <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">
          Draft sent to Buffer for {labelOf(drafted)}. Check it there; it won&apos;t be published from Buffer&apos;s drafts.
        </p>
      )}
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
            Leave empty to post {caps.delay_minutes} minutes after it goes live. A scheduled channel goes to Buffer once
            the item is live, and Buffer sends it at this time. Each channel posts at most {caps.per_day} a day, so the
            limit can move it to the next morning.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm sm:mt-6">
          <input type="checkbox" name="social_skip" defaultChecked={item?.social_skip ?? false} className="mt-1" />
          Don&apos;t post this to social media at all
        </label>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-medium">What each channel will receive</h3>
        {!panel ? (
          <p className="mt-1 text-xs text-graphite">Save it first to see and schedule each channel&apos;s post.</p>
        ) : !panel.channels.length ? (
          <p className="mt-1 text-sm text-graphite">No social channels connected</p>
        ) : (
          <>
            {lookupFailed && (
              <p role="alert" className="mt-1 text-xs text-danger">
                Buffer couldn&apos;t say which network each channel is just now, so these show the shorter text every
                channel would fall back to, and scheduling is off until it can. Reload in a minute.
              </p>
            )}
            {panel.networks === "unknown" && (
              <p className="mt-1 text-xs text-graphite">
                No Buffer organisation id is stored, so the network of each channel isn&apos;t known and every channel
                gets the same text, with all members&apos; tags fitted to X&apos;s 280 characters.
              </p>
            )}
            <ul className="mt-2 space-y-3">
              {panel.channels.map((c, i) => {
                const image = mediaUrl(c.post.imagePath);
                const network = c.network;
                const handed = c.state === "handed";
                const draftChanged = !!c.record?.draft_at &&
                  (c.record.draft_text !== c.post.text || (c.record.draft_image ?? null) !== (c.post.imagePath ?? null));
                const leadId = `social_lead-${i}`;
                return (
                  <li key={c.post.channelId} className="rounded border border-black/10 p-3" data-channel={c.post.channelId}>
                    <input type="hidden" name="social_channel" value={c.post.channelId} />
                    {canConfirm && (
                      <input type="hidden" form={SOCIAL_CONFIRM_FORM} name={`${SEEN_FIELD}${c.post.channelId}`} value={c.fingerprint} />
                    )}
                    {tools && (
                      <input type="hidden" form={SOCIAL_TOOL_FORM} name={`${SEEN_FIELD}${c.post.channelId}`} value={c.fingerprint} />
                    )}
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{c.label}</span>
                      <span className="text-xs text-graphite" role="status">{panel.lines[i]}</span>
                    </div>
                    <div className="mt-2 flex gap-3">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-2 text-sm text-ink">
                        {c.post.text}
                      </p>
                      {image && (
                        // eslint-disable-next-line @next/next/no-img-element -- a preview of the exact file Buffer is sent
                        <img src={image} alt={`Image posted to ${c.label}`} className="h-20 w-20 shrink-0 rounded object-cover" />
                      )}
                    </div>
                    {c.state !== "posted" && (
                      <>
                        <label htmlFor={leadId} className="mt-3 block text-xs font-medium">Wording for {c.label}</label>
                        <textarea
                          id={leadId}
                          name={`${LEAD_FIELD}${c.post.channelId}`}
                          rows={network && leadMaxFor(network) > SOCIAL_LEAD_MAX ? 4 : 2}
                          maxLength={leadMaxFor(network)}
                          defaultValue={c.record?.lead_text ?? ""}
                          placeholder="Empty: the lead-in above"
                          aria-describedby={`${leadId}-hint`}
                          className="mt-1 w-full rounded border px-3 py-2 text-sm"
                        />
                        <p id={`${leadId}-hint`} className="mt-1 text-xs text-graphite">
                          {c.record?.lead_ai && c.record.lead_text ? "Written by Claude: read it before scheduling. " : ""}
                          Up to {leadMaxFor(network)} characters. The link and {c.label}&apos;s member tags are added after it.
                          {handed ? " Saving a change takes the post back out of Buffer, to schedule again." : ""}
                        </p>
                        {c.record?.draft_at && (
                          <p className="mt-1 text-xs text-graphite">
                            Draft in Buffer since {formatLondonShort(c.record.draft_at)}.
                            {draftChanged && <span className="text-danger"> The post has changed since: send it again to check this version.</span>}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              name="social_skip_channel"
                              value={c.post.channelId}
                              defaultChecked={c.record?.skip ?? false}
                            />
                            Don&apos;t post on {c.label}
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            {tools && !handed && (
                              <>
                                <SocialConfirmButton
                                  form={SOCIAL_TOOL_FORM}
                                  name="write_channel"
                                  value={c.post.channelId}
                                  disabled={!tools.writer || !network}
                                  pendingLabel="Writing…"
                                >
                                  Write with Claude
                                </SocialConfirmButton>
                                <SocialConfirmButton
                                  form={SOCIAL_TOOL_FORM}
                                  name="draft_channel"
                                  value={c.post.channelId}
                                  disabled={!tools.buffer || lookupFailed}
                                  pendingLabel="Sending…"
                                >
                                  {c.record?.draft_at ? "Send draft again" : "Send draft to Buffer"}
                                </SocialConfirmButton>
                              </>
                            )}
                            {c.state === "waiting" && canConfirm && (
                              <>
                                <SocialConfirmButton form={SOCIAL_CONFIRM_FORM} value={`schedule:${c.post.channelId}`} disabled={lookupFailed} pendingLabel="Scheduling…">
                                  Schedule
                                </SocialConfirmButton>
                                <SocialConfirmButton form={SOCIAL_CONFIRM_FORM} value={`now:${c.post.channelId}`} disabled={lookupFailed} pendingLabel="Publishing…">
                                  Publish now
                                </SocialConfirmButton>
                              </>
                            )}
                          </div>
                        </div>
                        {tools && !handed && (!tools.writer || !network) && (
                          <p className="mt-1 text-xs text-graphite">
                            {!tools.writer ? "Write with Claude needs the Anthropic key on this site." : "Write with Claude needs Buffer to say which network this is."}
                            {!tools.buffer ? " Drafts need Buffer connected here." : ""}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {waiting.length > 1 && canConfirm && (
              <div className="mt-2 flex flex-wrap gap-2">
                <SocialConfirmButton form={SOCIAL_CONFIRM_FORM} value="schedule:all" disabled={lookupFailed} pendingLabel="Scheduling…">
                  Schedule all ({waiting.length})
                </SocialConfirmButton>
                <SocialConfirmButton form={SOCIAL_CONFIRM_FORM} value="now:all" disabled={lookupFailed} pendingLabel="Publishing…">
                  Publish all now ({waiting.length})
                </SocialConfirmButton>
              </div>
            )}
          </>
        )}
        {notes.map((n) => <p key={n} className="mt-1 text-xs text-graphite">{n}</p>)}
      </div>
    </fieldset>
  );
}
