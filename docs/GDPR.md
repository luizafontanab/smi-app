# Data protection reference — UK GDPR, PECR, and what they mean for SMI

What the law says, quoted from its source, and how each part applies to this site.
Researched **20 October 2026**. The law changed a lot in 2026 (see §1). If you are reading
this much later, re-check the "In force" dates and the sources before you rely on any of it.

**This is not legal advice.** It is a working reference, written to make decisions faster and
to brief a solicitor well. Anything that decides real risk (the privacy policy wording, the
IP-to-company feature, a breach) should still go past someone qualified.

How to read it:
- Text in a quote block with a source link is the law or the regulator, **verbatim**.
- "**For SMI:**" is how it applies here.
- "**Unverified**" means we could not confirm it from a primary source.
- §15 lists the gaps found in the app. §16 answers "what member activity can we keep?"

---

## Contents

1. [Which laws apply, and what changed in 2026](#1-which-laws-apply-and-what-changed-in-2026)
2. [Is it personal data? Companies, people, and the shared login](#2-is-it-personal-data-companies-people-and-the-shared-login)
3. [The seven principles (Art 5)](#3-the-seven-principles-art-5)
4. [Lawful basis (Art 6)](#4-lawful-basis-art-6)
5. [Telling people: the privacy notice (Arts 12–14)](#5-telling-people-the-privacy-notice-arts-1214)
6. [People's rights, deadlines, and the new complaints duty](#6-peoples-rights-deadlines-and-the-new-complaints-duty)
7. [Cookies and device storage (PECR reg 6)](#7-cookies-and-device-storage-pecr-reg-6)
8. [Marketing email (PECR regs 22–23)](#8-marketing-email-pecr-regs-2223)
9. [The journalism exemption](#9-the-journalism-exemption)
10. [Security, breaches, and logging](#10-security-breaches-and-logging)
11. [Processors and transfers abroad](#11-processors-and-transfers-abroad)
12. [Paperwork: records, LIAs, DPIAs, the fee](#12-paperwork-records-lias-dpias-the-fee)
13. [Fines](#13-fines)
14. [What we hold today](#14-what-we-hold-today)
15. [Gaps found](#15-gaps-found)
16. [Member-activity auditing: what we can keep](#16-member-activity-auditing-what-we-can-keep)
17. [Decisions needed from Jas](#17-decisions-needed-from-jas)
18. [Sources](#18-sources)

---

## 1. Which laws apply, and what changed in 2026

| Law | What it covers for us |
|---|---|
| **UK GDPR** (retained Regulation (EU) 2016/679, as amended) | All personal data: member logins, contacts, subscribers, visitor analytics, logs. |
| **Data Protection Act 2018** | Fills in the UK GDPR: exemptions (incl. journalism, §9), fines, the complaints duty, the regulator. |
| **PECR** (S.I. 2003/2426) | Cookies and anything stored on or read from a visitor's device (§7); marketing email (§8). |
| **Data (Use and Access) Act 2025** ("DUAA") | Amends all three. Royal Assent 19 June 2025. |
| **EU GDPR** | Only if we *target* people in the EU, or track them. See below. |

**What the DUAA changed, and when it took effect.** Checked against the commencement
regulations on legislation.gov.uk.

| Change | In force | Matters to us? |
|---|---|---|
| New lawful basis "recognised legitimate interests" (Art 6(1)(ea), Annex 1) | 5 Feb 2026 | Rarely — see §4 |
| New rules on reusing data for another purpose (Art 8A) | 5 Feb 2026 | Somewhat |
| New cookie exemptions, incl. analytics without consent (PECR Sch A1) | 5 Feb 2026 | **Yes** — §7 |
| PECR fines raised to UK GDPR levels | 5 Feb 2026 (breaches from that date) | Yes — §13 |
| Subject access requests: "reasonable and proportionate search"; "stop the clock" (Arts 15(1A), 12A) | 15(1A) at Royal Assent; 12A 5 Feb 2026 | Yes — §6 |
| Automated decision rules relaxed (Arts 22A–22D) | 5 Feb 2026 | No (we make none) |
| Transfers abroad: new "data protection test" (Arts 44A–46) | 5 Feb 2026 | Yes — §11 |
| **Duty on us to handle data protection complaints** (DPA s.164A) | **19 Jun 2026** | **Yes** — §6 |
| ICO abolished; functions pass to the **Information Commission** | **30 Sep 2026** | Yes: the privacy notice should name the Information Commission |

Sources: [S.I. 2026/82](https://www.legislation.gov.uk/uksi/2026/82/made) (regs 2–3: 5 Feb and
19 Jun 2026); [S.I. 2026/1015](https://www.legislation.gov.uk/uksi/2026/1015/made) (DUAA ss.118–119
on 30 Sep 2026); [gov.uk commencement plan](https://www.gov.uk/guidance/data-use-and-access-act-2025-plans-for-commencement).

> **Numbering note:** since 5 Feb 2026 the old Art 4 definitions sit in Art 4(1). Since
> 30 Sep 2026 "the Commission" in the UK GDPR means the Information Commission. The regulator's
> website is still ico.org.uk, and this document says "ICO" for its guidance.

**EU GDPR.** It reaches a UK business only through Art 3(2): offering goods or services to people
in the EU, or monitoring their behaviour in the EU.

> "the mere accessibility of the controller's … website in the Union … is insufficient"
> — Recital 23, [legislation.gov.uk (EU text as adopted)](https://www.legislation.gov.uk/eur/2016/679/introduction/adopted)

**For SMI:** being readable in the EU does not trigger EU GDPR. What would:
- selling memberships or adverts to EU firms (especially priced in euros);
- tracking or profiling EU visitors.

If either starts, we would likely need an EU representative (EU GDPR Art 27). Today we sell in
pounds to UK firms.

---

## 2. Is it personal data? Companies, people, and the shared login

> "'personal data' means any information relating to an identified or identifiable natural person
> ('data subject'); an identifiable natural person is one who can be identified, directly or
> indirectly, in particular by reference to an identifier such as a name, an identification number,
> location data, an online identifier or to one or more factors specific to the physical,
> physiological, genetic, mental, economic, cultural or social identity of that natural person;"
> — UK GDPR Art 4(1)(1), [legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/4)

> "Information about companies or public authorities is not personal data."
> — [ICO, What is personal information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-information-a-guide/)

> "information about individuals acting as sole traders, employees, partners and company directors
> where they are individually identifiable and the information relates to them as an individual may
> constitute personal data." — same page

The ICO's B2B guidance adds that an email address which "identifies an individual" is personal
data, even when used for business. A generic info@ address is not.
[ICO, B2B marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)

IP addresses and cookie IDs are "online identifiers".
[ICO, identifiers](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors/)

**For SMI:**

| Data | Personal data? |
|---|---|
| A member **company's** name, page, stats, invoices | No, if the member is a limited company. **Yes if the member is a sole trader or partnership**: those *are* people. |
| The **login email** (e.g. `jane@acme.co.uk`) | Yes. |
| **Activity on the shared company login** (sign-ins, edits, pages viewed) | **Treat it as yes.** One login per company does not anonymise it. The login email usually names a person, and in a small firm it is usually obvious who used it. The ICO has no guidance specific to shared logins; this is our reading of its tests. |
| CRM contacts (~2,700 from Bigin), newsletter subscribers, contact-form senders | Yes. |
| Visitor analytics rows (`session_hash` = hash of IP + browser) | Yes. It is pseudonymised, not anonymous (see §15, G2). |
| Daily totals (`rollups_daily`, `consent_stats`) | No. |

The working rule: **anything tied to a login, an email, an IP or a session hash is personal data.**

---

## 3. The seven principles (Art 5)

> "Personal data shall be:
> (a) processed lawfully, fairly and in a transparent manner in relation to the data subject
> ('lawfulness, fairness and transparency');
> (b) collected (whether from the data subject or otherwise) for specified, explicit and legitimate
> purposes and not further processed by or on behalf of a controller in a manner that is
> incompatible with the purposes for which the controller collected the data ('purpose limitation');
> (c) adequate, relevant and limited to what is necessary in relation to the purposes for which they
> are processed ('data minimisation');
> (d) accurate and, where necessary, kept up to date; …
> (e) kept in a form which permits identification of data subjects for no longer than is necessary
> for the purposes for which the personal data are processed; … ('storage limitation');
> (f) processed in a manner that ensures appropriate security of the personal data, … ('integrity
> and confidentiality')."
>
> "(2) The controller shall be responsible for, and be able to demonstrate compliance with,
> paragraph 1 ('accountability')."
> — UK GDPR Art 5, [legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/5)

**For SMI, the ones that bite:**
- **Transparency.** People must be told what we do. The Policies page doesn't do this today (G1).
- **Purpose limitation.** If we log sign-ins for *security*, we cannot quietly reuse that log for
  *sales calls*. Purposes must be decided and stated up front. This drives the design in §16.
- **Minimisation.** Log the fields we need, not everything we can. The ICO's audit toolkit says the
  same of logs (§10).
- **Storage limitation.** Most tables have no deletion at all today (G3). The ICO is explicit that
  "you should not keep data indefinitely 'just in case'"
  ([ICO, storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)).
- **Accountability.** "Be able to demonstrate": this means written records (§12), not just good
  intentions.

---

## 4. Lawful basis (Art 6)

> "Processing shall be lawful only if and to the extent that at least one of the following applies:
> (a) the data subject has given consent to the processing of his or her personal data for one or
> more specific purposes;
> (b) processing is necessary for the performance of a contract to which the data subject is party
> or in order to take steps at the request of the data subject prior to entering into a contract;
> (c) processing is necessary for compliance with a legal obligation to which the controller is
> subject;
> (d) [vital interests] … (e) [public task] …
> (ea) processing is necessary for the purposes of a recognised legitimate interest;
> (f) processing is necessary for the purposes of the legitimate interests pursued by the controller
> or by a third party, except where such interests are overridden by the interests or fundamental
> rights and freedoms of the data subject which require protection of personal data, in particular
> where the data subject is a child."
> — UK GDPR Art 6(1), [legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/6)

Art 6(11) (new in 2026) gives examples of processing that "may be" a legitimate interest under (f):

> "(a) processing that is necessary for the purposes of direct marketing, … (c) processing that is
> necessary for the purposes of ensuring the security of network and information systems."

**Legitimate interests (f) is a three-part test.** All three must pass *before* we start:

> "Purpose test: Do you have a legitimate interest…? Necessity test: Is your use… necessary for that
> purpose? Balancing test: Do the person's interests, rights or freedoms override the legitimate
> interest…?"
> — [ICO, legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/what-is-the-legitimate-interests-basis/)

> "The UK GDPR doesn't require you to do an LIA. But you should do one anyway."
> — [ICO, applying legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/how-do-we-apply-legitimate-interests-in-practice/)
> ([LIA template](https://www.ico.org.uk/media2/15pbtz22/gdpr-guidance-legitimate-interests-sample-lia-template.docx))

**"Recognised legitimate interests" (ea)** skip the balancing test, but only cover five listed
purposes (Annex 1):
- disclosures to public bodies;
- national security, public security and defence;
- emergencies;
- crime;
- safeguarding vulnerable people.

None covers ordinary business like membership, marketing or analytics. Whether routine security
logging counts under "crime" is **unverified**: the ICO's examples are fraud and shoplifting, with
no IT-security case. **Use (f) for logging**, not (ea).
[ICO, recognised legitimate interest](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/recognised-legitimate-interest-detailed/what-is-the-recognised-legitimate-interest-basis/)

**Contract (b) is narrower than it sounds.** The ICO and EDPB both treat service-improvement
analytics as *not* necessary for the contract:

> "collection of organisational metrics relating to a service or details of user engagement, cannot
> be regarded as necessary for the provision of the service"
> — EDPB Guidelines 2/2019 para 48 ([PDF](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf); EU guidance, persuasive in the UK)

**For SMI, the basis for each thing we do:**

| Processing | Basis | Notes |
|---|---|---|
| Running a member's account, page, submissions, adverts | (b) contract | With the member company. For a limited company, the login user isn't the contracting party, so for *their* data the cleaner basis is (f). Either way it's expected and low-risk. |
| Invoices, payments, accounting records | (c) legal obligation | HMRC: 6 years (§16). |
| Security and audit logs (sign-ins, admin access) | (f) + Art 6(11)(c) | Needs an LIA. |
| Member dashboard-usage analytics | (f) | Needs an LIA. Not (b). |
| Public visitor analytics | (a) consent today | Could move to the PECR statistics exemption plus (f) (§7). |
| Newsletter to people who subscribed | (a) consent | |
| Marketing email to CRM business contacts | (f) | Plus PECR rules (§8). |
| "Who's engaging" (visitor IP → company) | (a) consent, plus a DPIA | Not built yet. See §7 and §12. |
| Editorial content naming people | Journalism exemption (§9) | |

---

## 5. Telling people: the privacy notice (Arts 12–14)

Information must be given "in a concise, transparent, intelligible and easily accessible form, using
clear and plain language" (Art 12(1)).

**When we collect data from the person themselves (Art 13),** we must tell them at the time:
- (a) "the identity and the contact details of the controller";
- (c) "the purposes of the processing … as well as the legal basis";
- (d) where relying on (f), "the legitimate interests pursued";
- (e) "the recipients or categories of recipients";
- (f) any transfer outside the UK and its safeguard;
- 13(2)(a) "the period for which the personal data will be stored, or if that is not possible, the
  criteria used to determine that period";
- 13(2)(b) the rights (access, rectification, erasure, restriction, objection, portability);
- 13(2)(c) the right to withdraw consent;
- **13(2)(ca), new from 19 Jun 2026: "the right to make a complaint to the controller under section
  164A of the 2018 Act"**;
- 13(2)(d) the right to complain to the Commission;
- 13(2)(e) whether giving the data is required, and what happens if they don't.

— [legislation.gov.uk Art 13](https://www.legislation.gov.uk/eur/2016/679/article/13)

**When the data came from elsewhere (Art 14)**, e.g. CRM contacts imported from Bigin or the
WordPress member list, we must also give:
- the categories of data;
- the source;
- the notice "within a reasonable period … but at the latest within one month", or at first contact.

— [legislation.gov.uk Art 14](https://www.legislation.gov.uk/eur/2016/679/article/14)

**The right to object must be flagged on its own:**

> "explicitly brought to the attention of the data subject … at the latest at the time of the first
> communication … clearly and separately from any other information." — Art 21(4)

**For SMI:** the current Policies page meets none of this (G1). The real privacy notice needs at
least these sections:
- who we are, and how to contact us;
- what we collect, for each group: members, contacts, subscribers, visitors;
- why, and on what basis (the §4 table);
- who receives it (§11);
- how long we keep it (§16 plus G3);
- people's rights, with the right to object set apart;
- how to complain to us, then to the Information Commission;
- cookies (§7), including the advert-impression counting already decided in GAPS D1.

---

## 6. People's rights, deadlines, and the new complaints duty

| Right | Article | What it means for us |
|---|---|---|
| Access ("subject access request") | 15 | A member user or contact can ask for everything we hold on them. |
| Rectification | 16 | Fix what's wrong. |
| Erasure | 17 | Delete on request when one of the grounds applies. Exceptions include "exercising the right of freedom of expression and information" (17(3)(a): editorial content) and "legal claims" (17(3)(e)). |
| Restriction | 18 | Pause use while a dispute is resolved. |
| Portability | 20 | Data given under consent or contract, in a usable format. |
| **Object** | 21 | Against anything on (f) or (ea). We must stop "unless the controller demonstrates compelling legitimate grounds". **Absolute for direct marketing.** |

Art 21(1):

> "The data subject shall have the right to object, on grounds relating to his or her particular
> situation, at any time to processing of personal data concerning him or her which is based on
> point (e), (ea) or (f) of Article 6(1) … The controller shall no longer process the personal data
> unless the controller demonstrates compelling legitimate grounds for the processing which override
> the interests, rights and freedoms of the data subject or for the establishment, exercise or
> defence of legal claims."
> — [legislation.gov.uk Art 21](https://www.legislation.gov.uk/eur/2016/679/article/21)

**Deadlines (Art 12A, from 5 Feb 2026):**
- one month from receiving the request (or the ID check, or the fee, whichever is latest);
- can be extended "by two further months" for complex or numerous requests, telling them within the
  first month;
- "Stop the clock": the time spent waiting for a clarification we "reasonably require" doesn't count.
- Requests are free unless "manifestly unfounded or excessive" (Art 12(5)).

**Access requests are bounded:**

> "the data subject is only entitled to such confirmation, personal data and other information as the
> controller is able to provide based on a reasonable and proportionate search"
> — Art 15(1A), in force from Royal Assent and retrospective to 1 Jan 2024

**New complaints duty (DPA 2018 s.164A, in force 19 Jun 2026).** We must:
- "give people a clear way to raise a data protection complaint";
- "acknowledge it within 30 days";
- "communicate the outcome".

Breaking it falls under the standard fine maximum (§13). Source:
[ICO news, June 2026](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/06/new-data-protection-complaints-law-now-in-force/).
The ICO page reads as 23 June, but the commencement SI says 19 June; **we use the SI's date**.

**For SMI:**
- **We have no process for any of these yet.** The minimum: a named contact address in the
  privacy notice, a written procedure, and a way to export one person's or member's data (G8).
- **A deletion has to reach every system we've shared the data with.** Today a member deletion can
  leave the `contacts` row, Resend's audience and Bigin untouched.

---

## 7. Cookies and device storage (PECR reg 6)

> "Subject to Schedule A1, a person must not store information, or gain access to information
> stored, in the terminal equipment of a subscriber or user."
> — PECR reg 6(1), [legislation.gov.uk](https://www.legislation.gov.uk/uksi/2003/2426/regulation/6)

"Gain access" includes "collecting or monitoring information automatically emitted by the terminal
equipment", i.e. fingerprinting (reg 6(2)).

**Exceptions (Sch A1, in force 5 Feb 2026)** — [legislation.gov.uk](https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1)

| Para | Exception | Conditions |
|---|---|---|
| 2 | **Consent** | Clear and comprehensive information, plus consent. |
| 4 | **Strictly necessary** | For a service the user requested. Includes security, fraud prevention, "automatically authenticating the identity of the subscriber or user", and remembering form input. |
| 5 | **Statistics (analytics)** | All of the conditions below must hold. |
| 6 | **Appearance and functionality** | Adapting the site to the user's preferences, with the same information-plus-objection conditions as para 5. |

For the statistics exception (para 5), all of these must hold:
- the sole purpose is "to collect information for statistical purposes about how the service is used
  with a view to making improvements to the service";
- the information is not shared except to help make those improvements;
- the user is given "clear and comprehensive information";
- they are "given a simple means of objecting, free of charge … and does not object".

**ICO limits on the analytics exception** —
[ICO, what are the exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)

> "It is about how your service is used, not about who uses it. It is not for identifying, tracking
> or monitoring people or groups of people who use your service."

> "if you make inferences or take decisions about people (or categories of people) based on
> information like their IP address or category on your service" [the exception won't apply and you
> must get consent]

> "If your service uses storage or access technologies for the purposes of online advertising, you
> must get consent. You cannot rely on any of the exceptions."

> "if you say your use of a particular technology is strictly necessary because of the purpose (eg
> security), you must ensure that you only use it for this purpose. If you use it for any other
> purpose as well, the exception does not apply and you must then get consent."

**For SMI — our cookies today.** Verified in code; the inventory is in §14.

| Cookie | Purpose | PECR position |
|---|---|---|
| `sb-*` (Supabase auth) | Login session | Strictly necessary (para 4). |
| `smi-view-as` | Admin viewing as a member | Strictly necessary (admin-only, security-relevant). |
| `smi-consent` | Stores the cookie choice | Strictly necessary. |
| `smi-ads` | Admin advert preview | Strictly necessary for the admin feature. |
| `smi-theme` | Design switcher (currently off) | Appearance (para 6), or strictly necessary for a feature the admin asked for. Not gated; fine while the switcher is admin-only. |
| `viewed_cats` | Personalises the news page | Appearance (para 6). Already gated behind "Accept". |
| Analytics (`analytics_events` via `session_hash`) | Readership stats | **Doesn't store anything on the device**: we hash IP + browser on the server. Reading "information automatically emitted" may still count as "access" under reg 6(2). Consent-gated today, which is the safe side. |
| Newsletter click counts (`analytics_events`, no identifier) | Counting clicks from a newsletter issue | **Recorded without consent since 21 Oct 2026** (Luiza's decision, GAPS B5.10), but only as a bare count: the event, the time, what was clicked and the issue. No session hash, referrer, region or company, and the IP and browser are never read (`requestContext()` returns before touching them; `record()` blanks the fields again). Only for links that carry `src=newsletter`. With consent, the usual full row is kept instead. See consequence 4. |

Three consequences:
1. **"Who's engaging" (IP → company) must stay consent-based.** It is the textbook case the ICO
   excludes: decisions about *who* visited, based on IP. Its output is also about third parties
   (the visiting companies), so it doesn't fit "improving our service" either.
2. **Plain readership analytics *could* move off consent** to the statistics exception, if:
   - the policy explains it;
   - there's a free, simple opt-out (the ICO says a default-on toggle works);
   - the data is used only to improve the site.

   But today the same `analytics_events` rows feed **members' stats** (who viewed *their* page). That
   is reporting to third parties, arguably beyond "improving the service". **Keep consent** unless a
   solicitor signs off.
4. **Anonymous newsletter click counts (21 Oct 2026).** A row with no identifier is not personal
   data (§2), and nothing is read from the device beyond the request itself, which is needed to serve
   the page or the redirect. That is the reasoning for counting these without consent. It has not
   been checked by a solicitor. Two things to put to one alongside consequence 2:
   - these rows also count towards **members' story-view figures** (a story_view from a newsletter
     link is credited to the story's member like any other view), which is reporting to third
     parties, though only as a count;
   - the privacy notice should say that newsletter clicks are counted, anonymously, whatever the
     cookie choice (for the rewrite ask-jas 27 unblocks).
3. **Logged-in member activity is not a PECR question** once the user is authenticated. We read the
   `sb-*` cookie to authenticate (strictly necessary), and what we then record on the server is UK
   GDPR processing.
   - **Caveat (uncertain):** the ICO's multi-purpose rule above could be argued against using the
     auth cookie as the hook for usage analytics.
   - Keeping the auth cookie for authentication only, and stating the activity-log purpose in the
     privacy notice, is the cautious design. §16 follows it.

**Embeds load before consent (G5).** YouTube (`youtube-nocookie.com`) iframes and OpenStreetMap tiles
load in the visitor's browser regardless of the cookie choice. That sends the visitor's IP to Google
and OSM.
- `youtube-nocookie` sets no cookies until a video is played. **Unverified** whether it uses other
  device storage before playback.
- At minimum the privacy notice must name both. The stronger fix is click-to-load placeholders.

---

## 8. Marketing email (PECR regs 22–23)

> "This regulation applies to the transmission of unsolicited communications by means of electronic
> mail to individual subscribers." — PECR reg 22(1), [legislation.gov.uk](https://www.legislation.gov.uk/uksi/2003/2426/regulation/22)

**Individual subscribers.** No marketing email without consent, except under the **soft opt-in**
(reg 22(3)). That needs all three:
- we got the details "in the course of the sale or negotiations for the sale of a product or
  service";
- the marketing is about "similar products and services only";
- an opt-out was offered when we collected the details, and is offered in every message.

**Corporate subscribers** (limited companies, LLPs and the like) are outside reg 22. The ICO says
the electronic mail rule "does not apply to corporate subscribers". An employee's work address at a
company counts as the company's.
[ICO B2B](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)
(The ICO says this guidance is "under review" after the DUAA.)

**Reg 23 applies to all marketing email.** We must not hide who we are, and must give "a valid
address to which the recipient … may send a request that such communications cease".

**For SMI:**
- Emailing `name@ltdcompany.co.uk` needs no PECR consent. It still needs:
  - a UK GDPR basis (f);
  - a privacy notice;
  - an unsubscribe in every email;
  - honouring objections permanently (Art 21(3)).
- **Sole traders and ordinary partnerships are "individuals":** they need consent or the soft opt-in.
  The ~2,700 Bigin contacts aren't tagged by company type (G9).
- The newsletter is opt-in through the site form, which is fine. We don't record what the person
  saw when they signed up, so we can't *prove* the consent (Art 7(1)) (G9).
- Unsubscribes already sync back to Bigin and stick (`requirements/05-platform-layer.md:11`).

---

## 9. The journalism exemption

DPA 2018 Sch 2 para 26 can switch off most of the UK GDPR for "the special purposes", which include
"the purposes of journalism". It applies only where all three hold:
1. the processing is "with a view to the publication by a person of journalistic … material";
2. the controller "reasonably believes that the publication of the material would be in the public
   interest";
3. the controller reasonably believes that applying a listed provision "would be incompatible with
   the special purposes".

It can disapply, among others: Art 5(1)(a)–(e), 6, 13–17, 21(1), 34 and 44A.
[legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2018/12/schedule/2/paragraph/26)

**For SMI:**
- **It covers:** news stories, interviews and press releases that name people. Someone named in an
  article generally can't demand its erasure on data protection grounds.
- **It does not cover:** member accounts, the CRM, the newsletter list, analytics, or activity
  auditing. None of those is processing "with a view to publication".
- **The decision is case by case** and must be "reasonable", so a story that names a private
  individual should still get a quick "is this in the public interest?" thought.

---

## 10. Security, breaches, and logging

> "the controller and the processor shall implement appropriate technical and organisational
> measures to ensure a level of security appropriate to the risk, including inter alia as
> appropriate: (a) the pseudonymisation and encryption of personal data; (b) the ability to ensure
> the ongoing confidentiality, integrity, availability and resilience of processing systems and
> services; (c) the ability to restore the availability and access to personal data in a timely
> manner …; (d) a process for regularly testing, assessing and evaluating the effectiveness …"
> — UK GDPR Art 32(1), [legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/32)

**Breaches (Art 33/34).**
- Tell the Commission "without undue delay and, where feasible, not later than 72 hours after
  having become aware of it", unless it's "unlikely to result in a risk".
- Tell the affected people too if it's a "high risk".
- **Record every breach** (33(5)), including ones we don't report.

**What the ICO expects of logs.** From its own audit toolkit, verbatim:

> "Produce a documented policy that sets out logging requirements."
> "Ensure logs are sufficiently detailed to assess whether the use of systems and applications is
> permitted."
> "Regularly review and analyse logs to identify any unusual activity that may indicate unauthorised
> access and misuse of systems and applications."
> "Protect logs by making sure staff with privileged access rights do not have permission to delete
> or de-activate their own activities."
> — [ICO audit toolkit, system and network security](https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/information-and-cyber-security/system-and-network-security/)

The ICO and NCSC security outcomes add: "You record user access to personal data" (C.1), and
two-factor authentication for privileged users (B.2).
[ICO security outcomes](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/security-outcomes/)

**How long to keep logs.** The ICO sets no period. NCSC suggests:
- "a minimum of 6 months" ([intro to logging](https://www.ncsc.gov.uk/guidance/introduction-logging-security-purposes));
- "13 months" for critical areas and "something like 180 days" for less critical ones
  ([NCSC blog](https://www.ncsc.gov.uk/blog-post/what-exactly-should-we-be-logging)).

Recent enforcement shows what "no monitoring" costs. The ICO fined 23andMe £2.31m (June 2025),
partly for lacking "effective systems in place to monitor, detect, or respond to cyber threats".
[ICO](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2025/06/23andme-fined-for-failing-to-protect-uk-users-genetic-data/)

**For SMI:**
- **We record nothing about admin access to member data.** That includes the new "View as member"
  feature (fix-list 94). This is the clearest gap against the ICO's expectations, and the one §16
  fixes first.
- **Admin accounts have no two-factor authentication** (G7).
- **No breach procedure or breach register exists** (G8).

---

## 11. Processors and transfers abroad

**Processors (Art 28).** Use "only processors providing sufficient guarantees", under a written
contract that covers:
- acting "only on documented instructions";
- confidentiality;
- security;
- sub-processors;
- helping us with requests and breaches;
- deleting or returning the data at the end;
- audits.

In practice this is each provider's standard Data Processing Agreement (DPA): accept it and keep a
copy.

**Transfers outside the UK (Arts 44A–46, from 5 Feb 2026).** A transfer must be either:
- approved by UK regulations (the UK's own "adequacy" list); or
- under safeguards (e.g. the ICO's IDTA or the UK Addendum to EU clauses), where we, "acting
  reasonably and proportionately", consider that the "data protection test" is met: protection "not
  materially lower" than UK law.

The ICO is explicit that "The EU SCCs are not valid on their own for restricted transfers under the
UK GDPR."
[ICO transfers](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/appropriate-safeguards/what-are-standard-data-protection-clauses-the-uk-idta-and-the-addendum/)

**For SMI — who receives personal data.** From the code inventory; status "to check" means we
haven't verified their DPA or certification.

| Provider | What they get | Where | Status |
|---|---|---|---|
| Supabase | Everything (database, auth, files) | **London (eu-west-2)**: inferred from the production pooler hostname, not confirmed in the dashboard. `README.md` still names the old Canada project. | Confirm region; accept DPA |
| Vercel | Hosting, function logs (incl. IPs, some emails in log lines: G6) | US company | DPA; transfer mechanism to check |
| Stripe | Member billing email, member id | US/Ireland | DPA; to check |
| Resend | Every email we send, the newsletter audience, open/click events | US company | DPA; to check |
| Zoho Bigin | CRM contacts: names, emails, opt-out flag | EU data centre (`zoho.eu` default) | DPA; to check |
| Nominatim (OSM) | Member addresses, at each profile save | Server-to-server | Low risk; name it in the notice |
| YouTube, OSM tile servers | Visitor IPs (embeds; G5) | Third parties, not processors | Name them in the notice |
| Buffer | Social posts (company handles only) | US | Probably no personal data |

**For the US providers:** the UK's "data bridge" (The Data Protection (Adequacy) (United States of
America) Regulations 2023, [S.I. 2023/1028](https://www.legislation.gov.uk/uksi/2023/1028/regulation/3))
covers transfers to US companies certified to the UK Extension of the EU–US Data Privacy Framework.
**Unverified:**
- that it is still in force unamended as of Oct 2026;
- whether Vercel and Resend are on the list.

Check each on the DPF list (dataprivacyframework.gov), or rely on their IDTA/Addendum.

---

## 12. Paperwork: records, LIAs, DPIAs, the fee

**Records of processing (Art 30).** Small organisations are exempt, *except* when:

> "… unless the processing it carries out is likely to result in a risk to the rights and freedoms of
> data subjects, the processing is not occasional, or the processing includes special categories of
> data …"
> — Art 30(5), [legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/30)

The conditions are joined by "or". Running a membership platform and a CRM every day is "not
occasional", so **we should keep a record**. This document's §14 is a start. The ICO's template is a
spreadsheet.

**Legitimate Interests Assessments.** Write one for each (f) purpose in §4. At minimum:
- security and audit logging;
- member dashboard-usage analytics;
- B2B marketing email.

**DPIA (Art 35).** Required where processing is "likely to result in a high risk". The ICO's
high-risk list includes:
- "Combining, comparing or matching personal data obtained from multiple sources" (data matching);
- invisible processing;
- tracking an individual's behaviour.

[ICO list](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk).
"If in any doubt, we would always recommend that you do a DPIA"
([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/)).

**For SMI:**
- **IP → company "Who's engaging" (not built): DPIA likely *required*.** It involves tracking, data
  matching against a vendor's company database, and invisible processing (the visitor doesn't know).
  Do the DPIA before switching on any company-match vendor (TECH-DECISIONS #8).
- **Member-activity auditing as designed in §16: DPIA *advisable*, not clearly required.** It is
  tracking only, not combined with another high-risk factor. A short DPIA covering both is the
  defensible route.

**The data protection fee.** Every controller pays unless *all* its processing is exempt. Our
editorial and platform processing isn't exempt.
[S.I. 2018/480 reg 3](https://www.legislation.gov.uk/uksi/2018/480/regulation/3); amounts from
17 Feb 2025.

| Tier | Who | Fee |
|---|---|---|
| 1 (micro) | Turnover ≤ £632,000 **or** ≤ 10 staff | **£52** |
| 2 | Turnover ≤ £36m or ≤ 250 staff | £78 |
| 3 | Everyone else | £3,763 |

Direct debit takes £5 off. The fixed penalty for not paying is £400 / £600 / £4,000 by tier
([ICO](https://ico.org.uk/about-the-ico/our-information/fixed-penalties-for-failure-to-pay-the-data-protection-charge/)).
SMI is almost certainly tier 1. **Whether SMI has paid is unknown**: the question to Jas (old
ask-jas §10) was removed without an answer (G10).

---

## 13. Fines

> "in the case of an undertaking, £17,500,000 or 4% of the undertaking's total annual worldwide
> turnover in the preceding financial year, whichever is higher"
> — DPA 2018 s.157, the higher maximum, [legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2018/12/section/157)

| Tier | Maximum | Covers |
|---|---|---|
| Higher | £17.5m or 4% | Principles, lawful basis, consent, rights, transfers. **Since 5 Feb 2026 also PECR cookies (reg 6) and marketing email (regs 22–23).** |
| Standard | £8.7m or 2% | Controller duties: security, records, DPIAs, processors. Also the new complaints duty. |

Before 5 Feb 2026, PECR fines were capped at £500,000.

For context:
- The ICO reports 99% cookie compliance across the top 1,000 UK sites (April 2026).
- We found no ICO cookie *fine* in 2024–2026; it has used warnings and preliminary notices.
- Realistic risk for a site our size is a complaint, then an ICO letter or reprimand, then
  reputational harm with members.

---

## 14. What we hold today

Built from the schema and code on 20 Oct 2026. Treat it as the draft of our record of processing.

| Store | Personal data | Whose | Kept for |
|---|---|---|---|
| `auth.users`, `profiles` | Login email, password hash, `last_sign_in_at`, display name | Member logins, admins | Until the member is deleted from the console. **Not on lapse or archive.** |
| `members` | Contact email, phone, address, lat/lng, social links, Stripe ids, key dates | Member companies (people, if sole traders) | Forever (archive only hides) |
| `contacts` | Name, email, company, Bigin ids, subscribed / unsubscribed | CRM contacts (~2,700), subscribers | **Forever**: "Nothing is ever deleted on either side" (`src/lib/adapters/crm.ts`) |
| `newsletter_signups` | Email, time | Public subscribers | **Forever** |
| `inbox_messages` / `inbox_replies` | Name, email, message text | Enquirers, members | **Forever** |
| `analytics_events` (monthly partitions) | `session_hash`, full referrer, path | Consenting visitors | **Forever**: partitions are never dropped |
| `search_queries` | Free-text query, `session_hash` | Consenting visitors | **Forever** |
| `error_events` / `error_occurrences` | User id, user-agent, path | Anyone who hit an error | **90 days** (`log_retention` job) |
| `dev_tasks` | Reporter email, page context | Admins | Manual |
| `notifications`, `jobs` | Member id, read time | Members | Forever |
| `invoices` + private bucket | Member, amounts, Stripe session; PDF "Billed to" | Members | Forever (should be 6 years) |
| Content tables | `submitted_by`, `approved_by`, `decided_by`, `ended_by` | Members, admins | With the content |
| `prospect_marks` | LinkedIn URL, note | Lead-gen prospects (mock data today) | Manual |
| Rate limiter | Raw IP in memory only | Form users | Minutes |
| Vercel function logs | Request IPs; some emails in log lines (G6) | Various | Vercel's retention (not checked) |

The cookies are in §7 and the providers in §11.

---

## 15. Gaps found

These are things in the app or docs that don't meet the above. Numbered here so they can move into
`GAPS.md`, `HUMAN-TODO.md` or `ask-jas.md` as decided. **G2, G4 and G6 were fixed on 20 Oct** (rows marked);
the rest are open. Jas's questions are ask-jas 27; the production push is HUMAN-TODO §29.

| # | Gap | Law | Severity |
|---|---|---|---|
| **G1** | **The Policies page is not a privacy notice.** It calls itself one, but is cookie boilerplate. It claims we use Google Analytics, which we don't (`scripts/lib/static-page-content.ts:190`). It lacks every Art 13 item, the impression rule (D1) and the new complaint right. | Arts 5(1)(a), 12–14 | **High**: the most visible failure |
| **G2** | **Fixed 20 Oct.** The visitor "session hash" was an unsalted 32-bit hash of IP + browser: anyone could recompute it from an IP, or brute-force it back. It is now a keyed HMAC-SHA256 (`sessionHash()` in `src/lib/analytics.ts`), which can't be reversed or matched without the server key. **Not rotated daily:** the Command Centre's yearly "site users" figure counts distinct visitors, so a daily salt would count one person once a day. It is still pseudonymous personal data. Daily rotation stays an option if Jas drops that figure. Side effect: HUMAN-TODO 29.3. | Arts 5(1)(c), 25, 32 | — |
| **G3** | **No retention on most tables:** analytics, searches, signups, inbox, contacts, notifications, invoices beyond 6 years. Lapsed and archived members' logins stay live. Only error logs (90 days) and staged uploads are swept. | Art 5(1)(e) | **High**: needs Jas's periods (§17) |
| **G4** | **Fixed 20 Oct** — the security log (§16 A): migration `20261020000001`, `src/lib/audit.ts`. It records sign-ins (and failed ones), sign-outs, password and login-email changes, view-as start and stop, and console member changes. Production needs HUMAN-TODO 29.1. Not logged yet: the join flow's first sign-in, and admin edits outside member records (stories, adverts, contacts). | Art 32; ICO toolkit (§10) | — |
| **G5** | YouTube and OSM embeds load before any choice and send visitor IPs to third parties, and the notice doesn't name them. | Arts 13(1)(e); possibly PECR reg 6 | Medium |
| **G6** | **Fixed 20 Oct.** Email addresses were written to Vercel logs. The Resend webhook now logs the contact id, and the dev email senders log a masked address (`maskEmail()`, `j…@acme.co.uk`). | Arts 5(1)(c), 32 | — |
| **G7** | No two-factor authentication for admin accounts. | Art 32; ICO outcome B.2 | Medium |
| **G8** | No documented process for subject access, erasure, objection or complaints. No breach register. No way to export or delete one person across Supabase, Resend and Bigin. | Arts 12–21, 33(5); DPA s.164A | **High**: complaints duty in force since 19 Jun 2026 |
| **G9** | Newsletter consent isn't evidenced (no wording or time recorded beyond `created_at`). The Bigin import isn't tagged for sole traders. | Art 7(1); PECR reg 22 | Medium |
| **G10** | The ICO fee, retention periods and controller identity are unanswered. Old ask-jas §10 was deleted in `97975e6` without an answer, and fix-list 69 still points to it. | DPA 2018 fee regs; Art 13(1)(a) | **High**: blocks G1 |
| **G11** | The database region isn't confirmed or recorded (README names the old Canada project). No processor DPAs are on file. | Arts 28, 44A | Medium |
| **G12** | No LIAs, no record of processing, no DPIA. | Arts 5(2), 30, 35 | Medium |

---

## 16. Member-activity auditing: what we can keep

**Short answer:** quite a lot, as long as each kind of record has:
- one stated purpose;
- a lawful basis;
- a retention period;
- a line in the privacy notice.

What we can't do is collect everything "in case it's useful" and decide later.

Three things make this workable:
- members are businesses;
- the activity happens inside a paid service they signed up for;
- SMI has a genuine need for security, disputes and renewals.

All three point towards it being **within reasonable expectations** (the ICO's balancing test).

### What to keep

| | What | Why (purpose) | Basis | Keep for | Who sees it |
|---|---|---|---|---|---|
| **A. Security log** | Sign-in success and failure; sign-out; password reset; login-email change; **admin "View as member" start and stop** (which admin, which member, when); admin edits to a member record; archive, delete, activate; role changes. IP address on sign-in events only. | Detect unauthorised access, investigate incidents, prove who did what | (f) + Art 6(11)(c) | **12 months** (inside NCSC's 6–13); **IPs nulled after 90 days** | Developer always. Jas: view-as and admin-edit entries. **Not deletable or editable by any admin** (ICO toolkit). |
| **B. Account record** | What the member submitted, edited, withdrew or uploaded; profile-edit requests; advert bookings; payments and cancellations; preference changes. **Mostly exists already** (`submitted_by`, `approvals`, `member_revisions`, `invoices`, inbox notifications). | Run the service, settle disputes ("we never submitted that") | (b) contract, (f) for disputes | Membership + **6 years** for anything financial or contractual (Limitation Act s.5; HMRC). Content history lives with the content. | Jas (it's his platform's record), and the member themselves |
| **C. Usage summary** | **Per member company, per month:** number of sign-ins, days active, which dashboard sections were opened (stats, leads, adverts, …), last active date. **Counts, not a click-stream.** | Show Jas whether members use what they pay for; inform renewal conversations; improve the member area | (f), with an LIA | **13 months**, then roll up to yearly totals with no per-login detail | Jas, in the member's console page and the activity timeline |

### Why C is counts and not a click-stream

- **Minimisation (Art 5(1)(c)).** Jas's actual question is "is this member using SMI?". Monthly
  counts answer it. A list of every page and click doesn't answer it any better, and holds far more
  about the person behind the login.
- **Reasonable expectations (the balancing test).** A member expects their supplier to know they
  logged in and looked at their stats. They don't expect a record of every click that a salesperson
  can scroll through before calling them.
- **It keeps the requirements' line.** "you can't say that Rishi Gupta, who works at JLR, has logged
  in" (`requirements/DESIGN-QUOTES.md:1079`) was about *visitors*. The same instinct applies here.
  Company-level counts are what Jas needs; individual behaviour isn't.

### What not to keep

- **Session replay, keystroke or click-by-click recording** of member sessions.
- **Linking a logged-in member's reading on the *public* site to their identity.** For example,
  "Acme read these five competitor stories". Public analytics is consent-gated and pseudonymous by
  design. Using the login to join them up would sidestep the consent choice.
- **Reading the *contents* of unsent drafts** for anything other than running the service.
- **Showing one member anything about another member's activity.**
- **Reusing the security log (A) for sales or renewal calls.** That's purpose creep (Art 5(1)(b)).
  Renewal conversations use B and C, which are disclosed for that purpose.

### What has to be true before we build it

1. **Privacy notice (G1):** a members section saying we keep A, B and C, why, for how long, and that
   members can object (stated separately, Art 21(4)).
2. **Membership terms:** one plain sentence pointing to it.
3. **Two short LIAs:** one for A, one for C (B rests on the contract). The ICO template is fine.
4. **Retention periods signed off by Jas** (§17), and enforced by a scheduled job like the existing
   `log_retention`. Not by hand.
5. **Admins can't edit or delete the security log.**
   - The table gets no update or delete permission, and writes go through a database function.
   - Deletion happens only through the retention job.
   - Jas's console shows it read-only.
6. **An entry in the record of processing** (G12). A short DPIA covering A and C is advisable.

### What's built (20 Oct), and what isn't

**A is built**, ahead of the privacy notice. The ICO expects it as a *security* measure (§10).
The log is new, so nothing existing changes. The notice must still describe it before it can be
said to be transparent (G1).
- **Table:** `audit_events` (migration `20261020000001`) holds action, actor, role, member, minimal
  detail, and IP for security events only.
- **Append-only:** the app's database role may insert and read, never update or delete. This was
  checked against the local database: both are refused. The only change path is
  `purge_audit_events()`, run daily by the `log_retention` job:
  - rows are kept 12 months;
  - IPs and attempted-login emails are kept 90 days.
- **Where it's written:**
  - `src/lib/audit.ts` (`audit()`, which never throws);
  - the login page, sign-out, password reset and change, the login-email change and its
    confirmation link;
  - `startViewAs` and `stopViewAs`;
  - the console's create, edit, status, payment, archive, unarchive and delete member actions.
- **What Jas sees:** an "Admin access" card on each console member page. It lists view-as sessions
  and admin changes, newest first, with the admin's name. Members' own sign-ins stay out of it
  (purpose limitation).
- **Not checked:** Supabase's own auth audit log may already hold sign-ins (HUMAN-TODO 29.2).
- **B** needs nothing new. `memberActivityTimeline()` (`src/lib/activity.ts`) already merges most
  of it.
- **C is not built.** It waits for Jas's go-ahead (§17.4) and the privacy notice. When built: a
  small counter table (member, month, section, count) incremented from `requireMemberView()` on
  member page loads. It must skip admins viewing as a member: those visits are A, not member usage.

---

## 17. Decisions needed from Jas

None of the high-severity gaps can close without these:

1. **Who is the controller?** The legal entity name, its address, and the data protection contact
   email. These go at the top of the privacy notice.
2. **Is SMI registered with the ICO (now the Information Commission), and on what number?** If not,
   pay the tier-1 £52 fee.
3. **Retention periods.** Proposed defaults, for Jas to accept or change:

   | Data | Proposed retention |
   |---|---|
   | Visitor analytics rows | 26 months (two year-on-year comparisons), then totals only |
   | Search queries | 12 months |
   | Contact-form and inbox messages | 2 years after the last reply |
   | Lapsed or cancelled members' logins | Disabled at lapse; deleted 12 months later |
   | Lapsed or cancelled members' account records | 6 years for anything financial; profile data 12 months |
   | Newsletter unsubscribes | The email is kept as a suppression marker only, forever. Erasing it would let us email them again. |
   | Security log | 12 months; IPs 90 days |
   | Usage summary | 13 months |
   | CRM contacts | Reviewed if there's been no engagement for 3 years |

4. **Activity auditing (§16):** go ahead with A, B and C as described?
**Decided, not asked:** "Who's engaging" by company name is **paused** (Luiza, 20 Oct). It stays
region-level, as agreed with Jas on 4 Aug. Any company-match vendor needs a DPIA and a solicitor's
view first (§7, §12).

---

## 18. Sources

All fetched 20 Oct 2026.
- **Legislation:** from legislation.gov.uk (the point-in-time version valid from 30 Sep 2026).
- **Spot-checked verbatim:** every quote attributed to Art 6, Art 30(5), PECR Sch A1, S.I. 2026/82,
  S.I. 2026/1015, S.I. 2018/480 reg 3, DPA Sch 2 para 26, and the two ICO pages quoted in §7 and §10.

**Legislation**
- UK GDPR: https://www.legislation.gov.uk/eur/2016/679/contents (Arts 4, 5, 6, 7, 8A, 12, 12A, 13, 14, 15, 17, 21, 25, 28, 30, 32, 33, 34, 35, 44A, 45B, 46; Annex 1)
- Data Protection Act 2018: s.157 https://www.legislation.gov.uk/ukpga/2018/12/section/157 · s.164A https://www.legislation.gov.uk/ukpga/2018/12/section/164A · Sch 2 para 26 https://www.legislation.gov.uk/ukpga/2018/12/schedule/2/paragraph/26
- PECR: reg 6 https://www.legislation.gov.uk/uksi/2003/2426/regulation/6 · Sch A1 https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1 · reg 22 https://www.legislation.gov.uk/uksi/2003/2426/regulation/22 · reg 23 https://www.legislation.gov.uk/uksi/2003/2426/regulation/23
- Data (Use and Access) Act 2025: https://www.legislation.gov.uk/ukpga/2025/18/contents
- Commencement: S.I. 2026/82 https://www.legislation.gov.uk/uksi/2026/82/made · S.I. 2026/1015 https://www.legislation.gov.uk/uksi/2026/1015/made
- Fee: S.I. 2018/480 reg 3 https://www.legislation.gov.uk/uksi/2018/480/regulation/3
- US adequacy: S.I. 2023/1028 https://www.legislation.gov.uk/uksi/2023/1028/regulation/3
- Limitation Act 1980 s.5: https://www.legislation.gov.uk/ukpga/1980/58/section/5

**ICO**
- Personal information: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-information-a-guide/
- Legitimate interests: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/
- Recognised legitimate interest: https://ico.org.uk/for-organisations/recognised-legitimate-interest-guidance/
- Storage and access technologies, exceptions: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/
- B2B marketing: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/
- Storage limitation: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/
- Security outcomes: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/security-outcomes/
- Audit toolkit, system and network security: https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/information-and-cyber-security/system-and-network-security/
- DPIAs: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/
- Privacy information: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
- Data protection fee: https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/
- Complaints law (June 2026): https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/06/new-data-protection-complaints-law-now-in-force/

**Other**
- NCSC logging: https://www.ncsc.gov.uk/guidance/introduction-logging-security-purposes · https://www.ncsc.gov.uk/blog-post/what-exactly-should-we-be-logging
- EDPB Guidelines 2/2019 (contract basis): https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf
- HMRC company records: https://www.gov.uk/running-a-limited-company/company-and-accounting-records
