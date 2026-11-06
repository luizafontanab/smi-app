"use client";

import { useRouter } from "next/navigation";

/* PROTOTYPE (issue #63): the live /news/ "Topics" select, here switching industry pages. */
export function TopicSelect({ topics, current }: { topics: { slug: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <label className="flex flex-1 flex-col gap-1 text-black sm:max-w-xl">
      Topics
      <select className="h-13 rounded-[5px] bg-white px-4 text-lg" value={current} onChange={(e) => router.push(`/industry/${e.target.value}`)}>
        {topics.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
      </select>
    </label>
  );
}
