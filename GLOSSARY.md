# SMI

Sheet Metal Industries: a trade-association site where member companies publish news, videos and events, and SMI's admins review and publish them.

## People

**Member**:
A company that belongs to SMI and has a public page on the site.
_Avoid_: client, customer, account

**Admin**:
Someone on SMI's own team (Jas and anyone working the console) who approves, writes and publishes content.
_Avoid_: the desk, operator, staff

## Content

**Content item**:
A Story, Video or Event that goes through review before it appears on the public site.
_Avoid_: post, entry, article (for all three)

**Story**:
A written news piece, either about a member or written by one.
_Avoid_: article, news item, post

**Video**:
A YouTube video shown on the site, either sent in by a member or added by an admin.

**Event**:
A dated industry happening (webinar, live event, open house, exhibition, golf challenge) listed in the events diary.

**Submission**:
A content item a member has sent in for an admin to review.
_Avoid_: request, upload

**Member draft**:
A story a member has saved but not yet submitted; it is private to them and admins never see or move it.

**Submission intake**:
How a content item is saved from a form: a member's submission or resubmission, or an admin's save in the console. It reads the form, stores the image, and writes the item; status moves after that belong to the content lifecycle.
_Avoid_: upload, import (importing is pulling items from outside sources)

**Resubmit**:
A member editing their own content item while it is Ready to review or Sent back, which puts it back to Ready to review. Refused, with nothing saved, if an admin changed the item since the member opened it.
_Avoid_: re-upload, update

## Lifecycle

**Content lifecycle**:
The set of statuses a content item moves through, and the rules for which moves are allowed and what each move sets off.
_Avoid_: workflow, pipeline

**Transition**:
One allowed move of a content item from one status to another.
_Avoid_: status change, state change

**Draft**:
Being written or edited by an admin; not public.

**Ready to review**:
Waiting for an admin to approve or decline it.
_Avoid_: awaiting approval, pending

**Scheduled**:
Approved and set to go live at a chosen time.

**Live**:
Visible on the public site.
_Avoid_: published, active

**Sent back**:
Declined with a reason the member is told, so they can edit and submit again.
_Avoid_: rejected, refused

**Withdrawn**:
Pulled back by the member who submitted it, while it was Ready to review or after it was Sent back. A transition like any other: refused if an admin moved the item first.

**Approve**:
An admin's decision that a content item that is Ready to review can go Live, either now or at a scheduled time.

**Decline**:
An admin's decision that a content item that is Ready to review isn't going Live yet. A member's item is Sent back with a reason; an item an admin wrote goes back to Draft and nobody is told ("Not yet").

**Publish now**:
Making a content item Live immediately instead of at a scheduled time; the urgent path.

**Schedule**:
Setting the time a story or video will go Live, which makes it Scheduled. Events are never scheduled; they go Live when approved.

**Take down**:
Moving a Live content item back to Draft.
_Avoid_: unpublish, return to draft

**Approval record**:
The lasting note of who approved or declined a content item, when, and why.
_Avoid_: audit log (that is a separate record of member account changes)

## Site design

**Design variant**:
One of the two layouts the public site can be shown in, grid (the default) or forge. Both use the same colours, type and components and differ only in how pages are arranged. "Theme" is an accepted synonym, used when talking with the client.
_Avoid_: skin, template, version

## Story discovery

**Story source**:
A company's news page that SMI watches for new articles that could become stories.
_Avoid_: target, feed (a feed is only one way a source is read)

**Source check**:
Reading the story sources that are due for new articles. Each source is read at most about once a day, whether the check was started by the schedule or by an admin.
_Avoid_: scrape, crawl, scan

**Suggestion**:
A new article that a source check found, waiting for an admin to start a story from it or dismiss it.
_Avoid_: lead (that is a member's enquiry), hit, find

## Console

**Command Centre**:
The console's home page: revenue, counts and "Needs You Today".
_Avoid_: command center, dashboard (that is the member area)
