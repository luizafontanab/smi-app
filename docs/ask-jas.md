# Questions for Jas

Open questions only. An answered item is removed; its number is never reused,
because other docs and code cite these numbers. Older items and their
background are in git history (`git log -p docs/ask-jas.md`).

## Branding & content

8. **Your own emails: plain text, or branded?** Your daily digest and the four
   alerts (new enquiry, new signup, member message, change request) arrive as
   plain text; member emails are branded HTML. We left yours plain, as it suits
   skimming on a phone. Keep them plain, or brand them? Branded ones would need
   their own footer, since the member one says "you have a member account".

13. **Archiving a member: three calls to sign off** (fix-list 72). Archiving
    hides a member's page, byline and links; their content stays. Reversible.
    - **Billing.** An archived member stays `active` for billing unless also
      lapsed, so they still count in the member total and revenue. Should
      archiving affect billing, or stay separate (as built)?
    - **Paid placements.** A Featured Member card stops showing when its member
      is archived or lapsed, rather than linking to a page that 404s. If they
      lapse mid-month, should the placement run out its paid term instead? It
      is a one-line change.
    - **Lapsed members' contact links.** `/go/<member>` still forwards clicks
      to a lapsed member's phone, website and email from old links. We stopped
      it for archived members only. Should lapsed members keep getting leads?

14. **Members who have left in social posts.** Since 16 Oct, archived or lapsed
    members are not tagged in story or video posts, whether they are the main
    member or co-featured. Say if you'd rather they still were.

