# Content playbook (2026-11-10)

Task WA-1285 (design), WA-1289 (build). Status: built 11-10 on option A and the two defaults below.

William, 11-10: "a first class content playbook for ourselves for all content and all ads".

Read first: `designs/2026-11-05-variants.md` (Vireo: subject, batch, sample, tip = `guide`, keep, lock)
and `designs/2026-11-09-knowledge-repo.md` (verdict, rule set, line id, reference).

## Goal

An agent that makes any piece (a Short, a post, an ad, a page, an email) runs one command. It gets
every rule for that content type, and each rule shows its proof. A tip William locks in Vireo and a
sample he keeps are in the playbook the next time an agent reads it. No person runs a step for that.

## Non-goals (v1)

- Market winners as rules (`live`, `pBest`). They need a tested rule for "winner"; later.
- A flag for two locked tips that conflict. Code cannot find it without a model.
- Clients. This is our own playbook.
- Channel caps and specs. No rule set holds them yet.

## Now

- Vireo keeps tips (`testing`, `locked`, `dropped`) and kept samples in Postgres. A subject has a
  `kind`: text, image, video or page.
- `wren variants promote` copies each kept sample and each locked tip to a `verdict` record in
  `knowledge/`. A person or an agent runs it by hand (skill `variants`, step 6b). Prod on 11-09: 0
  kept, 0 locked, 25 tips testing.
- Rules live in topics, one per channel or craft (`content-principles`, `meta-ads`,
  `linkedin-content`, `landing-pages`, `outbound-copy`, `youtube-upload`). No verdict reaches a rule.
  No door says "these are the rules for a Short".

## Target state

```
Vireo (Postgres)                         knowledge/ (git)
  lock a tip   ─┐                          verdicts/<id>.md              (exists)
  keep a sample ┴─ promote (code) ───────▶ rules/content-playbook/proven-<type>.md   (new)
                   runs inside the read     kept verdict tagged `reference`, `content-type:<t>`
                                                     │
  rule sets that exist ──────────────────▶ guides/content-playbook.md  ──▶ wren playbook <type>
                                           (procedure + the table below)
```

- **Content type** is the key: what the piece is. It is not the frame shape (`long`, `vertical`,
  `square`, `portrait`), which the studio calls format. Each type has one Vireo kind.
- **One topic, `content-playbook`,** kept by hand like `ui-design` (no `wren sop build`). Its guide
  holds a short procedure (pick the viewer, load the type, make, test in Vireo, ship) and the table.
- **One proven set per type,** made when its first line arrives. A line is the tip's words and the
  verdict it cites: `- **PSV-3** Name the place in the first line. [verdict-id]`. Code writes it. No
  model rewords a winner. The numbers (good rate with and without, samples judged) stay on the
  verdict; the command reads them at print time, so a line changes only at lock or unlock.
- **A kept sample is a reference, not a rule.** Its verdict gets the tags `reference` and
  `content-type:<t>`. No second record.
- **`wren playbook <type>`** runs `promote` first, then prints with the knowledge package's
  `renderMany`: the guide, the proven lines with their numbers, the sets of the type's row, and the
  five kept samples with the highest score. `--json` gives `{type, proven: [{id, text, verdict,
  with, without, judged, early}], sets: [...], references: [...]}`. It reads `settings.knowledgeDir`,
  as `promote` does.

| Content type | Kind | Sets (owner topic) |
|---|---|---|
| `long-video` | video | `content-principles-rules`, `-angles`, `youtube-upload-rules` |
| `short-video` | video | `content-principles-rules`, `-angles`, `-hooks` |
| `text-post` | text | `content-principles-rules`, `-angles`, `-hooks`, `linkedin-content-rules` |
| `thread` | text | `content-principles-rules`, `-angles`, `-hooks` |
| `carousel` | image | `content-principles-rules`, `-hooks` |
| `story` | image | `content-principles-rules` |
| `blog-post` | text | `content-principles-rules`, `seo-audit` |
| `newsletter` | text | `content-principles-rules` |
| `cold-email` | text | `outbound-copy-rules` |
| `landing-page` | page | `landing-pages-rules`, `landing-pages-filler`, `offers-rules` |
| `ad-image` | image | `meta-ads-creative`, `meta-ads-rules`, `content-principles-hooks` |
| `ad-video` | video | `meta-ads-creative`, `meta-ads-rules`, `content-principles-hooks`, `-angles` |

Gaps the table shows: `video-editing` has no rule set (its three rules are in its notes), and thread,
carousel, story and newsletter have no set of their own. Their proven sets fill first from Vireo.

## Options

