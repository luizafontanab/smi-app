"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Topic = { slug: string; name: string };

export type IndustrySection = {
  id: "news" | "members" | "videos" | "events";
  title: string;
  seeAll: { href: string; label: string };
  /** `name` is what A–Z sorts on: a story's, video's or event's title, a member's name. */
  items: { key: string; name: string; card: ReactNode }[];
};

type Sort = "recent" | "az";

/**
 * Everything on the Classic industry page below its title (#76): the Sort By
 * and Topics selects, then one panel per section. Choosing a topic waits for
 * the Go button: a select that navigates on change breaks WCAG 3.2.2
 * (decisions 6 Nov, 18). A client component because
 * Sort By reorders in place; the cards arrive already rendered from
 * ClassicIndustryView, so the shared cards stay server components.
 *
 * Sort By:
 *   · Most recent: the order the hub loads them in, which is newest first for
 *     news and videos, soonest first for upcoming events (latest first for
 *     past ones), and the directory's daily rotation for members, which have
 *     no date to sort by.
 *   · A–Z: by title (members by name), within each section.
 * It sorts the cards on the page, not the whole archive: "See all …" is the
 * way to the full, filterable list.
 */
export function ClassicIndustryBody({ sections, topics, current, emptyText }: {
  sections: IndustrySection[];
  topics: Topic[];
  current: Topic;
  emptyText: string;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>("recent");
  const [topic, setTopic] = useState(current.slug);
  // Never a select that can't show where the reader is, even if the route
  // passed no list or the list is missing this industry.
  const options = topics.some((t) => t.slug === current.slug) ? topics : [current, ...topics];

  return (
    <>
      <div data-part="filters">
        {sections.length > 0 && (
          <label data-part="industry-filter">
            <span data-part="form-label">Sort By</span>
            <select data-part="industry-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">Most recent</option>
              <option value="az">A–Z</option>
            </select>
          </label>
        )}
        {/* A plain button, not a form submit: Go is a client-side page change,
            not work that SubmitButton's pending state (#48) is for. */}
        <div data-part="industry-topics-picker">
          <label data-part="industry-filter">
            <span data-part="form-label">Topics</span>
            <select data-part="industry-topics" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {options.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
          </label>
          <button type="button" data-part="button-primary" onClick={() => router.push(`/industry/${topic}`)}>Go</button>
        </div>
      </div>

      {sections.length === 0 && <p data-part="empty-state">{emptyText}</p>}

      {sections.map((s) => (
        <section key={s.id} data-part="industry-section" aria-labelledby={`industry-${s.id}-title`}>
          <h2 id={`industry-${s.id}-title`} data-part="section-title">{s.title}</h2>
          <ul data-part="card-grid">
            {(sort === "az" ? byName(s.items) : s.items).map((item) => <li key={item.key}>{item.card}</li>)}
          </ul>
          <p data-part="industry-see-all">
            <Link href={s.seeAll.href} data-part="button-primary">{s.seeAll.label}</Link>
          </p>
        </section>
      ))}
    </>
  );
}

const collator = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });
const byName = <T extends { name: string }>(items: T[]) => [...items].sort((a, b) => collator.compare(a.name, b.name));
