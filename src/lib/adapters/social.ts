/**
 * SocialPublisher adapter (TECH-DECISIONS #10): Buffer API bridge for v1,
 * direct platform APIs channel-by-channel later. Local dev: logging stub.
 *
 * GAPS B4.2: `tagHandles` is populated from `members.social` — there is no
 * separate CRM-stored handle field anywhere in the schema, despite this
 * file's original docstring implying one. `members.social` IS the
 * CRM-stored handle: every call site (`jobs.ts`'s story/video social push)
 * reads it from the member row, never hand-typed at post time.
 */

import { socialHandle, socialHref } from "@/lib/social";
import { mediaUrl, serviceDb } from "../db/server";
import { DEFAULT_SOCIAL_CHANNELS, type SocialChannels } from "../social-channels";

export type SocialPost = {
  text: string;
  imagePath: string | null;
  tagHandles: Record<string, string>; // { linkedin: "company/x", x: "handle", ... }
};

export interface SocialPublisher {
  publish(post: SocialPost): Promise<void>;
}

/**
 * "channel:handle" pairs, readable in the dev-log stub. Also the fallback
 * for a real post's text body (GAPS B4.1/B4.3): whether Buffer supports true
 * @-tagging at all is still an open question, so until it's resolved, tags
 * ride along in the text rather than silently vanishing.
 */
function formatTags(tagHandles: Record<string, string>): string {
  return Object.entries(tagHandles)
    .map(([ch, h]) => {
      const href = socialHref(ch, h);
      return `${ch}:${(href && socialHandle(ch, href)) ?? h}`;
    })
    .join(" ");
}

class LoggingSocialStub implements SocialPublisher {
  async publish(post: SocialPost): Promise<void> {
    const tags = formatTags(post.tagHandles);
    console.log(`[social] would post (${tags || "no tags"}): ${post.text.split("\n")[0].slice(0, 80)}`);
  }
}

/** Which connected Buffer profiles a post goes to — Buffer has no "post to everything" default, profile_ids[] is required. */
async function bufferProfileIds(): Promise<string[]> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", "social_channels").maybeSingle();
  const channels: SocialChannels = { ...DEFAULT_SOCIAL_CHANNELS, ...(data?.value as Partial<SocialChannels> | null) };
  return channels.profileIds;
}

class BufferPublisher implements SocialPublisher {
  constructor(private token: string) {}
  async publish(post: SocialPost): Promise<void> {
    const profileIds = await bufferProfileIds();
    if (!profileIds.length) {
      // Fail closed rather than let Buffer reject a profile_ids-less request
      // with a cryptic error — same posture as the other adapters (A7.5, B3.1).
      throw new Error("[social] no Buffer channel configured — set profile ids in /console/stories");
    }

    const tags = formatTags(post.tagHandles);
    const text = tags ? `${post.text}\n\n${tags}` : post.text;
    const image = mediaUrl(post.imagePath);

    const body = new URLSearchParams();
    body.append("text", text);
    for (const id of profileIds) body.append("profile_ids[]", id);
    if (image) body.append("media[photo]", image);

    try {
      const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Buffer rejected the update (${res.status}): ${detail.slice(0, 300)}`);
      }
    } catch (e) {
      console.error("[social] buffer publish failed:", e);
      throw e; // job retries; dead-letter surfaces in Needs You Today
    }
  }
}

export function getSocialPublisher(): SocialPublisher {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  return token ? new BufferPublisher(token) : new LoggingSocialStub();
}
