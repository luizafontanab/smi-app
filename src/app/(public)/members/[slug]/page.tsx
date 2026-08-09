import Image from "next/image";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { memberBySlug } from "@/lib/queries";
import { StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/members/[slug]">) {
  const { slug } = await props.params;
  const m = await memberBySlug(slug);
  return { title: m?.name ?? "Member" };
}

export default async function MemberPage(props: PageProps<"/members/[slug]">) {
  const { slug } = await props.params;
  const [member, ctx] = await Promise.all([memberBySlug(slug), requestContext()]);
  if (!member) notFound();
  record([{ kind: "member_page_view", member_id: member.id, path: `/members/${slug}`, ...ctx }]);

  const socials = Object.entries((member.social ?? {}) as Record<string, string>);
  const yt = member.video_url?.match(/[?&]v=([\w-]+)/)?.[1];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <header className="mt-6 flex flex-wrap items-center gap-5 rounded-xl bg-white p-6 shadow-sm">
        {member.logo_path && <Image src={mediaUrl(member.logo_path)!} alt="" width={80} height={80} className="rounded-lg" unoptimized />}
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-amber">SMI Member{member.category ? ` · ${member.category.name}` : ""}</p>
          <h1 className="text-2xl font-bold text-navy">{member.name}</h1>
          <p className="text-sm text-gray-500">{member.address}</p>
        </div>
        <div className="flex gap-2 text-sm">
          {member.website && <a href={member.website} target="_blank" rel="noopener" className="rounded bg-navy px-4 py-2 text-white">Website</a>}
          {member.phone && <a href={`tel:${member.phone}`} className="rounded border px-4 py-2">Call</a>}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="font-bold text-navy">About</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{member.description}</p>
          </section>
          {yt && (
            <section className="mt-6 overflow-hidden rounded-lg bg-white shadow-sm">
              <iframe className="aspect-video w-full" src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Company video" allowFullScreen />
            </section>
          )}
          <section className="mt-6">
            <h2 className="mb-3 font-bold text-navy">Stories featuring {member.name}</h2>
            {member.stories.length === 0 && <p className="text-sm text-gray-500">No stories yet.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {member.stories.map((s) => <StoryCard key={s.id} story={s} />)}
            </div>
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          {member.lat && member.lng && (
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <iframe
                className="h-56 w-full"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${member.lng - 0.05}%2C${member.lat - 0.03}%2C${member.lng + 0.05}%2C${member.lat + 0.03}&layer=mapnik&marker=${member.lat}%2C${member.lng}`}
                title="Location map"
              />
              <p className="p-3 text-xs text-gray-500">{member.address}</p>
            </div>
          )}
          {socials.length > 0 && (
            <div className="rounded-lg bg-white p-4 shadow-sm text-sm">
              <h3 className="font-bold text-navy">Follow</h3>
              <ul className="mt-2 space-y-1 text-steel">
                {socials.map(([k, v]) => <li key={k} className="capitalize">{k}: <span className="text-gray-500">{v}</span></li>)}
              </ul>
            </div>
          )}
          {(member.testimonials as string[] | null)?.length ? (
            <div className="rounded-lg bg-white p-4 shadow-sm text-sm">
              <h3 className="font-bold text-navy">Testimonials</h3>
              {(member.testimonials as string[]).map((t, i) => <p key={i} className="mt-2 italic text-gray-600">“{t}”</p>)}
            </div>
          ) : null}
        </aside>
      </div>
      <div className="my-10" />
    </div>
  );
}
