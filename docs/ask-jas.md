# Questions for Jas

## Branding & content

6. **Taking published content back down** — the console can now return a published story, video, event or piece of equipment to draft (fix-list 47). It does this silently: the member is not emailed and gets no in-app notification, because there is no wording for it and inventing one felt like your call. Should a member be told when their published content is taken down, and if so what should it say — does it differ between "we're editing this, it'll be back" and "this is coming down for good"?



8. **Your own emails — plain text, or branded like the members'?** You can now edit the wording of every email the site sends, including your own: the daily "N items waiting for you" digest and the four alerts (new enquiry, new signup, member message, change request) — fix-list 63. All five have always arrived as **plain text**, while member emails go out as branded HTML with the SMI header and footer. Templating them made it trivial to switch yours over too, and we deliberately didn't: that's your inbox, and plain text is arguably the better format for something you skim on a phone and act on. **Do you want your five kept as plain text, or rendered like the member emails?** If you want them branded, note they'd need their own wrapper rather than reusing the member one — its footer says "you're receiving this because you have a member account", which isn't true of you. Either way it's small; we just didn't want to change how your morning looks without asking.



12. **Who does a reply to an enquiry come from?** The console can now reply to a
    contact or advertising enquiry properly — the reply is stored against the message,
    shows as a thread, survives a failed send, and goes out branded like every other
    email instead of as bare plain text (fix-list 71b). It sends from `EMAIL_FROM` with
    `EMAIL_REPLY_TO` as the return path, which is the only thing the platform knows.
    **Should a reply instead come from a named person's address** so it reads as being
    from you rather than from the website? That is an account and DNS decision
    (HUMAN-TODO §1.5), not a code one, which is why we have not guessed.

13. **Archiving a member — three consequences you should sign off.** The console can now
    archive a member (fix-list 72): their page becomes admin-only, their byline and the
    link back to them stop appearing on content, and the content itself survives
    untouched. Reversible. Three things fall out of it that are judgement calls:
    - **Does an archived member still count as a member?** There are 123 on production.
      Archived ones are excluded from the public directory and the map, but they are
      still `active` for billing unless you also lapse them, so they still count in the
      console's member total and in the revenue figure. Should archiving imply anything
      about billing, or are the two deliberately independent (which is how it is built)?
    - **A paid placement now stops rendering if its member is archived or lapsed.**
      Previously a Featured Member card kept showing for a lapsed member and linked to a
      page that 404s — a dead link on the homepage. It now renders nothing rather than
      linking nowhere. But if someone has paid for a month and lapses in week three,
      **should their placement run out its paid term or stop with the membership?** We
      chose "stop", because the card is the member. Say the word and it is a one-line
      change.
    - **Should a lapsed member's contact links keep working?** Separate from archiving
      and pre-existing: `/go/<member>` forwards clicks to a member's phone, website and
      email from any old link or cached page, with no status check at all — so a lapsed
      member, whose page already 404s, still receives forwarded enquiries. We fixed the
      archived case and deliberately left lapsed alone, because "does a lapsed member
      keep getting leads" is a commercial question rather than a bug.

14. **Should an archived member still be tagged in social posts?** When a story or video
    is published, the auto-post tags the member's own X/LinkedIn handles. Archiving hides
    them everywhere on the site, but it does not stop that off-site tag — and we left it
    that way, because a handle mention on someone else's platform is not obviously the
    same thing as a link on ours. If "hidden" should mean hidden there too, it is one line.

## Data validation

We'd like you to confirm the lists below are correct and complete before we treat them as final.

### Membership types (fixed list, up to 6 per member)

1. Equipment Supplier
2. Service Provider
3. IT Services
4. Software
5. Training and Education

*Note: the legacy site's equivalent "Sector" field only has 4 options (Trade Association/Events, Service Provider, Equipment Supplier, Subcontractor/OEM) — just 2 of which match this list. Please confirm this 5-item list is the one we should keep, or whether it should be replaced by Sector, by the "Services" list below, or something else entirely.*

### Services (the "Services" filter dropdown on `/find-a-member/`)

