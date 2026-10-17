/**
 * Worst-case values (the `break-ui` list): every story set has a worst-case story built from
 * these. Synthetic: no real person, company or address.
 */
export const WORST = {
  longName: "Maximiliana Alexandrovna Featherstonehaugh-Montgomery-Vanderbilt the Third",
  shortName: "Q",
  longCompany: "International Consolidated Amalgamated Holdings and Subsidiary Enterprises, Ltd.",
  email: "averyveryveryveryveryverylongmailboxnamewithoutbreaks@subdomain.example-company.example",
  url: "https://example.com/a/really/long/path/that/never/stops/and/has/no/spaces/in/it/anywhere/at/all?with=query&and=more",
  longLabel: "A label that keeps going well past the width any column would ever give it",
  longText:
    "This note runs long on purpose. It wraps across several lines, then several more, so a clamp, a fold or a scroll has to catch it. ".repeat(
      4,
    ),
  nonLatin: "Ζωή Παπαδοπούλου · 山田 太郎 · Мария Иванова · محمد الأحمد · 김민준",
  rtl: "שלום עולם, זו שורה מימין לשמאל",
  emoji: "Launch 🚀🔥 team 👩🏽‍💻👨🏿‍🔬 · ✅",
  hugeCount: 1_234_567_890,
  negative: -48_211,
  zero: 0,
  missing: undefined,
  empty: "",
} as const;
