# Service

Server-side code that runs on Cloudflare alongside the hosted editor.

- `handoff/relay.ts` is the one-time project drop-off behind
  `functions/api/handoff/[[id]].ts`. The retired `bline-web.pages.dev` and
  `web-beta.bline-web.pages.dev` origins upload their browser projects;
  `bline.run` collects them once and the relay deletes them on pickup or after
  15 minutes. The Pages project binds the `bline-handoff` D1 database as
  `HANDOFF_DB` in production.
