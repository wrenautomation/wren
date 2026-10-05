# Borrowed UI

Living doc. Started 2026-10-04. William asked to "analyze and steal UI principles of features we haven't thought of" from Twenty and Mautic, starting with opt-in marketing for Wren's organic content, and to be very picky because some of it is badly designed. The bar is the console standard (`2026-10-03-console-standard.md`). An idea gets in only if it fits that bar and fills a gap we have. Every skip is listed with its reason so nobody proposes it again.

## How I looked

Ran both locally in Docker on 10-04 with sample data, then tore them down. Cost $0.

- Twenty (latest Docker image): companies, people, opportunities, record panel, filters, views, command menu, data model, workflows, onboarding.
- Mautic 5.2.11: contact page, contact preference center, segments, email and unsubscribe settings, landing pages, campaign builder.

Twenty used about 1.7 GB of memory (server 750 MB, worker 760 MB, Postgres, Redis), and its UI hung after a few page loads. Mautic used about 290 MB.

## Take

1. **Column totals under every list** (Twenty). A footer row shows one figure per column: count, sum, average, % empty. Twenty makes the user pick per column. We pick per field kind, so nobody configures it: `money` sums, `rate` pools n of m over the view with the same Wilson rule, `verdict` shows % valid, `date` shows the newest, `status` counts the most common state, `text` shows % filled. Each figure links to its rows, so "38% no email" opens those people. This is rule 2 applied to the whole view, and it shows data gaps without a report. Lands in the List template and the field kind files in `@wren/ui`.
2. **A command menu scoped to where you are** (Twenty). ⌘K opens with three groups in order: this view (export, copy link), this record type (its declared actions, new saved view), then go-to and search. Go-to has two-key shortcuts, G then P for People. Our ⌘K only finds. Records already declare their actions, so the menu reads them and nothing new gets declared. Lands in the shell.
3. **"Created by" on every record** (Twenty). Twenty's actor field holds a person, the system, a workflow, an API key or an import. We keep provenance on addresses and in the audit log, but a list can't show who or what made a row. Add an `actor` field kind (a pipeline stage, William, a client user, an import file) and show it where people and machines both write rows: suppressions, consents, notes, drafts. Most of the values are in columns we already have.
4. **Filter picker in two parts, with search across all fields** (Twenty). The picker lists the columns on screen first, then the hidden ones, then a free-text search over every field. It answers "can I filter by that?" without opening the column picker. Lands in the List template.
5. **Grouped record fields, system fields last** (Twenty). Twenty groups fields as General, Business, Contact and System. We add an optional `group` on each field in `defineRecord`, with created, updated and actor in a collapsed System group at the bottom. We leave out its empty placeholders. Twenty shows every empty field as a gray label to invite an edit, and pipelines write most of our fields, so empty fields stay hidden.
6. **One recommended add-on, preselected, at setup** (Twenty). Onboarding offered one app, already checked, described in one line ("Shows when you last talked to each contact"), with two buttons: Install 1 app and Skip. For the marketplace (`2026-10-04-components-and-marketplace.md`), a new client sees the one component that fits their niche, preselected and described by its outcome. One click adds it, one skips. Setup shows no catalog.
7. **A public name for a list, and a switch that puts it in the preference center** (Mautic). A Mautic segment has an internal name, a public name and an "Available in Preference Center" switch. That becomes the topic model below. The console shows the internal name, subscribers only ever see the public one, and a topic appears in the preference center only when marked public.
8. **Unsubscribe confirms with an undo** (Mautic). The confirmation page says the address is off the list and links back in. That matches rule 7, undo over confirm. Used in the preference center below.
9. **Frequency and pause set by the person** (Mautic). Mautic's preference center lets a contact cap messages per channel ("N messages each day, week or month") and pause between two dates. We take both with fixed choices: as sent, weekly at most, monthly at most, and a pause of 30 or 90 days. A free number and two date pickers ask more of the subscriber and invite mistakes.
10. **Consent changes in the person's activity** (Mautic). Mautic's contact history shows every event with filters by source. We already have an activity tab, so we take one narrow piece: each consent change appears there with its source and proof. The record then answers why we may email this person.

## Skip

