---
status: accepted
---

# Social posts go out only after an admin confirms each channel

Until November 2026 a story or video going Live queued its social post automatically: it went out through Buffer 30 minutes later (or at its own post time) unless an admin ticked "Don't post", and nobody had to see the final text. Luiza decided on 5 Nov 2026 that nothing reaches SMI's social channels unless an admin has seen exactly what that channel will receive and confirmed it. The default flips from "posts unless stopped" to "posts only when confirmed". A post is public and permanent on someone else's network, and its text is assembled from parts nobody reads together: the lead-in, the summary it follows, member tags (trimmed for X), and the image.

Confirmation is **per channel**, not per item, so LinkedIn can go out while X is still being checked or deliberately skipped.

## Consequences

- **Confirmation stores a snapshot, not a flag.** Confirming records exactly what that channel would receive (text and image). Just before posting, the post is built again and compared. Any difference holds that channel back until someone confirms it again. This catches changes made outside the editor, such as a member editing their social handle (which changes the tags), without every edit path having to remember to clear confirmations.
- **An unconfirmed channel waits indefinitely.** It never expires and never posts by default. Once its post time has passed it shows in Needs You Today and the admin digest. "Don't post" (per channel, or for the whole item) is a separate decision, so a deliberate skip is never listed as waiting.
- **Confirming can post an item that went Live long ago.** Plain saving still never queues a post for an old item; confirming is an explicit act, so it may.
- **The daily limit counts per channel** ("3 a day" means up to 3 on each channel), because channels now post at different times.
- **Confirmation never makes a post go out early.** A channel posts at the latest of its post time, the item going Live, and the confirmation.

## Considered options

- **Keep auto-posting with "Don't post" as the opt-out.** Rejected: an admin who misses the 30-minute window publishes text nobody checked.
- **Confirm once for all channels.** Rejected: each network gets different text (X drops tags past 280 characters, and each network carries only its own tags), so one sign-off covered posts the admin had not seen. One channel's problem would also have held up the others.
- **Make confirmation part of Approve.** Rejected: an admin should be able to approve an item without settling its social post yet, and edits made after approval would silently go out unchecked.
