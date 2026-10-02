# Error logging

What the app records when something fails, where it goes, and how to read it.
Decided 29–30 Sep 2026 (Luiza):
- our own Postgres tables, no vendor;
- 90-day retention;
- alerts to the developer only;
- **never visible in Jas's console**. Errors have a developer-only page.

This is Phase 1 of the logging plan. Later phases add job/adapter/webhook wiring, an audit log and security events, and the webhook, email, 404, integration-health and slow-call logs. Each adds its tables to the retention job below.

## Where errors come from

| Source | Captured by | Area looks like |
|---|---|---|
| `server` | `src/instrumentation.ts` → `onRequestError`: every Server Component render, Route Handler, Server Action and proxy error | `render:/news/[slug]`, `action:/console/members/[id]` |
| `client` | `src/instrumentation-client.ts` (window `error` and `unhandledrejection`) and the four error boundaries → `/api/client-errors` | `client:/news` (first path segment) |
| `job`, `webhook`, `adapter`, `db` | Phase 2: `logError()` calls at those seams | `job:social_push`, … |

Next's own control-flow throws are skipped: `redirect()`, `notFound()` and bail-outs, matched by digest prefix in `instrumentation.ts`. Browser noise is dropped on both ends: extension errors, `ResizeObserver loop`, and stackless `Script error.`

To log from code: `logError({ source, area, error, path?, digest?, userId?, context? })` from `src/lib/log.ts`. It never throws and never blocks; inside a request it writes after the response is sent. Use `recordError()` only when you must await the write.

## What's stored

- **`error_events`:** one row per distinct error. Holds `count`, `first_seen`, `last_seen`, `status` (`open` / `resolved` / `ignored`), and `alerted_at`.
- **`error_occurrences`:** the newest 50 occurrences per error. Holds path (no query string), digest, user id, and scrubbed context.

**Grouping.** The fingerprint is a hash of source, area, the message with ids, numbers and quoted values replaced, and the top `src/` stack frame without line:column. So "member 123 not found" and "member 456 not found" are one error, and a rebuild doesn't split a group.

**Scrubbing**, before anything is stored:
- Keys matching `password|token|secret|authorization|cookie|api_key|signature` are redacted at any depth.
- Lengths are capped: message 1 KB, stack 4 KB, context 4 KB.
- Only a user id is kept, never an email. No IP addresses.

**Access.** Both tables have RLS on and no policies, so only the service role can read or write them. Writes go through `src/lib/db/log-client.ts`, a client that deliberately skips the `[supabase]` transport logger, so a failing database can't log itself in a loop. If the write fails, the error still reaches Vercel's function log as an `[error] {…}` line, which is always printed first.

## Alerts (to `DEV_ALERT_EMAIL`)

- **When:** one email the first time an error is seen, and again if a **resolved** error comes back. An **ignored** error never alerts.
- **Throttles:** at most 20 alerts are sent per hour in total. A reopen always alerts, because resolving is a deliberate "this is fixed". Otherwise the same error alerts at most once an hour.
- **How:** sent immediately, not queued, because production cron runs once a day (GAPS A3.1).
- **Daily digest** (job `dev_error_digest`): every non-ignored error seen in the last 24 hours, busiest first. Nothing is sent on a quiet day.
- **Dependency:** email needs the Resend key (GAPS B3.3). Until it exists, alerts are inert in production; locally they land in Mailpit.

## Reading the log

- **In the app:** `/console/errors` (Open / Resolved / Ignored, filter by source) and `/console/errors/<id>` (stack, occurrences, and Resolve / Ignore / Reopen).
- **Who can see it:** only admins whose login email is in `DEVELOPER_EMAILS`. Everyone else, Jas included, gets a 404, and the nav link only renders for developers.

In the Supabase dashboard's SQL editor:

```sql
-- what's broken right now
select count, source, area, message, last_seen
from error_events where status = 'open' order by last_seen desc limit 50;

-- everything about one error
select o.occurred_at, o.path, o.digest, o.user_id, o.context
from error_occurrences o join error_events e on e.id = o.event_id
where e.fingerprint = '<fingerprint>' order by o.occurred_at desc;

-- the server log line for a digest a user quoted from an error page
select e.message, e.area, o.occurred_at, o.path
from error_occurrences o join error_events e on e.id = o.event_id
where o.digest = '<digest>';

-- silence a known, harmless error
update error_events set status = 'ignored' where id = '<id>';
```

## Developing the logger

`src/instrumentation.ts` is loaded once, when the server starts, and is not hot-reloaded. The logger and alert code it imports are therefore not hot-reloaded either: after editing `log.ts` or `log-alerts.ts`, restart the dev server (`pnpm dev:stop && pnpm dev:start`). This was found in the Phase 1 live check, where an edited alert rule kept running the old code.

## Retention

The job `log_retention` runs daily. It deletes errors not seen for 90 days, together with their occurrences, and occurrences older than 90 days on errors that are still active.
