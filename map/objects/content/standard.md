---
type: object
cluster: content
universe: live
status: verified
verified: 2026-11-11
entity: packages/content-standard/src/canon.ts:91
---

# standard (content)

What the pieces an SOP covers look like, measured from Canon: each live source with a `breakdown` in its front matter is one row; William's `verdict` records (`from: owner`) are his keep / tune / drop calls. Code in `packages/content-standard`, pure of the database. Replaced Learn (`learn.items`, `learn.breakdowns`, `learn.standards`) on 11-11 (WA-1317).

## Why this shape

Canon is the one store for sources (designs/2026-11-09-knowledge-repo.md), so the standard reads the files, not a table. A closed label set (`labels.ts`) lets pieces group and rank; free tags would never count. A breakdown is written once and never asked again: a call's path (`beats/2`) points into it.

## Shape

- Breakdown (`Breakdown`, `labels.ts`): `kind` (`BROKEN_DOWN`: reel, video, post, film, ad), `hookStyle` (`HOOK_STYLES`), `hook`, `hookWhy`, `topic`, `beats` `[{t, beat}]`, `ctaKind` (`CTA_KINDS`), `cta`, `facts` (per kind: `FACTS[kind]`, `breakdown.ts`; a film's `filmFactsSchema`, `film.ts`; an ad's `adFactsSchema`), `by` (`model` or `hand`)
- `breakdownPiece` / `breakdownFrom` (`breakdown.ts`): one model call on a source's text, checked by the kind's schema
- Row (`piecesOf`, `canon.ts`): id = the source id, `platform` (`platformOf`: the source's `platform`, else the URL host), creator, reach (views, else likes plus comments), the kind's numbers. A piece counts once someone picked it: a hand breakdown, `saved`, a `feed`, or his keep; a whole-piece drop never counts
- Calls (`verdictsOf`, `callsOf`): newest owner verdict per source and path (`/` = the whole piece; `factRows`, `calls.ts`, lists the callable paths)
- `standardOf` (`standard.ts`): per kind in an SOP's scope (`scopeOf`: `kinds`, `platforms`, `topic`, `set` off `notes.md`), each number's median and middle half, each closed set's counts. `rulesOf` rolls calls into patterns; `RULE_KEEPS` keeps with no drop make a rule
- `writeSopFiles` writes `standard.md` and `calls.md` into the topic folder; `playbookStandard` is the snapshot `wren topic push` stores on `content_playbooks.standard` (jsonb, migration 0388)
- `checkPiece` (`check.ts`): one of our pieces beside a `KindStandard` and the patterns
- Ads (`ads.ts`): a Meta Ad Library ad as a source page (`adPage`, `adFacts`); `isWinner` at `WINNER_DAYS` running or `WINNER_VERSIONS` versions

## Connected to

- **owned-by:** Canon (`sources/`, `verdicts/`)
- **read-by:** [[content/playbook]] (`postStandardFor` reads the stored snapshot), [[sop-build]]
- **looks-like-but-is-not:** [[ads/ad-format]] (our own ad formats, edited by hand)

## If you change this

- **Hits:** a new hook style or fact key: `labels.ts` and `FACTS[kind]`; a number a standard counts: `StandardRow`, `NUMBERS` or `SHARES`, and `piecesOf`; a regenerated breakdown orphans his calls on its paths
- **Does not hit:** the database (no table; the old `learn` schema dropped 11-11, WA-1318)

## Surfaces

| Surface | Role |
|---|---|
| `wren source add <url> [--from who] --topic <name>` | reads a link into a Canon source, breaks it down (`--no-breakdown` skips) |
| `wren source breakdown <source...>` | writes a breakdown on sources that lack one |
| `wren source call <source> <path> keep\|tune\|drop` | writes his verdict (path `?` lists the paths) |
| `wren source ads` | pulls an advertiser's or a keyword's ads (`--ads <file>` from a Weaver run) into sources |
| `wren topic sync <name>` / `build` / `push` | reads the standard and calls into the SOP |
