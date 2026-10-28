<!--
  What's new — shown to admins only, at /console/releases.

  Newest first. Each release is a heading followed by bullet points:

    ## YYYY-MM-DD — Short title
    - One plain-language sentence per change.

  Only headings, bullets, blank lines and comments like this one are allowed;
  anything else fails `pnpm check` (tests/unit/release-notes.test.ts).
-->

## 2026-10-27 — Story sources from Bigin
- Each company's News Page URL in Bigin is now a story source as well as the spreadsheet list. It's checked daily, or straight away with "Sync from Bigin now" on Story sources → Sources.
- A news page that's already on the list isn't added twice. If a company's URL changes or is removed in Bigin, the old page stops being checked, unless it's also on the spreadsheet.
- Sources from Bigin show a "Bigin" tag with the company name, and there's a "From Bigin" filter. Their address is changed in Bigin, not on this page.
- When a source belongs to a member, "Start story" makes a draft already tagged with that member. You can change the tag in the editor.
- There's a new Story crawler switch under Features. It starts off; while it's off, no sources are checked.

## 2026-10-27 — More of a member's stories on their page
- "Stories featuring" on a member's page is now a carousel you can scroll sideways, showing their 12 latest stories instead of 4.
- When a member has more than 12, a "See more" link opens the Newsroom showing every story featuring them, with a "Featuring …" tag you can clear to see all news again.
- The page layout editor no longer has a card count for this block, as it's always the 12 latest.

## 2026-10-27 — Switch member Leads on or off
- There's a new Features page under Site Config, where you can switch parts of the site on or off. Changes apply straight away, with no redeploy.
- The first switch is the members' Leads page. It starts off: members won't see Leads in their menu, and anyone opening the Leads address is taken to their dashboard. Turn it on in Features when you're ready.
- Your own Lead Gen page in the console works as before, and says whether members' Leads is on.

## 2026-10-27 — Members can see which months have Featured Member slots
- When a member asks for Featured Member on Advertising → Buy, they now see this month and the next 11, each with how many of the 8 slots are left. Full months can't be picked. Choosing a month is optional.
- Slots held for unpaid invoices count as taken, the same as when you book a slot. Members see only how many slots are left, never whose they are.
- On Adverts & Banners → Interest, a request now shows the month the member wants, with a "Book this slot" link that opens Featured Member with the member and dates already filled in.
- Members also see the month they asked for under Advertising → Manage.

## 2026-10-27 — Featured event on the home page
- The event card at the top of the home page can now be booked like a Featured Member slot, under Adverts & Banners → Featured Event. Pick an event, the dates and an optional price. Only one event can be featured on any day.
- A priced booking is invoiced to the event's member and shows once it's paid. An event with no member can be featured, but only without a price.
- You can also pin a backup event on the same page. It shows on any day nothing is booked. With no backup pinned, the card shows the next upcoming event, as it always has.
- If a booked or pinned event is unpublished or has finished, the home page skips it and the Featured Event page tells you, so a booking never shows a dead event.
- The Events page now has a card at the top saying which event is featured on the home page today, why, and what's booked next.

## 2026-10-22 — Newsletter, social post and console fixes
- A newsletter can no longer go out with a story or video that has since been withdrawn or unpublished. The issue page names it, and "Send me a test", approving, scheduling and sending all refuse until you remove it from the issue or republish it. If it happens after the issue is scheduled, the issue shows as failed with the reason instead of sending.
- Social posts now carry only the tags for the network they're posted to, so an X post no longer includes LinkedIn and Facebook handles. On X, extra members' tags are dropped when needed to keep the post within 280 characters.
- If a social post goes out on some networks but fails on another, the retry posts only to the one that failed, instead of posting again everywhere. For this to work best, fill in the Buffer organisation id next to the channel ids under Stories.
- The newsletter's "Schedule" time is now UK time, and so is the time shown on a scheduled issue. In summer it used to be read an hour out.
- The console calendars (stories, videos, newsletter, events and the Command Centre) now put everything on its UK day, so something at half past midnight no longer appears on the day before. Their times are UK time too.
- A member's "Paid at" date and time, and the scheduled times on the Story and Video boards, are now UK time.
- The Command Centre's "this month" revenue now starts at midnight UK time on the 1st.
- A rebook draft made with "Rebook" can now have its dates changed, or be deleted if you don't want it, from its booking page. Once the member has sent it in, or you've booked it, it can't be changed this way.
- Replies you send from the inbox no longer say "you have a Sheet Metal Industries member account" at the bottom. They now say the reader is getting it because they contacted you. Member emails keep the account line, and the plain-text version of every email now has it too.
- If the email wrapper under Email templates was edited before this change, it keeps its old footer. The Email templates page says so, and resetting the wrapper fixes it.

## 2026-10-22 — Home page on phones, and easier-to-read green labels
- On phones, the home page no longer scrolls sideways. The "More news" row now scrolls on its own, as it does on a computer.
- The green used for "done" and "approved" labels across the console and member area is a shade darker, so the small green tags, such as "To call" on Leads, are easier to read.

## 2026-10-21 — Bounced addresses, and a last check before each newsletter
- An address that bounces permanently is now marked "bounced, not mailed" on its CRM contact instead of being unsubscribed. It's left out of newsletters, but nothing is recorded in Bigin as an opt-out.
- When you correct a bounced contact's email address, or tick "address fixed" when editing it, they go back on the list from the next daily contact sync.
- Just before each newsletter goes out, anyone who unsubscribed or bounced since the last daily sync is taken off the sending list. If that can't be done, the issue isn't sent: it shows as failed with the reason, and you can send it again.
- The subscriber counts on the newsletter pages now leave out bounced addresses.

