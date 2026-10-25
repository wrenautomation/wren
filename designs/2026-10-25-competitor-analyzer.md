# The SOP loop: competitors in, decisions by William, SOPs out (2026-10-25)

Living doc. William: "a universal 'competitor analyzer' ... literally anything that goes out." Then: "this is an extension of our sop stuff ... I give you some sources (or you find some sources), you watch the videos, pull out some basics, I tell you what to keep, what to change, what to drop, what to tune, you write the SOP and use it for the future. I want to focus on the decision making and abstract away everything else."

## Answer first

No new system. One loop, and most of it exists. An SOP is the unit of brand knowledge. Learn ingests and breaks down. Decide records his calls. `sop build` writes. The playbook uses. Three gaps close:

1. **Hunt.** Nobody finds sources for him. The machine proposes candidates per SOP.
2. **One seat, structured units.** His calls are split across Decide (worth/skip), `points/*.md` (delete lines by hand) and `notes.md`. They collapse into one queue: keep, drop or tune, with a comment, on the facts a breakdown pulled out.
3. **Learn back.** Our own pieces go through the same breakdown. Their real numbers test his calls.

## Target state

William touches four things: the queue (keep / drop / tune + comment), `notes.md` when he wants to write a rule himself, the SOP.md diff, and push. Everything else is machine: finding examples, watching, counting, writing points, rolling his calls into rules, writing the SOP, putting it in every draft prompt, checking a draft against it, and reading back what our pieces did.

## The loop

| Step | Who | Exists | New |
|---|---|---|---|
| 1 Hunt | machine | followed creators, links he shares, `wren study`, youtubeSearch, IG discovery | `wren sop hunt <name>`: seeds Learn with candidates for one SOP, ranked by reach. Thin orchestration, no new reader |
| 2 Read | machine | transcript, score vs SOP, breakdown for reel and video | breakdown for every kind, kind rubrics, film extractor |
| 3 Decide | **William** | Decide: worth / skip on an item | keep / drop / tune + comment on a breakdown fact (a hook, a beat, a CTA, a shot move, a post shape) |
| 4 Write | machine | `sop build` from `notes.md` + sources; `extract` points | build also reads `calls.md` (his calls rolled up, cited) and `standard.md` (numbers from the view) |
| 5 Use | machine | `sop push` → playbook in every draft prompt | standard numbers beside the playbook; draft breakdown diffed against the SOP |
| 6 Learn back | machine | deep video analytics per post | our posted pieces get breakdowns; the view joins their numbers; a kept pattern whose real retention disagrees comes back to the queue |

### 1 Hunt

Each SOP's front matter names what it governs: `kinds`, `platforms`, `topic` words, and `set` (the creators and brands the standard counts). `wren sop hunt <name>` reads the set's creators (exists) and searches the topic (exists), writes candidates into Learn tagged with the SOP, and stops at a cap a day. Candidates reach his queue ranked by reach. He never scrolls a platform.

### 2 Read

- **Item kinds.** Add `post` (text, image or carousel post: LinkedIn, X, IG, Threads) and `film` (a produced launch or demo film). `article` stays for blogs. Creators' image and text posts become `post`.
- **Schema.** `breakdowns` keeps the shared columns (`hook_style`, `hook`, `hook_why`, `topic`, `beats`, `cta_kind`, `cta`) and adds `kind` and `facts jsonb`. `format` moves into `facts`. No column per kind.
- **Hook styles stay one closed set across kinds.** William 10-25: yes. `demo-first` on a post means it opens on a screenshot or clip.
- **Code counts, the model reads.** Code measures length, lines, cuts, shot lengths, loudness. The model labels only hook style, beats, CTA and the closed-set labels.
- **Rubrics.**
  - `reel`, `video`: as today, `format` in facts.
  - `post` facts: `format` (text, image, carousel, doc, video), `chars`, `lines`, `first_line_chars`, `link` (body, comment, none), `hashtags`, `shape` (list, story, essay, one-liner, thread).
  - `film` facts: `duration_s`, `cuts`, `shot_median_s`, `shot_p90_s`, `cuts_per_10s[]`, `first_product_s`, `logo_s`, `cta_s`, `music`, `vo`, `cuts_trust`, `shots[]`. Each shot: `t`, `len`, `src`, `type`, `move`, `in`, `text`, `sound`, closed sets. `move` includes `orbit`, `roll`, `rack-focus`, `macro`. The seed study (`designs/studies/2026-10-25-launch-films.json`, 15 films, 5 hand-labelled) uses the same keys.
- **Film cuts.** Our own films need no detector: the Studio edit holds the exact cut list. Competitor films: PySceneDetect `detect-hash` is the default (seed: 4 of 5 hand-counted films within 20%), `adaptive` the second signal, ffmpeg `scene` kept as a column but out of the trust vote (it finds 0 cuts on every Linear film). A film passes when hash is within 20% of the hand count, or, with no hand count, when hash and adaptive agree within 2x. Else `cuts_trust = low` and its shot stats stay out of the standard. Browserbase Director 2.0 (+26%, montage over-count) stays low; the rule does not widen for one film.
- **Shot labels** (`type`, `move`, `in`) are empty until Cohere vision proves at least 80% match against the hand seed. Cohere reads nothing on dark frames; brighten first (`eq`) and test. Frame reads stay in `@wren/video-watch` (William 10-25).

