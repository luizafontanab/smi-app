import Link from "next/link";
import type { ChannelDetail, ChannelDetails } from "@/lib/adapters/social";
import { networkLabel } from "@/lib/adapters/social";
import type { SocialChannels } from "@/lib/social-channels";
import type { StoryView } from "@/lib/story-board";
import { saveSocialChannels } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

type Props = {
  channels: SocialChannels & { legacyProfileIds: string[] };
  details: ChannelDetails;
  /** The stories tab the page is on, kept across Edit, Cancel and Save. */
  view: StoryView;
  editing: boolean;
  saved: boolean;
  saveFailed: boolean;
};

const DETAILS_MISSING = {
  "no-key": "This site has no Buffer key, so channel names and details can't be loaded.",
  "no-organisation": "Add the organisation id to load each channel's name and details from Buffer.",
  failed: "Couldn't load channel details from Buffer just now. Showing the saved ids only.",
} as const;

/**
 * The "Buffer channels" settings on /console/stories. Once ids are saved it
 * reads as saved: each channel by name, with its network and whether Buffer
 * still has it connected. Edit brings the form back.
 */
export function BufferChannels({ channels, details, view, editing, saved, saveFailed }: Props) {
  const tab = view === "board" ? "" : `view=${view}&`;
  const editHref = `/console/stories?${tab}channels=edit#buffer-channels`;
  const doneHref = `/console/stories${tab ? `?view=${view}` : ""}#buffer-channels`;
  const showForm = editing || channels.channelIds.length === 0 || channels.legacyProfileIds.length > 0;
  const known = details.kind === "known" ? details.channels : null;
  const missing = details.kind === "known" ? null : DETAILS_MISSING[details.kind === "failed" ? "failed" : details.reason];
  const unused = known ? [...known.values()].filter((c) => !channels.channelIds.includes(c.id)) : [];

  return (
    <section id="buffer-channels" aria-labelledby="buffer-channels-heading" className="mt-5 scroll-mt-4">
      <div className="flex items-center gap-3">
        <h2 id="buffer-channels-heading" className="text-sm font-bold text-ink">Buffer channels</h2>
        {!showForm && (
          <Link href={editHref} className="rounded border px-3 py-1 text-sm text-ink hover:bg-paper">Edit</Link>
        )}
      </div>
      <p className="mt-1 text-xs text-graphite">
        Which connected Buffer channels social posts go to. Buffer sends one post per channel, with no &quot;post everywhere&quot; default, so this must be set before any post can send.
      </p>
      {saved && !showForm && <p role="status" className="mt-2 text-xs font-medium text-ink">✓ Saved</p>}
      {saveFailed && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">Couldn&apos;t save the channels. Nothing changed; try again.</p>}
      {channels.legacyProfileIds.length > 0 && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
          The saved ids ({channels.legacyProfileIds.join(", ")}) are Buffer v1 <em>profile</em> ids. The current
          Buffer API does not accept them — re-enter them as channel ids, or no post will send.
        </p>
      )}

      {showForm ? (
        <form action={saveSocialChannels} className="mt-2 text-sm">
          <input type="hidden" name="view" value={view} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col">
              Channel IDs (one per line, or comma-separated)
              <textarea
                name="channel_ids"
                rows={2}
                defaultValue={channels.channelIds.join("\n")}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col">
              Organisation ID (optional)
              <input
                type="text"
                name="organization_id"
                defaultValue={channels.organizationId ?? ""}
                className="mt-1 w-56 rounded border px-2 py-1"
              />
            </label>
          </div>
          {/* Their own row, on the left: the floating Feedback button covers the far right. */}
          <div className="mt-2 flex items-center gap-2">
            <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-4 py-2 text-white">Save</SubmitButton>
            {channels.channelIds.length > 0 && (
              <Link href={doneHref} className="px-2 py-2 text-graphite underline hover:text-ink">Cancel</Link>
            )}
          </div>
        </form>
      ) : (
        <>
          {missing && <p className="mt-2 rounded bg-paper p-2 text-xs text-graphite">{missing}</p>}
          <ul className="mt-2 divide-y rounded border text-sm">
            {channels.channelIds.map((id) => (
              <ChannelRow key={id} id={id} detail={known?.get(id) ?? null} lookedUp={known !== null} />
            ))}
          </ul>
          <dl className="mt-2 flex gap-2 text-xs text-graphite">
            <dt>Organisation</dt>
            <dd className="font-mono">{channels.organizationId ?? "not set"}</dd>
          </dl>
          {unused.length > 0 && (
            <p className="mt-1 text-xs text-graphite">
              Also in Buffer, not posted to: {unused.map((c) => `${networkLabel(c.service)} · ${c.name || c.id}`).join(", ")}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ChannelRow({ id, detail, lookedUp }: { id: string; detail: ChannelDetail | null; lookedUp: boolean }) {
  const status = !detail
    ? lookedUp ? { text: "Not in this Buffer organisation: posts to it will fail", bad: true } : null
    : detail.disconnected ? { text: "Disconnected: reconnect it in Buffer", bad: true }
    : detail.locked ? { text: "Locked in Buffer", bad: true }
    : { text: "Connected", bad: false };

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
      <div className="min-w-0">
        {detail || lookedUp ? (
          <>
            <p className="font-medium text-ink">
              {detail ? (detail.name || "Unnamed channel") : "Unknown channel"}
              {detail && <span className="ml-2 font-normal text-graphite">{networkLabel(detail.service)}</span>}
            </p>
            <p className="font-mono text-xs text-graphite">{id}</p>
          </>
        ) : (
          // Nothing from Buffer to name it by: the id is all there is.
          <p className="font-mono text-ink">{id}</p>
        )}
      </div>
      <div className="flex items-baseline gap-3 text-xs">
        {status && <span className={status.bad ? "font-medium text-danger" : "text-ink"}>{status.bad ? "⚠ " : "● "}{status.text}</span>}
        {detail?.profileUrl && (
          <a href={detail.profileUrl} target="_blank" rel="noopener noreferrer" className="text-graphite underline hover:text-ink">
            View on {networkLabel(detail.service)} ↗
          </a>
        )}
      </div>
    </li>
  );
}
