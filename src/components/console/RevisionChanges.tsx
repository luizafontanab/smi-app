import type { ParsedRevision, RevisionChange } from "@/app/console/member-revision";

/**
 * What approving a member's page edit will change, field by field — shown above
 * Approve so Jas decides on the content, not on a date. Only allowlisted fields
 * appear as changes (member-revision.ts); anything else the submission carried
 * is listed separately as not applied, because a field a member's form can't
 * produce is either a stale client or someone writing to the API by hand.
 */

type Named = { id: number; name: string };

export type RevisionSets = {
  services: { all: Named[]; current: number[] };
  membershipTypes: { all: Named[]; current: number[] };
  industries: { all: Named[]; current: number[] };
};

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, max = 280) => (s.length > max ? `${s.slice(0, max)}…` : s);

function Value({ change, value, industries, mediaUrl }: {
  change: RevisionChange;
  value: unknown;
  industries: Named[];
  mediaUrl: (path: string | null) => string | null;
}) {
  if (value == null || value === "") return <span className="text-graphite">—</span>;
  switch (change.field) {
    case "industry_id":
      return <>{industries.find((i) => i.id === value)?.name ?? `#${String(value)}`}</>;
    case "description":
      return <>{clip(plain(String(value))) || <span className="text-graphite">(empty)</span>}</>;
    case "social": {
      const entries = Object.entries(value as Record<string, string>);
      if (!entries.length) return <span className="text-graphite">—</span>;
      return (
        <ul>
          {entries.map(([k, v]) => <li key={k}><span className="text-graphite">{k}:</span> {v}</li>)}
        </ul>
      );
    }
    case "logo_path":
    case "hero_path": {
      const url = mediaUrl(String(value));
      // eslint-disable-next-line @next/next/no-img-element -- a console thumbnail of a storage object
      return url ? <img src={url} alt="" className="h-12 max-w-[10rem] rounded border object-contain" /> : <>{String(value)}</>;
    }
    default:
      return <span className="break-all">{String(value)}</span>;
  }
}

function setDiff(label: string, proposed: number[] | null, set: { all: Named[]; current: number[] }) {
  if (!proposed) return null;
  const name = (id: number) => set.all.find((x) => x.id === id)?.name ?? `#${id}`;
  const added = proposed.filter((id) => !set.current.includes(id)).map(name);
  const removed = set.current.filter((id) => !proposed.includes(id)).map(name);
  if (!added.length && !removed.length) return null;
  return { label, added, removed };
}

export function RevisionChanges({
  changes,
  parsed,
  sets,
  mediaUrl,
}: {
  changes: RevisionChange[];
  parsed: Pick<ParsedRevision, "serviceIds" | "membershipTypeIds" | "industryIds" | "ignored">;
  sets: RevisionSets;
  mediaUrl: (path: string | null) => string | null;
}) {
  const setChanges = [
    setDiff("Services", parsed.serviceIds, sets.services),
    setDiff("Membership types", parsed.membershipTypeIds, sets.membershipTypes),
    setDiff("Industries", parsed.industryIds, sets.industries),
  ].filter((d) => d !== null);

  return (
    <div className="mt-3">
      {changes.length === 0 && setChanges.length === 0 ? (
        <p className="text-sm text-graphite">Nothing in this submission differs from their page as it is now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Proposed changes</caption>
            <thead>
              <tr className="text-left text-xs uppercase text-graphite">
                <th scope="col" className="py-1 pr-3">Field</th>
                <th scope="col" className="pr-3">Now</th>
                <th scope="col">Proposed</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.field} className="border-t align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium">{c.label}</th>
                  <td className="py-1.5 pr-3 text-graphite"><Value change={c} value={c.from} industries={sets.industries.all} mediaUrl={mediaUrl} /></td>
                  <td className="py-1.5"><Value change={c} value={c.to} industries={sets.industries.all} mediaUrl={mediaUrl} /></td>
                </tr>
              ))}
              {setChanges.map((d) => (
                <tr key={d.label} className="border-t align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium">{d.label}</th>
                  <td colSpan={2} className="py-1.5">
                    {d.added.length > 0 && <p>Adds {d.added.join(", ")}</p>}
                    {d.removed.length > 0 && <p className="text-graphite">Removes {d.removed.join(", ")}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed.ignored.length > 0 && (
        <p role="note" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">
          Also in this submission, and <b>not</b> applied on Approve: {parsed.ignored.map((i) => `${i.key} (${i.reason})`).join("; ")}.
          A member&apos;s profile form can&apos;t produce these.
        </p>
      )}
    </div>
  );
}
