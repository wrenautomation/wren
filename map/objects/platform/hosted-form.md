---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ 6fc58b65
entity: packages/sites/src/schema.ts:138
---

# hosted-form

A form as data: fields, rules, a thank-you or redirect, an optional booking step. Table `site_form_defs`; served at `/o/f/<slug>` on the owner's host; Sites → Forms and Submissions in the portal.

## Why this shape

One door path for pages and forms: a submit lands in the same `site_forms` table, through the same `/o/__form` post and the same site door as a Sites page, so speed to lead and webhooks out need nothing new. Rules come from a fixed list (digits, letters, ZIP, web address), never a typed regex. The consent box keeps the words shown and a 12-hex version of them, so every opt-in can prove its TCPA wording.

## Shape

- `site_form_defs`: `client` (null is Wren), `slug` (unique per owner), `name`, `status` draft|live|retired, `spec` (`FormSpec`, `packages/sites/src/forms.ts:60`), `hook`, `created_*`, `updated_*`.
- `site_forms` gains `form`, `consent {text, version}`, `visitor` (`wv`), `human` (Turnstile `yes` | `off`); `page` nullable. `site_events` gains `form` and the `start` event.
- Views `site_form_records` (views, starts, submits, conversion, url) and `site_entry_records` (every field, source, consent, door result). Migration `0182_forms`.
- Round two: a field's `show` rule (is, not, filled, empty on an earlier field) and `step` fields
  that split it into steps (`site_events.step`, migration 0204). `site_form_splits` runs A/B per
  form (`form-split.ts`): `wab` cookie on `/o/f/<slug>`, `form_split` + `arm` on `site_events`
  and `site_forms`, a submit checked against its arm's spec (migration 0205).
- Check: `checkEntry` (`forms.ts:241`); consent words `consentWords` (`forms.ts:81`). Serve: `Sites/serveForm` (`packages/sites/src/service.ts:163`), submit `Sites/form` (`:271`) enters the door with `event: "form.submitted"`.
- CSP: `PAGE_CSP` allows `challenges.cloudflare.com` (Turnstile) on every page; `FORM_CSP` lets any site frame a form (the embed).

Citations: `packages/sites/src/schema.ts:138`, `packages/sites/src/forms.ts:60`, `packages/sites/src/form-store.ts:81`, `packages/sites/src/service.ts:271`, `packages/sites/src/render.ts:14`, `apps/portal/src/sites.ts:222`

## Connected to

- **owns:** `site_form_defs`, `site_form_splits`
- **owned-by:** `@wren/sites`
- **joins:** [[clients/client]] by `client`; [[platform/spine]] (the door); [[platform/webhook-subscription]] (`form.submitted`)
- **looks-like-but-is-not:** a Sites page's default form section (no def row); `Ads.leads` (Meta form fills)

## If you change this

- **Hits:** the door payload (`HOOK_PRESETS.site` reads it), webhooks out's `form.submitted`, embeds already pasted on client sites (`/o/f/<slug>?embed=1`, `/o/__kit.js data-embed`), the consent version of every past opt-in when the words change.
- **Does not hit:** Sites pages' versions and To approve (form publish and form A/B are direct).
- **Also hits:** the Worker's `page()` in `apps/portal/src/sites.ts` serves both pages and forms; a cache or cookie change lands on both.

## Surfaces

| Surface | Role |
|---|---|
| Sites → Forms (`apps/portal/web/src/modules/sites/forms.tsx`) | builder (show rules, steps, A or B), preview, publish/unpublish/retire, A/B test, embed snippets, numbers per source and step |
| Sites → Submissions | every submit whole, CSV export |
| a client's Sites → Forms, Submissions | its own rows only (`formRecordFor`, `entryRecordFor`) |
| portal Worker `/o/f/<slug>`, `/o/__form` | serve, Turnstile, `wv` cookie, post |

## See

- Source: `packages/sites/src/forms.ts`, `packages/sites/src/form-store.ts`
- Design: `designs/2026-10-07-forms-and-pay.md`
