---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-06 @ 6d30b4b
entity: packages/channel-email/src/outreach/templates.ts:47
---

# template

An email's words, live in the [[platform/template-store]] (kind email, system the niche), parsed into a `Template` tree. The `.email` files under `packages/templates/defaults/email/<niche>/` are defaults: `wren templates sync` writes each change in as a `default` version, live where the template follows its default; compose reads `liveEmails` (`packages/channel-email/src/outreach/live.ts:1`).

## Why this shape

Every word a sent email contains is human-authored; `render()` only assembles and records (`templates.ts:1`). Four marks and nothing else: `{key}`, `{key|fallback}`, `[[a | b]]`, `((optional))` (`authoring.ts:1`); `[[#name a | b]]` names a point, so an experiment can follow it (`authoring.ts:302`). No callables live in the tree, so `version` changes exactly when the words change, and `template_versions` stores the source under that hash at compose (`compose.ts:754`).

## Shape

- `Template` (`templates.ts:47`); `parseTemplate` (`authoring.ts:142`)
- a file without a leading `subject:` is a thread-riding follow-up; `<arm>/opener` belongs to an arm, a root-level file is shared (`sequences.ts:1`)
- `template_versions`: `niche`, `template`, `version`, `source`, and for a genome `parent_version`, `experiment_id` (`packages/channel-email/src/schema.ts:225`)
- pickers choose among variants, deterministic by hash, or along an experiment's shares (`sharePick`, `outreach/pickers.ts`)
- each message keeps its picks (`provenance.picks`, `v1` → option); `variantOutcomes` scores every option per version, `wren email variants` prints it (`packages/channel-email/src/report/variants.ts:1`)

Citations: `packages/channel-email/src/outreach/templates.ts:47`, `authoring.ts:142`

## Connected to

- **owned-by:** [[platform/niche]] (`templatesDir`, `packages/niches/src/niche.ts:67`)
- **owns:** the pinned `template` + `template_version` on [[email/message]]
- **joins:** [[email/sequence]]; facts from `factsFor` (`outreach/facts.ts:125`)
- **looks-like-but-is-not:** an SMS step body (`packages/channel-sms/src/templates.ts`)

## If you change this

- **Hits:** publishing a version changes every future draft; adding a `{key}` needs the facts view to supply it or drafts are refused. Editing a `.email` file changes the default: the next deploy's sync makes it live wherever the template follows its default
- **Also hits:** queued, untouched, unstarted messages: deploy calls `QueueRefresh/all`, which re-renders them (`packages/channel-email/src/restate/queue-refresh.ts:1`)
- **Also hits:** a template under a running [[email/experiment]]: the next tick imports the edit (new options live, dropped ones retired)
- **Does not hit:** sent, hand-edited or person-approved messages; a sequence once a step went out

## Surfaces

| Surface | Role |
|---|---|
| `wren templates get\|set\|diff\|history` | reads and writes; `set --publish` waits in To approve |
| `wren email preview` | renders one |
| `ComposeScheduler` | renders all |

## See

- Source: `packages/channel-email/src/outreach/authoring.ts`
