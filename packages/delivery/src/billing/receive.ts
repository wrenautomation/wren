/**
 * Where a client wires us, per currency: Wise's receive details, read from the environment
 * (`WISE_RECEIVE_DETAILS`) at runtime and never kept in the repo. The PDF, the mail and the
 * portal's Billing page all print them through `payFields`.
 */

/** One currency's details as stored: `{ name, account, routing, swift, ... }`. */
type ReceiveFields = Readonly<Record<string, string>>;
/** Currency → its details. */
export type ReceiveDetails = Readonly<Record<string, ReceiveFields>>;

/** Each stored key as the payer's bank form names it, in the order a form asks. */
const LABELS: readonly [string, string][] = [
  ["name", "Account holder"],
  ["bank", "Bank"],
  ["address", "Bank address"],
  ["routing", "Routing number (ACH and wire)"],
  ["institution", "Institution number"],
  ["transit", "Transit number"],
  ["sortCode", "Sort code"],
  ["account", "Account number"],
  ["iban", "IBAN"],
  ["swift", "Swift/BIC"],
];

/** The env's JSON as details; anything malformed is none, so a bad value prints no wrong number. */
export function parseReceive(raw: string | undefined): ReceiveDetails {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, ReceiveFields> = {};
  for (const [cur, fields] of Object.entries(v)) {
    if (!/^[A-Z]{3}$/.test(cur) || !fields || typeof fields !== "object") continue;
    const kept = Object.entries(fields).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "",
    );
    if (kept.length) out[cur] = Object.fromEntries(kept);
  }
  return out;
}

/**
 * The lines to pay `currency` by bank transfer, label then value; none when we hold no account in
 * it (the payer asks us). The memo reference is the caller's: it's per invoice.
 */
export function payFields(details: ReceiveDetails, currency: string): [string, string][] {
  const f = details[currency.toUpperCase()];
  if (!f) return [];
  const known = new Set(LABELS.map(([k]) => k));
  return [
    ...LABELS.filter(([k]) => f[k]).map(([k, label]): [string, string] => [label, f[k] as string]),
    ...Object.entries(f).filter(([k]) => !known.has(k)),
  ];
}
