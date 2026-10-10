# Outbound webhooks, replay and the error digest (2026-10-07)

Audit items 1 and 8 (`designs/2026-10-07-product-audit.md`). William: "steal all the stuff". No embedded builders; the Zapier app waits.

## Answer first

- A client's tools hear what happens in Wren: subscribe an https URL to `lead.created`, `form.submitted`, `reply.received`, `booking.made`, `booking.cancelled` or `deal.won`. Each delivery is signed, retried for about a day, and logged per attempt.
- A workflow can call any API mid-run: the **Send webhook** node posts a JSON body built from the event and keeps the answer on the run.
- Failed runs heal: a workflow can retry them on its own (off, or 1 to 5 tries on Zapier's ladder). The team replays many at once from Executions or Events.
- One line a day says what broke: a flag per client and workflow ("3 runs failed in Speed to lead", with the top error) rides the flags digest; Wren's own failures ride the same message.
- Version restore was already there (History > Open as the draft). It now says Restore.

## Events

The spine already has the moments. Each fans out to subscriptions where it happens:

| Event | Where |
|---|---|
| `lead.created` | `Spine/hook`: a door entry of kind `lead` |
| `form.submitted` | `Spine/hook`: a door entry of kind `form` |
| `reply.received` | `Spine/fire`, `trigger.reply` (email, text, DM; never a STOP) |
| `booking.made` / `booking.cancelled` | `Spine/fire`, `trigger.booking` |
| `deal.won` | `Spine/emit` from `close` at `outcome.won` |

Flags stay internal: clients never see them.

An event's id is the Restate call plus the event name and subject, so a retried call delivers once and a second reply still delivers.

## Delivery

- Tables on main: `webhook_subscriptions` (client, url, events, sealed secret, the old secret until 24 h after a rotate, on/off), `webhook_deliveries` (one per subscription and event id: payload, state, attempts, last status, latency, snippet) and `webhook_attempts` (one row per try).
- `Webhooks/deliver` (private) tries, then `ctx.sleep`s 1 min, 5 min, 30 min, 2 h, 6 h, 12 h: 7 tries over about 21 hours, durable in Restate. It retries a network error, 408, 425, 429 and 5xx; any other 4xx stops at once.
- A failed try that waits for the next sets `next_at`, and the row shows "Retrying at <time>".
- Failing URLs turn off. The first failed try sets `failing_since` on the subscription and a landed one clears it. A failed try 5 days (`DISABLE_AFTER_DAYS`) past `failing_since` turns the subscription off and sets `disabled_at` and `disabled_why` ("Nothing landed in 5 days. Last try: ..."). Its pending deliveries then fail as "the webhook is off". Turning it on clears all three, so it starts clean. Turning it off by hand leaves `disabled_at` empty. Test sends don't count.
- Signing follows Standard Webhooks (standardwebhooks.com), so receivers can use its libraries: headers `webhook-id`, `webhook-timestamp` (seconds) and `webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">`, secret `whsec_<base64>`. During the 24 hours after a rotate, both signatures go, space separated. Receivers drop a timestamp more than 5 minutes off (`verifyWebhook` does this).
- The secret is AES-256-GCM sealed with `WREN_HOOK_KEY`, the door's key. It is shown once on add and on rotate. Without the key, adding refuses.
- SSRF guard (`safeUrl`, `safePost`): https only, no user or password in the URL, no `localhost`, `.local`, `.internal` or metadata hosts. Every address the host resolves to must be public. The check runs in the socket's own lookup, so a DNS rebind can't slip past it. Redirects are not followed. 10 s timeout, the first 64 KB read, and 1,000 characters kept.

## Send webhook node

`logic.webhook`, under Actions in the palette.

- Settings: URL, method, headers (one per line, `Name: value`), body (JSON), keep (`id=body.id, ok=status`).
- Slots: `{{data.lead.email}}`. A string that is a single slot keeps the value's type; a slot inside text becomes text. In the URL a slot is URL-encoded. An empty body sends the whole event.
- Out: `answered` for 2xx, `refused` for any other 4xx. A network error or 5xx throws, so the spine's 3 tries, the failed row and auto-retry all apply. The run keeps `data.webhook = {status, ms, body (4 KB), ...kept}`.
- The test says "Would post to <host>" and sends nothing. The same SSRF guard applies.
- It counts as sending (`effects: ["sends"]`), since it posts data out of Wren. The Effects column shows it, and publishing or installing a workflow with one needs an admin and its id typed back.
- Headers live in the workflow's save, which the team can read. Put a client's API key there knowing that.

## Replay

- Auto-retry is a setting on the workflow, saved with its draft and published: `WorkflowEdits.retry` (0 to 5). A step that fails past its 3 tries sends itself a delayed `Spine/retry` after 5 min, 30 min, 1 h, 3 h and 6 h (Zapier's ladder), counting tries in the call. If someone retried by hand and it passed, the delayed one finds nothing failed and does nothing.
- Replay (`ConsolePortal/replay`, `wren:effect`): up to 200 executions or events at once. Each failed step gets `Spine/retry`. You get it on the Executions and Events pages (select, then Replay) and on the canvas's Executions tab (tick rows, or Replay all failed).

## Error digest

`DeliveryWatch` reads failed steps (`failedRuns`) in each client's database each pass.

- One flag per client and workflow: source `workflows`, cause `workflow:<id>`, reminded daily. It clears itself once nothing has failed. The 09:00 flags digest carries it, and Wren's own failed runs go as lines in that same message.
- Who reads it: Wren's team. The Workflows app is the team's, so clients get no failure mail.
- A client's URL Wren turns off mails the client's owners and whoever added it, once, from portal@ (`turnedOffTeller`). Wren's own show only in its Account.

## Surfaces

- Account > Webhooks: list, add (secret shown once), events, on/off, rotate, test send, delivery log with attempts, redeliver. A URL Wren turned off shows "Turned off" with why and a "Turn back on" button; one still failing shows since when. Owners and team `manage` change it; anyone who may read sees it.
- `wren [--client <id>] webhooks list|add|remove|on|off|rotate|test|log|redeliver`.

## Not built

- The Zapier app (on hold). Its triggers would be REST hooks onto these subscriptions.

## Decision log

- 2026-10-07: Built. Standard Webhooks over a homemade header, so receivers verify with a library. A service with a sleep loop over a virtual object per delivery: the state flip (`failed|delivered` to `pending`) guards a double redeliver. Wren never adds subscriptions on prod; a client's URL is their config.
- 2026-10-09: A URL that fails for 5 days turns off, and turning it on starts clean. A failed row shows when it retries (`next_at`). The clock counts from the first failed try, not from the delivery, so a URL that fails once a day still turns off. Migration 0202.
- 2026-10-10: A client hears when Wren turns their URL off: one mail per owner and the adder, from portal@, linking Account → Webhooks. A mail that won't go never fails the delivery.
