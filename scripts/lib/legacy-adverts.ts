/**
 * Plans the import of the old site's real adverts (seed-real.ts
 * --legacy-adverts-only). Pure, so the decisions below are unit-tested rather
 * than discovered on production.
 *
 * Source: `handover-extract/seed/adverts.seed.json` — legacy slot A (banners)
 * and D (supplier logos) from the WordPress "Advertisements" options page.
 *
 * Decisions, all Luiza's (27 Sep 2026):
 *  - A run still in date gets an `awaiting_approval` booking, so nothing the
 *    old site sold goes live on the new one without Jas looking at it.
 *  - A run that has already ended gets its advert (the artwork) and NO booking.
 *    Jas can rebook it from /console/adverts/artwork without chasing the files,
 *    and no booking is invented for dates nobody approved.
 *  - No `product_id`, deliberately: approving a booking raises an invoice only
 *    when its product carries a rate, and these runs were paid for on the old
 *    system. Linking one to a priced product would bill the member twice.
 *
 * Idempotency is keyed on `desktop_path`, which shape-seed derives from the
 * legacy slot and index (`adverts/<member>/a0-desktop.png`). If Jas swaps an
 * imported advert's artwork, that key is gone and a re-run would import it
 * again — this is a one-shot migration tool, not a sync.
 */

export type LegacyAdvertRow = {
  legacy_key: string;
  wp_member_id: number;
  name: string;
  format: "banner" | "supplier_logo";
  desktop_path: string;
  mobile_path: string;
  link_url: string | null;
  starts_on: string;
  ends_on: string;
};

export type PlannedAdvert = {
  legacy_key: string;
  advert: {
    member_id: string;
    name: string;
    format: LegacyAdvertRow["format"];
    desktop_path: string;
    mobile_path: string;
    link_url: string | null;
  };
  /** null when the legacy run has already ended — artwork only. */
  booking: {
    status: "awaiting_approval";
    source: "admin";
    submitted_at: string;
    starts_on: string;
    ends_on: string;
    notes: string;
  } | null;
};

export type LegacyAdvertPlan = {
  inserts: PlannedAdvert[];
  /** legacy keys already on the target */
  present: string[];
  /** legacy keys whose member isn't on the target, e.g. a local subset */
  noMember: string[];
};

export function planLegacyAdverts(
  rows: LegacyAdvertRow[],
  opts: {
    /** ISO date, "YYYY-MM-DD" */
    today: string;
    now: string;
    memberId: (wpMemberId: number) => string | null;
    existingDesktopPaths: Set<string>;
  },
): LegacyAdvertPlan {
  const plan: LegacyAdvertPlan = { inserts: [], present: [], noMember: [] };
  for (const r of rows) {
    if (opts.existingDesktopPaths.has(r.desktop_path)) {
      plan.present.push(r.legacy_key);
      continue;
    }
    const member_id = opts.memberId(r.wp_member_id);
    if (!member_id) {
      plan.noMember.push(r.legacy_key);
      continue;
    }
    // ISO dates compare correctly as strings. A run ending today is still in date.
    const inDate = r.ends_on >= opts.today;
    plan.inserts.push({
      legacy_key: r.legacy_key,
      advert: {
        member_id,
        name: r.name,
        format: r.format,
        desktop_path: r.desktop_path,
        mobile_path: r.mobile_path,
        link_url: r.link_url,
      },
      booking: inDate
        ? {
            status: "awaiting_approval",
            source: "admin",
            submitted_at: opts.now,
            starts_on: r.starts_on,
            ends_on: r.ends_on,
            notes:
              `Imported from the old website (legacy slot ${r.legacy_key}), where it was running ` +
              `${r.starts_on} → ${r.ends_on}. Already paid for on the old system — approving raises no invoice.`,
          }
        : null,
    });
  }
  return plan;
}
