/**
 * The "not vetted sales leads" disclaimer both lead-gen panels must carry
 * (USE-CASES gap 24, TECH-DECISIONS #16 — Jas's 18 Sep guardrail). One
 * component so the console and the member area can never say different things.
 *
 * ⚠ DRAFT WORDING. Jas wants sign-off on the exact phrasing, not just the idea,
 * before this ships even as a mock — see docs/ask-jas.md. Change it here only.
 */
export const LEADS_DISCLAIMER_HEADING = "Not vetted sales leads.";
export const LEADS_DISCLAIMER_BODY =
  "These are people whose publicly available professional details — the job title, company and contact routes they published themselves — matched the business profile searched for. Nobody listed here has asked to be contacted.";

export function LeadsDisclaimer() {
  return (
    <p role="note" className="mt-3 rounded border border-graphite/30 bg-white p-3 text-sm text-ink">
      <strong>{LEADS_DISCLAIMER_HEADING}</strong> {LEADS_DISCLAIMER_BODY}
    </p>
  );
}
