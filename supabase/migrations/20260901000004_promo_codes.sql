-- Comp-via-promo-code admin (GAPS A4.11): promo codes were hardcoded in
-- lib/adapters/payments.ts with no table, console UI, or usage tracking, and
-- shared no storage with the console's manual per-member comp
-- (recordMemberPayment / applyPaymentResult). This table is the shared seam;
-- redemption still goes through applyPaymentResult's existing "comped"
-- branch, so notification/invoice behaviour stays identical either way.
--
-- Console-only, service-role only — no RLS policies, same as media/adverts.
create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  months int not null check (months between 1 and 60),
  active boolean not null default true,
  max_uses int check (max_uses is null or max_uses > 0),
  used_count int not null default 0,
  expires_at date,
  created_at timestamptz not null default now()
);

create index promo_codes_code_idx on promo_codes (code);

alter table promo_codes enable row level security;
-- no policies: console/service-role only.
