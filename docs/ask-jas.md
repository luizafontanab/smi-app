# Questions for Jas

## Branding & content

1. **Advertise submenu** — should this live under *Content* or under *Members*?
2. **Logo colour vs. brand guide** — the site's logo colour and the "Pantone® Orange 021" specified in the branding guide don't match. Which one takes precedence?
3. **Phone number format** — should the field accept extensions, or only a standard phone number?
4. **Ad placement** — which pages should *not* carry adverts?
5. **News sorting** - should we stick with "topics" or use "categories"?

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


### Industries (one per member, shown on the industry bar and `/industry/*` pages)

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


