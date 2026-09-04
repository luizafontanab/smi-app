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
    body: `<h2>What is SMI membership and what does it include?</h2>
<p>SMI membership gives your company a page in the member directory, the ability to publish your news, videos and events on SMI's channels, quarterly stats on how your content performs, and a backlink from every story we publish about you. Membership is £40/month.</p>
<h2>How do I join?</h2>
<p>Use the Become a Member button at the top of any page. You create an account, set up your company page, and our team reviews and activates it — usually within a working day.</p>
<h2>How do I publish news on SMI?</h2>
<p>Members submit stories, videos and events from their member area. Everything goes live after a quick editorial check, and we email you when it's published.</p>
<h2>Can I advertise without being a member?</h2>
<p>Yes — banner, rail and newsletter advertising are open to any company in the trade. See the Advertising page for formats and the media pack, or send us a message and we'll help you pick the right format.</p>
<h2>How does advert rotation work?</h2>
<p>No one can buy position on SMI. Every live advert in a slot rotates with equal visibility, so a smaller advertiser gets the same exposure as a larger one.</p>
<h2>How do I update or cancel my membership?</h2>
<p>Everything is self-service from your member area under Settings — update your details, change your password, view invoices, or cancel. Your page and stories stay live until the end of the period you've paid for.</p>
<h2>Who do I contact for anything else?</h2>
<p>Use the Contact page and we'll come back to you — usually the same day.</p>`,
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
];
