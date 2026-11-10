---
name: variants
description: Run William's taste loop with `wren variants`. You make a batch of samples (email copy, video cuts, images, landers), he scores them 1-10 (zones Bad, Okay, Good, Amazing) with anchored notes in the portal (Variants) and steers the tree (pin, prune, cross, width), you read his calls and make the next batch. Use when he says "variants", "make versions of", "iterate on", "try N cuts/openers/designs", "start from my direction", "what's winning", "grow from this", "add these to the current batch", "kill that line", "cross these", "go wider", or adds a tip to test. Keep winners in the catalog; lock proven tips.
---

# variants

You drive. Code keeps the ledger. Run `./bin/wren variants …` from `wren/` (prod: `node scripts/prod-wren.mjs variants …`; in the portal's Vireo chat: `vireo …`). JSON out. Engine: vireo (`../vireo`, npm `@wrenautomation/vireo`); wren gives its db, collectors and bucket. Design: `designs/2026-11-05-variants.md`, `../vireo/designs/2026-11-05-vireo.md` (D10: steers).

## Commands

```sh
./bin/wren variants new <slug> --name "…" --kind text|image|video|page [--brief "…"] [--seed <ref>]...
./bin/wren variants show <subject>              # read before every batch: calls, notes, leaders, guides, steers
./bin/wren variants add <subject> batch.json    # a new batch; refused if it breaks a live steer
./bin/wren variants append <subject>:<n> more.json   # more samples in that open batch, same JSON
./bin/wren variants merge <subject>:<m> <subject>:<n>   # m should have been an append: its samples join n, m goes
./bin/wren variants queue [<subject> | <subject>:<n>]   # what waits on William
./bin/wren variants close <subject>:<n> --note "…"   # his guide for the next batch, given in chat
./bin/wren variants steer pin|prune <sample> | cross <a> <b> | width <subject> narrow|normal|wide [--why "…"]
./bin/wren variants steer list <subject> | lift <steer>
./bin/wren variants guide add "…" [--subject s | --kind k] [--source study|sop|skill|agent --ref …]
./bin/wren variants guide lock|drop|test <id>
./bin/wren variants keep <sample> | catalog [--kind k]
./bin/wren variants promote          # kept samples and locked tips → verdicts in Canon
./bin/wren variants ship <sample> post|site|email <target> [--why …] | unship <ship> | channels
./bin/wren variants live <subject> | collect [--ship id]
```

## The loop

Read the reference for a step when you reach it. Each holds the how; this page holds the order.

| Step | Do | Read |
|---|---|---|
| 1 Start | New subject from his brief, or from seeds | `references/start.md` |
| 2 Batch | 4-6 samples, each with a name, parents, change; one `title` and one `why` | `references/batch.md` |
| 3 Tree | Pick parents: mutate leaders, cross, one wild; obey his steers | `references/tree.md` |
| 4 Hand over | Tell him `<subject>:<n>` waits in Variants › Batches. Stop | — |
| 5 Read | `show`: his scores, anchored notes, batch note, leaders, steers | `references/batch.md` |
| 6 Guides | Propose lock or drop from `effect`; he decides | `references/guides.md` |
| 6b Record | After a keep, lock, un-keep or drop: `promote` (prod: `prod-wren.mjs`), then push `canon/` | — |
| 7 Ship | A kept sample goes out; read `live` before each batch | `references/ship.md` |
| Makers | A maker on his Mac builds pages or video for you | `references/makers.md` |

## Rules

- Never judge for him. `judge` and `note` exist for tests and for his spoken calls in chat only.
- Blind: he sees no parent, change or why while he judges. He sees the batch `title` and each sample's `name` beside its number, so both say what it is, never which one should win. Never put them in a sample's body.
- Fix a sample in place: `wren variants edit <id> --name|--change|--guides|--body|--file|--poster-file …`, many with `--json`. A title: `rename batch <subject>:<n> "…"`. Never re-add a batch to fix one. What he saw (body, file, poster) changes only before a call or a note; after one, the fix is a new sample in the next batch.
- Name a batch `<subject>:<n>` (its number within the subject) in notes and messages. The global id is secondary; outputs lead with the ref.
- One open batch per subject. "Add it to the current batch" means `append`, never `add`: a new batch replaces an unmarked one in his queue. A closed batch takes no more samples; make a new one.
- Steers are his. Set or lift one only when he says so (chat or canvas); put his words in `--why`.
- His batch note comes first, then live steers, then his scores, then your own ideas.
- The repo is public: subjects and samples live in the database, never in files under `wren/`.
- A client's subjects: `--client <id>` (their own database).