15. **Sign off the lead-gen disclaimer** (GAPS A8.3/A8.4, issue #11). Both lead
    panels show:

    > **Not vetted sales leads.** These are people whose publicly available professional
    > details — the job title, company and contact routes they published themselves —
    > matched the business profile searched for. Nobody listed here has asked to be contacted.

    Is that the wording? It lives in one file, so a change applies to both
    panels. The panels still show sample data only.

16. **Stats email: on by default, or opt-in?** (GAPS A9.7, issue #14.) Today
    every member gets a quarterly summary unless they switch it off. The 18 Sep
    call asked for opt-in, which means members who never visit Settings stop
    getting it. Which do you want?

18. **An Email button on the company page?** (GAPS A9.11, issue #13.) No public
    page offers a member's email, so "Email" in their click stats always reads
    zero. Add the button, or leave it off on purpose?

19. **Advert impressions in the Policies page.** We count an advert as seen even
    when the reader declined cookies, storing nothing about them. The policy
    doesn't say so yet. This goes into the privacy policy rewrite in item 27.

22. **"All-time story views" for a co-featured member.** The figure counts every
    story a member is in, so it no longer drops when a story is taken down. It
    still drops if a co-featured member is untagged. Keeping credit for past
    tags needs a small history table. Worth it, or fine as it is?

23. **Changing a banner's artwork changes every run of that advert**, past and
    future, renewals included. Right for a logo; is it also right for the link?

24. **Cancelling an unpaid Featured Member slot or takeover** cancels the invoice
    and frees the slot. The member isn't told. Should they get an email, and
    what should it say?

25. **Changing a price after the invoice has gone out.** Unpaid: the old invoice
    is cancelled and the member gets a new pay link. Already paid: the new price
    is recorded, not billed, and the difference is settled by hand. Is that
    right?

26. **"Revenue this month" counts money received.** Advertising and Featured
    Member invoices paid this month (unpaid shown beside), plus £40 per paying
    member. So a year's run paid in January shows in January only, and with
    online payment off, advertising reads £0 until invoices are marked paid. Is
    "money in" the view you want, or "what's been sold"?

27. **Data protection: four answers (20 Oct).** Written up at
    https://claude.ai/code/artifact/df015872-7399-43ca-99bb-26865779395e
    (background in [`GDPR.md`](GDPR.md) §17):
    - the company's legal name, address and a privacy contact email;
    - whether SMI is registered with the regulator (the £52 fee);
    - retention periods (proposed defaults in the doc);
    - go-ahead for monthly member usage counts.

    Company names in "Who's engaging" are paused (Luiza's call, 20 Oct), so not
    asked.

28. **Story sources we can't read (20 Oct).** About 580 of your 726 news pages
    are read automatically ([`story-sources.md`](story-sources.md)). For the
    rest:
    - **68 block automated reading.** Check by hand, or drop?
    - **21 have moved (404).** Update the addresses, or drop some companies?
    - **23 are unreachable.** Drop them?
    - **31 need JavaScript or show nothing readable.** Worth checking by hand?
    - **Dormant:** only 213 of 399 dated sources have posted since April. Keep
      quiet ones?
    - **Non-English** (at least one Italian): keep, or English only?

    The list can be edited at `/console/sources`; ChangeTower can go once the
    first week looks right (HUMAN-TODO 3.7).

29. **"Approved via Bigin link": we built it as your own sign-off (20 Oct).**
    Your flow chart's approval gate is a step in the console: mark a story or
    video **Ready to review**, then **Approve & schedule**, publish now, or send
    it back with **Not yet**. It's optional. If you meant someone outside SMI
    approves (e.g. the company, from a link), tell us: that's a separate piece
    of work.

30. **Should a post time you set by hand skip the daily limit?** The limit (3 a
    day today) counts per channel, so a post timed for 14:30 on a busy day can
    move to the next morning on one channel and go out on time on the others.
    Also: posts are now the lead-in plus the link, with no title on top
    (LinkedIn and Facebook show it in the link preview). Want the title back?

31. **Newsletter layout (21 Oct).** The issue now looks like your Mailchimp ones.
    - **"In association with" logo:** we sell 250×60, your recent issues use
      372×110. Which should advertisers send?
    - **Adverts stay 560×300**, as sold and as live. The SOP's 600×200/300/400
      aren't used, so the SOP may want updating.
    - **Adverts are labelled "Sponsored"**, as the SOP asks; live issues aren't.
    - **The sponsored story** (image 600×400, headline, up to 80 words, one per
      issue) isn't on the advertising page or price list. How do you want to
      sell it, and at what price?
    - **Events diary:** published events in the 30 days after the send date, up
      to 8. Right window, or pick by hand?
    - **Not built for now:** the A/B subject-line test and the Bigin
      "Advertising" pipeline link. Tell us if either matters.

32. **Newsletter footer (21 Oct).**
    - **Your postal address.** Issues go out without one until you add it under
      Newsletter → Footer.
    - **Why people receive it.** Draft: "You're receiving this because you
      signed up for SMI Monthly at sheetmetalindustries.com, or because your
      business is in contact with Sheet Metal Industries." Change it there, or
      send us yours.
    - **Who gets it.** Everyone in Bigin not opted out, as today. Sole traders
      and partnerships should have opted in themselves, and Bigin doesn't say
      which contacts they are. Mail only contacts marked "Subscribed" instead?

33. **"Start story" rewrites "we" into third person (28 Oct).** It switches on
    once the AI account is set up (HUMAN-TODO 1.21). To match your style, send
    us **5–10 pairs: a company's original article and the story you published
    from it** (links are enough).

34. **The wide logo needs exporting again (6 Nov).** Its canvas is smaller than
    the artwork, so the diamond and "Join" are cut off. In Illustrator, *Fit to
    Artwork Bounds* before exporting fixes it. Until then, tablets and computers
    keep today's wide logo. The stacked logo is live; it was exported in
    #f08119, so we set it to the confirmed #ff8200. A corrected export would let
    us use it exactly as supplied.

35. **Terms pages: seven answers (9 Nov).** The pages say only what's true today;
    your answers become new wording.
    - **Company details:** registered name, company number, registered office.
    - **Limitation of liability:** should a solicitor settle the full wording?
    - **Governing law:** England and Wales. Right?
    - **VAT:** is the £40 a month inclusive or plus VAT? (Membership terms, FAQ
      and checkout must agree.)
    - **Advert artwork deadline:** how many days before the run starts?
    - **Cancelling an advert booking:** until when, and is any part refunded?
    - **An advert that doesn't run through our fault:** the terms offer a longer
      run or a refund for the time lost. Keep the refund option, or longer run
      only?

    *Decided 9 Nov: no refund when a member cancels or SMI ends a membership.*

## Data validation

### Industries — your 12 Oct spreadsheet

Your ten are in, and every member and story was assigned from your mapping as
written. To check:

1. **The two tabs disagree on four terms.** Financial Services → Events (news)
   but no industry (services); Material / Sheet Handling and Material Handling
   Equipment → Processing Technology (news) but Machinery, Tools & Equipment
   (services); Roll Forming → Processing Technology (news) but Bending & Forming
   (services). Should each pair agree, and which way?
2. **Financial Services → "Events / Openhouse / Education"** (news tab, 17
   stories) looks like a slip. Where should it go?
3. **"Tool and Die" is missing from the services tab.** We followed its twin
   "Tool & Die" into Subcontractor News. Right?
4. **"Subcontractor News" as a Find a Member filter** reads oddly. Would
   "Subcontractors" work, or is News deliberate?
5. **Events with no member.** None of the 53 old events is linked to a member,
   so none got an industry. Default them to "Events, Open Houses & Education"?
6. **Only coil processing maps to Processing Technology** among services, so it
   starts with 5 members. Intended?
7. **Your "Services" bucket** (PR, finance, recruitment, servicing…): a new news
   category and service called "Services", or something else?
8. **Still without an industry:** 8 of 123 members, about 1,100 stories tagged
   only "Industry News", and the events in 5. The full list comes from the
   production run (HUMAN-TODO 4.10).
