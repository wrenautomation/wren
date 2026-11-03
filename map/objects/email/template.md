---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-23 @ 39edf1d2
entity: packages/starling/outbound/src/email/outreach/templates.ts:47
---

# template

An email's words, live in the [[platform/template-store]] (kind email, system the niche), parsed into a `Template` tree. Wren ships no email files: the store holds every word (set with `wren templates set` or in Library, Templates). Compose reads `liveEmails`, and `copyGap` (`packages/starling/outbound/src/email/outreach/live.ts`) says why a sequence cannot compose (a step not live, an opener with no subject, an unset `offer.*` term): the queue-keeper skips it and records the reason.

## Why this shape

Every word a sent email contains is human-authored; `render()` only assembles and records (`templates.ts:1`). Four marks and nothing else: `{key}`, `{key|fallback}`, `[[a | b]]`, `((optional))` (`authoring.ts:1`); `[[#name a | b]]` names a point (`authoring.ts:302`). No callables live in the tree, so `version` changes exactly when the words change, and `template_versions` stores the source under that hash at compose (`compose.ts:754`).

## Shape

- `Template` (`templates.ts:47`); `parseTemplate` (`authoring.ts:142`)
- a file without a leading `subject:` is a thread-riding follow-up; `<arm>/opener` belongs to an arm, a root-level file is shared (`sequences.ts:1`)
- `template_versions`: `niche`, `template`, `version`, `source`
- pickers choose among variants, deterministic by hash, or along forced shares (`sharePick`, the spam check's coverage)
- `{page.<slug>}` links one of Wren's live Sites pages with the email's utm (`outreach/pages.ts`); compose refuses a page that isn't live, the send holds a step whose page went off (`page_not_live`)
- each message keeps its picks (`provenance.picks`, `v1` → option); `variantOutcomes` scores every option per version, `wren email variants` prints it (`packages/starling/outbound/src/email/report/variants.ts:1`)

Citations: `packages/starling/outbound/src/email/outreach/templates.ts:47`, `authoring.ts:142`

## Connected to

- **owned-by:** [[platform/niche]] (sequences name the templates; the store holds them)
- **owns:** the pinned `template` + `template_version` on [[email/message]]
- **joins:** [[email/sequence]]; facts from `factsFor` (`outreach/facts.ts:125`)
- **looks-like-but-is-not:** an SMS step body (`packages/starling/channels/sms/src/templates.ts`)

## If you change this

- **Hits:** publishing a version changes every future draft; adding a `{key}` needs the facts view to supply it or drafts are refused. Editing a `.email` file changes the default: the next deploy's sync makes it live wherever the template follows its default
- **Also hits:** queued, untouched, unstarted messages: deploy calls `QueueRefresh/all`, which re-renders them (`packages/starling/outbound/src/email/restate/queue-refresh.ts:1`)
- **Does not hit:** sent, hand-edited or person-approved messages; a sequence once a step went out

## Surfaces

| Surface | Role |
|---|---|
| `wren templates get\|set\|diff\|history` | reads and writes; `set --publish` waits in To approve |
| `wren email preview` | renders one |
| `ComposeScheduler` | renders all |

## See

- Source: `packages/starling/outbound/src/email/outreach/authoring.ts`
