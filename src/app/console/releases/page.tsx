import { requireConsole } from "@/lib/auth";
import { loadReleaseNotes } from "@/lib/release-notes";

export const metadata = { title: "What's new" };

export default async function ReleaseNotesPage() {
  await requireConsole();
  const notes = loadReleaseNotes();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-ink">What&apos;s new</h1>
      <p className="mt-1 text-sm text-graphite">Changes to the site and console, newest first.</p>

      {notes.length === 0 ? (
        <p className="mt-5 text-sm text-graphite">No release notes yet.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {notes.map((n) => (
            <article key={`${n.date}-${n.title}`} className="rounded-xl bg-white p-5 shadow-sm">
              <time dateTime={n.date} className="text-xs uppercase tracking-wide text-graphite">
                {new Date(`${n.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
              </time>
              <h2 className="mt-1 text-lg font-semibold text-ink">{n.title}</h2>
              {n.items.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {n.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
