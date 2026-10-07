---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-06 @ 4037f8e
entity: packages/core/src/schema.ts:754
---

# template-store

Every channel's copy and every model prompt in two tables, `templates` and `template_versions`: one slot syntax, a version per save, one live, Publish to make a draft live (designs/2026-10-06-edits-claude-templates.md, step 3).

## Why this shape

A version is the hash of the words, kept once and never changed, so a send can name exactly what it said. Only the live version goes out; a save is a draft, and Publish sends nothing (a sender reads live when it next composes) (`packages/core/src/templates.ts:1`). One parser for all four kinds, so `[[variants]]` and `((groups))` work on texts and DMs too; each kind differs only in its finish (`STYLE`, `packages/core/src/slots/kinds.ts:26`).

## Shape

- `templates {kind, system, name, live_version_id, draft_version_id}`, unique on (kind, system, name) (`packages/core/src/schema.ts:754`); `template_versions {template_id, version, source, created_by, published_at, published_by}` (`:792`)
- kinds `email | sms | dm | prompt` (`slots/kinds.ts:20`). System: the niche for email, `texts` for SMS, `reach` for DMs, the asking package for a prompt (`reactivation`, `content`)
- `TemplateRef {kind, system, name}` (`templates.ts:22`); `saveDraft`, `publish`, `saveLive`, `importVersion` (live only where nothing is), `liveTemplates` (`:162`–`:280`)
- prompts: `livePrompt` seeds the code's words as version 1 on first use, then the store wins; renders exactly, `""` a value (`templates.ts:337`, `slots/tree.ts`)
- every cadence step names its template: `CadenceStep.template` (`packages/core/src/workflows.ts:72`). Named `CadenceStep`, not `Step`: the spine's `Step` is its handler type
- `template_stats` view: sends, replies, booked (email only) per kind, system, template, version and picks (`packages/core/src/views.ts:123`, migration 0128)
- records `templates.template|version|variant|sequence|step`, read only (`packages/core/src/template-records.ts:268`)

Citations: `packages/core/src/templates.ts:1`, `packages/core/src/schema.ts:754`

## Connected to

- **owns:** the versions each send pins: `messages.template_version`, `sms_messages.template_version`, `reach_messages.template_version`, `compositions.prompt_version`
- **feeds:** [[email/template]] (imported by `importEmailFiles`, `packages/niches/src/import.ts:19`), SMS step bodies (`liveTexts`, `packages/channel-sms/src/template-store.ts:90`), DMs (`liveDms`, `packages/outreach/src/store.ts:41`)
- **prompts:** reactivation `COMPOSE_PROMPT` (`packages/reactivation/src/compose.ts:299`), `DRAFT_ASK_PROMPT` (`packages/content/src/draft-ask.ts:422`), `VIDEO_ASK_PROMPT` (`packages/content/src/video-ask.ts:30`)
- **looks-like-but-is-not:** [[platform/offer]] (offers stay in code: the lander reads a snapshot)

## If you change this

- **Hits:** a publish changes the next compose on that channel; queued email drafts re-render on `QueueRefresh/all`
- **Hits:** a prompt's words in code once seeded: nothing. Edit it in the store (`wren templates show prompt <system> <name>`)
- **Also hits:** reactivation keeps `COMPOSE_VERSION` as its cache key, so a prompt edit redrafts no one
- **Does not hit:** sent messages; `sms_templates` and `reach_templates`, kept until a later drop

## Surfaces

| Surface | Role |
|---|---|
| `wren templates import\|list\|show` | moves old copy in, reads it |
| marketing Texts and DMs pages | save and publish |
| the Library (step 4) | reads the records |

## See

- Design: `designs/2026-10-06-edits-claude-templates.md`
- Parity: `packages/niches/test/integration/templates-parity.test.ts`, `packages/reactivation/src/compose-prompt.test.ts`, `packages/content/src/ask-prompts.test.ts`
