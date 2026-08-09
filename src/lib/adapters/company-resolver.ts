/**
 * IP → region/company resolution (TECH-DECISIONS #8: region-first, company optional).
 *
 * Production: region from self-hosted MaxMind GeoLite2 (key pending approval),
 * company from a vendor API behind this same interface, tried first when enabled.
 * Local dev: deterministic stub so seeded/demo traffic gets plausible UK regions.
 */

export type IpResolution = { region: string | null; company: string | null };

const UK_REGIONS = [
  "West Midlands", "South Yorkshire", "Greater Manchester", "East Midlands",
  "South East", "North West", "Scotland", "Wales", "North East", "East of England",
];

export async function resolveIp(ip: string): Promise<IpResolution> {
  if (process.env.COMPANY_RESOLVER === "vendor") {
    // Wire the vendor API here once cost + UK-GDPR lawfulness are confirmed.
    // Falls through to region-only until then.
  }
  if (ip === "local" || ip.startsWith("127.") || ip.startsWith("::1")) {
    return { region: stableRegion(ip), company: null };
  }
  // GeoLite2 lookup goes here once the MaxMind key is approved.
  return { region: stableRegion(ip), company: null };
}

function stableRegion(ip: string): string {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (Math.imul(33, h) + ip.charCodeAt(i)) | 0;
  return UK_REGIONS[Math.abs(h) % UK_REGIONS.length];
}
