# Questions for Jas

## Branding & content



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

    *Note (15 Oct): a story can now feature several members (fix-list 84), and every
    one of them is tagged in the post, so the answer covers all of them at once. They
    follow the same rule as the main member today: tagged even if archived. One
    difference is already in place: an archived co-featured member gets no "story
    featuring you is live" email, because their tile isn't on the page.*

    *Note (16 Oct): we've switched the default while we wait for you. Members who
    have left (archived or lapsed) are no longer tagged in story or video posts,
    main member or co-featured. Say if you'd rather they still were.*

15. **Sign off the lead-gen disclaimer wording (you asked to see the exact text).** Both
    lead panels, yours and the members', now show job titles prominently and carry this
    draft (GAPS A8.3/A8.4, from the 18 Sep call):

    > **Not vetted sales leads.** These are people whose publicly available professional
    > details — the job title, company and contact routes they published themselves —
    > matched the business profile searched for. Nobody listed here has asked to be contacted.

    Is that the wording, or how would you change it? It lives in one place
    (`src/components/leads/LeadsDisclaimer.tsx`), so a change applies to both panels at
    once. The panels still show sample data only.

16. **Should the stats email be on by default, or opt-in?** Your 15 July note said
    "stats quarterly is fine", and today every member gets a quarterly summary unless
    they switch it off in Settings. The 18 Sep call asked for it to be an *opt-in*
    setting instead. Switching means members who never visited Settings stop getting it.
    Which do you want (GAPS A9.7)?

17. **Which homepage design is going live?** The 18 Sep call asked for the old site's
    nav order — Home / News / Videos / Newsletters / Find a Member beside the logo, with
    the Industries bar underneath (GAPS A9.9). The two designs lay their headers out
    differently, and we have assumed the lighter "Grid" design is the one going live,
    because it matches "vertical layout, lighter background" from the same call. Is that
    right? You can now flip every visitor between the two yourself, in the console under
    Page Layouts → Homepage design.

    *Note (5 Oct): answered: grid is going live. It is now the site default (GAPS A8.2),
    and the nav-order fix is scoped to grid only (GAPS A9.9).*

18. **Should a company page have an Email button?** The directory cards used to offer
    Email beside Website and Call; that went when the cards were simplified. Today no
    public page offers a member's email at all, so the "Email" line in members' click
    stats can only ever read zero (GAPS A9.11). Add an Email button to the company page,
    or leave it off on purpose?

