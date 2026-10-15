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

