/**
 * IP → region/company resolution (TECH-DECISIONS #8: region-first, company optional).
 *
 * Both fields return null until their real source is wired: region from
 * self-hosted MaxMind GeoLite2 (key pending approval, GAPS B2.1), company
 * from a vendor API behind this same interface (parked for Phase 1, B2.2).
 * A hashed-IP placeholder region used to be returned here regardless of
 * environment, which meant paying members saw invented UK regions labelled
 * as real data on /dashboard/stats — GAPS C2. Do not reintroduce a stub
 * region: null is the honest value until GeoLite2 is actually wired.
 */

export type IpResolution = { region: string | null; company: string | null };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ip stays in the signature for the GeoLite2 lookup that lands here
export async function resolveIp(ip: string): Promise<IpResolution> {
  if (process.env.COMPANY_RESOLVER === "vendor") {
    // Wire the vendor API here once cost + UK-GDPR lawfulness are confirmed.
    // Falls through to region-only until then.
  }
  // GeoLite2 lookup goes here once the MaxMind key is approved.
  return { region: null, company: null };
}
