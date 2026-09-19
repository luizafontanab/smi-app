import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { getLeadGenSource } from "@/lib/adapters/leadgen";
import { markProspectFollowUp, unmarkProspect } from "../actions";

export const dynamic = "force-dynamic";

export default async function DashboardLeadsPage() {
  const user = await requireMember();

  // M14 is "prospects relevant to their own business", not a search panel —
  // the criteria form is A29's job, on the console side.
  const [prospects, { data: marks }] = await Promise.all([
    getLeadGenSource().search({ memberId: user.memberId ?? undefined, limit: 10 }),
    serviceDb().from("prospect_marks").select("id, prospect_ref").eq("member_id", user.memberId ?? ""),
  ]);

  const markedId = new Map((marks ?? []).map((m) => [m.prospect_ref, m.id]));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-ink">Leads</h1>
      <p className="mt-1 text-sm text-graphite">Prospects that look relevant to your business.</p>

      <p className="mt-3 rounded bg-danger/10 p-3 text-sm text-danger">
        <strong>Sample data.</strong> These prospects are fictional and their contact details are not real —
        every address is an <code>example.com</code> one. Marking one is just a note to yourself; nothing is
        sent and nobody is contacted.
      </p>

      {prospects.length === 0 ? (
        <p className="mt-4 rounded-xl bg-white p-5 text-sm text-graphite shadow-sm">No prospects to show yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {prospects.map((p) => {
            const markId = markedId.get(p.ref);
            return (
              <li key={p.ref} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
                <div className="text-sm">
                  <p className="font-semibold text-ink">{p.company}</p>
                  <p className="text-graphite">
                    {p.name} · {p.location} · {p.distanceMiles} mi
                  </p>
                  <p className="mt-1 flex flex-wrap gap-3 text-xs">
                    {p.email && <a href={`mailto:${p.email}`} className="underline">{p.email}</a>}
                    {p.phone && <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="underline">{p.phone}</a>}
                    {p.linkedinUrl && (
                      <a href={p.linkedinUrl} target="_blank" rel="noreferrer noopener" className="underline">LinkedIn</a>
                    )}
                  </p>
                </div>

                {markId ? (
                  <form action={unmarkProspect} className="flex items-center gap-2">
                    <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">Following up</span>
                    <input type="hidden" name="id" value={markId} />
                    <button className="rounded border px-3 py-1.5 text-xs hover:bg-graphite/10">Undo</button>
                  </form>
                ) : (
                  <form action={markProspectFollowUp}>
                    <input type="hidden" name="ref" value={p.ref} />
                    <button className="rounded bg-ink px-3 py-1.5 text-xs text-white">Mark to follow up</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
