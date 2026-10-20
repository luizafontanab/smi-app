<!--
  What's new — shown to admins only, at /console/releases.

  Newest first. Each release is a heading followed by bullet points:

    ## YYYY-MM-DD — Short title
    - One plain-language sentence per change.

  Only headings, bullets, blank lines and comments like this one are allowed;
  anything else fails `pnpm check` (tests/unit/release-notes.test.ts).
-->

## 2026-10-20 — Story sources, in place of ChangeTower
- There's a new "Story Sources" page under Content. It holds your list of company news pages and checks each one once a day for articles that weren't there before.
- New articles appear under "Suggested". "Start story" turns one into a draft titled after the article and opens it in the Story Engine, with a link back to the original; "Dismiss" hides it for good.
- Nothing is published automatically. A started story is an ordinary draft and goes through approval like any other.
- The first check of each site only notes what's already there, so suggestions begin from the day after.
- About four in five of the sites can be read automatically. The rest are listed under filters such as "Blocked" and "News page gone", where you can change a page's address, pause a site or remove it.

## 2026-10-20 — Ready to review, then schedule
- "Awaiting approval" is now called "Ready to review" for stories and videos, in the console and on members' "Your content" page; "Published" is now "Live" and "Rejected" is "Sent back" everywhere in the Story Engine.
- A draft story or video now has an optional "Mark ready to review" button, for a final check before it is scheduled; you can still schedule a draft straight away.
- On a story or video that is ready to review, the main button is now "Approve & schedule" with a date and time; "Approve & publish now" is still there for urgent ones.
- "Not yet" on your own story or video puts it back to draft without emailing anyone; before this, the company it featured could be emailed that "their" story had been sent back.
- A member's own story or video is still sent back with a reason, which they see.

## 2026-10-20 — A record of who accessed member accounts
- Each member's console page has a new "Admin access" box listing every time an admin viewed as that member or changed their record, with who and when.
- Sign-ins, password and login-email changes are now recorded too, for security; they're kept for 12 months and can't be edited or deleted by anyone using the console.
- Visitor statistics now identify visitors in a way that can't be traced back to them; as a one-off, "site users this year" on the Command Centre will read higher until the year rolls past this change.

## 2026-10-16 — See any member's dashboard as they see it
- A member's console page now has a "View as member" link that opens their own dashboard, with their stats, leads, content, adverts, invoices and settings exactly as they see them.
- While you're viewing as a member nothing can be changed: a grey "Admin view" bar sits at the top of every page, anything you try to save is turned away with a note saying so, and "Back to console" takes you back to that member.
- Each member's console page also shows when their login last signed in, or "Never"; this updates when they sign in, not every time they visit, so someone who stays logged in can show an older date.

## 2026-10-16 — Safer approvals and invoices
- When you review a member's page edit, the console now lists exactly what will change, and approving it only applies the fields a member is allowed to edit.
- The Command Centre card is now "Page edits to review" and takes you to the member, so you see the changes before you approve them.
- A priced booking, banner, supplier logo, bundle, Featured Member slot or takeover with no invoice now has a "Raise invoice" button, and changing the price re-issues the invoice.
- Featured Member slots and takeovers that are waiting for payment can now be cancelled from their edit page.
- The revenue figure on the Command Centre now counts invoices actually paid this month, with what is still unpaid shown beside it.
- Upload fields now show progress, and the Save button waits until the upload has finished; larger files (over 4.5 MB) are built to go through, and will be checked on the live site after the next deploy.
- Rotating banners now have a pause button beside the dots.
- The newsletter list sync now sends every subscriber to the mailing service, not just the first 1,000, and takes off addresses that are no longer subscribed.

## 2026-10-15 — Story Engine changes from your 13 October feedback
- Uploading an image into a story now shows a spinner, and if it fails the reason appears right there; you can't save halfway through an upload.
- Adverts on phones are smaller on story pages, and adverts everywhere can be swiped.
- "View on our socials" on a story now links to SMI's own post of that story: paste the LinkedIn, Facebook and X links into the three new fields on the story, and any left empty link to SMI's page on that network.
- Preview now shows the story exactly as it will look when published.
- Members can save a story as a draft and come back to it before sending it for approval.
- A story can now tag several members, and it appears on every tagged member's profile and in their stats.
- Tagged members show as logo tiles in a sidebar beside the story, and the story text is wider on desktop.
- Each featured member gets a closing line at the end of the story with their company name in orange capitals, linking to their website.
- Images in every text editor can be placed left, right or centre and sized, with the words flowing around them.
- Pinning a story to the headline is now its own optional step, separate from approval, and the days box no longer starts filled in.
- The story editor now has a clear Publishing section showing the story's status.
- "Excerpt" is now called "Summary"; the editor explains where it appears, and a story left without one uses its first lines instead.

