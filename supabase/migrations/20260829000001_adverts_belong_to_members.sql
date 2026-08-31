-- Members are the advertisers.
--
-- `advertisers` was an indirection with a nullable member_id ("advertisers need
-- not be members"). In practice every advertiser is a member, so adverts now
-- hang off members directly. Beyond removing a table and a join, this makes
-- every advert's notification recipient unambiguous: notify_member always
-- resolves, so the advert lifecycle needs no nullable-recipient fallback.

-- Guard: "every advertiser is a member" is the assumption that makes the not-null
-- constraints below safe, and advertisers.member_id is nullable (on delete set
-- null), so nothing enforced it. Assert it up front — a violation then fails with
-- a readable message and no DDL applied, rather than a bare not-null error part
-- way through. Verified 0 orphans on the remote before this migration was pushed.
do $$
declare orphan_count int;
begin
  select count(*) into orphan_count from advertisers where member_id is null;
  if orphan_count > 0 then
    raise exception
      'adverts.member_id cannot be NOT NULL: % advertiser row(s) have no member_id. Assign each one a member (or delete the advertiser and its adverts) before running this migration.', orphan_count;
  end if;
end $$;

alter table adverts add column member_id uuid references members(id) on delete cascade;

update adverts a
   set member_id = ad.member_id
  from advertisers ad
 where ad.id = a.advertiser_id;

alter table adverts alter column member_id set not null;
create index adverts_member_idx on adverts (member_id);
alter table adverts drop column advertiser_id;

-- bundles hang off the same owner
alter table bundles add column member_id uuid references members(id) on delete cascade;

update bundles b
   set member_id = ad.member_id
  from advertisers ad
 where ad.id = b.advertiser_id;

alter table bundles alter column member_id set not null;
alter table bundles drop column advertiser_id;

drop table advertisers;
