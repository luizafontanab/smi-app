import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { getLeadGenSource } from "@/lib/adapters/leadgen";
import { markProspect } from "../actions";

export const dynamic = "force-dynamic";

const RADII = [10, 25, 50, 100];

const ACTIONS = [
  { value: "call", label: "Mark to call" },
  { value: "email", label: "Mark to email" },
  { value: "sequence", label: "Add to sequence" },
] as const;

const MARK_LABEL: Record<string, string> = {
  call: "To call",
  email: "To email",
  sequence: "In sequence",
  follow_up: "Following up",
};

export default async function ConsoleLeadsPage(props: PageProps<"/console/leads">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();

  const companyType = typeof sp.company_type === "string" ? sp.company_type : "";
  const near = typeof sp.near === "string" ? sp.near : "";
  const radiusMiles = Number(sp.radius) || undefined;

  const [types, prospects, marks] = await Promise.all([
    must(db.from("membership_types").select("slug, name").order("sort_order"), "console/leads membership types"),
    getLeadGenSource().search({ companyType: companyType || undefined, near: near || undefined, radiusMiles }),
    must(db.from("prospect_marks").select("prospect_ref, action").is("member_id", null), "console/leads prospect marks"),
  ]);

  // Many marks per prospect: one operator can flag the same company to call and
  // to email, and both badges should show.
  const marked = new Map<string, string[]>();
  for (const m of marks ?? []) marked.set(m.prospect_ref, [...(marked.get(m.prospect_ref) ?? []), m.action]);

  // Carried on every action form so the redirect lands back on this same search.
  const q = new URLSearchParams();
  if (companyType) q.set("company_type", companyType);
  if (near) q.set("near", near);
  if (radiusMiles) q.set("radius", String(radiusMiles));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">Lead generation</h1>

      <p className="mt-3 rounded bg-danger/10 p-3 text-sm text-danger">
        <strong>Sample data.</strong> These prospects are fictional and their contact details are not real —
        every address is an <code>example.com</code> one. Nothing here contacts anybody. The live source needs
        an SMI-owned n8n instance and sign-off on the lead-gen cost before it can be switched on.
      </p>

      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Marked.</p>}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <form className="flex flex-wrap items-end gap-3 text-sm" role="search">
          <label htmlFor="leads-type" className="flex flex-col">
            Company type
            <select id="leads-type" name="company_type" defaultValue={companyType} className="mt-1 rounded border px-3 py-1.5">
              <option value="">Any</option>
              {(types ?? []).map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </label>
          <label htmlFor="leads-near" className="flex flex-col">
            Near
            <input id="leads-near" name="near" defaultValue={near} placeholder="Town or postcode" className="mt-1 rounded border px-3 py-1.5" />
          </label>
          <label htmlFor="leads-radius" className="flex flex-col">
            Radius
            <select id="leads-radius" name="radius" defaultValue={radiusMiles ?? ""} className="mt-1 rounded border px-3 py-1.5">
              <option value="">Any distance</option>
              {RADII.map((r) => (
                <option key={r} value={r}>{r} miles</option>
              ))}
            </select>
          </label>
          <button className="rounded bg-ink px-4 py-1.5 text-white">Search</button>
        </form>

        <p className="mt-4 text-sm text-graphite">{prospects.length} prospects</p>

        {prospects.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">No prospects match those criteria.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th scope="col" className="py-2">Company</th>
                  <th scope="col" className="py-2">Contact</th>
                  <th scope="col" className="py-2">Distance</th>
                  <th scope="col" className="py-2">Mark</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => (
                  <tr key={p.ref} className="border-t align-top">
                    <td className="py-3">
                      <span className="font-semibold text-ink">{p.company}</span>
                      <span className="block text-xs text-graphite">{p.location}</span>
                      {(marked.get(p.ref) ?? []).map((a) => (
                        <span key={a} className="mt-1 mr-1 inline-block rounded bg-success/10 px-2 py-0.5 text-xs text-success">
                          {MARK_LABEL[a] ?? a}
                        </span>
                      ))}
                    </td>
                    <td className="py-3">
                      {p.name}
                      {p.email && <a href={`mailto:${p.email}`} className="block text-xs underline">{p.email}</a>}
                      {p.phone && <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="block text-xs underline">{p.phone}</a>}
                      {p.linkedinUrl && (
                        <a href={p.linkedinUrl} target="_blank" rel="noreferrer noopener" className="block text-xs underline">
                          LinkedIn
                        </a>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap">{p.distanceMiles} mi</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {ACTIONS.map((a) => (
                          <form key={a.value} action={markProspect}>
                            <input type="hidden" name="ref" value={p.ref} />
                            <input type="hidden" name="action" value={a.value} />
                            <input type="hidden" name="q" value={q.toString()} />
                            <button className="rounded border px-2 py-1 text-xs hover:bg-graphite/10">{a.label}</button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
