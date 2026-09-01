-- Onboarding beyond the draft checklist (GAPS A4.18): OnboardingChecklist
-- vanishes entirely once a member is activated, with nothing guiding a
-- newly-activated member around stats/buy/resources on first arrival.
--
-- Backfilled true for members already past draft: this is a first-arrival
-- nudge, not a retroactive one — an established active/grace/lapsed member
-- should not suddenly see a "welcome" panel the day this ships.
alter table members add column onboarding_seen boolean not null default false;
update members set onboarding_seen = true where status in ('active', 'grace', 'lapsed');
