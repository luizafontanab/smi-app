1. [x] advertize page should include example images and bundle — per-format example upload on `/console/adverts/spots`, rendered on `/advertising`; Bundles card added (bespoke, points at the contact form)
8. [x] edit pages prompt when moving out without saving — `UnsavedChangesGuard` in 16 console + dashboard edit forms (beforeunload + internal-link confirm; no timers)
9. [x] news page sections with horizontal carousels — Latest / Member news / For you (viewed-categories cookie, consent-gated; popular-last-30-days fallback), then search + filters + paginated All news
11. [x] news category pills = industries; categories into combobox — industry filter joins through the author member's category
12. [x] news filtering by date range — from/to date inputs bounding `published_at`
13. [x] policies page collapsible sections — per-page "Collapsible sections" toggle (`content_pages.collapsible`, migration `20260903000001`), headings become `<details>`; prod toggle is HUMAN-TODO 10.3
14. [x] typing return on password should log in — did not reproduce in any browser/timing (JS off included); cause pinned to password-manager overlay on unattributed fields; `autocomplete="email"/"current-password"` added. Shout if it still happens and name the browser.
15. [x] logo always goes to the homepage — member area and console logos now link `/`
16. [x] member area nav "overview" → "Dashboard"
17. [x] same account icon everywhere — avatar `AccountMenu` now in public, member and console headers
18. [x] admin link to public side removed — the logo does this job
19. [x] member billing inside settings — `/dashboard/settings/billing`; old `/dashboard/billing` redirects
20. [x] *(added in chat)* member Add content + Settings tabbed like advertising — shared `SectionTabs`; Settings = Notifications | Security | Billing, content forms = Story | Video | Event (hub keeps its cards)
- make content pages at routes /page/smth have a wider main area
- on the events page, create a side bar, move the calendar to the side bar. the list should come before the map. the list should be filterable by event type, as well as include a search bar. 
- member cards on member page make the logo bigger than it is today. give a little bit more room between featured members and what's below. include a header of "all members" just above the search bar. include a combo box for services as well. fix category combo box only allowing one selection.
- on admin messages, allow admin to reply from within the application. add fields to edit the subject (from suggested), write message and send from resend.