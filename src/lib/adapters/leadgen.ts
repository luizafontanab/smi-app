/**
 * LeadGenSource adapter (TECH-DECISIONS #16): lead generation for both the
 * admin console (A29 / GAPS A8.3) and the member dashboard (M14 / GAPS A8.4).
 *
 * **Phase 1 is mock data only, deliberately.** TECH-DECISIONS #16 gates the
 * real source on two things that don't exist yet: Jas's sign-off on the
 * Daniel/Prosp cost, and an SMI-owned n8n instance (Luiza's condition, mirroring
 * the #15 ownership rule). So unlike every other adapter in this directory,
 * `getLeadGenSource()` does NOT branch on an env var — there is no second
 * implementation to switch to, and advertising one in `.env.example` under this
 * project's "Unset → stub, Set → real" convention would be a lie.
 *
 * What the live shape will probably be, recorded now so the interface isn't
 * re-litigated later:
 *
 *   - `search()` → an n8n webhook. Prosp CANNOT serve this: its API has no
 *     search-by-criteria endpoint at all (lead discovery happens in its Chrome
 *     extension and lead finder), so "company type + radius" has no Prosp
 *     counterpart. This is an open question for Jas — see docs/ask-jas.md.
 *   - `mark()` → Prosp's `POST /api/v1/leads` (add to contact list + campaign)
 *     and `/api/v1/leads/send-message`. Note Prosp authenticates with an
 *     `api_key` field in the JSON *body*, not a header, and identifies a lead
 *     by its `linkedin_url` — which is why `Prospect.ref` is shaped as one.
 *     The env var, when it arrives, will be `PROSP_API_KEY`.
 *
 * `mark()` lives on this interface rather than inline in the server actions
 * precisely because live it becomes an outbound call, not a database write.
 */

import { serviceDb } from "../db/server";

export type Prospect = {
  /** Stable identity, shaped as a LinkedIn URL — how Prosp keys a lead. */
  ref: string;
  name: string;
  /**
   * Shown prominently on both panels — Jas's 18 Sep guardrail (TECH-DECISIONS
   * #16, USE-CASES gap 24): who the person is matters more than their address.
   * Live, it must come from what the prospect published themselves.
   */
  jobTitle: string | null;
  company: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  /** A `membership_types.slug` — the vocabulary the rest of the app filters on. */
  companyType: string | null;
  location: string | null;
  distanceMiles: number | null;
};

export type ProspectQuery = {
  companyType?: string;
  /** Postcode or town. Mock data ignores the value itself and filters on radius. */
  near?: string;
  radiusMiles?: number;
  /** M14 scoping. Absent = A29's whole-market search. */
  memberId?: string;
  limit?: number;
};

export type ProspectAction = "call" | "email" | "sequence" | "follow_up";

export const PROSPECT_ACTIONS: readonly ProspectAction[] = ["call", "email", "sequence", "follow_up"];

export function isProspectAction(value: unknown): value is ProspectAction {
  return typeof value === "string" && (PROSPECT_ACTIONS as readonly string[]).includes(value);
}

export interface LeadGenSource {
  search(query: ProspectQuery): Promise<Prospect[]>;
  mark(ref: string, action: ProspectAction, opts: { memberId: string | null }): Promise<void>;
}

/**
 * Fixed sample prospects. Hardcoded rather than generated: @faker-js/faker is a
 * devDependency and must not be imported from src/, and the visual suite
 * photographs both lead-gen pages — a list that shuffles would diff every run.
 *
 * The domains are all `example.com` on purpose. These rows sit next to Call and
 * Email buttons in an admin panel, and a plausible-looking real address is how
 * someone ends up contacting a stranger from sample data.
 */
