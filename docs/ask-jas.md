# Questions for Jas

## Branding & content

1. **Advertise submenu** — should this live under *Content* or under *Members*?
2. **Logo colour vs. brand guide** — the site's logo colour and the "Pantone® Orange 021" specified in the branding guide don't match. Which one takes precedence?
3. **Phone number format** — should the field accept extensions, or only a standard phone number?
4. **Ad placement** — which pages should *not* carry adverts?
5. **News sorting** - should we stick with "topics" or use "categories"?
6. **Taking published content back down** — the console can now return a published story, video, event or piece of equipment to draft (fix-list 47). It does this silently: the member is not emailed and gets no in-app notification, because there is no wording for it and inventing one felt like your call. Should a member be told when their published content is taken down, and if so what should it say — does it differ between "we're editing this, it'll be back" and "this is coming down for good"?

7. **Member directory — the landing view is now a word map.** `/member` used to open on a grid of logo-led tiles. It now opens on a "Cloud" view: every matching member's **name** scattered across the page, featured members large and orange, everyone else small and black, with the member's logo appearing on hover (first tap on a phone). The tile list is still there on the **List** toggle, and the geographic **Map** is unchanged, so nothing has been removed — but the first thing a visitor sees is names, not logos. This is a deliberate change we were asked for, and it cuts against two things you told us on 19 Aug: that the directory should be "logo-led" and "put the client's logo first" (`USE-CASES.md` V7), which is what GAPS A6.5 was closed on. **Is the word map the right default, or should `/member` open on the logo-led List with Cloud as the opt-in view?** It is a one-line change either way.

8. **Your own emails — plain text, or branded like the members'?** You can now edit the wording of every email the site sends, including your own: the daily "N items waiting for you" digest and the four alerts (new enquiry, new signup, member message, change request) — fix-list 63. All five have always arrived as **plain text**, while member emails go out as branded HTML with the SMI header and footer. Templating them made it trivial to switch yours over too, and we deliberately didn't: that's your inbox, and plain text is arguably the better format for something you skim on a phone and act on. **Do you want your five kept as plain text, or rendered like the member emails?** If you want them branded, note they'd need their own wrapper rather than reusing the member one — its footer says "you're receiving this because you have a member account", which isn't true of you. Either way it's small; we just didn't want to change how your morning looks without asking.

*Note (13 Sep): a member can now see their own published content in the member area and ask for a change to it (fix-list 51), so they will notice when something disappears. That makes the question above more pressing than it was.*

*Note (13-14 Sep): the Services list below is now picked from by **both** members (`/dashboard/profile`) and Jas (`/console/members/[id]`) — fix-list 43 and 52. So a wrong or duplicated term now gets **used**, not just displayed, which makes settling this list more urgent than the others.*

*Note (14 Sep): assigning services to a member is done (GO-LIVE §3.2, ticked). What still does not exist is a screen for editing the **vocabulary itself** — adding, renaming or removing a service — the way `/console/industries` and `/console/categories` allow for theirs. Until that is built, changing this list means a migration or a seed run, so it is worth getting right once rather than iterating.*

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
whatever drives the live industry bar lives outside the database. Until Jas
confirms, dev seeds derive each member's industry from their Services tags
(`scripts/lib/industry-map.ts`, ~93% resolve). Validating this is item 1.1 in
[`GO-LIVE.md`](GO-LIVE.md).*

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


