-- Terms pages: take every "[SMI TO CONFIRM …]" marker off the public pages, and
-- state that no refund is given when SMI ends a membership.
--
-- Decided 9 Nov 2026: placeholders never go on public pages. The open
-- questions behind these markers now live in docs/ask-jas.md (item 35); each
-- page says only what is true today. Follows 20261109000001, which removed the
-- pro-rata refund placeholder. Same change in the seed source,
-- scripts/lib/static-page-content.ts.
--
--   · terms: company details, limitation-of-liability and governing-law markers
--   · membership-terms: the VAT marker; "Ending membership from our side" now
--     says "No refund is given for the rest of the period you have paid for."
--     in place of the promise to refund the unused part
--   · advertising-terms: the artwork-deadline and cancellation-window markers
--
-- Each replace is of the exact seeded text, and only where it is still present,
-- so wording changed in the console is left alone. Text that isn't found raises
-- a NOTICE naming it. Afterwards, any page that still contains "SMI TO CONFIRM"
-- (a hand-edited marker this can't match) raises a WARNING naming the page, so
-- `supabase db push` shows what needs removing by hand.
--
-- Data only, no schema change. Idempotent: a second run finds nothing to
-- replace and changes nothing.

do $$
declare
  r record;
  leftover record;
begin
  for r in
    select *
      from (values
        ('terms',
         ' [SMI TO CONFIRM: registered company name, company number and registered office address.]',
         ''),
        ('terms',
         ' [SMI TO CONFIRM: a solicitor should settle the full limitation-of-liability wording before this page is published.]',
         ''),
        ('terms',
         ' [SMI TO CONFIRM.]',
         ''),
        ('membership-terms',
         ' [SMI TO CONFIRM: whether £40 is inclusive of VAT or plus VAT. This figure also appears in the FAQ and at the point of sale and must read the same in all three places.]',
         ''),
        ('membership-terms',
         'Where we do, we will refund the unused part of the period you have paid for.',
         'No refund is given for the rest of the period you have paid for.'),
        ('advertising-terms',
         ' [SMI TO CONFIRM: the deadline. The platform does not enforce one, so this needs to be a number you are willing to hold advertisers to.]',
         ''),
        ('advertising-terms',
         ' [SMI TO CONFIRM: the cancellation window and whether any part of a cancelled run is refundable.]',
         '')
      ) as t(slug, old_text, new_text)
  loop
    update static_pages
       set body = replace(body, r.old_text, r.new_text),
           updated_at = now()
     where slug = r.slug
       and position(r.old_text in body) > 0;

    if not found then
      raise notice 'static_pages %: text not found, left as is: %', r.slug, r.old_text;
    end if;
  end loop;

  for leftover in
    select slug from static_pages where position('SMI TO CONFIRM' in body) > 0
  loop
    raise warning 'static_pages %: still contains "SMI TO CONFIRM"; remove it by hand in the console', leftover.slug;
  end loop;
end
$$;
