import Anthropic from "@anthropic-ai/sdk";
import { logError } from "@/lib/log";

/**
 * "Write with Claude" in the editor's Social post section (issue #101, ADR
 * 0003): one channel's wording, written for that network from the story or
 * video. Only the wording — the app adds the link and that network's member
 * tags after it (adapters/social channelText), so Claude can't drop the link
 * or invent a handle. The admin reads and can edit it before anything is sent.
 *
 * Runs only when an admin clicks the button: each click is one paid call.
 * Without ANTHROPIC_API_KEY it reports that it isn't set up, and the channel
 * keeps the item's own lead-in. Same key as the story rewrite (HUMAN-TODO 1.21).
 */

export type WriteInput = {
  /** Buffer's service name: "linkedin", "twitter", "facebook", … */
  network: string;
  title: string;
  summary: string | null;
  /** The story body or video description, as plain text. */
  body: string;
  /** The member companies the post is about, for naming them in the wording. */
  companies: string[];
  /** The wording's length limit for this network (adapters/social leadMaxFor). */
  maxLength: number;
};
export type WriteResult = { ok: true; text: string } | { ok: false; reason: string };

export interface SocialWriter {
  write(input: WriteInput): Promise<WriteResult>;
}

export const SOCIAL_WRITER_MODEL = "claude-opus-5-5";

/** Fixed: nothing per-request goes in the system prompt. */
export const SOCIAL_WRITER_SYSTEM = `You write the wording of one social media post for Sheet Metal Industries (SMI), a UK trade publication and membership body for the sheet metal industry. The post shares one of SMI's own news stories or videos about a member company.

Write only the wording. The app adds the link to the story and the member companies' social handles after your text, so:
- Never include a URL, a link placeholder, an @handle or a "link in bio".
- Never write "click the link below" or similar; the link is plainly there.

Voice: SMI's, in the third person about the companies ("Acme Engineering has…", never "we" for a company). Factual and specific: say what happened and why it matters to people in sheet metal and manufacturing. Use only facts from the story you are given; never add figures, quotes, names or claims it doesn't contain. British spelling. No clickbait, no exaggeration, no exclamation marks unless the story itself is a celebration.

Fit the network:
- linkedin: professional. One to three short paragraphs. Open with the news itself, not a question. At most three relevant hashtags at the end, or none.
- facebook: friendly and plain. One or two short paragraphs. Hashtags are optional, at most two.
- twitter (X): one or two sentences. No hashtags unless one is essential. Every character counts.
- instagram: a caption that works without the link. One short paragraph, then up to five relevant hashtags.
- any other network: one short, plain paragraph.

Stay within the length limit you are given, counted in characters, including spaces and hashtags. Shorter is fine.

Return the wording as "text".`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

/** A URL or @handle in the wording would duplicate or contradict what the app appends. */
const FORBIDDEN = [/https?:\/\//i, /\bwww\./i, /(^|\s)@\w/];

/** Whether Claude's wording can be used as it is: within the limit, and nothing the app adds itself. */
export function checkWording(text: string, maxLength: number): WriteResult {
  const t = text.trim();
  if (!t) return { ok: false, reason: "Claude returned no wording. Try again." };
  if (t.length > maxLength) {
    return { ok: false, reason: `Claude's wording was ${t.length} characters, over this network's ${maxLength}. Try again, or write it yourself.` };
  }
  if (FORBIDDEN.some((re) => re.test(t))) {
    return { ok: false, reason: "Claude's wording included a link or an @handle, which the app adds itself. Try again." };
  }
  return { ok: true, text: t };
}

class SkipWriter implements SocialWriter {
  async write(): Promise<WriteResult> {
    return { ok: false, reason: "Writing with Claude isn't set up on this site yet (no Anthropic key)." };
  }
}

export class AnthropicSocialWriter implements SocialWriter {
  constructor(private client: Anthropic) {}

  async write(input: WriteInput): Promise<WriteResult> {
    const failed: WriteResult = { ok: false, reason: "Claude didn't answer just now. Try again in a minute." };
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: SOCIAL_WRITER_MODEL,
        max_tokens: 16000,
        // A safety-classifier decline is retried on Anthropic's recommended model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // A short piece of copy: low effort keeps the button quick.
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        system: SOCIAL_WRITER_SYSTEM,
        messages: [{
          role: "user",
          content:
            `Network: ${input.network}\nLength limit: ${input.maxLength} characters\n` +
            `Member companies: ${input.companies.length ? input.companies.join(", ") : "none named"}\n\n` +
            `<title>${input.title}</title>\n\n<summary>${input.summary ?? ""}</summary>\n\n<body>\n${input.body}\n</body>`,
        }],
      });
    } catch (e) {
      logError({ source: "adapter", area: "adapter:social-writer", error: e, context: { status: e instanceof Anthropic.APIError ? e.status : null } });
      return failed;
    }
    if (response.stop_reason === "refusal") return { ok: false, reason: "Claude declined to write this post. Write it yourself." };
    if (response.stop_reason === "max_tokens") return failed;
    const block = response.content.find((b) => b.type === "text");
    try {
      const parsed = JSON.parse(block && block.type === "text" ? block.text : "") as { text?: unknown };
      return checkWording(typeof parsed.text === "string" ? parsed.text : "", input.maxLength);
    } catch (e) {
      logError({ source: "adapter", area: "adapter:social-writer", error: e, context: { stop: response.stop_reason } });
      return failed;
    }
  }
}

/** True when the button can do anything here. */
export function socialWriterLive(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export function getSocialWriter(): SocialWriter {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  // The admin waits on this, so keep it bounded; the SDK's own retry covers 429s and 5xx.
  return key ? new AnthropicSocialWriter(new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 })) : new SkipWriter();
}