Pulled directly from the live "Services" dropdown on `sheetmetalindustries.com/find-a-member/` (55 items) — separate from, and much longer than, the "Membership types" list above:

1. Additive Manufacturing / 3D Printing
2. Assembly
3. Automation / Robotics
4. Bending / Folding / Levelling / Manipulation Machines
5. Bending/ Folding/ Levelling Services
6. Cleaning Equipment
7. Coil Processing / Cut to length lines / Slitting / Blanking lines
8. Cold Forming Machines
9. Cold Forming Services
10. Consultancy Services
11. Consumables
12. Coolants / Oils / Lubricants / Chemicals
13. Cutting Systems - Laser / Plasma / Waterjet / Oxyfuel
14. Design & Prototyping Services
15. EDM – Electro Discharge Machining
16. Equipment Hire Specialists
17. Equipment Servicing / Maintenance / Repair / Installation
18. Factory Equipment
19. Financial Services (Leasing / Asset Financing / Risk Management / Tax Incentives and Funding)
20. Finishing - Polishing/ Powder Coating / Painting/ Tool Coating
21. Forging
22. Forming
23. Grinding / Lapping / Polishing
24. Inspection / Test & Measurement
25. IT Services
26. Laser / Part Marking Equipment
27. Laser Profiling/ Plasma/ Waterjet/ Oxyfuel Cutting
28. Material / Sheet Handling / Storage Systems
29. Material Handling Equipment
30. Materials Suppliers (Metals / Composites / Exotics)
31. Power Presses / Stamping (Low & High Speed)
32. PR / Marketing Service Providers
33. Press Brake/ Guillotine/ Nibbling/ Notching Services
34. Press Brakes / Guillotines / Nibbling / Notching/ Ironworkers
35. Press Tools / Punches, Tool & Die
36. Press Works / Stamping Services
37. Presses / Stamping
38. Product Design / Research and Development
39. Punching / Hole Making
40. Quality Control - Inspection / Testing / Measurement/ Air Filtration
41. Recruitment Services
42. Roll Forming / Plate Rolling
43. Sawing Technology
44. Software CAD / CAM / ERP
45. Surface Finishing / Deburring / Grinding / Heat treatment
46. Tool & Die
47. Tool and Die
48. Tool Storage / Vending
49. Tooling / Press Tools / Punches and Dies
50. Trade Association/ Events
51. Training / Education Providers
52. Tube Bending and Pipe Fabrication
53. Tube Bending/ Manipulation Services
54. Welding / Joining / Fastening
55. Workholding

*Note: several entries look like near-duplicates added at different times (e.g. "Tube Bending and Pipe Fabrication" vs. "Tube Bending/ Manipulation Services", "Tool & Die" vs. "Tool and Die"). Please confirm which of each pair is current, and whether this full 55-item list should carry over as-is or be consolidated.*


### Industries (one per member — and now one per story, video and event too)

1. Automation & Robotics
2. Fabrication
3. Finishing & Coating
4. Laser Cutting
5. Machinery Sales
6. Press Brakes
7. Service & Maintenance
8. Software
9. Tube Bending
10. Welding

*Note: "Software" appears in both the membership types and industries lists — worth checking that's intentional and not a naming collision.*

*Note (9 Sep): this list has **no source in the WordPress data**. Checked the
export and the original database dump — the only member taxonomies there are
`best-service` (the 69-term Services list above) and `best-level` (the 4-option
legacy Sector field). There is no `industry` taxonomy and no ACF field, so
~~whatever drives the live industry bar lives outside the database~~. Until Jas
confirms, dev seeds derive each member's industry from their Services tags
(`scripts/lib/industry-map.ts`, ~93% resolve). Validating this is item 1.1 in
[`GO-LIVE.md`](GO-LIVE.md).*

*Correction (24 Sep): there is no live industry bar. Searched the deployed
`Sprout` theme, the git checkout and all 42 ACF field groups for any of the ten
slugs — zero hits in any PHP, Twig, JS or JSON. The only member taxonomies
registered anywhere are `best-service` and `best-level`
(`classes/Best/Setup.php:219-248`); `/find-a-member` filters on exactly those
two, `/news` filters on `post_tag`, and `sheetmetalindustries.com/tag/laser-cutting/`
returns 404. Of the ten slugs only `automation-robotics` exists as a real term.*

