import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import { logError } from "@/lib/log";
import { sanitizeRichText } from "@/lib/sanitize";

/**
 * The one-click rewrite (requirements/06-content-os.md "Drafting"): a
 * company's own article, written as "we", becomes third-person copy
 * attributed to the company — with no other style changes whatsoever. Jas
 * describes this as the only edit he makes (DESIGN-QUOTES §13), and the
 * output must never read as tool-built, so the result is checked against the
 * input (checkRewrite) and thrown away if it changed anything else.
 *
 * Runs automatically from "Start story" (src/app/console/sources/actions.ts).
 * Without ANTHROPIC_API_KEY it skips, and the draft keeps the article's own
 * wording — local and tests need no key. HUMAN-TODO 1.21 sets up the account.
 */

export type RewriteInput = { company: string; title: string; excerpt: string | null; html: string };
/** `unnamedWriter`: the article speaks as "I" without saying who wrote it, so "I" was attributed to the company. */
export type Rewritten = { title: string; excerpt: string | null; html: string; unnamedWriter: boolean };
export type RewriteResult = ({ ok: true } & Rewritten) | { ok: false; reason: string };

export interface Rewriter {
  toThirdPerson(input: RewriteInput): Promise<RewriteResult>;
}

export const REWRITE_MODEL = "claude-opus-5-5";

/**
 * Fixed, with nothing per-request in it. Not prompt-cached: no cache_control
 * is set, and the prompt is shorter than the minimum cacheable length anyway.
 */
export const REWRITE_SYSTEM = `You convert a company's own news article from first person to third person, for a trade news site that republishes members' news.

The only change you make is to the words where the article speaks in the first person:
- "we", "us", "our", "ours", "ourselves" always mean the company named in the request. Use the company's name where the sentence needs a name, otherwise "the company" or "it"/"its"/"they"/"their" where the name would be repetitive. Never reinterpret them as anyone else (the industry, the sector, the country, customers, the reader), even where the context suggests a wider group.
- "I", "me", "my", "mine", "myself" mean the person writing. If the text you are given names that person (a byline, a sign-off, "by …"), use their full name the first time and their surname after that; never use "he", "she", "his" or "her" for them. If the text doesn't name them, attribute "I" to the company, as for "we". Never take a name from anywhere else, and never guess one.
- Change a verb only where the change of person requires it ("we are" → "the company is", "I hope" → "Smith hopes").

Change nothing else, whatsoever:
- Same sentences, same order, same words, same punctuation, same spelling (keep British spelling).
- Do not summarise, shorten, expand, correct, improve, reword or restyle anything.
- Text inside quotation marks is a quote: leave it exactly as written, including any "we" or "I".
- Keep every HTML tag, attribute and link exactly as given; change only the text between tags.
- If a part has no first person in it, return it unchanged.

Return the title, the summary and the body, each converted the same way. Also return:
- writer: the name you used for "I", exactly as the text gives it, or "" if you used none.
- speaks_as_i: true if the article, outside quotation marks, uses "I", "me", "my", "mine" or "myself" for the person writing.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    body: { type: "string" },
    writer: { type: "string" },
    speaks_as_i: { type: "boolean" },
  },
  required: ["title", "summary", "body", "writer", "speaks_as_i"],
  additionalProperties: false,
};

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** Text with entities decoded ("O&#8217;Brien" → "O’Brien") and apostrophes made straight, for matching a name against. */
const plainText = (html: string) => cheerio.load(html, null, false).root().text().replace(/[‘’]/g, "'");
const tagSequence = (html: string) => [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[0].toLowerCase());
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export type RewriteOutput = { title: string; summary: string; body: string; writer: string; speaks_as_i: boolean };

/**
 * How far a part's length may move. Each "we" → company name (or "I" → the
 * writer's name) adds the name's length, so the allowance grows with it;
 * beyond that, 20% is already more than a change of person produces, and
 * means the text was reworded.
 */
function lengthKept(before: string, after: string, name: string): boolean {
  const allowance = before.length * 0.2 + name.length * 3;
  return Math.abs(after.length - before.length) <= allowance;
}

/** The rewrite, if it changed nothing but person and tense; else why not. */
export function checkRewrite(input: RewriteInput, output: RewriteOutput): RewriteResult {
  const rejected: RewriteResult = { ok: false, reason: "The rewrite changed more than person and tense, so the article's own wording was kept." };
  // A writer's name must come from the article itself: a name it doesn't
  // contain was guessed, and a guessed byline is worse than none.
  const writer = output.writer.trim();
  const source = plainText(`${input.title}\n${input.excerpt ?? ""}\n${input.html.replace(/<[^>]+>/g, " $& ")}`).replace(/\s+/g, " ");
  if (writer && !source.includes(plainText(writer).replace(/\s+/g, " "))) return { ok: false, reason: "The rewrite named a writer the article doesn't, so the article's own wording was kept." };
  const name = writer.length > input.company.length ? writer : input.company;
  const html = sanitizeRichText(output.body);
  if (!html || !sameList(tagSequence(html), tagSequence(input.html)) || !sameList(hrefs(html), hrefs(input.html))) return rejected;
  if (!lengthKept(textOf(input.html), textOf(html), name)) return rejected;
  const title = output.title.trim();
  if (!title || !lengthKept(input.title, title, name)) return rejected;
  const summary = output.summary.trim();
  if (input.excerpt && (!summary || !lengthKept(input.excerpt, summary, name))) return rejected;
  return { ok: true, title, excerpt: input.excerpt ? summary : null, html, unnamedWriter: output.speaks_as_i && !writer };
}

class SkipRewriter implements Rewriter {
  async toThirdPerson(): Promise<RewriteResult> {
    return { ok: false, reason: "The third-person rewrite isn't set up yet, so the article's own wording was kept." };
  }
}

export class AnthropicRewriter implements Rewriter {
  constructor(private client: Anthropic) {}

  async toThirdPerson(input: RewriteInput): Promise<RewriteResult> {
    const failed: RewriteResult = { ok: false, reason: "The rewrite service didn't answer, so the article's own wording was kept." };
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: REWRITE_MODEL,
        max_tokens: 16000,
        // A safety-classifier decline is retried on Anthropic's recommended model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // A mechanical edit: low effort is enough, and keeps "Start story" quick.
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        system: REWRITE_SYSTEM,
        messages: [{
          role: "user",
          content: `Company: ${input.company}\n\n<title>${input.title}</title>\n\n<summary>${input.excerpt ?? ""}</summary>\n\n<body>\n${input.html}\n</body>`,
        }],
      });
    } catch (e) {
      logError({ source: "adapter", area: "adapter:rewrite", error: e, context: { status: e instanceof Anthropic.APIError ? e.status : null } });
      return failed;
    }
    if (response.stop_reason === "refusal") return { ok: false, reason: "The rewrite service declined this article, so its own wording was kept." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "The article is too long to rewrite in one go, so its own wording was kept." };
    const text = response.content.find((b) => b.type === "text");
    try {
      const parsed = JSON.parse(text && text.type === "text" ? text.text : "") as RewriteOutput;
      return checkRewrite(input, parsed);
    } catch (e) {
      logError({ source: "adapter", area: "adapter:rewrite", error: e, context: { stop: response.stop_reason } });
      return failed;
    }
  }
}

export function getRewriter(): Rewriter {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  // The SDK's own retries cover 429s and 5xx; "Start story" waits on this, so keep it bounded.
  return key ? new AnthropicRewriter(new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 1 })) : new SkipRewriter();
}
