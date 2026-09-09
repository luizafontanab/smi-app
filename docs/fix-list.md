1. [x] advertize page should include example images and bundle — per-format example upload on `/console/adverts/spots`, rendered on `/advertising`; Bundles card added (bespoke, points at the contact form)
24. [x] on admin messages, allow admin to reply from within the application. add fields to edit the subject (from suggested), write message and send from resend. — in-app reply form on `/console/messages/[id]` (subject prefilled, body free text), sent via the existing `getEmailSender()`/Resend adapter
26. [x] member search on admin area should match name, description or email — `/console/members` search now `.or()`s across all three, matching the public directory's existing pattern
29. [x] The map on the members page is broken. — investigated: it isn't. Renders and works correctly in the browser (pins, zoom, popups); the only issue is 4 harmless dev-mode-only console errors from a known React StrictMode + react-leaflet interaction (double-invoked effects, dev only) — confirmed absent in a production build. Left as is rather than disabling StrictMode app-wide for it; flag if this was seen as an actual visible failure rather than a console error.


38. [x] Copy the featured machine from live so that we have a seed. — the WP export has no machine/equipment content type at all, so this couldn't come from the extract like everything else; hand-authored a real row (S1 Laser Punching Machine, Salvagnini UK & Ireland) sourced from the live page, added to `scripts/seed-real.ts` with a real downloaded product photo



- public events page, make the calendar span the entire page width
- add unread notification count to account icon and notification menu
- seed sample images to a few member pages so that we can check sizes and positions. ok to copy from real set.
- membership type doesn't show anywhere in the member area, even for data that cannot be edited, everything must be displayed