| Idea | Seen in | Why not |
|---|---|---|
| Views in a dropdown | Twenty | Our saved views are tabs with counts. A dropdown hides the counts. |
| Kanban by stage | Twenty | Only worth it where a person drags items between states. Pipelines set ours. Revisit if we build a deal board for clients. |
| "Add New" row and a Create button on every list | Twenty | Pipelines and forms make our rows. A blank row invites junk. |
| Custom objects and fields in settings | Twenty | Records are declarations in code and clients don't edit schema. A component that adds a field ships it in code. |
| Soft delete with a deleted view | Twenty | We rarely delete. Suppressions already have `lifted`, and the 10-second undo covers the rest. |
| Favicon chips for companies and links | Twenty | Color noise on long lists of firms, and fetching icons from a third party leaks every domain we look at. |
| "Ask AI" on every page | Twenty | A generic chat box on a list gives no outcome. Our model work runs inside pipelines. |
| "Skip anyway?" after Skip on invites | Twenty | A guilt prompt after the person already chose. |
| Skeleton rows that sit for seconds | Twenty | Its lists showed placeholders for several seconds and then hung. We keep small server-side pages of real rows. |
| Points and stages (engagement scoring) | Mautic | Opens are unreliable and points reward noise. We score on signals like a move or a hire. |
| Visual campaign builder | Mautic | Our flows are Restate code with tests, and a drag-and-drop canvas can't be tested. The Run template already shows the graph read-only, which is the part people use. |
| Categories next to segments in the preference center | Mautic | Two overlapping ideas for one thing. We have topics. |
| Preferred channel per person | Mautic | We don't route one message to whichever channel a person likes. Revisit if the same content goes out by email and SMS. |
| Six switches for what the preference center shows | Mautic | Settings nobody should touch. There is one preference center. |
| IMAP folders for bounces and unsubscribes | Mautic | Our inbound classifier already sorts bounces, auto-replies and unsubscribes. |
| Save, Save & Close and Cancel on every form | Mautic | Three buttons for one decision. Forms save once and switches save on change. |
| Page builder, translations, page availability dates | Mautic | The lander is code. |
| Engagement chart on an empty contact | Mautic | An empty chart reading "No data found" breaks rule 6. |
| The look: blue bars, pill buttons, large headings | Mautic | Ours stays. |

## Opt-in marketing

### What exists

- `suppressions` (email, domain, phone; opt_out, bounce, complaint, manual, lifted) with evidence in `suppression_events`. Every channel writes it through core, and compose and send gate on it.
- The inbound classifier catches unsubscribe replies to email and STOP texts.
- Cold email sends no `List-Unsubscribe` header. That's fine at 10 a day. Marketing mail needs it.
- No consent records, topics or preference page.

The law treats the two differently. Cold B2B email in the US needs a working opt-out and no prior consent. Marketing to people who signed up runs on consent, and the consent must be provable: Canada (CASL) and the EU (GDPR) require it, and US marketing texts need prior express written consent (TCPA). So marketing gets its own gate on top of suppressions, and cold outreach keeps the one it has.

### Model

Three tables in core next to suppressions. Each client database gets them through the shared migrations, as it gets suppressions.

- `topics`: what someone can sign up for. Internal name, public name, one public line ("A short breakdown of one automation, weekly"), channel (email or sms), cadence in words, and whether it shows in the preference center.
- `consents`: one row per address, channel and topic. State is pending, confirmed or withdrawn. It holds the source (lander form, Meta lead form, SMS keyword, cal.com booking), the version of the text the person agreed to, a time for each state, the frequency choice and pause-until.
- `consent_events`: append only, one row per change, with proof as jsonb: form URL, IP, user agent, the exact consent text and the confirm click. Same pattern as `suppression_events`.

One function in core, `mayMarket(channel, address, topic)`, decides a send. Compose checks it and send checks it again:

1. No active suppression for the address, or for its domain on email. A suppression beats every consent.
2. A confirmed consent for this topic and channel.
3. Not paused.
4. Under the cap: the person's own choice, else the channel default. SMS keeps 4 in 31 days.

Unsubscribing from one topic withdraws that consent. "Unsubscribe from everything" writes an `opt_out` suppression, so it stops cold outreach too. A confirmed double opt-in newer than an opt-out suppression lifts it, through `liftSuppression` with the consent as evidence. Nothing else lifts an opt-out.

Rules:

- Email signups are double opt-in. The form makes a pending consent, a confirm email goes out as transactional mail, and the click confirms. Pending expires after 7 days with no reminder.
- A Meta lead form with a consent checkbox confirms directly. The form ID and Meta's consent text are the proof. The first send is a welcome with one-click unsubscribe.
- SMS consent never follows from email consent. An SMS topic needs its own unchecked box with its own text.
- An imported list without proof never gets marketing. There is no "mark as consented" action.
- Every marketing email carries `List-Unsubscribe` and `List-Unsubscribe-Post` (one click, RFC 8058), a footer link to the preference center, and the postal address CAN-SPAM requires.

### Preference center

One page on the lander, `/prefs/<token>`. The token is signed per address, so there's no login. It follows the client's palette (palette P3).

- From an unsubscribe link, the top line reads "You're off <public name>." with an Undo button, and the full page sits below.
- Each public topic shows its public name, its line, its cadence and a switch. Switches save on change.
- Per channel: how often (as sent, weekly at most, monthly at most) and a pause of 30 or 90 days.
- At the bottom, "Unsubscribe from everything" takes effect at once and offers Undo.

It has no confirm step and no exit survey.

### Console

Built on the records standard, with no hand-built pages.

- `marketing.subscriber`: address, topics as chips, state, source, since, last sent, cap, actor. Views: Confirmed, Pending, Withdrawn, Paused. The record opens with one line on whether we can send, such as "Can send: confirmed for <topic> on Oct 12 by lander form" with the proof one click away, or "Can't send: unsubscribed from everything on Nov 3".
- `marketing.topic`: public name, confirmed count, net change this week, confirm rate (pending to confirmed), unsubscribe rate per send as a `rate`, last send.
- Overview: net subscribers, confirm rate, unsubscribe rate, top sources. Both lists get column totals (take 1).

