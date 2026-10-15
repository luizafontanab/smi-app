-- contacts.email holds lowercase, trimmed addresses — made true for rows
-- already there (review follow-up, 16 Oct).
--
-- Every lookup by address is an exact `.eq("email", <lowercased>)`: the
-- newsletter signup and unsubscribe (lib/unsubscribe.ts), the Resend webhook's
-- unsubscribe, the console's add/edit clash checks and the Bigin pull's match.
-- A row stored as "Jo.Bloggs@Example.com" is invisible to all of them — its
-- unsubscribe link finds nobody, and a signup with the same address inserts a
-- second row instead of finding the first.
--
-- Every write path in the app lowercases and trims today (the Bigin pull via
-- biginEmail, the public signup, console saveContact/addContact, both seeds),
-- checked at 12e339b. But rows written before any of those did — or imported
-- by hand — can still be mixed case, and nothing has ever checked. So:
--
--   · normalise_contact_emails() lowercases and trims every address that can
--     be changed without colliding on contacts_email_key, and returns the ones
--     that can't — two rows that are the same address once lowercased. Those
--     are NOT merged: which row's opt-in, Bigin link and history should win is
--     a decision, not a cleanup, so they are reported and left as they are.
--   · This migration runs it once and raises a WARNING per colliding address,
--     naming the rows, so `supabase db push` shows them. HUMAN-TODO carries the
--     query to run before the push, and how to resolve a pair by hand.
--
-- The function stays, service_role only, so the same pass can be re-run after
-- a pair is resolved: `select * from normalise_contact_emails();`.
-- Idempotent.

create or replace function normalise_contact_emails()
returns table (address text, contact_ids uuid[], emails text[])
language plpgsql
security invoker
set search_path = public
as $$
begin
  update contacts c
     set email = lower(btrim(c.email))
   where c.email <> lower(btrim(c.email))
     and not exists (
       select 1 from contacts o
        where o.id <> c.id and lower(btrim(o.email)) = lower(btrim(c.email))
     );

  return query
    select lower(btrim(c.email)), array_agg(c.id order by c.created_at, c.id), array_agg(c.email order by c.created_at, c.id)
      from contacts c
     group by lower(btrim(c.email))
    having count(*) > 1;
end;
$$;

revoke execute on function normalise_contact_emails() from public;
revoke execute on function normalise_contact_emails() from anon, authenticated;
grant execute on function normalise_contact_emails() to service_role;

do $$
declare
  clash record;
begin
  for clash in select * from normalise_contact_emails() loop
    raise warning 'contacts: % rows are the address % once lowercased — left unmerged, resolve by hand: ids %, stored as %',
      cardinality(clash.contact_ids), clash.address, clash.contact_ids, clash.emails;
  end loop;
end;
$$;
