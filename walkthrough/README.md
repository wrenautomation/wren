# Walkthrough

From a fresh clone to running Wren's loops. Each guide is short, in order,
with the exact commands and what they print. `demos/` run now against
production, read-only.

| # | Guide | You end up with |
|---|-------|-----------------|
| 0 | [Setup](00-setup.md) | the CLI and a local stack (Postgres + Restate + worker) |
| 1 | [Content loop](01-content-loop.md) | an idea → drafts per platform → approve → posted at its slot → what worked |
| 2 | [Meta ads](02-meta-ads.md) | a spec → launch PAUSED → start with a budget → the guard → leads |
| 3 | [Email campaign](03-email-campaign.md) | the cold-email machine: pool, compose, send windows, replies, health |
| 4 | [Production](04-production.md) | Restate Cloud + Lambda + Postgres on EC2; deploy by push; the loops and how to poke them |
| 5 | [Cold SMS](05-sms.md) | number pool, contacts with consent basis, send loop, phone inbox |

Demos (`prod.sh` points one `wren` command at production; nothing writes):

```sh
walkthrough/demos/prod.sh content drafts --all     # every draft, newest first
walkthrough/demos/prod.sh content results --days 7 # what worked
walkthrough/demos/prod.sh content costs --days 30  # drafting spend by platform and model
walkthrough/demos/prod.sh ads launches             # the ads ledger
walkthrough/demos/prod.sh email status             # queue, pool, health per domain
walkthrough/demos/01-loops.sh                      # every loop on Restate Cloud: running? last pass?
walkthrough/demos/02-content-dry.sh                # one idea through the local stack (needs a model key)
```

Reference: `../README.md`, `../docs/restate-operations.md` (what is live),
`../designs/` (why), `../sops/` (copy rules, ramp).
