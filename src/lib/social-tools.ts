/**
 * The editor's per-channel tools before Schedule / Publish now (issue #101,
 * ADR 0003): "Write with Claude" fills the channel's wording; "Send draft to
 * Buffer" puts exactly what the channel would receive into Buffer as a draft,
 * to check it there. Both are optional, and neither posts anything.
 */

import type { serviceDb } from "./db/server";
import type { ChannelNetworks, SocialPublisher } from "./adapters/social";
import type { SocialWriter } from "./adapters/social-writer";
import { excerptFromHtml } from "./sanitize";
import { leadMaxFor } from "./social-text";
import {
  connectedChannelIds, leadsOf, loadSocialItem, ownerOf, postFingerprint, readChannelRecords, saveClaudeLead, targetOf,
  type SocialTarget,
} from "./social-post";

type Db = ReturnType<typeof serviceDb>;
type Outcome = { ok: true } | { ok: false; error: string };

export const TOOL_MESSAGES = {
  notFound: "That item isn't there any more.",
  notConnected: "That channel isn't connected any more.",
  noNetwork: "Buffer couldn't say which network this channel is just now, so Claude can't write for it. Try again in a minute.",
  withBuffer: "This channel's post is already with Buffer. To change it, edit and save: that takes it back out of Buffer first.",
  noBuffer: "Buffer isn't connected on this site, so no draft was made.",
  changed: "The post changed after this page loaded, so no draft was made. Check the preview and try again.",
  draftFailed: "Buffer didn't take the draft. Try again in a minute.",
} as const;

/** What Claude is given about the item: its own words, and the member companies it's about. */
async function sourceText(db: Db, t: SocialTarget): Promise<{ title: string; summary: string | null; body: string; companies: string[] } | null> {
  if ("story_id" in t) {
    const { data } = await db
      .from("stories")
      .select("title, story_summary, body, member:members!stories_member_id_fkey(name), story_members(member:members(name))")
      .eq("id", t.story_id)
      .maybeSingle();
    if (!data) return null;
    const names = [data.member?.name, ...(data.story_members ?? []).map((m) => m.member?.name)].filter((n): n is string => !!n);
    return {
      title: data.title,
      summary: data.story_summary,
      // The whole body, as plain text: Claude needs the facts, not the markup.
      body: excerptFromHtml(data.body, Number.MAX_SAFE_INTEGER) ?? "",
      companies: [...new Set(names)],
    };
  }
  const { data } = await db.from("videos").select("title, description, member:members(name)").eq("id", t.video_id).maybeSingle();
  if (!data) return null;
  return {
    title: data.title,
    summary: null,
    body: excerptFromHtml(data.description, Number.MAX_SAFE_INTEGER) ?? "",
    companies: data.member?.name ? [data.member.name] : [],
  };
}

/** "Write with Claude": one channel's wording, saved to its box. Its post then needs scheduling again. */
export async function writeChannelWording(
  db: Db,
  t: SocialTarget,
  channelId: string,
  deps: { writer: SocialWriter; networks: () => Promise<ChannelNetworks> },
): Promise<Outcome> {
  const [channels, records, source] = await Promise.all([connectedChannelIds(db), readChannelRecords(db, t), sourceText(db, t)]);
  if (!source) return { ok: false, error: TOOL_MESSAGES.notFound };
  if (!channels.includes(channelId)) return { ok: false, error: TOOL_MESSAGES.notConnected };
  const record = records.get(channelId);
  if (record?.handed_at && !record.posted_at) return { ok: false, error: TOOL_MESSAGES.withBuffer };
  const networks = await deps.networks();
  const network = networks.kind === "known" ? networks.services.get(channelId) ?? null : null;
  if (!network) return { ok: false, error: TOOL_MESSAGES.noNetwork };
  const result = await deps.writer.write({ network, ...source, maxLength: leadMaxFor(network) });
  if (!result.ok) return { ok: false, error: result.reason };
  await saveClaudeLead(db, t, channelId, result.text);
  return { ok: true };
}

/**
 * "Send draft to Buffer": exactly what the channel would receive, as a Buffer
 * draft. Sending again replaces the previous draft. `seen` is the channel's
 * fingerprint as the editor showed it, so the draft is what the admin looked at.
 */
export async function sendChannelDraft(
  db: Db,
  t: SocialTarget,
  channelId: string,
  seen: string | undefined,
  deps: { publisher: SocialPublisher; live: boolean; networks: () => Promise<ChannelNetworks> },
): Promise<Outcome> {
  if (!deps.live) return { ok: false, error: TOOL_MESSAGES.noBuffer };
  const [item, channels, records] = await Promise.all([loadSocialItem(db, t), connectedChannelIds(db), readChannelRecords(db, t)]);
  if (!item) return { ok: false, error: TOOL_MESSAGES.notFound };
  if (!channels.includes(channelId)) return { ok: false, error: TOOL_MESSAGES.notConnected };
  const networks = await deps.networks();
  if (networks.kind === "failed") return { ok: false, error: TOOL_MESSAGES.noNetwork };
  const { channelPosts } = await import("./adapters/social");
  const entry = channelPosts(item.post, [channelId], networks, leadsOf(records))[0];
  if (!entry || seen !== postFingerprint(entry.post)) return { ok: false, error: TOOL_MESSAGES.changed };

  const record = records.get(channelId);
  let draft;
  try {
    draft = await deps.publisher.publishChannel(entry.post, { kind: "draft" }, { aiAssisted: !!record?.lead_ai && !!record.lead_text });
  } catch {
    // Logged by the adapter.
    return { ok: false, error: TOOL_MESSAGES.draftFailed };
  }
  if (!draft?.id) return { ok: false, error: TOOL_MESSAGES.draftFailed };
  // The old draft goes once the new one exists; if that delete fails it's left in Buffer, not lost track of silently.
  if (record?.draft_post_id && record.draft_post_id !== draft.id) await deps.publisher.deletePost(record.draft_post_id);
  const { key } = targetOf(t);
  const { error } = await db.from("social_channel_posts").upsert({
    ...ownerOf(t),
    channel_id: channelId,
    draft_post_id: draft.id,
    draft_text: entry.post.text,
    draft_image: entry.post.imagePath,
    draft_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: `${key},channel_id` });
  if (error) throw new Error(`[social] the draft is in Buffer but wasn't recorded: ${error.message}`);
  return { ok: true };
}
