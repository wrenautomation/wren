# @wren/offers: interface

Exports: 31. Files: 4.

## packages/offers/src/index.ts

- **registry** (function) `(offers: readonly Offer[]): readonly Offer[]`
- **leadOffers** (function) `(): { name: string; audience: string }[]`
- **offerFor** (function) `(id: string): Offer`
- **OFFERS** (const) `readonly Offer[]`
- **OFFER_IDS** (const) `ReadonlySet<string>`
- **OFFER_PAGES** (const) `ReadonlySet<string>`

## packages/offers/src/offer.ts

- **AccessNeed** (interface) `interface AccessNeed { readonly system: string; readonly scope: string; readonly why: string; readonly revoke: string; }`
- **Answers** (type) `type Answers = Readonly<Record<string, string | readonly string[]>>;`
- **Application** (interface) `interface Application { readonly questions: readonly Question[]; readonly fit: readonly FitRule[]; }`
- **Choice** (interface) `interface Choice { readonly id: string; readonly label: string; }`
- **FitRule** (interface) `interface FitRule { readonly question: string; readonly anyOf: readonly string[]; }`
- **Icp** (interface) `interface Icp { readonly who: string; readonly industries?: readonly string[]; readonly sizes?: readonly string[]; readonly roles?: readonly string[]; readonly regions?: readonly string[]; readonly must?: readonly string[]; readonly not?: readonly string[]; }`
- **Measure** (interface) `interface Measure { readonly key: string; readonly label: string; readonly unit: MeasureUnit; }`
- **MeasureUnit** (type) `type MeasureUnit = (typeof MEASURE_UNITS)[number];`
- **Offer** (interface) `interface Offer { readonly id: string; readonly name: string; readonly status: OfferStatus; readonly audience: string; readonly promise: string; readonly price: Price; readonly slots: number | null; readonly days: number | null; readonly youGet: readonly string[]; readonly youGive: readonly string[]; readonly weGet: readonly string[]; readonly guarantee: string | null; readonly measures: readonly Measure[]; readonly next: readonly string[]; readonly page: string | null; readonly booking: string | null; readonly video?: string; readonly application: Application | null; readonly plan?: readonly Phase[]; readonly access?: readonly AccessNeed[]; readonly reviewAfterFirst?: readonly { readonly measure: string; readonly moment: string }[]; readonly upsell?: { readonly pitch: string }; readonly app?: string; readonly addOn?: string; readonly perUnitMeasure?: string; readonly target?: { readonly measure: string; readonly count: number; readonly fromDay: number }; readonly icp?: Icp; }`
- **OfferStatus** (type) `type OfferStatus = (typeof OFFER_STATUSES)[number];`
- **Phase** (interface) `interface Phase { readonly id: string; readonly name: string; readonly from: number; readonly to: number | null; readonly deliverables: readonly string[]; readonly asks: readonly string[]; }`
- **Price** (type) `type Price = | { readonly kind: "free" } | { readonly kind: "quoted" } | { readonly kind: "fixed"; readonly upfront: UsdRange | null; readonly monthly: UsdRange | null; } | { readonly kind: "performance"; readonly upfront: number; readonly perUnit: number; readonly unit: string; readonly cap: number | null; readonly monthly: number | null; readonly flat: number | null; readonly until: number | null; readonly refundIfNone: { readonly minContacts: number } | null; };`
- **Question** (type) `type Question = | { readonly id: string; readonly ask: string; readonly kind: "one" | "many"; readonly choices: readonly Choice[]; readonly required: boolean; } | { readonly id: string; readonly ask: string; readonly kind: "text"; readonly placeholder: string; readonly required: boolean; };`
- **UsdRange** (interface) `interface UsdRange { readonly min: number; readonly max: number; }`
- **defineOffer** (function) `(offer: Offer): Offer`
- **fits** (function) `(offer: Offer, answers: Answers): boolean`
- **invalidAnswers** (function) `(offer: Offer, answers: Answers): string | null`
- **MEASURE_UNITS** (const) `readonly ["count", "usd", "hours"]`
- **OFFER_ID_MAX** (const) `64`
- **OFFER_STATUSES** (const) `readonly ["draft", "live", "paused", "retired"]`
- **offerFacts** (function) `(offer: Offer): Readonly<Record<string, string>>`

## packages/offers/src/snapshot.ts

- **SNAPSHOT_VERSION** (const) `1`
- **Snapshot** (interface) `interface Snapshot { readonly version: number; readonly note: string; readonly offers: readonly Offer[]; }`
- **snapshot** (function) `(offers: readonly Offer[]): Snapshot`

## packages/offers/src/terms.ts

- **Terms** (interface) `interface Terms { currency: string; setupCents: number; monthlyCents: number | null; perUnitCents: number | null; unit: string | null; capCents: number | null; days: number | null; until?: number | null; refundIfNone?: { minContacts: number } | null; payDays: number; shareBps?: number | null; floorCents?: number | null; installments?: { count: number; everyDays: number } | null; trialDays?: number | null; }`
