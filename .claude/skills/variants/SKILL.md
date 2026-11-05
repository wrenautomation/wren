---
name: variants
description: Run William's taste loop with `wren variants`. You make a batch of samples (email copy, video cuts, images, landers), he marks them Amazing/Good/Bad with anchored notes in the portal (Campaigns › Variants), you read his calls and make the next batch. Use when he says "variants", "make versions of", "iterate on", "try N cuts/openers/designs", "start from my direction", "what's winning", or adds a tip to test. Keep winners in the catalog; lock proven tips.
---

# variants

You drive. Code keeps the ledger. Run `./bin/wren variants …` from `wren/` (prod: `node scripts/prod-wren.mjs variants …`). JSON out. The engine is vireo (`../vireo`, npm `@wrenautomation/vireo`); wren gives its db, collectors and bucket. Design: `designs/2026-11-05-variants.md`, `../vireo/designs/2026-11-05-vireo.md`.

## The loop

```sh
./bin/wren variants new <slug> --name "…" --kind text|image|video|page [--brief "his direction"] [--seed <study|sop|sample|file>]...
./bin/wren variants show <subject>              # read this before every batch
./bin/wren variants add <subject> batch.json    # one batch; files upload to the media bucket
./bin/wren variants queue                       # what waits on William
./bin/wren variants guide add "…" [--subject s | --kind k] [--source study|sop|skill|agent --ref …]
./bin/wren variants guide lock|drop|test <id>
./bin/wren variants keep <sample>               # only when he asks; he keeps in the portal
./bin/wren variants catalog [--kind k]
./bin/wren variants ship <sample> post|site|email <draft id | page id | template@version> [--why …]
./bin/wren variants channels                    # each channel's target, rates, means
./bin/wren variants unship <ship>
./bin/wren variants live <subject>              # market numbers per segment, beside his calls
./bin/wren variants collect [--ship id]         # read numbers now (the loop runs every 6 h)
```

1. **Start.** No brief = from scratch: read the seeds (a Birdwatch study's claims, the SOP, the skill) and spread wide. A brief = his direction: stay near it. Add each seed tip as a `guide` (`--source study --ref <slug>`), state `testing`.
2. **Make a batch.** 4-6 samples. Text: inline `body`. Video: render with studio, then `file` (mp4) + `posterFile` (jpg), and `studio: {edit, format}` (or `source: {ref, spans}`) so he can play cuts of one footage in step. Image: `file`. Page: full html in `body` (shown in a sandboxed frame).
3. **Spread on purpose.** Each batch tests one or two ideas. Vary one thing per sample when you can, so his calls teach something. Tag each sample's `guides` with the guide ids it applies; that is how a tip's with-vs-without rate is counted.
4. **Say why.** `why` = what you changed from the last batch and what it tests. `change` per sample = what differs from its `parent`. He does not see these while he judges (blind); `show` gives them back to you.
5. **Tell him** it is in Campaigns › Variants. Stop. Wait for him to send the batch back.
6. **Read `show`.** Per batch: his `note`, each sample's `verdict` and `notes` (a `quote` = a line, `box` = a region in fractions, `time` = seconds on a video). `leaders` = Plackett-Luce strengths across all batches. Guides carry `effect` (good rate with vs without, `early` under 30 judged).
7. **Next batch.** Keep what Amazing/Good samples share. Fix every anchored Bad note. Obey his batch note first. Mutate from the leaders (`parent`), and keep one wild sample in each batch so the loop does not narrow too early.
8. **Ship.** When he keeps a sample and it goes out (a post, a page, an email version), `ship` it. Read `live` before each batch: a segment where the market disagrees with his calls is the next thing to test. Trust a rate only when its range is narrow; `pBest` over 0.9 is a winner there.
9. **Guides.** When a testing guide's `effect` is not `early` and `diff` is clearly positive, propose to lock it; negative, propose to drop. He decides. A locked guide is a rule: apply it to every sample of its scope, and say which SOP it belongs in.

## batch.json

```json
{
  "why": "Batch 3: named places beat questions (batch 2). Now test a next step vs none.",
  "agent": "<your session id>",
  "samples": [
    { "body": "…", "parent": 22, "guides": [1], "change": "adds a next step" },
    { "file": "out/cut-b.mp4", "posterFile": "out/cut-b.jpg", "parent": 31, "change": "captions 20% lower", "studio": { "edit": 12, "format": "short" } }
  ]
}
```

Paths are relative to the json file. Playable: mp4 mov m4v webm jpg png gif pdf.

## Rules

- Never judge for him. `judge` and `note` exist for tests and for his spoken calls in chat only.
- One open batch per subject at a time. Wait for it to close.
- The repo is public: subjects and samples live in the database, never in files under `wren/`.
- A client's subjects: `--client <id>` (their own database).
