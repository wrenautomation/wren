# wren map

A system map of this repo for agents that must edit it: the nouns (tables, types, files), the verbs (movements that run), and what a change hits. The code is the source of truth; cards cite `path:line` and never restate behaviour.

Twins `AGENTS.md` and `routing.md` are generated from this file by `_meta/build.sh`. Edit only `CLAUDE.md`.

## Where things live

| Folder | What it holds |
|---|---|
| `CONTEXT.md` | how to walk the map; the three universes; name collisions in full |
| `_meta/schema.md` | the closed set of card types and their frontmatter |
| `_templates/` | `object.md`, `process.md`: copy one to add a card |
| `objects/` | one card per noun, in clusters; `_index.md` is generated |
| `processes/` | one card per movement that actually runs |
| `effects/CONTEXT.md` | "I am changing X, open these cards" plus what points in from outside the repo |

## Clusters (objects/)

| Cluster | Ask it |
|---|---|
| `leads/` | who we reach: companies, people, leads, sightings, suppressions |
| `ledger/` | what ran and what it cost: runs, imports |
| `research/` | what we learned about a company: documents, enrichments, discovery, candidates, verifications, signals |
| `email/` | the cold-email machine: enrollments, messages, templates, sequences, roster, policy, health, inbox |
| `content/` | the content loop: ideas, drafts, metrics, platforms, media |
| `ads/` | Meta ads: launches |
| `sms/` | texts: numbers, contacts, messages, events, speed to lead, missed calls, review asks |
| `clients/` | who we work for: the registry row, its own database, its logins and what we deliver |
| `reactivation/` | the lead reactivation product: CRM contacts, client profile, handoffs, demo videos |
| `books/` | the money: vendors, bills, their documents, the journal |
| `watch/` | the Monitor: William's mail, triaged by rules and a model into Needs you |
| `learn/` | Learn: saved links and followed sources, read, scored against the SOPs, searchable |
| `calendar/` | our own booking calendar: bookings, slots, the lander's /book page |
| `voice/` | the phone agent, in development: calls, timed turns, consent to AI calls |
| `platform/` | what everything stands on: settings, niches, offers, loop objects, Restate services, schema, worker, CLI, phone |

## Colliding names (short form; full list in CONTEXT.md)

- **lead**: in prose a company; in code `leads` is an email address with a status; `Ads.leads` are Meta form fills.
- **message**: `messages` (email) and `sms_messages` are different tables and state machines.
- **draft**: a `messages.state` and a `content_drafts` row.
- **campaign**: a niche's email operation (`Campaign` in the worker), a Meta campaign object, an SMS 10DLC registration.
- **sync**: the loop handler `sync` (one pass now) vs the mailbox read `syncInbox` vs the `inbox_syncs` cursor.
- **signals**: dated findings from the collectors ([[research/signal]]) vs the lander's visitor events and replay vs `crm run`'s hiring stage.
- **worker**: `apps/worker` (Restate endpoint on Lambda) vs `apps/phone` and `deploy/pixel` (Cloudflare Workers).

## Route by task

| If you are | Go to |
|---|---|
| asking "what is X" | `objects/_index.md`, then the card |
| changing a table, type or file | the card's **If you change this**, then `effects/CONTEXT.md` |
| changing how something moves | `processes/`, then the object cards it `consumes` / `produces` |
| adding a card | copy from `_templates/`, then run `_meta/build.sh` |
| told a card is wrong | fix the card against source, bump `verified`, rebuild |

## The one rule

A card marked `verified` carries a date, a commit and citations. When a card and the code disagree, the code wins and the card gets fixed the same day.