19. **One line for the Policies page about advert impressions.** Since 28 Sep we count
    an advert as seen even when the reader declined analytics cookies, so advertisers
    get the full number. For those readers we store nothing about them: no cookie,
    no IP-derived data, just "this advert was on this page at this time". Nothing
    they see changes because of it. The Policies page says nothing about this yet
    (and still describes Google Analytics, which the site doesn't use). Are you
    happy for the policy to say so, and do you want your usual wording or ours?

20. **How many industries may a member pick?** A member can now choose their own
    industries on their company page. We've capped it at **3** for now, so nobody
    appears on every industry page; members who already have more (the import gave a
    few of them four) keep them but can't add another. The console isn't capped. Is 3
    right, and should the console have a cap too?

21. **The orange company line at the end of a story.** Every story about a member ends
    with that member's name, linking to their website. If the author's last paragraph
    is a single link, we used to treat it as that line, even when it was something
    else ("Watch the video"), and then the member got no link of their own. Now a
    closing link only counts as the company line when it points at the member's
    website or is the member's name; otherwise it stays as normal text and the
    member's line is added underneath. Is that right, or should other closing links
    be styled as company lines too?

22. **"All-time story views" for a co-featured member.** A member's all-time figure
    now counts every story they've been the main member of, plus every story that
    features them today, published or not, so it no longer drops when a story is
    taken down. One case can still make it go down: if a co-featured member is
    untagged from a story, its views leave their total. Keeping credit for past tags
    needs a small history table. Worth it, or fine as it is?

23. **Changing a banner's artwork changes it for every run of that advert.** The image
    and link belong to the advert, and each run (including renewals) uses the same
    advert. So editing one run's logo or link changes its past and future runs too.
    That's probably what you want for a logo; is it also right for the link?

24. **Cancelling an unpaid Featured Member slot or takeover.** You can now cancel one
    that hasn't been paid for: the invoice is cancelled and the slot freed. The
    member isn't told. Should they get an email, and what should it say?

25. **Changing a price after the invoice has gone out.** If the invoice is still
    unpaid, the old one is cancelled and the member gets a new pay link at the new
    price. If they've already paid, the new price is recorded but not billed: the
    console says so, and the difference is settled by hand. Is that how you want it
    to work?

26. **"Revenue this month" now counts money that has arrived.** The console figure used
    to add up the adverts running today, at list prices, and got bundles wrong. It
    now counts advertising and Featured Member invoices **paid** this month, with
    anything invoiced but not yet paid shown beside it, and memberships at £40 for
    each paying member (members on a free period aren't counted). So a year-long run
    paid in January shows in January only, and with online payment off, advertising
    reads £0 until you mark invoices paid. Is "money in this month" the view you want,
    or would you rather see what's been sold?

27. **Data protection — four answers (20 Oct).** Written up for Jas as a short document:
    https://claude.ai/code/artifact/df015872-7399-43ca-99bb-26865779395e. Background and sources are in
    [`GDPR.md`](GDPR.md) §17. The four questions:
    - the company's legal name, address and a privacy contact email;
    - whether SMI is registered with the regulator (the £52 fee);
    - retention periods (proposed defaults in the doc);
    - go-ahead for monthly member usage counts.

    Company names in "Who's engaging" are paused for now (Luiza's call, 20 Oct), so they aren't asked.

    Item 19's impressions line goes into the privacy policy rewrite these answers unblock.

28. **Story sources: what to do with the sites we can't read (20 Oct).** The
    ChangeTower replacement reads about 580 of your 726 news pages automatically
    ([`story-sources.md`](story-sources.md)). The rest need your decision, group by group:
    - **68 sites block automated reading.** These are mostly bot-check screens, which
      we won't work around. Do you check them by hand, or drop them?
    - **21 news pages have moved (404).** For many of them the homepage suggests the
      new address. Should we update them, or are some companies no longer worth
      following?
    - **23 sites are unreachable** (dead domains, expired certificates). Should we drop
      them?
    - **31 are built with JavaScript, or show nothing readable.** Is checking them by
      hand worth it?
    - **Dormant sources:** only 213 of the 399 sources that date their posts have
      posted since April. Should quiet sources stay on the list?
    - **Non-English sources** (at least one is Italian): keep, or English only?

    The flow chart's open question about Bigin scraping domains instead is answered
    by this. The list now lives in the app and can be edited at `/console/sources`,
    so ChangeTower can go once the first week looks right (HUMAN-TODO 30.5).

29. **"Approved via Bigin link" — we've read it as your own sign-off (20 Oct).** Your
    16 Oct flow chart has one gate: *Ready to review — approved via Bigin link?* We've
    built it as a step inside the console, with no Bigin involved: the admin manager
    can mark a story or video **Ready to review**, then **Approve & schedule** it (or
    publish it now if it's urgent), or put it back to draft with **Not yet**. The step
    is optional, so a finished draft can still be scheduled straight away. "Awaiting
    approval" is now called "Ready to review" for stories and videos, members' too.
    **If you meant someone outside SMI signs off** (for example, the company the story
    is about approving it from a link you send them from Bigin), tell us. That would be
    a separate piece of work: a no-login review link and a record of who approved.

30. **Social posts: should a time you set yourself skip the daily limit? (20 Oct)** Each
    story and video now has its own **Post at** time, a **lead-in** (prefilled from the
    summary) and a **Don't post** box, as your flow chart asks. The daily limit you set
    in the Story Engine (3 a day today) still applies to all of them, so a post you
    timed for 14:30 on a busy day moves to the next morning. **Should a time you set by
    hand go out regardless?** Also worth knowing: the post is now the lead-in plus the
    link, without the title above it — LinkedIn and Facebook show the title in the link
    preview anyway. Tell us if you want the title back on top.

31. **Newsletter layout: one size to confirm, and what's changed (21 Oct).** The
    issue now looks like the issues you send from Mailchimp today: the SMI logo with
    the "In association with" sponsor beside it, the lead story at full width, then
    the stories two to a row under "Sheeting Hot News", with adverts between the rows.
    The SOP's sponsored story, events diary and supplier directory are in too, and so
    are the UTM tags on advert links and a per-issue report (top stories and each
    advert's clicks) on a sent issue's page.
    - **"In association with" logo size.** We sell it as 250×60, but the logos in
      your recent issues are 372×110. Which should we ask advertisers for?
    - **Advert sizes stay at 560×300**, the size we sell and the one your live issues
      use. The SOP's 600×200 / 600×300 / 600×400 aren't used, so the SOP may want
      updating.
    - **Adverts are now labelled "Sponsored"**, as the SOP asks. The live issues have
      no label.
    - **The sponsored story isn't on the advertising page or price list yet.** It's set
      up as artwork in its own format (image 600×400, a headline and up to 80 words),
      one per issue. How do you want to sell it, and at what price?
    - **The events diary** lists published events in the 30 days after the send date,
      up to 8. Is that the right window, or should you pick them by hand?
    - **Not being built for now:** the A/B subject-line test (we're not sure Resend
      can do it) and the link to a Bigin "Advertising" pipeline. Tell us if either
      matters to you.

32. **Newsletter footer: your postal address and the "why you're getting this" line
    (21 Oct).** The SOP asks for both in every footer. We need:
    - **The postal address** to print. Until you give it, issues go out without one
      and the issue page warns you. You can type it in yourself under
      Newsletter → Footer.
    - **The wording for why people receive it.** We've drafted: "You're receiving
      this because you signed up for SMI Monthly at sheetmetalindustries.com, or
      because your business is in contact with Sheet Metal Industries." Change it
      there too, or send us yours.
    - **Who gets it.** For now, everyone in Bigin who hasn't opted out stays on the
      list, as today. That's fine for company addresses, but sole traders and
      partnerships need to have opted in themselves, and Bigin doesn't tell us
      which contacts those are. Tell us if you'd rather mail only contacts marked
      "Subscribed" in Bigin.
    - We now record when, how, and against what wording each person joins the list.
      We haven't built double opt-in (a confirmation email before someone is added);
      UK law doesn't require it, and fewer people finish signing up with it.

33. **"Start story" now rewrites "we" into third person: a few examples to tune it
    (28 Oct).** Starting a story from a suggestion now fills in the draft from the
    article and rewrites it from the company's "we" to third person, changing
    nothing else, as you described (1 May). It switches on once the AI account is
    set up (HUMAN-TODO 1.21). To make it match how you write, send us **5–10
    pairs: a company's original article, and the story you published from it.**
    Links to both are enough. Until then it follows the rule as you described it:
    the company's name or "the company" for "we", "its" for "our", quotes left as
    they are.

## Data validation

- sent to Jas on oct 4th

### Industries — your 12 Oct spreadsheet

*Note (12 Oct): your ten are in, in your order, with the punctuation tidied:
Automation & Robotics · Inspection & Measurement · Grinding & Surface Finishing ·
Processing Technology · Machinery, Tools & Equipment · Software & IT Services ·
Bending & Forming · Welding & Joining · Subcontractor News · Events, Open Houses &
Education. A member can now be in several, with one shown as their primary, and
every member and story was assigned from your mapping exactly as written. A few
things we'd like you to look at:*

1. **The two tabs disagree on four terms that appear in both.** Financial Services →
   Events (news) but no industry (services); Material / Sheet Handling and Material
   Handling Equipment → Processing Technology (news) but Machinery, Tools & Equipment
   (services); Roll Forming → Processing Technology (news) but Bending & Forming
   (services). Should each pair agree, and which way?
2. **Financial Services → "Events / Openhouse / Education"** on the news tab looks like
   a slip (17 stories). Where should it go, or nowhere?
3. **"Tool and Die" is missing from the services tab.** It's the near-twin of "Tool &
   Die", which you put under Subcontractor News, so we've done the same. Right?
4. **"Subcontractor News" as a directory filter.** It's also how members are filtered
   on Find a Member (`/member?industry=subcontractor-news`), where "News" reads oddly.
   Would "Subcontractors" work as the name, or is News deliberate?
5. **Events with no member.** None of the 53 events in the old site is linked to a
   member, so none got an industry. Your tab 1 says the ten should cover every event.
   Should those default to "Events, Open Houses & Education"?
6. **Only coil processing maps to Processing Technology** among services, so it starts
   with very few members (5 as primary industry). Intended?
7. **Your "Services" bucket** (the New Category / New Member Services columns) for the
   terms with no industry: PR, finance, recruitment, servicing, and so on. Not done yet.
   Did you mean a new news category and service called "Services" that those merge
   into, or something else?
8. **What's still without an industry.** You asked to be told: 8 of the 123 members,
   about 1,100 stories tagged only "Industry News", and the events in 5. The full list
   comes from the production run (HUMAN-TODO 26.2).