### Phases

- M1: tables, `mayMarket`, the suppression rules, migrations, integration tests.
- M2: lander signup form and confirm email, the preference center, one-click unsubscribe headers and the footer.
- M3: console records and overview.
- M4: Meta lead form and SMS sources.

Opt-in marketing builds when William starts the first content funnel, or on his word. Takes 1 to 6 are small changes to the List and Record templates and the shell, and can ship before then.

## Decision log

- 2026-10-04: Written after running Twenty and Mautic locally. Ten takes; everything else is skipped with a reason. Opt-in marketing sits on top of `suppressions`: consent per address, channel and topic with proof, one send rule, and a preference center on the lander. Cold outreach keeps its own gate. Nothing built yet.
- 2026-10-05 (P1, takes 1 to 5): Built. Totals ride the list's count query, so they cover the view, filters and search, never just the page. Number, percent, score, link and cited get no footer: the take names none. Text says "38% empty" and links to the empty rows, since the gap is the news; a full column says "All filled". A status total shows its commonest state. A figure links only when the viewer may filter or sort that way, so the demo's footer is plain text. ⌘K's "new saved view" is skipped: views are declared in code and the address is the saved view, so "Copy link" covers it. G then a letter takes each page's first free letter; delivery's "I've given it" moved from G to I. The actor kind is masked on the demo, like a name. "Search every field" searches the fields a type marks searchable, the same as the search box, and says "Search <list> for".
- 2026-10-05 (P2, take 6): Built. The add-on is declared on the offer (`Offer.addOn`), not the niche: a client buys an offer, and one offer names one component, so "the one that fits" needs no picking. Recruiting's reactivation offers name day-before SMS reminders. The Apps page shows it once to a client user (not the team, not the demo), checked, with its blurb, "Install 1 app" and "Skip". A client can't install, so Install is the marketplace's ask and Wren's team installs it. Skip is kept in the browser; a server-side skip waits for a client with two people. A component that isn't ready or is already installed never shows.
- 2026-10-05 (M1): Built. Pending expires at the confirm click, with no loop. Frequency and pause are stored on every consent of the address and channel, so one setting covers every topic. Caps count `sent` events. "Unsubscribe from everything" keeps the consents and adds an `opt_out` suppression. Its Undo lifts only that event, and only while it is the newest and under 24 hours old: the one lift besides a double opt-in, and it is the person's own click. A one-step consent (Meta, a text keyword, a preference-center switch) never lifts an opt-out. A form posted again within a day mails no second confirm. A bounce, complaint, manual block or suppressed domain gets no confirm email; an opt-out does, since its click is what lifts it.
- 2026-10-05 (M2, wren side): `Marketing{signUp,confirm,prefs,set}` behind the phone Worker's `/marketing/<handler>`, with no new secret. The lander signs each signup after its bot check with the export token it already shares with wren, and preference links are signed with a key derived from that token. Rotating the token breaks old links. The confirm email goes from portal@. A topic switched on in the preference center is a consent with source `preference_center`: the signed link proves the inbox. `marketingEnvelope` returns the one-click headers and the footer with the postal address. No marketing sender exists yet, so nothing calls it; a sender without a postal address is refused.
- 2026-10-05 (M2, lander side): `/api/subscribe` checks Turnstile, signs the address and passes the form, the exact text and its version, IP and user agent as proof. `/prefs/<token>` is server rendered in the lander's palette, with `noindex` in a header and a meta tag, and it is never in the sitemap. A GET never changes anything. The confirm and unsubscribe links open a page that posts itself, with a button when scripts are off, so a link scanner can't confirm or unsubscribe anyone. A mail app's one-click POST withdraws the link's topic. Every change redirects back with one line on top: "You're off X." or "You're off everything." with Undo, else "Saved.". With everything off, the page says so and hides the switches; coming back takes a new signup. `Subscribe.astro` is the form; no page uses it until one names a topic.
- 2026-10-05 (M3, records): `marketing.subscriber` and `marketing.topic` on three views. A subscriber is one address on one channel across its topics. Its state is off, paused, confirmed, pending, lapsed (pending past 7 days) or withdrawn, and its subtitle is the "Can send" line. Activity merges consent events with their proof and the address's suppressions. The topic's confirm rate is confirmed over signed up, among consents that went through pending, so one-step consents don't inflate it.
- 2026-10-05 (M4): Built. `Ads.leadConsents{formId, topic, checkbox, text}` pulls a form's leads with `custom_disclaimer_responses` and confirms each lead whose box is ticked, with the form, the lead, the box's key and its exact words as proof. A lead already recorded for that form is skipped, so a second pull never re-subscribes someone who left. SMS: a topic can carry a `keyword`, and a text that is only that word (any case, punctuation ignored) confirms the sender for it, with the message as proof. STOP and START run first, and a keyword never lifts an opt-out. Both sources skip the welcome text and email for now, because no marketing sender exists yet; the first marketing send will be the welcome. The M1 migration missed an index on `consents.topic_id`, which broke CI; 0086 adds it.
