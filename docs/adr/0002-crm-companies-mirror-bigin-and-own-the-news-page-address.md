---
status: accepted
---

# CRM companies mirror Bigin, and a company's news page address is changed through Bigin

Story sources come from two lists: the imported spreadsheet, and each CRM company's News Page URL in Bigin, with the company's Website standing in when that is blank. Until November 2026 the app kept no record of CRM companies. It kept only the sources Bigin produced, tagged with the company's id and name. So a company with no address was invisible, and a Bigin-supplied address could only be changed in Bigin itself. Luiza decided on 6 Nov 2026 that the console's CRM page should reflect Bigin as closely as possible. The app now keeps its own copy of every CRM company, with all of its Bigin fields, and shows it in a Companies box on the CRM page. A company's News Page URL is edited there and **written through to Bigin**. Bigin stays the record of where a company's news lives, and the story source follows from it. (Issue #49.)

## Consequences

- **A Bigin-linked source's address can't be edited on Story Sources.** This is deliberate. Story Sources is about *reading* (readable or blocked, re-check, pause, suggestions). CRM is about *where the address comes from*. Editing the source directly would be undone by the next sync, or would leave the console and Bigin disagreeing.
- **An edit waits as "push pending" until Bigin accepts it,** and a sync from Bigin doesn't overwrite it in the meantime. This is the same rule as contacts, so a slow or failed push can't be reverted by stale data.
- **The member a company's stories are tagged with is the one exception kept only in the app.** Bigin has no field for it. An admin's choice overrides the automatic match and survives syncs, including a company being deleted in Bigin and coming back.
- **Nothing is deleted on either side.** A company missing from a complete Bigin read is marked "deleted in Bigin" and hidden by default. Its source is unlinked, and paused only if Bigin alone had added it.
- **It needs more Bigin access.** The token needs a Companies write scope and a field-list read scope (HUMAN-TODO). Until they exist, the box is read-only and shows only the fields already known.

## Considered options

- **Edit the address on the source and stop syncing it from Bigin.** Rejected: Bigin is where SMI keeps company records. Two places holding a company's news page would drift, and the CRM page is meant to mirror Bigin, not fork it.
- **Keep "change it in Bigin" and only link out to Bigin.** Rejected: fixing a dead page or replacing a homepage stand-in is routine work, and contacts already show that console edits written through to Bigin work.
- **Show companies on Story Sources rather than CRM.** Rejected: CRM companies include non-members and fields that have nothing to do with news, and the CRM page is where admins expect to see what Bigin holds.
