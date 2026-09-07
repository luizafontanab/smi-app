-- Fix-list: membership-type tags (GAPS A8.1). Distinct from `categories`
-- (a single industry per member, e.g. "Laser Cutting") — this is the live
-- site's separate fixed list of up to 6 tags per member, picked at signup
-- and filterable on the public directory.
create table membership_types (
  id serial primary key,
  slug text not null unique,
  name text not null,
  sort_order int not null default 0
);

create table member_membership_types (
  member_id uuid not null references members(id) on delete cascade,
  membership_type_id int not null references membership_types(id) on delete cascade,
  primary key (member_id, membership_type_id)
);
create index member_membership_types_type_idx on member_membership_types (membership_type_id);

alter table membership_types enable row level security;
alter table member_membership_types enable row level security;
create policy public_read_membership_types on membership_types for select using (true);
create policy public_read_member_membership_types on member_membership_types for select using (true);

insert into membership_types (slug, name, sort_order) values
  ('equipment-supplier', 'Equipment Supplier', 1),
  ('service-provider', 'Service Provider', 2),
  ('it-services', 'IT Services', 3),
  ('software', 'Software', 4),
  ('training-education', 'Training and Education', 5);
