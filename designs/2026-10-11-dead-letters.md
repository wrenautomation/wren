# Dead letters, and why no Kafka

2026-10-11. William's temp note: "an event broker like kafka? + dead letter queue (we kinda have
this already in discord, but formalizing and passing it back to claude code)? microservice grpc +
cqrs?"

## Decisions

- **No Kafka, no separate broker.** Restate is already the durable log: every handler call is
  journaled, retried, exactly-once per step, and a one-way send or a delayed send is a queued
  message. The spine (`core/spine.ts`) is the domain event bus on top: events by workflow and
  subject, routed wires, failed steps kept, Replay. A broker would be a second log to run, back up
  and keep in sync with this one, with no consumer that needs it. Revisit when an outside system
  must subscribe to our events in bulk; webhooks out (`Webhooks`) cover the small case today.
- **No microservices or gRPC.** One deploy of many packages is a modular monolith: the package
  boundaries do what service boundaries would, and nothing pays network hops or version skew for
  it. Restate services are already the unit of scale and isolation (the box worker runs a subset).
  Split a service out only when it needs its own runtime, as the box and desk workers do.
- **CQRS as we have it.** Writes go through Restate handlers; reads go straight to Postgres, with
  views where a screen needs them. No separate read store.
- **A real dead-letter queue.** The gap was Restate's own: a handler that fails past its retries
  is paused, its object locked, and the only sign was the hourly lag check in Discord, gone next
  hour. Now each one is a row.

## Dead letters

- **What a letter is.** An invocation in Restate's `paused` state (retries used up). Not a
  handler's terminal error: that goes back to its caller, who owns it. Not a spine step's error:
  that waits on its event, with Replay.
- **Table** `dead_letters` (main, 0225): Restate's invocation id (unique), target, key, error,
  who sent it, paused at, told at, and how it ended: `retried`, `killed`, `dropped`, or `cleared`
  (left the paused state some other way).
- **Loop** `DeadLetters/all`, every 10 minutes (`core/dead-letters.ts`): SQL over `sys_invocation`
  for what is paused; files new ones, with the failure read from the journal when Restate kept
  none on the row; reopens a retried one that paused again; clears rows whose call is no longer
  paused; tells Discord once per new letter, as a warning.
- **Actions** `wren dlq list|show|retry|kill|drop`, `--json` on reads, so Claude Code reads the
  same rows. `retry` resumes where it stopped; `kill` ends it with an error its caller sees.
  Caddy lets exactly those two admin writes through with the ingress bearer; every other admin
  write stays on the box.
- The hourly lag check stops reporting paused calls: they are the loop's.

## Order

1. Table, loop, CLI, Caddy routes, tests. Deploy, then `wren dlq sweep start`.
2. Later: a Console view over the same rows, if the CLI is not enough.
