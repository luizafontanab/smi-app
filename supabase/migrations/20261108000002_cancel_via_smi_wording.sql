-- Members ask SMI to cancel (#91, parent #89; Jas feedback item 24: "if
-- people wish to cancel they should communicate to me directly").
--
-- The member area no longer has a cancel button, so the live Terms and FAQ
-- must stop promising one. Those pages live in static_pages and are editable
-- in the console, so the seed change (scripts/lib/static-page-content.ts)
-- alone never reaches a database that is already seeded. This rewrites the
-- three sentences that promise self-service cancelling:
--
--   · membership-terms, "Cancelling": "You can cancel at any time from your
--     member area." → "… by contacting us." The rest of the paragraph stays.
--   · faq, "How do I update or cancel my membership?": self-service keeps
--     details, password and invoices; "To cancel, contact us."
--   · faq, "Where are my invoices?": drops "or cancel from the same page".
--
-- Each replace is of the exact original sentence, and only where that sentence
-- is still present, so wording Jas has already changed in the console is left
-- alone. A sentence that isn't found raises a NOTICE naming it, so `supabase db
-- push` shows which page needs a look by hand. The Join page's "cancel
-- anytime" is component copy, not a static page, and is unchanged.
--
-- Data only, no schema change. Idempotent: once rewritten, the original
-- sentence is gone, so a second run updates nothing (and says so).

do $$
declare
  r record;
begin
  for r in
    select *
      from (values
        ('membership-terms',
         'You can cancel at any time from your member area.',
         'You can cancel at any time by contacting us.'),
        ('faq',
         'Everything is self-service from your member area under Settings — update your details, change your password, view invoices, or cancel.',
         'Everything is self-service from your member area under Settings — update your details, change your password or view invoices. To cancel, contact us.'),
        ('faq',
         'You can update your details or cancel from the same page.',
         'You can update your details.')
      ) as t(slug, old_text, new_text)
  loop
    update static_pages
       set body = replace(body, r.old_text, r.new_text),
           updated_at = now()
     where slug = r.slug
       and position(r.old_text in body) > 0;

    if not found then
      raise notice 'static_pages %: original sentence not found, left as is: %', r.slug, r.old_text;
    end if;
  end loop;
end
$$;
