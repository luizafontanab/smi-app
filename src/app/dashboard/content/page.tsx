import Link from "next/link";
import { requireMember } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add content" };

const TYPES = [
  { href: "/dashboard/story/new", icon: "📰", title: "Add a story", sub: "Your news on SMI's channels" },
  { href: "/dashboard/video/new", icon: "🎬", title: "Add a video", sub: "Your video on SMI's channels" },
  { href: "/dashboard/event/new", icon: "📅", title: "Add an event", sub: "Open days, shows, launches" },
];

export default async function AddContentPage() {
  await requireMember();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Add content</h1>
      <p className="mt-1 text-sm text-graphite">
        Everything you submit goes live after a quick editorial check — we&apos;ll email you when it&apos;s published.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TYPES.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl bg-white p-5 text-center shadow-sm transition hover:shadow-md">
            <span className="text-3xl">{c.icon}</span>
            <p className="mt-2 font-bold text-ink">{c.title}</p>
            <p className="mt-1 text-xs text-graphite">{c.sub}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
