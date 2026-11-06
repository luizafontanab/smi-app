import Image from "next/image";
import Link from "next/link";
import { youtubeId } from "@/lib/hero";
import { excerptFromHtml } from "@/lib/sanitize";
import type { IndustryHub } from "@/app/(public)/industry/[slug]/hub.data";
import { ClassicNewsroom } from "../ClassicNewsroom";
import { BlueButton, cover, DiscHeading, fmtDate, LiveCard, Panel } from "./bits";
import { TopicSelect } from "./TopicSelect";

/*
 * PROTOTYPE (issue #63). Two structural takes on /industry/[slug] in Classic.
 * The live site has no industry pages; its nearest thing is the Topics filter
 * on /news/ and /video/.
 *
 *   A2 "Topic page": the industry page *is* the live news list with a topic
 *      chosen. Disc title, Sort/Topics selects, then one white panel per
 *      section with a 4-up grid. No carousels.
 *   A3 "Mini homepage": the industry's own Newsroom (#1–#4), a full-width
 *      members row on the canvas, a black videos band, and events as a
 *      dated list.
 */
type Props = { hub: IndustryHub; slug: string; topics: { slug: string; name: string }[] };

const videoImg = (v: IndustryHub["videos"][number]) => {
  const yt = youtubeId(v.url);
  return cover(v.thumbnail_path) ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
};

function MemberCardLive({ m }: { m: IndustryHub["members"][number] }) {
  const logo = cover(m.logo_path);
  return (
    <Link href={`/member/${m.slug}`} className="group flex h-full flex-col rounded-[5px] bg-white p-5 shadow-[0_5px_25px_rgb(0_0_0/0.08)]">
      <div className="relative h-20 border-b-2 border-[#f2f2f2] pb-3">
        {logo && <Image src={logo} alt="" fill sizes="200px" className="object-contain object-left" unoptimized />}
      </div>
      <p className="mt-3 text-lg leading-snug text-black group-hover:underline">{m.name}</p>
      {m.description && <p className="mt-1 line-clamp-2 text-sm text-[#666]">{excerptFromHtml(m.description, 120)}</p>}
      <span className="mt-auto self-end pt-3 text-[#3100ff]">View Member ›</span>
    </Link>
  );
}

export function IndustryTopicPage({ hub, slug, topics }: Props) {
  const { industry, stories, storyTotal, members, memberTotal, videos, videoTotal, events, eventsTense } = hub;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <DiscHeading as="h1" icon="🏭" size="text-[2.5rem] sm:text-[3rem]">{industry.name}</DiscHeading>
      <div className="mt-8 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-black">
          Sort By
          <select className="h-13 w-56 rounded-[5px] bg-white px-4 text-lg" defaultValue="recent"><option value="recent">Most Recent</option></select>
        </label>
        <TopicSelect topics={topics} current={slug} />
      </div>

      {stories.length > 0 && (
        <Panel className="mt-8">
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {stories.slice(0, 8).map((s) => (
              <LiveCard key={s.id} href={`/news/${s.slug}`} title={s.title} image={cover(s.cover_path)} focus={s.cover_focus}
                kicker={s.is_member_news ? "Member news" : null}
                meta={[s.member ? `Published by ${s.member.name}` : "Published by Sheet Metal Industries", fmtDate(s.published_at)]} />
            ))}
          </div>
          {storyTotal > 8 && <div className="mt-10 text-center"><BlueButton href={`/news?industry=${slug}`}>See all {storyTotal} stories</BlueButton></div>}
        </Panel>
      )}

      {members.length > 0 && (
        <section className="mt-14">
          <DiscHeading icon="👥">Members</DiscHeading>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {members.slice(0, 8).map((m) => <MemberCardLive key={m.slug} m={m} />)}
          </div>
          {memberTotal > 8 && <div className="mt-8 text-center"><BlueButton href={`/member?industry=${slug}`}>See all {memberTotal} members</BlueButton></div>}
        </section>
      )}

      {videos.length > 0 && (
        <section className="mt-14">
          <DiscHeading icon="🎥">Videos</DiscHeading>
          <Panel className="mt-6">
            <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {videos.slice(0, 4).map((v) => (
                <LiveCard key={v.id} href={`/video/${v.slug}`} title={v.title} image={videoImg(v)} meta={[v.member?.name]} />
              ))}
            </div>
            {videoTotal > 4 && <div className="mt-10 text-center"><BlueButton href={`/video?industry=${slug}`}>See all {videoTotal} videos</BlueButton></div>}
          </Panel>
        </section>
      )}

      {events.length > 0 && (
        <section className="mt-14">
          <DiscHeading icon="📅">{eventsTense === "upcoming" ? "Upcoming events" : "Past events"}</DiscHeading>
          <Panel className="mt-6">
            <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {events.slice(0, 4).map((e) => (
                <Link key={e.slug} href={`/event/${e.slug}`} className="group block">
                  <p className="text-sm uppercase text-[#666]">{fmtDate(e.starts_on)}</p>
                  <p className="mt-1 text-lg uppercase leading-snug group-hover:underline">{e.title}</p>
                  {e.location && <p className="mt-1 text-sm text-[#666]">📍 {e.location}</p>}
                </Link>
              ))}
            </div>
          </Panel>
        </section>
      )}
    </div>
  );
}

