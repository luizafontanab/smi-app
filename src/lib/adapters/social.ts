/**
 * SocialPublisher adapter (TECH-DECISIONS #10): Buffer API bridge for v1,
 * direct platform APIs channel-by-channel later. Local dev: logging stub.
 * Tags come from CRM-stored handles only — never hand-typed at post time.
 */

import { socialHandle, socialHref } from "@/lib/social";

export type SocialPost = {
  text: string;
  imagePath: string | null;
  tagHandles: Record<string, string>; // { linkedin: "company/x", x: "handle", ... }
};

export interface SocialPublisher {
  publish(post: SocialPost): Promise<void>;
}

class LoggingSocialStub implements SocialPublisher {
  async publish(post: SocialPost): Promise<void> {
    // stored values are URLs as often as handles — reduce both to a readable tag
    const tags = Object.entries(post.tagHandles)
      .map(([ch, h]) => {
        const href = socialHref(ch, h);
        return `${ch}:${(href && socialHandle(ch, href)) ?? h}`;
      })
      .join(" ");
    console.log(`[social] would post (${tags || "no tags"}): ${post.text.split("\n")[0].slice(0, 80)}`);
  }
}

class BufferPublisher implements SocialPublisher {
  constructor(private token: string) {}
  async publish(post: SocialPost): Promise<void> {
    // Buffer API: create one update per connected channel profile.
    // ⚠ Verify Buffer supports company @-tagging; if not, handles stay in the text body.
    try {
      await fetch("https://api.bufferapp.com/1/updates/create.json", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ text: post.text }),
      });
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