### 3 Decide

- Subject: an item (`learn:<id>`, exists) or one fact of its breakdown (`learn:<id>/<path>`, like `/hook`, `/beats/2`, `/facts/shots/5/move`).
- Calls: `keep`, `drop`, `tune`, each with an optional comment. Written through `recordCall` into the existing `decisions` tables (designs/2026-10-16-decide.md: one write path, his calls written where they happen). No new table.
- He judges examples, never patterns in the abstract. The machine rolls up: a hook style kept on 3 items with no drop is a rule; a drop with a comment is a rule too ("no comment-a-word CTAs").
- Where he does it: Learn → Competitors, on the item page (each fact has the three buttons and a comment box), and the CLI (`wren learn call <id> <path> keep|drop|tune ["comment"]`). Decide's queue shows items with no call yet, ranked by reach.
- Scores: none. William 10-25: "scores are arbitrary". The diff and his calls are the facts.

### 4 Write

The SOP folder stays the one artifact. Beside `notes.md` (his, code never writes it) code writes two files:
- `calls.md`: his keep / drop / tune calls rolled into rules, each with its comment and cited item ids.
- `standard.md`: the numbers from the `learn.standards` view for the SOP's kinds, platforms and set.

`sop build` reads notes > calls > standard > points > sources. He reviews the SOP.md diff and pushes. `points/<source>.md` becomes generated only. Line deletes and `!` move to calls (a `tune` comment forces a point in).

### 5 Use

- The draft prompt gets the playbook (exists) plus the standard's lines for its kind and platform.
- A draft goes through the same breakdown. The page shows each standard field beside ours, each kept rule it meets or breaks, and up to 3 changes from the judge. Write for posts, Studio for films (from the render file).

### 6 Learn back

Our posted pieces get breakdowns. `learn.standards` joins their deep numbers (hook, hold at 3 s, finish rate). A pattern he kept whose real retention falls under the set's median comes back to his queue as "check this". Built last.

## Seams

- `learn` exports `breakdownOf(kind, input)`, `standardOf(sop)`, `callsOf(sop)`. `content` and `studio` import `learn`; neither imports the other today, so no cycle. `sop build` (apps/cli, packages/research) reads `calls.md` and `standard.md` as files; it never imports `learn`.
- UI: Learn → Competitors gets a Kind filter (type is a filter, 10-14). A film's page shows its shot strip. No new pages.
- Clients: Wren only for now. A client's items break down on its own judge, and its "Add to SOP" still goes to its Notes. A client's calls and SOP folder are a later seam.
- Public repo: the design and the study hold public film facts only. SOP text, notes and calls live in `sops/` (private).

## Build

1. Kinds `post` and `film`; `breakdowns.kind` + `facts`; `format` into facts (migration). Creators write `post`.
2. `post` rubric. Backfill IG and X posts.
3. `film` extractor: hash + adaptive cuts, `cuts_trust`, shot stats, speech, frame text. Import the seed as `film` items with hand breakdowns (`by = 'hand'`).
4. Calls on breakdown facts: subject paths, `recordCall`, item page buttons, `wren learn call`.
5. `learn.standards` view; `calls.md` + `standard.md` writers; `sop build` reads them; `points/` generated only.
6. `wren sop hunt`.
7. Standard lines in the draft prompt; draft check in Write and Studio.
8. Competitors Kind filter, film shot strip.
9. Learn back: our pieces' breakdowns, "check this" queue.
10. Shot labels by vision, after the 80% proof.

## Decision log

- 2026-10-25: generalize Learn breakdowns, no new system (handoff from "video & canvas work").
- 2026-10-25: William: one hook-style set across kinds; no scores; the system is the SOP loop, he decides, the machine does the rest.
- 2026-10-25: detector: hash default, adaptive second, ffmpeg out of the trust vote (seed f0a242e5).
- 2026-10-25: William: `points/` generated only, calls replace line deletes; film rules move to `sops/launch-films/notes.md`.
- 2026-10-25: builds 2 and 3: `post` counts in code, `film` facts off a `## Facts` fence in the read page (one write path, offline re-breakdown), `breakdowns.by` (model | hand), `learn import-films` for the seed, `WREN_SCENEDETECT`.
- 2026-10-25: build 4: his calls are Decide kind `learn_fact` (keep | tune | drop, mode `off`: he is the only judge) with his words in a new `decision_calls.comment`; subjects `learn:<id>` and `learn:<id>/<path>`, the paths enumerated off the breakdown row (`factRows`), so a call never lands on nothing; item page "How it's made" + `wren learn call`. No queue view yet: build 5 rewrites the views.
