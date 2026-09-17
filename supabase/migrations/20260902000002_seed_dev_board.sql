-- First seed of the dev board: one high-level card per area of the app, all
-- in the testing column — that is where the project stands, and the board
-- should say so in production too (scripts/seed-real.ts deliberately never
-- touches dev_tasks, so the live board is empty until this).
--
-- These are starting points, meant to be edited/split/reassigned by hand on
-- /console/dev afterwards. Idempotent the same way the ad-slot seeds are
-- (20260811000002): dev_tasks has no natural key, so the rows carry fixed
-- uuids and re-running is a no-op. kind stays null (board-created, not
-- widget-reported), assignee stays null, priority takes the default.
insert into dev_tasks (id, title, description, status, priority, sort_order) values
  ('e5b1a1c0-0001-4000-8000-000000000001', 'Homepage',
   'Both variants (forge/grid), hero + pinning, ad slots, featured members, takeover theming.',
   'testing', 'medium', 0),
  ('e5b1a1c0-0001-4000-8000-000000000002', 'Public content pages',
   'News, videos, events, search, static/content pages, cookie consent.',
   'testing', 'medium', 1),
  ('e5b1a1c0-0001-4000-8000-000000000003', 'Public member directory & profiles',
   'Directory list/map/filters, member pages, backlinks, outbound click tracking.',
   'testing', 'medium', 2),
  ('e5b1a1c0-0001-4000-8000-000000000004', 'Join & auth',
   'Signup funnel, payment step, promo codes, password reset, login/logout.',
   'testing', 'medium', 3),
  ('e5b1a1c0-0001-4000-8000-000000000005', 'Member area — profile & page',
   'Profile form, geocoding, page blocks, revision approval flow.',
   'testing', 'medium', 4),
  ('e5b1a1c0-0001-4000-8000-000000000006', 'Member area — content submission',
   'Stories, videos, events and machines: submit, edit, withdraw, approval notifications.',
   'testing', 'medium', 5),
  ('e5b1a1c0-0001-4000-8000-000000000007', 'Member area — billing & membership',
   'Pay, invoices + PDFs, cancellation, grace/lapse transitions.',
   'testing', 'medium', 6),
  ('e5b1a1c0-0001-4000-8000-000000000008', 'Member area — stats, notifications & resources',
   'Stats page and trends, notification feed + preferences, resources library.',
   'testing', 'medium', 7),
  ('e5b1a1c0-0001-4000-8000-000000000009', 'Admin — content & publishing',
   'Story/video boards, scheduling, pinning, categories, media library, page layouts.',
   'testing', 'medium', 8),
  ('e5b1a1c0-0001-4000-8000-000000000010', 'Admin — adverts & inventory',
   'Bookings, bundles, takeover, featured member, rates & invoicing, interest requests.',
   'testing', 'medium', 9),
  ('e5b1a1c0-0001-4000-8000-000000000011', 'Admin — newsletter',
   'Composer, issue editing, ad slots, preview, send/failure states.',
   'testing', 'medium', 10),
  ('e5b1a1c0-0001-4000-8000-000000000012', 'Admin — members, CRM & operations',
   'Member editor, comps/promo codes, CRM, inbox, analytics, console dashboard.',
   'testing', 'medium', 11)
on conflict (id) do nothing;
