# Text roles: less gray, clear hierarchy (WA-1418)

William, 2026-11-16: "wren overuses gray half readable text"; "too much gray text in general need color or weight or something its just blobs of gray text". Cleaner hierarchy on Aerie tasks and the portal as a whole.

## Fault

- 1,170 gray text classes in portal and ui; 543 of them `ink-3`.
- `ink-2` (#56564f) and `ink-3` (#63645e) are two near-equal mid grays. Content and metadata both wear them, so a card reads as one gray block under its title.

## Options

| | What | For | Against |
|---|---|---|---|
| A | Darken both grays in every look | one edit, all 1,170 uses | dark blobs in place of gray blobs; no hierarchy |
| B | Role pass only: content to `ink`, gray for metadata | the real fix | 1,170 hand edits at once; slow to land everywhere |
| C | A, then B on the shared kit, Aerie and the busiest pages | every page better today; hierarchy where people look most | two steps |

Chosen: C. Priority order: readability on every page, then hierarchy, then edit risk.

## The rule

| Role | Token | Weight | Examples |
|---|---|---|---|
| Title | `ink` | 600 | task title, row name, panel heading |
| Content | `ink` | 400 | summary, description, message body, cell values, nav labels |
| Secondary | `ink-2` | 400–500 | a hint under a field, a subtitle, a label beside a value |
| Metadata | `ink-3` | 400–500, small | ids, times, counts, "updated 3 m ago" |
| State | status color or tint | 500–600 | status, priority, owner: a tinted chip or a dot plus a word |

- Gray never carries content a person reads in full.
- Hierarchy comes from weight and size first, then color, then gray.
- A row or card has at most one gray line.

## Tokens (every look)

`ink-3` takes the look's old `ink-2`. The new `ink-2` sits 30% of the way from the old `ink-2` to `ink` (CAM16-UCS blend for brand looks). Wren: `ink-2` #40403c (10:1 on white), `ink-3` #56564f. Night: `ink-2` #bfbdb6, `ink-3` #a9a79f. The brutal look keeps its values (already 7:1+). This overrides the design-language artifact; the artifact file carries the new values.

## Aerie card (precedent: Linear board card)

- Meta line on top: id, area (`ink-3`, 12px).
- Title: `ink`, 600, 14px.
- Summary: `ink`, 13px.
- One property row: priority as a tinted word, people as chips.

## Decision log

- 2026-11-16: C chosen; tokens stepped in every look; role pass starts with packages/ui shared parts and Aerie.
