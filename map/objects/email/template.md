---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/outreach/templates.ts:47
---

# template

An email as a file: `packages/niches/templates/<niche>/**/*.email`, parsed into a `Template` tree, versioned by content hash into `template_versions`.

## Why this shape

Every word a sent email contains is human-authored; `render()` only assembles and records (`templates.ts:1`). Four marks and nothing else: `{key}`, `{key|fallback}`, `[[a | b]]`, `((optional))` (`authoring.ts:1`). No callables live in the tree, so `version` changes exactly when the words change, and `template_versions` stores the source under that hash at compose (`compose.ts:754`).

## Shape

- `Template` (`templates.ts:47`); `parseTemplate` (`authoring.ts:142`)
- a file without a leading `subject:` is a thread-riding follow-up; `<arm>/opener` belongs to an arm, a root-level file is shared (`sequences.ts:1`)
- `template_versions`: `niche`, `template`, `version`, `source` (`packages/channel-email/src/schema.ts:157`–`161`)
- pickers choose among variants, deterministic by hash (`outreach/pickers.ts`)
- each message keeps its picks (`provenance.picks`, `v1` → option); `variantOutcomes` scores every option per version, `wren email variants` prints it (`packages/channel-email/src/report/variants.ts:1`)

Citations: `packages/channel-email/src/outreach/templates.ts:47`, `authoring.ts:142`

## Connected to

- **owned-by:** [[platform/niche]] (`templatesDir`, `packages/niches/src/niche.ts:67`)
- **owns:** the pinned `template` + `template_version` on [[email/message]]
- **joins:** [[email/sequence]]; facts from `factsFor` (`outreach/facts.ts:125`)
- **looks-like-but-is-not:** an SMS step body (`packages/channel-sms/src/templates.ts`)

## If you change this

- **Hits:** editing a `.email` file changes its hash and every future draft; adding a `{key}` needs the facts view to supply it or drafts are refused
- **Does not hit:** stored messages (pinned); running enrollments

## Surfaces

| Surface | Role |
|---|---|
| William, in the `.email` files | writes |
| `wren email preview` | renders one |
| `ComposeScheduler` | renders all |

## See

- Source: `packages/channel-email/src/outreach/authoring.ts`