## 2026-10-21 — Newsletter footer, sender and sign-up records
- Every newsletter footer now has links to the website, the contact page and SMI's social accounts, a line saying why the reader is getting it, your postal address, an "Update your details" link and the unsubscribe link. The plain-text version has them too.
- Set the postal address and the "why you're getting this" line under Newsletter → Footer. Until there's an address, issues go out without one and the issue page warns you; it doesn't stop you approving.
- If the newsletter template under Email templates was edited before these footer lines existed, it won't have them. The issue page says so with a link to fix it, and a test send or a real send refuses until it's fixed.
- When someone already on the list signs up again on the website, that sign-up now becomes their consent record if they had none, or only a Bigin import date.
- Replies to the newsletter now go to the monitored inbox set for replies, and the newsletter can have its own sender name, "Sheet Metal Industries", without changing other emails. "Send me a test" uses the same sender, so you can check it.
- Every new subscriber now has a record of when they joined, how (a website sign-up form, added in the console, or imported from Bigin) and, for website sign-ups, the wording the form showed. You can see it when you edit a contact in the CRM.
- Contacts already imported from Bigin show their import date as the date they joined. That's when we got them, not a record of their consent, and the CRM says so. Older website and console sign-ups have no record.

## 2026-10-21 — Clicks counted per newsletter issue
- A sent issue's page now shows its five most-clicked stories and videos, and how many clicks each advert in it got, including any that got none.
- Advert links in the newsletter now carry the UTM tags from the newsletter SOP (source, medium, the issue's month and the advertiser's slot), so advertisers can see newsletter visits in their own analytics. A tag the advertiser already put in their link is kept.
- These figures start with the next issue sent. Every click from the email is counted, including from readers who haven't accepted analytics cookies; those are counted anonymously, with nothing that identifies the reader.
- This also means newsletter advert clicks, and story views from the newsletter, now count for readers who haven't accepted cookies; before, they weren't counted at all, so advert click figures and members' story views will go up.

## 2026-10-21 — Sponsored story, events diary and supplier directory in the newsletter
- There's a new artwork format, "Newsletter sponsored story": one 600×400 image with a headline and up to 80 words. Attached to an issue like a banner, it shows as a story card marked "Sponsored", and clicks are counted like any advert. One per issue.
- Each issue now ends with an events diary: the published events starting in the 30 days after it goes out.
- A new "Supplier directory" section on the issue page lets you pick members to list near the footer, each linked to their page.
- The story Summary box now counts words and suggests 40–60, as the newsletter SOP asks; it never stops you saving.
- The issue's page on the website shows all three as well.

## 2026-10-21 — Newsletter laid out like the Mailchimp issues
- Each newsletter issue now opens with the SMI logo, and an "In association with" sponsor logo beside it when one is attached (one per issue).
- The first story or video is the lead, at full width; the rest sit two to a row under "Sheeting Hot News", one under another on phones.
- Adverts now sit between the stories instead of all at the end, labelled "Sponsored". Left on auto, the first goes after item 3 and the last just before the footer; type a number in "After item" to place one yourself.
- Stories and videos are now one list on the issue page: use the arrows to set the order, and whatever is first becomes the lead story.
- To add something older than the latest 20, search by title or pick a "Published since" date.
- There's a new "Preview text" field for the line inboxes show under the subject, and both it and the subject show a character count; going over the suggested length is only a warning.
- The issue's page on the website now shows the same layout, including videos and adverts.

## 2026-10-21 — Newsletter proof and approval before sending
- Each newsletter issue now has a "Proof and approval" section with the full proof checklist from the newsletter SOP, saved as you tick it.
- "Send me a test" emails the issue, exactly as subscribers will see it, to your own address, marked [TEST].
- "Approve to send" becomes available once every item is ticked and a test has gone out since the last change; it records who approved the issue, when, and how many subscribers it will go to.
- The page compares the number of subscribers with the last issue sent and warns you in red if it has changed by more than 5%.
- An issue can only be scheduled or sent once it is approved, and "Send now" asks you to tick "confirm" first, because it goes to the whole list.
- Changing an approved issue, its adverts or its checklist takes the approval away and asks for a fresh test; a scheduled issue goes back to draft until it is approved again.
- Some checklist items, such as the postal address in the footer and "Sheet Metal Industries" as the sender name, aren't built into the newsletter yet, so an issue can't be approved until they are.

## 2026-10-20 — Newsletter issues keep their older stories
- Saving a newsletter issue no longer drops stories or videos that were picked earlier but are older than the latest 20; before, they quietly fell out of the issue.
- Everything already in an issue is now listed first, ticked, in the issue's order, with "not live" beside anything that has since come off the site.

## 2026-10-20 — Social posts set per story and video
- Each story and video has a new "Social post" section: a lead-in to post with the link, a "Post at" time, and a "Don't post this to social media" box.
- The lead-in starts as the story's summary (or the video's description); leave it alone and it keeps following the summary if you change that.
- Leave "Post at" empty and it posts the usual number of minutes after going live, as set in the Story Engine; a post never goes out before the story is live.
- The editor now says where each post stands: when it will go, when it went, or why it won't.
- Publishing now, approving, and dragging a card to Live now all use your delay setting; before, they always used 30 minutes.
- A story or video taken off the site before its post goes out is no longer posted.
- Times you type in the Story and Video Engines are now read as UK time; in summer they were an hour out.
- The daily limit now counts only posts that actually went out, starting from midnight UK time.
- The LinkedIn, Facebook and X links under "SMI's posts of this story" now fill themselves in once Buffer has posted the story, so there's nothing to copy and paste; a link you paste yourself is never replaced.

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