## 2026-10-12 — Your ten industries
- Your ten industries replace the old list across the site.
- A member can now belong to several industries, with one marked as primary.
- Every member, story, video and event takes its industry from your mapping of services and news topics.
- Industry pages have new web addresses to match the new names.

## 2026-10-06 — Adverts & Banners reorganised
- The Story Engine has a third view, List, showing every story in every status, including rejected and withdrawn ones.
- Featured Member slots and takeovers can now be edited after they are added, and saving a bundle now confirms "Saved."
- The rate card is gone: each booking now has its own price, and when you approve a member's advert request you set the price there.
- A new Supplier Logos page lets you book a supplier logo in one form: member, logo, link, dates and price.
- "Inventory" is now called "Banners", and the section is "Adverts & Banners".
- Members will be able to pay advert invoices online, and a priced advert waits until it is paid; this switches on once Stripe is set up, and until then invoices work as before and you can mark one paid by hand.

## 2026-10-04 — Banner carousel and tidier news topics
- Each banner position on the site now rotates through three adverts.
- Because more adverts are shown, impression figures will rise from the next deploy, even though an impression is counted exactly as before.
- Eight junk news topics carried over from WordPress were removed.
- The site now uses the Grid design throughout, and the design switcher has been switched off.

## 2026-09-28 — Members, directory and FAQ
- Members can choose up to six membership types themselves; on a live page the change waits for your approval.
- Filters on the Find a Member page now narrow each other, and member search also matches services and industry.
- Videos are now YouTube links only, and any YouTube link works.
- A member's page now plays their company video, followed by their published SMI videos.
- Members' dashboards show a Content reach chart broken down by type.
- Member news now appears in the More News carousel on the homepage.
- The Featured Machine page can show a video and the seller's logo.
- The FAQ is grouped by topic with seven new answers, and Policies and Membership terms open as collapsible sections.
- Members have a new Assets tab in their Advertising area.
- You now get a notification when a member edits a page that is already live.
- The "Homepage sections" card under Pages sets the order of the homepage sections below the fold, and which ones show.
- Advert impressions are now counted for every visitor, anonymously for anyone who declined cookies; clicks and page views still need consent.

## 2026-09-25 — Console tidy-up
- Messages and notifications are now separate: messages are things people sent you that need a reply, and notifications link straight to the item they are about.
- The Command Centre inbox shows messages only, and the Notifications page filters by Messages or Notifications, then by type.
- Replies to an enquiry are now kept, shown under the original message and marked "replied", and they go out in the same branded email as everything else.
- Members can be archived, restored or deleted from the Danger zone on the member editor, and the members list has an Archived filter.
- The story, video, event and equipment editors now confirm "Saved" and say what is missing when a save can't go through.
- The adverts pages show errors when a booking is refused, list Bundles, Homepage takeover and Featured Member in the menu, open on current work rather than old bookings, and show impressions.

## 2026-09-25 — Content recovered from the old website
- Stories are now linked to the members they mention: 485 stories have a member attached, up from 41. One story can name several members.
- Event locations and event types (exhibition, open house) came across from the old website.

## 2026-09-22 — Publish events from the console
- Events you add in the console can now be published. Before, they stayed stuck in draft and never appeared on the site.
- Change an event's status from the event editor, or drag it across the events board.
- The Terms pages and FAQ answers are written, and Terms is linked in both footers. A few clauses are marked [SMI TO CONFIRM] and are waiting for your wording.
- If the console cannot load a list, it now shows an error instead of an empty list.

## 2026-09-20 — A livelier homepage
- The Featured members box on the homepage is now a carousel that moves on by itself and pauses when you hover over it.
- Headlines in the More News carousel are larger, and the closing "Become a Member" button now shows for everyone.