const FIXTURES: Prospect[] = [
  ["Alan Whitcombe", "Operations Director", "Pennine Press Brake Services", "service-provider", "Huddersfield", 8],
  ["Priya Raman", "Purchasing Manager", "Calder Laser Cutting", "service-provider", "Halifax", 12],
  ["Tom Beresford", "Managing Director", "Beresford Tooling", "equipment-supplier", "Sheffield", 21],
  ["Marie Lindqvist", "UK Sales Manager", "Nordfab Machinery UK", "equipment-supplier", "Leeds", 16],
  ["Owen Pritchard", "Production Manager", "Pritchard Sheet Metal", "service-provider", "Wakefield", 11],
  ["Sandra Okafor", "Owner", "Okafor Fabrication", "service-provider", "Bradford", 9],
  ["Dev Chaudhary", "Head of Partnerships", "Meridian CAD Systems", "software", "Manchester", 38],
  ["Helen Ashworth", "Quality Manager", "Ashworth Metrology", "it-services", "Rochdale", 32],
  ["Jamie Sutcliffe", "Engineering Manager", "Sutcliffe Guillotines", "equipment-supplier", "Barnsley", 19],
  ["Rachel Nowak", "Procurement Lead", "Nowak Welding Supplies", "equipment-supplier", "Doncaster", 29],
  ["Ben Iqbal", "Works Manager", "Iqbal Precision Components", "service-provider", "Dewsbury", 6],
  ["Claire Docherty", "Training Director", "Docherty Training Partnership", "training-education", "York", 41],
  ["Martin Osei", "Finishing Supervisor", "Osei Powder Coating", "service-provider", "Castleford", 14],
  ["Yusuf Demir", "Technical Director", "Demir Toolroom Software", "software", "Nottingham", 62],
  ["Lauren Tasker", "IT Manager", "Tasker Industrial IT", "it-services", "Leeds", 17],
  ["Gordon Mackay", "Head of Apprenticeships", "Mackay Apprentice Academy", "training-education", "Newcastle", 88],
].map(([name, jobTitle, company, companyType, location, distanceMiles]) => {
  const slug = String(company).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return {
    ref: `https://www.linkedin.com/company/${slug}`,
    name: String(name),
    jobTitle: String(jobTitle),
    company: String(company),
    email: `${String(name).toLowerCase().split(" ")[0]}@${slug}.example.com`,
    phone: `01${String(1000 + Number(distanceMiles) * 7).slice(0, 3)} ${String(700000 + Number(distanceMiles) * 137).slice(0, 6)}`,
    linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    companyType: String(companyType),
    location: String(location),
    distanceMiles: Number(distanceMiles),
  };
});

/**
 * Deterministic, not random: the same member must get the same prospects on
 * every render, or the visual baselines diff on every run and a member's list
 * reshuffles under them mid-session.
 */
function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

class MockLeadGenSource implements LeadGenSource {
  async search(query: ProspectQuery): Promise<Prospect[]> {
    let results = FIXTURES;

    if (query.companyType) results = results.filter((p) => p.companyType === query.companyType);
    if (query.radiusMiles) results = results.filter((p) => (p.distanceMiles ?? Infinity) <= query.radiusMiles!);

    // Sort first, so there is one deterministic base order to rotate against.
    const byDistance = (a: Prospect, b: Prospect) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0);
    results = [...results].sort(byDistance);

    if (query.memberId && results.length) {
      // A stable rotation, so two members get a different window of the list and
      // each one gets the same window every time. This has to happen after the
      // sort and before the limit — sorting afterwards would cancel it out and
      // hand every member the same nearest-N.
      const offset = stableHash(query.memberId) % results.length;
      results = [...results.slice(offset), ...results.slice(0, offset)];
    }

    if (query.limit) results = results.slice(0, query.limit);
    return [...results].sort(byDistance);
  }

  async mark(ref: string, action: ProspectAction, opts: { memberId: string | null }): Promise<void> {
    // Idempotent: the partial unique indexes make a double-click a no-op rather
    // than a second row, so the page can re-render straight after the action.
    await serviceDb()
      .from("prospect_marks")
      .upsert(
        { prospect_ref: ref, action, member_id: opts.memberId },
        { onConflict: opts.memberId ? "member_id,prospect_ref,action" : "prospect_ref,action", ignoreDuplicates: true },
      );
  }
}

export function getLeadGenSource(): LeadGenSource {
  return new MockLeadGenSource();
}
