1. [x] advertize page should include example images and bundle — per-format example upload on `/console/adverts/spots`, rendered on `/advertising`; Bundles card added (bespoke, points at the contact form)


24. [x] on admin messages, allow admin to reply from within the application. add fields to edit the subject (from suggested), write message and send from resend. — in-app reply form on `/console/messages/[id]` (subject prefilled, body free text), sent via the existing `getEmailSender()`/Resend adapter

26. [x] member search on admin area should match name, description or email — `/console/members` search now `.or()`s across all three, matching the public directory's existing pattern
27. [x] remove advert from public member page — dropped the `ad_banner` block from the `member_profile` default layout (code + the live DB row); prod's equivalent `page_layouts` row needs the same edit, HUMAN-TODO
28. [x] on member's public page includes a logo of the member in a prominent position. Include the member highlight image as well and the list of services. If there's one YouTube video link display it big down the page, if there's more than one, display a carousel below the member news. — logo now overlaps the hero (112px, white ring); services render as pills under the name; video is its own full-width section below member news (new `profile_video` layout anchor). Multi-video carousel not built — `video_url` is a single column and nothing in the app lets a member add more than one; noted in GAPS.md as a follow-up needing a schema change.
29. [x] The map on the members page is broken. — investigated: it isn't. Renders and works correctly in the browser (pins, zoom, popups); the only issue is 4 harmless dev-mode-only console errors from a known React StrictMode + react-leaflet interaction (double-invoked effects, dev only) — confirmed absent in a production build. Left as is rather than disabling StrictMode app-wide for it; flag if this was seen as an actual visible failure rather than a console error.
30. [x] In the member area, on the content page, skip the initial page with the big icons and cards. Go straight to Story and the tabbed version. — `/dashboard/content` hub removed; both nav entries ("Add content") now point straight at `/dashboard/story/new`, which already carries the Story/Video/Event tab strip

32. [x] In the member area, when creating a story, make the cover image mandatory. — required client-side (unless a cover already exists, so a resubmit isn't blocked) and enforced again in `submitStory`/`editStory` server-side
33. [x] When a visitor filters the All News section, reload. scroll to that section of the page, not the top of the page. Better yet, if you're able to do a full reload of the entire page — every filter/pagination control on `/news` now targets `#all-news` (a real full-page GET reload, landing scrolled to that heading). Dates were the odd one out: the "Apply dates" form kept `#all-news` in the URL but Safari doesn't scroll to a fragment after a GET form submit (Chrome does) — a small `ScrollToHash` client component on `/news` now does that scroll on load, verified in WebKit.
34. [x] On member's dashboard, You can see all notifications in the notification box, but we don't have a similar notification on Submissions. Include one, please. — "Your submissions" heading now carries the same count badge as "Recent updates"
35. [x] Let's reorganise the members dashboard cards. The new order is:
        1. Add content
        2. Advertising
        3. Statistics
        4. Your page
        5. Help
        6. Settings
    — done; Help and Settings are new cards (new `IconHelp`/`IconSettings`), Settings replaces the old Billing-only card (Billing is a tab inside it)
- Copy the text wording and structure of the Contact Us page from the live website to our working version. 
- Copy the featured machine from live so that we have a seed. 