***So the 10 Industries are a new-product invention, not a legacy artefact.***
*There is nothing to migrate, nothing to observe on the live site, and no legacy
rule to recover — which means the assignment is a product decision, not a data
question, and `industry-map.ts` is the only thing that will ever produce one.
Two questions for Jas follow from that:*

1. *Is the derived industry right for each member? A review sheet (member,
   derived industry, the Services tags it came from) is the fastest way to
   confirm or correct 123 rows.*
2. *Stories need an industry too, and inheriting from a linked member covers only
   ~24% of the 1,992 even after the member-link fix. The plan is to map the ~35
   news Topics onto the 10 Industries — a second inferred mapping on top of the
   first, so it needs Jas's eyes before launch rather than after.*

*Note (10 Sep): these 10 are now their own `industries` table, inserted by
migration `20260909000002` and editable at `/console/industries` — they used to
be a discriminated subset of `categories`, which is what let a bad seed put 69
service names in the industry bar. News, videos and events also carry their own
`industry_id` now rather than inheriting one through their member, so an
editorial story with no member can still be filed under an industry. The three
member lists in this document remain three genuinely separate things.*

### Topics (the live "Topics" filter on `/news/`, used for tagging news stories)

Pulled directly from the "Topics" dropdown on `sheetmetalindustries.com/news/`:

1. Additive Manufacturing/ 3D Printing
2. Associations/ Events
3. Automation / Robotics
4. Bending / Folding / Levelling / Manipulation Machines
5. Castings
6. Coil Processing
7. Cold Forming Machines
8. Coolants / Oils / Lubricants / Chemicals
9. Cut to length lines / Slitting / Blanking lines
10. Cutting Systems – Laser / Plasma / Waterjet / Oxyfuel
11. EDM – Electro Discharge Machining
12. Education/ Apprenticeships
13. EQUIPMENT SERVICING / MAINTENANCE / REPAIR / INSTALLATION
14. Financial Services
15. Forging
16. Industry News
17. Inspection / Testing / Measurement
18. Laser / Part Marking Equipment
19. Material / Sheet handling/ Storage Systems
20. Material Handling Equipment
21. Powder/ Paint Coating
22. Power Presses / Stamping (Low and High Speed)
23. PR/Marketing
24. Press brakes / Guillotines / Nibbling / Notching / Ironworkers
25. Punching / Hole Making
26. Roll forming / Plate Rolling
27. rolls
28. Sawing Technology
29. Software CAD / CAM / ERP
30. Surface Finishing / Deburring/ Grinding/ Heat treatment
31. Tool Storage/ Vending
32. Tooling / Press Tools / Punches and Dies
33. Tube Bending and Pipe Fabrication
34. Welding / Joining / Fastening
35. Work Holding

### Member logins — 2,517 accounts whose company no longer exists

*Note (24 Sep): blocking the account migration. The old site has **2,639 user
accounts**, 2,634 of them with the `member-owner` role, and every one carries a
`member_id` pointing at a member company. But **only 117 of those still resolve
to a real member post** — the other **2,517 point at companies that have been
hard-deleted from WordPress**. There are no trash rows and no tombstones, so the
dump cannot say whether that was deliberate housekeeping or something lost in a
past migration.*

*What this means practically: the genuine login surface is **117 accounts**, not
2,634 — small enough to migrate and eyeball before any invitation is sent. All
2,639 email addresses are distinct, so nothing needs de-duplicating. WordPress
passwords are bcrypt and cannot move to Supabase Auth in any case, so every
migrated member gets a password-reset invitation rather than a carried-over
password.*

**Question for Jas: were those 2,517 companies removed on purpose?** *Those
people can still log in to the old site today and own nothing. Until this is
answered they get no account on the new platform — inviting 2,517 people who are
not members would be far worse than inviting none.*


