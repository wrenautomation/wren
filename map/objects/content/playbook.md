---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-04
entity: packages/content/src/schema.ts:61
---

# playbook

A platform's SOP, pushed from the private sops folder, read into every draft prompt for that platform. Table `content_playbooks`.

## Why this shape

SOPs live in `../sops`, outside this public repo, so the text reaches the Lambda through the database, not the bundle. Insert-only: the newest row per platform is live, and `content_drafts.playbook_id` says which version a draft was written against, so a lesson can be traced to the SOP that caused it. Pushing the same text again stores nothing (`playbook.ts:38`). The voice and the prompt's own rules win where the playbook differs; only its writing rules apply, not its posting steps.

## Shape

- `platform` (`PLATFORMS`), `sop` (the folder name), `text` (SOP.md, 16,000 chars max) (`schema.ts:61`–`74`)

Citations: `packages/content/src/schema.ts:61`, `packages/content/src/playbook.ts`

## Connected to

- **owned-by:** [[content/platform]]
- **joins:** [[content/draft]] (`playbook_id`), [[processes/sop-build]] (`wren sop push`)
- **joins:** [[content/funnel]] (written posts: one idea, an adapter per platform)

## If you change this

- **Hits:** `draft.ts` (`draftPrompt`, `draftIdea`, `redraft`; bump `DRAFT_PROMPT_VERSION`), `wren sop push`
- **Does not hit:** `lessons.ts` (notes and winners stay separate)

## Surfaces

| Surface | Role |
|---|---|
| `wren sop push <name> --platform <p>` | writes (prod: `node scripts/prod-wren.mjs sop push …`) |
| `ContentDesk.draft/redraft` | reads |

## See

- Source: `packages/content/src/playbook.ts`
