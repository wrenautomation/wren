# Account setup, vendors and read limits per client (2026-10-07)

William, 10-07:

- "clients should get their own read limits, have some sort of account connections. like we might need a dedicated 'setup' type workflow that is connected to other workflows in that each account needs certain things set up, and you run them one time, now that account has stored 'this is set up', we can use that etc."
- "paid collectors and linkedin reads can run for them as long as we set up principled billing systems / help them set up their api keys, manage their costs, etc. or for other businesses we can manage it (both choices as first class options in our vendor system)".
- "if there's a subset of workflows that need a phone number then the business obviously needs their specific phone number campaign, compliance stuff set up, and we have one-time workflows or repeating workflows (with long horizon checks for whenever status appears). or for email domains where domains need warming etc. that would be on a per account basis. but for less technical clients maybe they don't want to deal with their own setup even if it's largely automated (too much mental stack), so for me to handle it using autobrowse, folding their costs into mine using a disciplined account setup system on our side (just get their google, or email, etc.) or something is also required."
- Approval of a client's copy and posts: Wren's team by default; the client's owner is an option per client.
- Texting cutoff: the legal limit. Keep the 20:00 clamp; the form window ends at 20:00 by default.

## Answer first

- Every account a client has is a row in one registry: a phone number, a sending domain, an inbox, a Search Console property, an ad account, a login. Each row says whose it is, what it is for, and who set it up.
- A setup is a workflow of kind `setup`. It runs on the spine for one account and leaves named facts on it: `telnyx.campaign_approved`, `search_console.service_account_added`. A part names the facts it needs. Missing facts show as "Needs your account" in the Shop, on install and on the canvas, with a link to the setup.
- A setup step waits as long as it must. It re-checks on its own schedule (15 minutes for DNS, a day for a carrier review) until the status shows. A repeating setup re-checks after it's done; a lost fact starts it again.
- Every setup has two modes. Self-serve: the client does each step with how-to text, and a check confirms it. Done for you: Wren's team or an autobrowse agent does it with the minimum the client hands over. Anything that creates a real account or buys something for a client waits on William's yes for that client and says "Waiting on Wren's team".
- Every metered vendor has two modes per client. Own key: the client's key in SSM, their quota, their bill. Managed by Wren: Wren's key, metered per client, a monthly cap, billed through Books. Wren is client zero on managed. No mode set: the part waits with "Needs setup".
- Every metered call records vendor, client, units, estimated dollars and mode. Read limits are buckets per (vendor, key). Managed buckets split Wren's quota by per-client shares and keep a reserve for Wren.
- Managed usage becomes draft lines per client per month in Books, at cost plus a markup (default 0). Nothing is charged.

## Nouns

| Noun | What it is | Where |
|---|---|---|
| Account | One thing a client has on a site: a number, a domain, an inbox, a property, a login. Owner (`wren` or a client id), site, ref, role, mode, the credvault login when Wren holds it | `client_accounts` (main) |
| Fact | A named truth about one account, set by a check or a person: ok, waiting or lost, with what was seen and when | `account_facts` (main) |
| Setup | A workflow of kind `setup`: steps that each make one fact true. Runs on the spine, one subject per account | code, `packages/*/src/setups.ts` |
| Setup run | One setup on one account: its mode, where it is, why it waits, when it checks next, its generation | `setup_runs` (main) |
| Vendor | A metered service: id, unit, public price with URL and date, its quota | `packages/core/src/vendors.ts` |
| Vendor mode | Per owner and vendor: `own` (a key pointer) or `managed` (cap, daily share) | `vendor_modes` (main) |
| Usage | One metered call or batch: vendor, owner, mode, bucket, units, est. micro-dollars, part, run | `vendor_usage` (main) |
| Usage line | One owner's month of one managed vendor: units, cost, markup, amount. Draft only | `books.usage_lines` |

`clients.accounts` stays as the Shop's one-per-site link. Connecting a site writes its registry row too, so the registry is the superset.

## Setup workflows

### Shape

A setup is declared like a cadence and compiles to an ordinary workflow (`setupWorkflow`, beside `cadenceWorkflow`):

```
setup.<id>  in.accounts -> s1 -> s2 -> ... -> out.done
            each sN.again -> sN.account, waiting its step's "every"
```

