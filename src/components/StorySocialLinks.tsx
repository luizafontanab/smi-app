import { SocialIcon } from "@/components/social-icons";
import { storyPostLinks } from "@/lib/social";

/**
 * "View / share on our socials" under a story (Jas 13/10 item 8) — replaces the
 * share-intent buttons on the story page. Each icon goes to SMI's own post of
 * this story when the editor has pasted one, else to SMI's page on that
 * network: readers land where the conversation is, and SMI's posts get the
 * clicks. No client JS. Videos and events keep ShareButtons (decided 14 Oct —
 * they have no per-item post to point at).
 */
export function StorySocialLinks({ posts }: { posts: unknown }) {
  const links = storyPostLinks(posts);
  return (
    <section aria-labelledby="story-socials" className="mt-8 flex flex-wrap items-center gap-3">
      <h2 id="story-socials" className="text-xs font-bold uppercase tracking-widest text-graphite">
        View / share on our socials
      </h2>
      <ul className="flex gap-2">
        {links.map((l) => (
          <li key={l.key}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener"
              aria-label={l.isPost ? `View this story on ${l.label} (opens in a new tab)` : `SMI on ${l.label} (opens in a new tab)`}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <SocialIcon channel={l.key} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