| | Shape | For | Against |
|---|---|---|---|
| **A. One playbook topic: a type table + a proven set per type** | above | one door for every type; no rule copied; code writes winners; a lock is a one-line diff | the table is kept by hand; a type's rules sit in several sets (the command hides this) |
| B. One topic per type, three layers each | 12 guides, each built by `wren sop build` | each type reads as one doc | 5 types copy topics that exist; 12 model builds per change; one rule in two topics drifts |
| C. A computed view, no records | the command queries verdicts and rules by tag | nothing to keep in step | no fixed line id to cite; nothing William can open, edit or veto in git |
| D. Verdicts as sources of the topics we have | `wren sop build` reads verdicts into `linkedin-content`, `meta-ads` | no new part | topics are per channel, not per type; a model rewords the winner; one model call per lock |

Priorities, in order: 1) the agent sees every rule for its type in one call, 2) each rule traces to
proof with its numbers, 3) a lock or a keep lands with no hand step, 4) no rule lives in two places,
5) low $ (no model call on the path).

**Pick: A.** B fails 4 and 5. C fails 2. D fails 1 and 2.

How a lock lands with no hand step, options: a) the portal's lock handler queues promote: prod has
no checkout of `knowledge/` (git lives on the Mac). b) a daily job on the Mac: one more process, and
the Mac sleeps. c) the read runs promote first (picked): promote is a no-op when nothing changed, so
the playbook is current each time an agent reads it. Cost: one prod read and maybe one commit and
push per `wren playbook` call. A read with no network prints the last state and says so.

## How a result moves

| Event in Vireo | Verdict (exists) | Playbook (new) |
|---|---|---|
| William locks a tip | written | a new line in each proven set the tip reaches |
| He unlocks or drops it | retired | the line goes; its id is never used again |
| He keeps a sample | written | tagged as a reference for its subject's type |
| He un-keeps it | retired | it leaves the references |

Reach: a tip on a subject reaches that subject's type. A tip on a kind reaches the types of that
kind. A tip on everyone reaches all 12. The printed rate is the rate over the tip's own reach, and
the line says which: "over all video".

## Changes

1. Vireo: `content_type` on a subject (free text; the host checks it against the list). Additive.
2. `wren variants new --type <t>` (required; an unknown type fails and lists the 12). Backfill:
   every subject, by hand, in one command per subject (prod has few).
3. `promoteVerdicts`: tag kept verdicts; write proven lines through the package's line-id code
   (`last`, never reuse an id). Same commit as the verdicts.
4. Knowledge: topic `content-playbook` (guide + table). A lint: each set a row names is live.
5. `wren playbook <type>`. The `variants` skill calls it at step 1 and drops step 6b.

Test: unit tests on reach (subject, kind, everyone) and on lock → line → unlock → retired, against a
temp repo as `knowledge.test.ts` does. One run on prod's 25 testing tips writes nothing.

## Risks

- A subject with no type: its tips and keeps reach nothing. `wren playbook` lists such subjects.
- A tip locked on thin data: the line prints the count judged and `early` under 30 judged samples.
- A proven line and a set line that disagree: both print. The proven line is William's own call on
  our own samples, so the guide says it wins.
- Two agents read at once: promote's commit is compare-and-swap; the loser rebases (knowledge repo
  guarantees).
- The repo is public: lines and references live in `knowledge/` (private), never in `wren/`.

## Open for William

1. The 12 types: add or cut?
2. A tip on everyone reaches all 12 types (the design). Or name its types at lock?

## Log

- 2026-11-10: proposed A (one topic, type table, proven set per type, code writes winners).
- 2026-11-10: goldfish review: 27 findings, 19 applied, 8 rejected; open: the two above. Applied:
  promote runs inside the read (was a hand step: the design failed its own goal); numbers stay on the
  verdict; a kept verdict is the reference (no second record); the table is filled; market winners,
  the conflict flag, clients, channel lines, `--formats`, `todo` and the `origin` field are cut;
  "content type" replaces "format" (the studio owns that word); Non-goals, Risks, shapes, test.
  Rejected: a daily job (the Mac sleeps); freeze numbers at lock (reading the verdict is one place);
  per-type rate recompute (the line names its base instead); error text for each case; and four
  findings moot once market winners were cut.
- 2026-11-10: built (WA-1289) on the defaults: the 12 types, and a tip on everyone reaches all 12.
  William can still change either. Choices made in the build:
  - The type table is the guide's `types` field (type, kind, sets), not a markdown table: code reads
    it. Each set a row names must be in the guide's `cites`, so `knowledge lint` checks it is live.
  - Proven set id `content-playbook-proven-<type>`, prefix `P` + the type's initials (PSV, PTH).
  - An emptied set keeps its last cites (a live rule must cite).
  - With no Canon checkout (prod), `variants new` takes any type; on the Mac it takes only the 12.
  - `wren playbook` runs promote, pushes Canon when it committed, and prints the last state with
    the reason when promote or the push fails (`--offline` skips both).
  - Vireo 0.17.0: `subjects.content_type`, `new --type`, `vireo type <subject> <type>`.
  - The sop-making audit warns (not fails) SL-1 for a topic that only cites other topics' sets.
