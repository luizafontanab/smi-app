import { record, requestContext } from "@/lib/analytics";
import { upcomingEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

export default async function EventsPage() {
  const [events, ctx] = await Promise.all([upcomingEvents(20), requestContext()]);
  record([{ kind: "page_view", path: "/events", ...ctx }]);
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Events</h1>
      <div className="mt-6 space-y-4">
        {events.map((e) => (
          <div key={e.slug} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-amber">
              {fmt(e.starts_on)}{e.ends_on && ` – ${fmt(e.ends_on)}`}
            </p>
            <h2 className="mt-1 text-lg font-bold">{e.title}</h2>
            <p className="text-sm text-gray-500">{e.location}</p>
            {e.description && <p className="mt-2 text-sm text-gray-600">{e.description}</p>}
            <div className="mt-2 flex gap-3 text-sm text-steel">
              {e.link && <a href={e.link} target="_blank" rel="noopener" className="hover:underline">Event website →</a>}
              {e.member && <span className="text-gray-500">Hosted by {e.member.name}</span>}
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="text-gray-500">No upcoming events.</p>}
      </div>
      <div className="my-10" />
    </div>
  );
}