Each node uses the part `setup.step` with `with: { setup, step }`. The event kind is `account`, the subject `account:<id>:g<generation>`. One step:

| Field | Says |
|---|---|
| `fact` | the fact this step makes true |
| `label` | short, said to a person: "Carriers approve the campaign" |
| `who` | `client`, `wren` or `auto` (nobody acts, a check only waits) |
| `how` | self-serve how-to, said to the client |
| `forYou` | what Wren's team or the agent does in done-for-you mode |
| `goal` | optional autobrowse `do` goal for the agent, with inputs from the account |
| `buys` | true when the step creates an account or spends: waits on William's yes per client |
| `check` | a registered check name, or null when a person marks it done |
| `every` | how often to re-check while it waits: "15 minutes", "1 day" |
| `within` | how long before it's stuck and tells the team: "30 days" |

The step `setup.step` reads the fact. If it's ok, it passes `done` on with the base subject, so the next step gets it once. If not, it runs the check; if the check passes it records the fact and passes `done`. Else it records why, sets the run's state, and sends `again` with a round subject (`…#<n>`) that waits `every` on the self wire. A person marking a step done (console) sends a fresh round into the waiting node right away, so nobody waits for the next check. Old rounds that wake later find the fact set and pass `done` with the base subject, which the next node has already claimed, so they stop there.

Repeating setups name `repeat` ("7 days"). `SetupWatch` re-runs every done run's checks when due. A check that now fails marks its fact `lost`, sets the run `lost`, and starts the next generation from the first lost step. A part's call that fails for an account reason (a 403 from Search Console, a carrier block) calls `factLost(owner, site, fact, why)` the same way.

Waits are Restate delayed calls on the spine. Nothing polls and nothing bills while a step waits. One engine.

### Modes

| | Self-serve | Done for you |
|---|---|---|
| Who acts | the client, with `how` | Wren's team, or an agent through autobrowse `do` with `goal` |
| What the client hands over | nothing beyond the steps | the minimum: their Google login, an email address, a business detail |
| Where logins live | the client's | credvault, under autobrowse owner `<client>`, every use audited |
| Registry | the client's accounts | the same rows, `mode = for_you`, `login` set |
| Costs | the client's own bills | folded into Wren's managed billing for that client |

Mode is per client (`setup.mode` on the client), and per setup run where it makes sense (a client may do Google itself and hand over the phone). A done-for-you step with `buys: true` and no yes from William for that client stays `waiting_wren`, said as "Waiting on Wren's team". The worker gets no `do` runner for setup in this build, so every done-for-you agent step says the same. Tests use a fake.

### Worked examples

**Phone: the client's own 10DLC.** On Telnyx, the path Wren went through (`packages/channel-sms/src/registration.ts`).

| Step | Fact | Who | Check | Every | Buys |
|---|---|---|---|---|---|
| Business details: legal name, EIN, address, site | `telnyx.brand_details` | client | none (marked done) | | no |
| Brand registered with The Campaign Registry | `telnyx.brand_registered` | wren | none until Telnyx's brand read is in `Registration` | 1 day | yes |
| Campaign submitted: use case, samples, opt-in | `telnyx.campaign_submitted` | wren | none (marked done) | | yes |
| Carriers approve the campaign | `telnyx.campaign_approved` | auto | `telnyx.campaign` (`Registration.campaign`) | 1 day, within 30 days | no |
| Number bought on the client's profile | `telnyx.number_bought` | wren | none | | yes |
| Number on the campaign | `telnyx.number_assigned` | auto | `telnyx.number` (`Registration.number`) | 1 hour | no |

Repeats every 7 days: a suspended campaign or an unassigned number turns texts back to "Needs your account".

**Email: a sending domain and its inboxes.** Each domain and each inbox is its own account, with its own facts.

