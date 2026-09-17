-- Services as their own taxonomy. The live site has three distinct member
-- lists (docs/ask-jas.md): Industries (10, exactly one per member — that's
-- `categories` kind='member' + members.category_id), Services (the ~55-item
-- "Services" filter on /find-a-member, many per member — this table), and
-- Membership types (5, up to 6 per member — 20260904000001).
--
-- Services had no home before this, so seed-real.ts was writing them into
-- `categories` kind='member' and calling them industries, which is why the
-- industry bar rendered 69 service terms.
--
-- Rows are NOT inserted here, unlike membership_types: the vocabulary comes
-- from the WordPress export's `best-service` taxonomy, so the seed owns it.
create table services (
  id serial primary key,
  slug text not null unique,
  name text not null
);

create table member_services (
  member_id uuid not null references members(id) on delete cascade,
  service_id int not null references services(id) on delete cascade,
  primary key (member_id, service_id)
);
create index member_services_service_idx on member_services (service_id);

alter table services enable row level security;
alter table member_services enable row level security;
create policy public_read_services on services for select using (true);
create policy public_read_member_services on member_services for select using (true);
