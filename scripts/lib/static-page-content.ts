/**
 * Authored static-page content that cannot be regenerated from the WP extract.
 * The legacy About page stored its copy in ACF blocks, not post body HTML, so
 * handover-extract's shape-seed drops it from static_pages.seed.json; the
 * founder bio below lives in a separate WP post (28146) that the extract never
 * captured and was transcribed verbatim from the live site. Both seeds merge
 * these rows over the extract on slug.
 *
 * Bodies must stick to RICH_TEXT_ALLOWLIST (src/lib/sanitize.ts) and carry
 * their own <p> tags — the sanitiser never paragraph-wraps HTML-looking input.
 */
export const AUTHORED_STATIC_PAGES: { slug: string; title: string; body: string; collapsible?: boolean }[] = [
  {
    slug: "faq",
    title: "Frequently asked questions",
    collapsible: true,
    body: `<h2>Membership</h2>
<h3>What is SMI membership and what does it include?</h3>
<p>SMI membership gives your company a page in the member directory, the ability to publish your news, videos and events on SMI's channels, quarterly stats on how your content performs, and a backlink from every story we publish about you. Membership is £40/month.</p>
<h3>How do I join?</h3>
<p>Use the Become a Member button at the top of any page. You create an account, set up your company page, and our team reviews and activates it — usually within a working day.</p>
<h3>What happens to my page if I cancel?</h3>
<p>Your membership runs to the end of the period you've already paid for, and nothing changes until then. After that your company page comes off the public site. News stories we published about you stay up — they're part of the editorial archive, not part of your page.</p>
<h2>News</h2>
<h3>How do I publish news on SMI?</h3>
<p>Members submit stories, videos and events from their member area. Everything goes live after a quick editorial check, and we email you when it's published.</p>
<h3>How long until my story goes live?</h3>
<p>Everything members submit gets a quick editorial check before it publishes — usually within a working day. We email you the moment it's live, with a link straight to the page.</p>
<h3>What makes a submission you can publish quickly?</h3>
<p>Send us the story rather than the advert: what changed, who it's for, and why the trade should care. A real photograph beats a rendering, and a named contact beats a press office. Our <a href="/pages/press-release-submissions-guide">Press Release Submissions Guide</a> has the full list.</p>
<h3>Will my story be shared on social media?</h3>
<p>Yes. Once a member story is approved it's published with a link back to your company page and shared on SMI's social channels.</p>
<h3>Can I submit videos?</h3>
<p>Yes — add a video from your member area with its YouTube link. We take YouTube links only, so the video plays on the page; links from other sites can't be accepted. Like everything else, it's checked before it goes live.</p>
<h3>Can I edit a story after it's published?</h3>
<p>Not directly, and that's deliberate — reopening a live story for editing would take it off the site and out of search while it waited to be approved again. Instead, find it under Your content and use "request a change". It lands in the SMI editor's inbox and they'll reply to you in your member area. The story stays live throughout.</p>
<h3>Can I take something down?</h3>
<p>Yes. Ask us and we'll return it to draft — it comes off the site straight away and stays in your member area, so you can correct it and resubmit. This works for news, videos, events and equipment alike.</p>
<h2>Members</h2>
<h3>How do people find my company on SMI?</h3>
<p>Through Find a Member, the SMI member directory. Readers can search it by keyword and filter it by industry, by the services you offer and by membership type, or browse members on a map. Every story we publish about you also links back to your company page.</p>
<h3>What goes on my company page?</h3>
<p>Your logo, a description of the business, links to your website, phone and social channels, your address with a map, a company video, and every SMI story about your company — collected in one place.</p>
<h3>How do I change my company page?</h3>
<p>From My page in your member area. While your page is still being set up, changes save straight away. Once it's live, your edits are checked before they appear, and the current version stays up in the meantime.</p>
<h2>Events</h2>
<h3>How do I list an event?</h3>
<p>Use Add content in your member area and choose Event. Pick its type — webinar, live event, open house, exhibition or the Golf Challenge — and add a location if it has one, which puts it on the events map. It's checked before it appears on the Events page.</p>
<h3>We're exhibiting at a trade show. Can that go in Events?</h3>
<p>Not as an event listing — the Events page is for events you run, not a catalogue of every stand at a show. To tell readers where to find you, use a member story, an advert, or a Featured Member slot in the run-up to the show.</p>
<h3>Can I change an event after submitting it?</h3>
<p>Yes. While it's waiting for approval, or if it's been sent back to you, edit or withdraw it from Your content. Once it's live, use "request a change" there and we'll update it for you.</p>
<h2>Advertising</h2>
<h3>Can I advertise without being a member?</h3>
<p>Yes — banner, rail and newsletter advertising are open to any company in the trade. See the Advertising page for formats and the media pack, or send us a message and we'll help you pick the right format.</p>
<h3>How does advert rotation work?</h3>
<p>No one can buy position on SMI. Every live advert in a slot rotates with equal visibility, so a smaller advertiser gets the same exposure as a larger one.</p>
<h3>Can I pay for a particular position?</h3>
<p>No — and neither can anyone else. Every live advert in a slot rotates with equal visibility, in a random order reshuffled on each page load. A smaller advertiser gets exactly the same exposure as a larger one. That's the same rule in every slot on the site, and we don't make exceptions to it.</p>
<h3>How do you count an advert impression?</h3>
<p>Only when your artwork has actually loaded and been on screen — not when the page was served. That makes our numbers lower than a served-impressions count, and more honest: every impression we report is one a reader could genuinely have seen.</p>
<h3>What size should my advert artwork be?</h3>
<p>Sitewide banners are 1280×170px for desktop and 370×280px for mobile — please supply both, because a desktop file scaled down is unreadable on a phone. The newsletter banner is 560×300px with 18pt minimum type, and an "In Association With" logo is 250×60px. If you'd rather not produce them, we offer a one-off banner design service.</p>
<h3>What is Featured Member?</h3>
<p>Your logo, company name and industry in the Featured Members carousel on the homepage, plus higher visibility in Find a Member. The carousel shows three at a time and rotates through everyone booked, so each advertiser gets the same turn in the same space. There are eight slots.</p>
<h2>Account and billing</h2>
<h3>How do I update or cancel my membership?</h3>
<p>Everything is self-service from your member area under Settings — update your details, change your password or view invoices. To cancel, contact us. Your page and stories stay live until the end of the period you've paid for.</p>
<h3>Where are my invoices?</h3>
<p>In your member area, under Settings → Billing. You'll find every invoice there to download, along with your renewal date and the card on file. You can update your details.</p>
<h3>Who do I contact for anything else?</h3>
<p>Use the <a href="/contact">Contact page</a> and we'll come back to you — usually the same day.</p>`,
  },
  {
    slug: "about",
    title: "About",
    body: `<h3>Jas Rai — Founder</h3>
<p>I've spent my career working with brands across both consumer and B2B publishing, helping them navigate the world of advertising and promotion. From print advertising and direct marketing to exhibitions, live events and digital campaigns, I've seen what works and, more importantly, what doesn't. Over the years, I've worked with machine manufacturers, subcontractors, suppliers, software houses, trade associations, OEMs, and agencies, both in the UK and internationally, building relationships that last and delivering results that matter.</p>
<p>What drives me is helping businesses in the Sheet metal, Metal Forming and Fabrication manufacturing industries tell their story in a way that gets noticed. I believe in practical advice, honest conversations, and marketing that actually works and not just looks good on paper.</p>
<p>I started SheetMetalIndustries.com because I wanted to create a strong sense of community and celebrate achievements within the metalworking sector. Our digital platform was born in answer to the need for a specialised voice piece for our industry.</p>
<p>Enjoy the platform. Connect with others. Become a member. Help shape the industry.</p>
<p>We'd love to welcome you into the community</p>
<h3>Sheet Metal Industries (SMI) launched in 2022 and brought to market through a dedicated team of media and industry experts dedicated to the field of content generation and media publishing.</h3>
<p>Sheet Metal Industries was launched by Jas Rai, an experienced business to business media professional with over 30 years experience in print media, digital marketing, social digital marketing and event management - with a career dedicated to equipment users and sellers of production manufacturing equipment.</p>
<p><strong>SMI </strong>is dedicated to the niche field of metal forming process and aims to serve and highlight key innovations and strengths attached to the metal forming sector.</p>
<p><strong>SMI</strong> will publish daily industry news stories across all areas associated with installations of sheet metal machines and associated metal forming equipment such as:</p>
<ul>
<li>Tube bending</li>
<li>Pipe fabrication</li>
<li>Metal folding/shearing/punching</li>
<li>Laser/plasma/water jet cutting</li>
<li>Forging</li>
<li>Press manufacturing</li>
<li>Sawing technology</li>
<li>Material handling</li>
<li>Inspection</li>
<li>Workholding</li>
<li>Software systems</li>
<li>Automated production systems</li>
<li>Robots in industry/ slitting lines</li>
<li>Welding technology</li>
<li>Surface finishing equipment</li>
<li>And the evolving additive technologies to name but a few…</li>
</ul>
<h3>Industry sectors covered include:</h3>
<ul>
<li>Mechanical engineering</li>
<li>Sheet metal product</li>
<li>Component manufacturing</li>
<li>Iron, steel and aluminium construction</li>
<li>Enclosure manufacturing</li>
<li>Heating, ventilation and air conditioning</li>
<li>Renewable energy</li>
<li>Medical</li>
<li>Packaging</li>
<li>Hospitality equipment manufacturing</li>
<li>Aerospace</li>
<li>Marine through to building/facade construction</li>
<li>Architecture design</li>
<li>Agricultural equipment manufacturing</li>
<li>Plus many more traditional sectors.</li>
</ul>
<p>Whilst discussing daily industry topics, installations and news, Sheet Metal Industries will also service and champion the invaluable services provided by UK contract manufacturers through its dedicated membership platform.</p>
<p><a href="https://sheetmetalindustries.com/"><strong>Sheetmetalindustries.com</strong></a> will evolve as your one stop destination and aim to keep readers up to date with industry trends, company and product news and information delivered through a multi faceted approach of traditional and modern media channels.</p>`,
  },

  /*
   * The cookie policy, authored here so the fixes survive a reseed.
   *
   * The extract's version of this page carried two links to
   * bestfoundation.org.uk — an unrelated charity — one behind the text
   * "https://sheetmetalindustries.com/" and one behind "contact us". Both are
   * corrected below. A third link pointed at /#gdpr_cookie_modal, a WordPress
   * anchor that does not exist in this app; there is no URL to replace it with
   * because the real control is CookieSettingsLink, a <button> in the footer,
   * so that sentence now names the control in words instead.
   *
   * STILL WRONG, and deliberately left alone because fixing them needs
   * decisions only SMI can make (see docs/ask-jas.md):
   *   · it calls itself the Privacy Policy and is only a cookie policy — no
   *     controller, lawful basis, retention, rights or ICO route
   *   · it claims the site uses Google Analytics. It does not: there is no
   *     gtag/googletagmanager anywhere, analytics are first-party
   *     (src/lib/analytics.ts) and consent is affirmative-only
   *   · the cookie list is generic boilerplate, not the three real cookies
   *     (smi-consent, smi-theme, and Supabase auth sb-*)
   */
  {
    slug: "policies",
    title: "Policies",
    collapsible: true,
    body: `<p>This is the Privacy Policy for Sheet Metal Industries, accessible from <a href="https://sheetmetalindustries.com/">https://sheetmetalindustries.com/</a></p>

<h2>What Are Cookies</h2>

<p>As is common practice with almost all professional websites this site uses cookies, which are tiny files that are downloaded to your computer, to improve your experience. This page describes what information they gather, how we use it and why we sometimes need to store these cookies. We will also share how you can prevent these cookies from being stored however this may downgrade or 'break' certain elements of the sites functionality.</p>

<h2>How We Use Cookies</h2>

<p>We use cookies for a variety of reasons detailed below. Unfortunately in most cases there are no industry standard options for disabling cookies without completely disabling the functionality and features they add to this site. It is recommended that you leave on all cookies if you are not sure whether you need them or not in case they are used to provide a service that you use.</p>

<h2>Disabling Cookies</h2>

<p>You can prevent the setting of cookies by adjusting the settings on your browser (see your browser Help for how to do this). Be aware that disabling cookies will affect the functionality of this and many other websites that you visit. Disabling cookies will usually result in also disabling certain functionality and features of the this site. Therefore it is recommended that you do not disable cookies.</p>

<p>To change your choice at any time, use the <strong>Cookie settings</strong> link at the foot of any page.</p>

<h2>The Cookies We Set</h2>

<h3>Account related cookies</h3>

<p>If you create an account with us then we will use cookies for the management of the signup process and general administration. These cookies will usually be deleted when you log out however in some cases they may remain afterwards to remember your site preferences when logged out.</p>

<h3>Login related cookies</h3>

<p>We use cookies when you are logged in so that we can remember this fact. This prevents you from having to log in every single time you visit a new page. These cookies are typically removed or cleared when you log out to ensure that you can only access restricted features and areas when logged in.</p>

<h3>Forms related cookies</h3>

<p>When you submit data to through a form such as those found on contact pages or comment forms cookies may be set to remember your user details for future correspondence.</p>

<h3>Site preferences cookies</h3>

<p>In order to provide you with a great experience on this site we provide the functionality to set your preferences for how this site runs when you use it. In order to remember your preferences we need to set cookies so that this information can be called whenever you interact with a page is affected by your preferences.</p>

<h2>Third Party Cookies</h2>

<p>In some special cases we also use cookies provided by trusted third parties. The following section details which third party cookies you might encounter through this site.</p>

<p>This site uses Google Analytics which is one of the most widespread and trusted analytics solution on the web for helping us to understand how you use the site and ways that we can improve your experience. These cookies may track things such as how long you spend on the site and the pages that you visit so we can continue to produce engaging content.</p>

<p>For more information on Google Analytics cookies, see the official Google Analytics page.</p>

<h2>More Information</h2>

<p>Hopefully that has clarified things for you and as was previously mentioned if there is something that you aren't sure whether you need or not it's usually safer to leave cookies enabled in case it does interact with one of the features you use on our site.</p>

<p>However if you are still looking for more information then you can <a href="/contact">contact us</a>. </p>`,
  },

  /*
   * ── Terms ──────────────────────────────────────────────────────────────
   *
   * There were none before 21 Sep 2026: no terms of use, no membership terms,
   * no advertising terms, anywhere on the site or in this repo. That matters
   * here because SMI takes money (£40/month, plus advert bookings) and hosts
   * content its members submit.
   *
   * Every operative clause below describes what the platform ACTUALLY does,
   * checked against the code:
   *   · £40/month — MEMBERSHIP_MONTHLY_PENNIES, src/lib/pricing.ts
   *   · cancel by contacting us — members have no cancel button (#91, Jas
   *     item 24); an admin cancels from the console member page (#90)
   *   · cancel runs to period end — src/lib/membership.ts: cancelling sets
   *     cancel_requested_at and leaves status 'active'; Stripe's
   *     subscription.deleted then sets 'lapsed'. memberBySlug() serves only
   *     active/grace, so the company page 404s from that moment, while
   *     stories filter on status='published' alone and stay up.
   *   · equal rotation — dealSlots()/uniformShuffle(), src/lib/adverts.ts
   *   · impressions on load-and-in-view — src/components/AdCreative.tsx
   *   · takeover contrast — DEFAULT_AD_FORMATS key C, src/lib/advert-formats.ts
   *
   * NOT LEGAL ADVICE and not a substitute for a solicitor. The liability,
   * indemnity and data-protection clauses are deliberately thin here — they
   * are the parts a precedent does better than I can. What a precedent cannot
   * supply is the SMI-specific behaviour above, which is why it is written out
   * in full.
   *
   * NEVER put a placeholder in this copy. These pages are public, so an
   * "[SMI TO CONFIRM …]" marker here is shown to every visitor (it was, until
   * 9 Nov 2026). Open questions go to SMI in docs/ask-jas.md; the page says
   * only what is true today, and gains the clause once SMI answers. A test in
   * tests/unit/static-page-content.test.ts fails on any marker.
   */
  {
    slug: "terms",
    title: "Terms of use",
    body: `<p>These terms cover your use of sheetmetalindustries.com. If you are an SMI member, our <a href="/pages/membership-terms">Membership Terms</a> also apply; if you advertise with us, so do our <a href="/pages/advertising-terms">Advertising Terms</a>.</p>
<h2>Who we are</h2>
<p>This site is operated by Sheet Metal Industries.</p>
<h2>Our journalism</h2>
<p>Everything we publish is written in good faith for the UK sheet metal, fabrication and welding trade. It is trade journalism, not technical, legal or financial advice, and it is not a substitute for a manufacturer's own documentation. Specifications, prices and availability quoted in our stories are those given to us at the time of publication and may since have changed. Always check with the supplier before making a purchasing decision.</p>
<h2>Our content</h2>
<p>The words, photographs and design of this site belong to Sheet Metal Industries or to the people who licensed them to us. You are welcome to link to any page, quote a short extract with attribution, or share our stories on social media. You may not republish a story in full, sell our content on, or use it to train a commercial model without our written permission.</p>
<h2>Using this site</h2>
<p>Please do not attempt to break, overload or gain unauthorised access to the site or to anyone else's account, scrape it at a rate that affects other readers, or submit anything unlawful, defamatory or that infringes someone else's rights. We may suspend access where we reasonably believe any of that is happening.</p>
<h2>Links to other sites</h2>
<p>We link to manufacturers, members and other publications. We do not control those sites and are not responsible for their content or their handling of your data.</p>
<h2>Availability and liability</h2>
<p>We aim to keep the site available and accurate, but we do not guarantee it will be uninterrupted or error-free. Nothing in these terms limits our liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited.</p>
<h2>Changes</h2>
<p>We may update these terms. The version on this page is the one that applies, and we will date any material change.</p>
<h2>Governing law</h2>
<p>These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>`,
  },
  {
    slug: "membership-terms",
    title: "Membership terms",
    collapsible: true,
    body: `<p>These terms apply to SMI membership. Our <a href="/pages/terms">Terms of use</a> apply to the site as a whole.</p>
<h2>What membership costs</h2>
<p>Membership is £40 per month, rolling monthly.</p>
<h2>What membership includes</h2>
<p>A company page in the member directory; the ability to submit news, videos, events and equipment for publication; quarterly statistics on how your content performed; and a link back to your site from every story we publish about you.</p>
<h2>Your content, and the licence you give us</h2>
<p>You keep ownership of everything you send us. By submitting a story, video, event or photograph you give SMI a non-exclusive, royalty-free licence to publish it on sheetmetalindustries.com, include it in our newsletter, and promote it on our social channels. We may edit for length, clarity and house style, and we will tell you if we change anything material.</p>
<p>That licence continues for material we have already published if your membership later ends. We do not retrospectively unpublish the archive — a story that ran in March stays part of the record.</p>
<p>You confirm that you have the right to give us that licence: that the words are yours or you are authorised to supply them, and that you hold the rights to any photograph you send.</p>
<h2>Editorial discretion</h2>
<p>Membership buys you access to the platform, not a guarantee of publication. We may decline a submission, ask you to change it, or unpublish something that turns out to be inaccurate. We will always tell you why.</p>
<h2>Cancelling</h2>
<p>You can cancel at any time by contacting us. Cancelling stops the next payment; your membership, your company page and your ability to submit content all continue to the end of the period you have already paid for. After that your company page comes off the public site, and news we published about you remains in the archive.</p>
<h2>If a payment fails</h2>
<p>We will email you and your membership enters a short grace period during which your page stays live. If payment is not resolved by the end of it, membership lapses and your company page comes off the site. Paying brings it straight back.</p>
<h2>Ending membership from our side</h2>
<p>We may end a membership where these terms are seriously or repeatedly broken. No refund is given for the rest of the period you have paid for.</p>`,
  },
  {
    slug: "advertising-terms",
    title: "Advertising terms",
    body: `<p>These terms apply to advertising booked with SMI. Our <a href="/pages/terms">Terms of use</a> apply to the site as a whole.</p>
<h2>Rotation: nobody buys position</h2>
<p>Advert positions on SMI are not sold by position. Every live advert booked into a slot rotates with equal visibility in a random order, and no advertiser can buy priority, a fixed position, or exclusivity within a slot. We apply this to every booking without exception, including our own promotions.</p>
<h2>What we measure, and what we do not promise</h2>
<p>We report impressions and clicks. An impression is counted only when your artwork has loaded and been on screen for a reader — not when a page was served — so our figures are deliberately more conservative than a served-impressions count. We do not guarantee a number of impressions, clicks, enquiries or sales, and advertising is not sold on a performance basis.</p>
<h2>Artwork</h2>
<p>Artwork is due before your run starts, in the sizes set out on the <a href="/advertising">Advertising page</a>. Please supply both desktop and mobile files for banners — a desktop file scaled down is unreadable on a phone.</p>
<h2>Approval</h2>
<p>We will ask you to change artwork that is illegible at the size it runs, misrepresents a product, or would breach the CAP Code. A homepage takeover also needs a hex colour that meets WCAG 2.1 level A against our text; we check this and will come back to you if it does not.</p>
<h2>Your material</h2>
<p>You confirm that you own or are licensed to use everything in your artwork, and that the claims it makes are accurate and can be substantiated. You remain responsible for the content of your advert.</p>
<h2>Booking and cancellation</h2>
<p>A booking is confirmed once we have accepted it and taken payment.</p>
<h2>If something goes wrong</h2>
<p>If an advert fails to run for a material part of its booked period through our fault, we will extend the run by the time lost or refund that portion, at your choice. That is the limit of what we offer for a missed run.</p>`,
  },
];
