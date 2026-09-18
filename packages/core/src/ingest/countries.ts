/** Long-form names checked before the two-letter rule: "uk" is common but not the ISO code. Keys lowercased, dots stripped. */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "united kingdom": "GB",
  "great britain": "GB",
  uk: "GB",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  france: "FR",
  ireland: "IE",
  netherlands: "NL",
  switzerland: "CH",
  spain: "ES",
  italy: "IT",
  "new zealand": "NZ",
  japan: "JP",
  china: "CN",
  india: "IN",
  brazil: "BR",
  mexico: "MX",
  singapore: "SG",
  "hong kong": "HK",
  denmark: "DK",
  sweden: "SE",
  norway: "NO",
  belgium: "BE",
  luxembourg: "LU",
  israel: "IL",
  "united arab emirates": "AE",
  "cayman islands": "KY",
  bermuda: "BM",
  jersey: "JE",
  guernsey: "GG",
  "isle of man": "IM",
  // Comma-inverted forms resolve here after a swap-around-comma retry.
  "south korea": "KR",
  bahamas: "BS",
  "the bahamas": "BS",
  taiwan: "TW",
};

/** ISO 3166-1 alpha-2, officially assigned. A bare two-letter token is a country only against this set. */
export const ISO_ALPHA2: ReadonlySet<string> = new Set(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
   CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
   GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
   KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT
   MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
   SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG
   UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/),
);

/**
 * ISO 3166-1 alpha-2 code, or null when the value isn't recognizably a country.
 * Never guesses: the compliance gate keys on this column excluding NULL, so an
 * unparseable country fails closed. The raw value still rides in the row's provenance.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim().toLowerCase().replaceAll(".", ""); // "u.s.a." -> "usa"
  if (!text) return null;
  if (text.includes(",")) {
    // "Korea, South", "Bahamas, The": retry swapped-around-comma, then the bare prefix.
    const [left = "", right = ""] = text.split(",", 2).map((s) => s.trim());
    for (const candidate of [`${right} ${left}`, left]) {
      const code = COUNTRY_NAMES[candidate];
      if (code) return code;
    }
  }
  const named = COUNTRY_NAMES[text];
  if (named) return named;
  if (/^[a-z]{2}$/.test(text)) {
    const upper = text.toUpperCase();
    // ISO NA is Namibia, but in US-sourced data "NA" overwhelmingly means not-available.
    if (upper === "NA") return null;
    return ISO_ALPHA2.has(upper) ? upper : null;
  }
  return null;
}
