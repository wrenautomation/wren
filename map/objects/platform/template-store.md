---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ f7ab3fe
entity: packages/core/src/schema.ts:1063
---

# template-store

Every channel's copy and every model prompt in two tables, `templates` and `template_versions`: one slot syntax, a numbered version per save with who, when and why, one live. Wren's built-in words are files synced in as defaults; the database holds the live copy (designs/2026-10-07-templates-live-copy.md, on 2026-10-06-edits-claude-templates.md).

## Why this shape

A version is kept once and never changed, so a send can name exactly what it said. Only the live version goes out; a save is a draft, and making one live sends nothing (a sender reads live when it next composes) (`packages/core/src/templates.ts:1`). A template follows the newest default until it has its own live version. One parser for all five kinds; each differs only in its finish (`STYLE`, `packages/core/src/slots/kinds.ts`).

## Shape

- `templates {kind, system, name, folder, live_version_id, draft_version_id, waiting_version_id, waiting_by, follows_default, why}` (`packages/core/src/schema.ts:1063`); `template_versions {template_id, number, version, source, origin, why, opened_from, default_hash, created_by, published_at, published_by}` (`:1117`)
- kinds `email | sms | dm | post | prompt` (`slots/kinds.ts:20`). System: the niche for email, `texts` for SMS, `reach` for DMs, the asking package for a prompt (`reactivation`, `content`). Ref text `<kind>:<system>/<name>` (`refText`, `parseRef`)
- writes: `saveDraft` checks `expect` (the version opened) and throws `TemplateConflict` when it moved (`templates.ts:317`); `askPublish` makes a prompt live at once and parks copy that sends as waiting (`:434`); `approve`, `decline`, `restore`, `reset`; each sets the audit actor in its transaction
- reads: `liveTemplates`/`resolveTemplate` (`:666`), `templateState`, `listTemplates` (status per row, `:740`), `versionsOf`
- defaults: `packages/templates/defaults/<kind>/<system>/**` (`.email .sms .dm .post .prompt`); `loadDefaults`, `syncDefaults` (deploy: main all, clients only what they have), `installDefaults` (a part's `provides.templates` on install), `livePrompt` (`packages/core/src/template-defaults.ts:127`–`:182`); `writeDefault` (`templates.ts:829`)
- every cadence step names its template: `CadenceStep.template` (`packages/core/src/workflows.ts`)
- `template_stats` view: sends, replies, booked per kind, system, template, version and picks (`packages/core/src/views.ts`)
- records `templates.template|version|variant|sequence|step`; `TEMPLATE_EDITS` saves a draft of an email or prompt (`packages/core/src/template-edits.ts`)
- `lineDiff`, `unified`: the diff the CLI prints and the Library draws (`packages/core/src/line-diff.ts`)

Citations: `packages/core/src/templates.ts:1`, `packages/core/src/schema.ts:1063`, `packages/core/src/template-defaults.ts:1`

## Connected to

- **owns:** the versions each send pins: `messages.template_version`, `sms_messages.template_version`, `reach_messages.template_version`, `compositions.prompt_version`
- **feeds:** [[email/template]] (`liveEmails`), SMS step bodies (`liveTexts`, `packages/channel-sms/src/template-store.ts:86`), DMs (`liveDms`, `packages/outreach/src/store.ts:34`)
- **prompts:** `prompt:reactivation/compose` (`COMPOSE_PROMPT_REF`, `packages/reactivation/src/compose.ts:300`), `prompt:content/draft-ask`, `prompt:content/video-ask`, all read through `livePrompt`
- **looks-like-but-is-not:** [[platform/offer]] (offers stay in code: the lander reads a snapshot)

## If you change this

- **Hits:** a publish changes the next compose on that channel; queued email drafts re-render on `QueueRefresh/all`
- **Hits:** a default file: the next deploy's `wren templates sync` writes it as a new `default` version, live wherever the template follows its default; a template with its own copy shows "default updated"
- **Also hits:** reactivation keeps `COMPOSE_VERSION` as its cache key, so a prompt edit redrafts no one
- **Does not hit:** sent messages

## Surfaces

| Surface | Role |
|---|---|
| `wren templates ls\|get\|set\|diff\|history\|restore\|reset` (`apps/cli/src/templates.ts`) | reads all kinds; writes email and prompts, `set --publish` asks |
| `wren templates sync\|install` | defaults into every database (deploy), a client's parts |
| marketing Texts and DMs pages | save texts and DMs with each slot's rules |
| `TemplatesConsole` (`packages/core/src/templates-console.ts`, routes `templates/*`) | the Library's reads and writes; checks `act` at each template's app and channel (`templateAt`) |
| Marketing To approve (`marketing.approval`, ids `template:<id>:<n>`) | a person approves or declines a waiting version (`waitingAsks`) |
| the Library, Templates (`apps/portal/web/src/modules/library/templates.tsx`) | folder browser: search, filters, editor with live preview, history, diff, restore, conflict banner, publish, reset, move |
| the Library, Sequences (`apps/portal/web/src/modules/library/`) | reads numbers |
| `Browser`, `Diff` (`packages/ui/src/browser.tsx`, `diff.tsx`) | the kit's tree, list, detail and line diff; niches, SOPs, offers and settings can reuse them |
| `@wren/core/templates/labels` (`packages/core/src/template-labels.ts`) | folder and template names as people read them; refs stay the paths |
| Workflows' Play | each step's live template, rendered for the made-up lead |

## See

- Design: `designs/2026-10-07-templates-live-copy.md`, `designs/2026-10-06-edits-claude-templates.md`
- Tests: `packages/core/test/integration/templates.test.ts`, `templates-console.test.ts`, `template-defaults.test.ts`, `packages/niches/test/integration/templates-parity.test.ts`
