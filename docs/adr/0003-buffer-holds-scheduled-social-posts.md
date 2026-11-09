---
status: accepted
---

# Buffer holds and sends scheduled social posts; Claude drafts each channel's wording

Amends [0001](0001-social-posts-need-per-channel-confirmation.md). Per-channel confirmation stays. What changes is who sends the post and when the check happens.

Until now the app kept every confirmed post itself and sent it to Buffer with "share now" at the channel's post time, re-checking the text just before sending. Luiza decided on 9 Nov 2026 that each channel in the story and video editors gets three steps, each its own button:

1. **Write with Claude.** Claude drafts that channel's wording from the story, to that network's rules. The admin can edit it.
2. **Send draft to Buffer.** A Buffer draft (`saveToDraft`), so the post can be checked inside Buffer as the network will show it. A draft never publishes.
3. **Schedule** or **Publish now.** These replace Confirm. Schedule hands the post to Buffer with its time (`customScheduled` + `dueAt`) and **Buffer sends it**. Publish now hands it over with `shareNow`.

Steps 1 and 2 are optional tools, not gates: step 3 is always available.

## Consequences

- **The app hands a post to Buffer only once the item is Live.** Schedule or Publish now on an item that isn't Live yet records the confirmation; the hand-off happens when the item goes Live. Buffer sends at whatever time it holds, whether or not the story is public, so this is the only way to be sure it never links to an unpublished page.
- **Claude writes the wording only.** The app still adds the story link and that network's member tags, and still fits X to 280. Claude cannot drop the link or invent a handle.
- **The "changed since you checked" rule moves from send time to save time.** Once Buffer holds a post the app is not there at send time. Saving an item whose text or image changed for a handed-over channel deletes that Buffer post and puts the channel back to waiting. **Cost:** a change made outside the editor (a member editing their social handle) no longer pulls back a post Buffer already holds.
- **Unpublishing, rescheduling or deleting an item deletes its unsent Buffer posts.**
- **The daily limit is checked at hand-off**, counting the posts already handed to Buffer for that channel's day. Buffer's own per-channel daily limit applies on top.
- **"Posted" means Buffer reported it sent.** The post-link job that already polls Buffer for each post's live URL also records when it went out.
- **A channel's Buffer draft is deleted when its real post is handed over** (`deletePost`). If the delete fails, the draft stays in Buffer and is cleared by hand.

## Considered options

- **The app keeps the post and sends it at the post time (as in 0001).** Recommended, and declined: Luiza wants scheduled posts held by Buffer.
- **Claude writes the whole post, link and tags included.** Declined: every result would need checking for a wrong link or handle.
- **Strict order (no Schedule without Claude text and a Buffer draft).** Declined: a quick post shouldn't need a paid Claude call and a Buffer round-trip, and an outage of either would block posting.
- **Turn the draft itself into the scheduled post (`editPost`).** Not used: Buffer's reference doesn't say an edit takes a post out of draft. Revisit once tested on a live account.