export function IndustryMiniHome({ hub, slug }: Props) {
  const { industry, stories, storyTotal, members, memberTotal, videos, events, eventsTense } = hub;
  return (
    <div className="py-10">
      <div className="mx-auto max-w-6xl px-4">
        <p className="text-sm uppercase text-[#666]">Industry</p>
        {stories.length > 0 ? (
          <ClassicNewsroom stories={stories} title={industry.name} />
        ) : (
          <DiscHeading as="h1" icon="🏭">{industry.name}</DiscHeading>
        )}
        {stories.length > 4 && (
          <Panel className="mt-10">
            <h2 className="text-2xl font-normal">More {industry.name} news</h2>
            <ul className="mt-4 divide-y divide-[#e2e2e2]">
              {stories.slice(4, 9).map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-6 py-3">
                  <Link href={`/news/${s.slug}`} className="uppercase hover:underline">{s.title}</Link>
                  <span className="shrink-0 text-sm uppercase text-[#666]">{fmtDate(s.published_at)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6"><BlueButton href={`/news?industry=${slug}`}>All {storyTotal} stories</BlueButton></div>
          </Panel>
        )}
      </div>

      {members.length > 0 && (
        <section className="mt-14">
          <div className="mx-auto flex max-w-6xl items-end justify-between px-4">
            <DiscHeading icon="👥">{industry.name} members</DiscHeading>
            <Link href={`/member?industry=${slug}`} className="text-[#3100ff] hover:text-[#1d0099]">All {memberTotal} ›</Link>
          </div>
          <div className="mx-auto mt-6 flex max-w-6xl gap-6 overflow-x-auto px-4 pb-4">
            {members.map((m) => <div key={m.slug} className="w-64 shrink-0"><MemberCardLive m={m} /></div>)}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className="mt-14 bg-black py-12 text-white">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="inline-flex items-center gap-4 text-[2rem] font-normal">
              <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-brand text-2xl">🎥</span>
              Latest {industry.name} videos
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {videos.slice(0, 4).map((v) => {
                const img = videoImg(v);
                return (
                  <Link key={v.id} href={`/video/${v.slug}`} className="group block">
                    <div className="relative aspect-video overflow-hidden rounded-[5px] bg-ink">
                      {img && <Image src={img} alt="" fill sizes="25vw" className="object-cover" unoptimized />}
                      <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-4xl">▶</span>
                    </div>
                    <p className="mt-3 line-clamp-2 uppercase group-hover:underline">{v.title}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {events.length > 0 && (
        <div className="mx-auto mt-14 max-w-6xl px-4">
          <Panel>
            <DiscHeading icon="📅">{eventsTense === "upcoming" ? "Upcoming events" : "Past events"}</DiscHeading>
            <ul className="mt-6 space-y-4">
              {events.slice(0, 5).map((e) => {
                const d = new Date(e.starts_on);
                return (
                  <li key={e.slug}>
                    <Link href={`/event/${e.slug}`} className="group flex items-center gap-5">
                      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[5px] bg-[#333] text-center leading-none text-white">
                        <span><span className="block text-2xl">{d.getUTCDate()}</span><span className="text-xs uppercase">{d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span></span>
                      </span>
                      <span>
                        <span className="block text-lg uppercase group-hover:underline">{e.title}</span>
                        {e.location && <span className="block text-sm text-[#666]">📍 {e.location}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
