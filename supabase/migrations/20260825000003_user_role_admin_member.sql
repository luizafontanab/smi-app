-- Collapse the role model to two roles: admin (renamed from super_admin) and
-- member. approver/viewer were defined but never assigned to any account;
-- input_only (media@smi.local's restricted draft-only console access) is
-- superseded by the member self-service draft flow at /dashboard/story/new
-- (member_insert_story RLS policy, insert-only, no approve path) — so any
-- account on one of those three roles is promoted to admin rather than left
-- on a role that's about to stop existing.

alter type user_role rename value 'super_admin' to 'admin';

update profiles set role = 'admin' where role in ('approver', 'viewer', 'input_only');

alter type user_role rename to user_role_old;
create type user_role as enum ('admin', 'member');
alter table profiles alter column role drop default;
alter table profiles alter column role type user_role using role::text::user_role;
alter table profiles alter column role set default 'member';
drop type user_role_old;