| Account | Step | Fact | Who | Check | Every |
|---|---|---|---|---|---|
| domain | Domain bought | `domain.owned` | wren (buys) | DNS answers for it | 1 hour |
| domain | SPF, DKIM, DMARC records | `domain.dns` | client or wren | `dns.mail_records` (DNS over HTTPS, `doh.ts`) | 15 minutes, within 2 days |
| domain | Postmaster verified | `postmaster.verified` | client or wren | `dns.postmaster_txt` | 1 hour |
| inbox | Inbox exists and signs in | `inbox.signs_in` | wren | `inbox.auth` (the roster's sign-in) | 1 hour |
| inbox | Warmup reached its ramp | `inbox.warmed` | auto | `inbox.warmup` (the roster's warmup day vs today) | 1 day, within 30 days |
| inbox | Lands in the inbox | `inbox.placement` | auto | `inbox.placement` (the newest placement test) | 7 days |

Domain and inbox setups repeat every 7 days, so a broken DNS record or a bad placement shows the same week.

**Google.** Search Console: one step, `search_console.service_account_added`, who `client`, check `search_console.access` (one Search Console read as Wren's service account), every 1 hour, repeat 7 days. Calendar: `google_calendar.delegated`, the client's Workspace admin allows Wren's service account, check `google_calendar.access` (a freebusy read).

**Meta.** `meta.partner_added`: the client adds Wren's business as a partner on its ad account. Check `meta.ad_account` (one read of the ad account). Repeat 7 days.

In this build the checks that read a vendor are registered by name with a fake in tests. The worker registers DNS (DNS over HTTPS, free) and the 10DLC reads (the Telnyx provider it already has). The rest say "Check in development" and wait for a person to mark them done.

### Parts name their facts

`requires.facts` on a component: `["search_console.service_account_added"]`. `factsLacking(component, facts)` joins `accountsLacking`. The Shop, template install and the canvas use the same "Needs your account" state and link to the setup. A lost fact moves an installed part back to it.

## Vendors

### The list

| Vendor | Unit | Price (public) | Quota per key | Own key means |
|---|---|---|---|---|
| `exa` Exa search | search | $7 per 1k (Auto, up to 10 results), exa.ai/pricing | none | their Exa key |
| `youtube` YouTube Data API | quota unit | $0, 10,000 units a day free | 10,000 a day | their Google Cloud key |
| `google_search` Google search reads | search | $0 (read in Wren's browser) | 200 a day, shared with profiles | not offered: Wren's browser only |
| `x` X API | post read | $0.005 per post read, docs.x.com pricing | pay per use | their X developer key |
| `linkedin` LinkedIn reads | profile read | $0 | 10 a day per account | their LinkedIn login |
| `models` Models through the gateway | call | priced by the model; $0 on free keys | the gateway's ring | their model key |
| `reddit` Reddit reads | search | $0 | 400 a day shared | not offered |
| `telnyx` Texts | message part | $0.004 per part plus carrier fees, telnyx.com/pricing/messaging | none | their Telnyx account |

Prices live in `vendors.ts` with the URL and the day read, like `in-house.ts`. A vendor with no public number has price null and estimates $0, said as "no public price".

### Modes per owner

| Mode | Key | Quota | Money | Who pays |
|---|---|---|---|---|
| `own` | the client's, in SSM at `/wren/<env>/owners/<client>/keys/<VENDOR>` (credvault's owner path layout), Postgres keeps only the parameter name | the key's own | the client's bill at the vendor | the client |
| `managed` | Wren's | a share of Wren's, below a reserve Wren keeps | metered here, stops at the client's monthly cap | the client, through Books |

- Wren is client zero: owner `wren`, managed on every vendor, no cap, no markup. Its usage is metered too.
- No row for a client and vendor: parts that need it wait with "Needs setup". That's the default.
- A client may pick managed for a vendor only when Wren's vendor settings allow it for clients. Default: every vendor but `linkedin` (managed LinkedIn reads would read as William's main). William's call, under Open.
- Setting an own key: Wren's team pastes it on the client's Vendors page once. The worker writes it to SSM through `KeyStore`, the row keeps the name. The page never shows it again. No key in the worker's env means "Key store not set up here" and nothing is saved.

### Read limits

A bucket is `(vendor, key)`. Its id is `<vendor>:own:<owner>` for an own key and `<vendor>:managed` for Wren's.

- Own key: the vendor's quota per key, counted from that bucket's usage alone.
- Managed: the client's room is the smallest of three. Its own share (`per_day` on its mode, default 0, so nothing runs until set). The clients' pool, which is Wren's quota less the reserve (default half). And the whole quota. Wren's room is the whole quota less what clients used, so clients can never take Wren's reserve.
- `bucketRoom` (the existing GCRA in `pacing.ts`) does the math over `vendor_usage` times.

The old per-source buckets (`collectorRoom`, `youtubeRoom`, `exaSearchRoom`) keep counting their own tables for Wren. A client's metered unit asks `vendorRoom` first. This reverses the 10-07 call "Buckets stay one per source": a client's room is its own, not main's plus its own.

### Metering

`meter(main, { owner, vendor, units, part, runId })` writes one `vendor_usage` row: mode, bucket, units, est. micro-dollars from the price. `gate(main, owner, vendor, units)` answers ok, or why not: "Needs setup", "Monthly cap of $X reached", "No reads left today, next in 3 minutes". A run that hits a cap stops that owner's metered units for the pass and says why in its stats. Nothing else stops.

Who sees it: Wren's team on each client's Vendors page and a cross-client usage list; the client on Billing (its own usage, cap and mode).

## Billing

- `usageLines(main, period)` sums each owner's managed usage per vendor for a month into `books.usage_lines` (draft): units, cost cents, markup percent, amount cents. Re-running a month rewrites its drafts.
- Markup is Wren's vendor setting `markupPct`, default 0. William sets it.
- A line never sends an invoice or charges a card. Putting lines on the Wise invoice is a person's step, as invoices are today.
- Wren's own lines (owner `wren`) are cost only: what Wren spends per vendor, next to bills.

## Approver per client

`approver` on the client: `wren` (default), `client` or `either`. To approve shows a client's items to Wren's team when it's `wren` or `either`, and to the client's owner when it's `client` or `either`. Approve checks the same rule on the server. Wren's own items are always Wren's team's.

Built (step e): `mayApprove(who, client, approver)` in `@wren/core/access`. The reactivation portal refuses approve, undo and skip to the other side, drops the To approve view and its actions from that login's record types, and its rail shows "Waiting on Wren's team". The CLI's `crm approve` and `crm skip` are the team's and refuse a `client` approver. `wren clients set <id> --approver <who>` sets it.

## Metered collectors and LinkedIn reads for clients

`signalPlan`'s `free` flag (metered stays Wren's) becomes a vendor gate. A client's metered collector runs when its vendor mode is set, the bucket has room and the cap isn't hit. Each unit meters one read.

| Collector | Vendor | Client's own key | Managed |
|---|---|---|---|
| `linkedin` | `linkedin` | the client's LinkedIn login (`clients.accounts.linkedin`) | off unless William allows it |
| `demand` | `reddit` and `models` | not offered for Reddit | Wren's reads and gateway |

Built (step f): a metered collector names its `vendors` (and which a subject `spends`). `signalPlan` takes a `gate` in place of `free`: it asks each vendor for one unit and plans no more subjects than the smallest room. `signalUnit` meters each answered read (found or none) after its write; a failed meter is logged, so a read is never bought twice. Wren's pass is gated and metered too, as client zero. On a client's pass, `own` LinkedIn reads as `clients.accounts.linkedin` (never one of Wren's logins), and `managed` as Wren's pool account; no login is "Needs setup". The CLI's `wren enrich signals` passes no gate.

## Texting window

Form leads' window defaults to 08:00 to 20:00 (`WREN_SMS_FORM_WINDOW`), so the setting and the 20:00 clamp agree. Recorded in `2026-10-07-speed-to-lead.md`.

## Pages

- **Client → Accounts** (team and client): one place per client. Each account with its site, role, mode, its facts (ok, waiting with why and next check, lost), and its setup's steps with how-to. Actions: mark a step done (team; client for `who: client` steps), check now, start a setup, switch self-serve or done for you (team).
- **Client → Vendors**: each vendor with mode, key set or not, today's room, month's usage and est. $, cap. Team sets mode, key, cap and share. A client sees the same, read only, under Billing.
- **Shop and part pages**: "Needs your account" names the missing fact and links to the setup.
- Anything not built says "In development".

## Build

Each step is committed with tests on synthetic data.

| Step | What |
|---|---|
| a | Registry, facts, setup runs; `setupWorkflow`, `setup.step`, checks registry, `SetupWatch`, `factLost`; `requires.facts`; phone, email, Google and Meta setups declared |
| b | `vendors.ts`, `vendor_modes`, `vendor_usage`, `KeyStore` (SSM, credvault's layout), `vendorRoom`, `meter`, `gate`, caps |
| c | `books.usage_lines`, `usageLines`, markup setting |
| d | Accounts and Vendors pages, Shop and part pages show missing facts (after rebasing on template install) |
| e | `approver` on the client, To approve and Approve use it |
| f | Metered collectors and LinkedIn reads for clients behind modes |
| g | Form window ends at 20:00 |

## Outside the tree

- autobrowse `do` takes an `owner`, so a done-for-you step runs in the client's autobrowse owner (its accounts, its credvault path, its Keychain item), never Wren's. Today `DoRequest` has no owner. Until then the worker has no setup `do` runner.
- autobrowse lists an owner's accounts with role and site through `sites`, so the registry can show where each login lives without reading it.
- credvault: wren writes own keys with credvault's owner path layout through the AWS SDK. Taking credvault as a dependency is a later swap; the path stays the same.
- The worker's IAM role needs `ssm:PutParameter` on `/wren/<env>/owners/*/keys/*` to save own keys. Not in this build (`tofu` is William's).

## Open (William's call)

- Markup on managed usage. Default 0.
- Which vendors a client may use managed. Default: all but LinkedIn reads.
- Each client's daily share and monthly cap. Default 0 for both, so nothing managed runs until set.
- Wren's reserve on each managed bucket. Default half.
- Creating a real account or buying a number or domain for a real client: per client yes. Until then "Waiting on Wren's team".
- 10DLC fees and domain prices folded into a client's managed billing: which ones and at what markup.
- Putting usage lines on the Wise invoice: manual today.
- The IAM grant for writing client keys to SSM.
- Each client's approver. Clients that existed before step e are `either`, so nothing changes for them; new clients start `wren`.
- Whether `client` means any of the client's people who can act (built) or only its owner role.

## Decision log

- 2026-10-07: Written from William's notes above.
- 2026-10-07: Reverses "Buckets stay one per source" (`2026-10-07-per-client-runs.md`): buckets are per (vendor, key), managed buckets split by per-client shares with a reserve for Wren.
- 2026-10-07: A setup is a workflow on the spine, not a second runner. A step re-checks through a self wire with a wait; round subjects keep the spine's one-arrival-per-node rule.
- 2026-10-07: Facts live on the account they describe, so a number, a domain and an inbox each carry their own.
- 2026-10-07: The registry, facts and modes are in main: Wren's team reads across clients, and the Shop's gating reads main. Each setup's events are in the owner's database, like any workflow.
- 2026-10-07: Keys never sit in Postgres. Own keys are SSM SecureStrings at credvault's owner path; rows keep the name.
- 2026-10-07: Money is micro-dollars in usage and cents on lines, never floats.
- 2026-10-07: Texting window: form leads default to 08:00 to 20:00, matching the legal clamp.
- 2026-10-07 (step a): Wren's rows have no client (null), as `hooks` does it, not an owner named `wren`. The registry's unique key treats nulls as equal.
- 2026-10-07 (step a): A setup's steps are `own` custom steps running `setup.step`, so they stay out of the Shop's catalog. One step reads its setup and step from the node's `with`.
- 2026-10-07 (step a): The agent tries a step once (its first round), never on later rounds, so a buy is never repeated by a check. Wren's own buys wait on the team too: spend is William's call.
- 2026-10-07 (step a): Telling the team when a run goes stuck is In development; the Accounts page shows it.
- 2026-10-07 (step b): `vendor_usage` has no foreign key to clients: it's a ledger, and a client's usage outlives the client. The GCRA moved to `@wren/core/buckets`; research re-exports it.
- 2026-10-07 (step b): A managed share above the clients' pool is held to the pool. A free vendor still needs a cap above $0 to run managed, so nothing runs until William sets one.
- 2026-10-07 (step e): "The client's owner" reads as the client's side: any of its people the guard lets act (owner and member roles). A login that may only read never approves. Existing clients were set to `either` by the migration, so their approve keeps working; the default for new ones is `wren`.
- 2026-10-07 (step f): A metered read meters after its write, not before: losing a usage row costs less than buying a read twice. Hiring's LinkedIn jobs read stays Wren's only; the client's login is for the metered `linkedin` collector alone.
