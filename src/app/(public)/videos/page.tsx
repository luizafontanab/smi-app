import Image from "next/image";
import { record, requestContext } from "@/lib/analytics";
import { publishedVideos } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Videos" };

export default async function VideosPage() {
  const [videos, ctx] = await Promise.all([publishedVideos(24), requestContext()]);
  record([{ kind: "page_view", path: "/videos", ...ctx }]);
  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Videos</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => {
          const yt = v.url.match(/[?&]v=([\w-]+)/)?.[1];
          return (
            <a key={v.id} href={v.url} target="_blank" rel="noopener" className="group overflow-hidden rounded-lg bg-white shadow-sm hover:shadow-md">
              <div className="relative h-44 bg-navy">
                {yt && <Image src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" fill sizes="33vw" className="object-cover opacity-80" unoptimized />}
                <span className="absolute inset-0 flex items-center justify-center text-4xl text-white drop-shadow">▶</span>
              </div>
              <div className="p-3">
                <p className="font-semibold line-clamp-2">{v.title}</p>
                {v.member && <p className="mt-1 text-xs text-gray-500">{v.member.name}</p>}
              </div>
            </a>
          );
        })}
      </div>
      <div className="my-10" />
    </div>
  );
}
