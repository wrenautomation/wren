/**
 * `funnel(n, seed)`: a made-up business map of about `n` stations, the same for the same seed.
 * Outreach lines feed one hub; offer lines leave it and run left to right through the columns,
 * with decisions, person steps, failure exits and an upsell between lines. Synthetic names only.
 */
import {
  DEFAULT_COLUMNS,
  type MetroView,
  type ViewKind,
  type ViewStation,
  type ViewTrack,
} from "../view.js";

/** mulberry32: a small seeded random, so a case never changes. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = [
  "Replied",
  "Booked",
  "Held",
  "Proposal",
  "Signed",
  "Onboard",
  "Kickoff",
  "Review",
  "Renew",
];
const OUTREACH = ["Cold email", "LinkedIn", "Ads", "Referral", "Webinar", "Reddit"];

export function funnel(n: number, seed = 1): MetroView {
  const r = rand(seed);
  const columns = DEFAULT_COLUMNS;
  const nOut = Math.min(OUTREACH.length, 1 + Math.floor(n / 12));
  const nLines = Math.max(1, Math.min(6, Math.round(n / 10)));
  const stations: ViewStation[] = [];
  const tracks: ViewTrack[] = [];
  const lines: MetroView["lines"] = [];

  stations.push({
    id: "hub",
    kind: "hub",
    line: "o0",
    column: "Marketing",
    label: "First touch",
    sub: "120 / wk",
  });
  for (let i = 0; i < nOut; i++) {
    lines.push({ id: `o${i}`, tier: "out" });
    stations.push({
      id: `o${i}a`,
      kind: "att",
      line: `o${i}`,
      column: "Marketing",
      label: OUTREACH[i] as string,
      sub: `${20 + i * 7}`,
    });
    tracks.push({ from: `o${i}a`, to: "hub", by: "system" });
  }

  // Share the rest across the offer lines; each line walks the columns from Sales on.
  let left = Math.max(nLines * 2, n - stations.length);
  const ends: string[] = [];
  for (let l = 0; l < nLines; l++) {
    const id = `l${l}`;
    lines.push({
      id,
      offer: `Offer ${l + 1}`,
      label: `Offer ${l + 1}`,
      tier: l === 0 ? "core" : "front",
      colour: l % 4,
    });
    const count = l === nLines - 1 ? left : Math.max(2, Math.round(left / (nLines - l)));
    left -= count;
    let prev = "hub";
    for (let k = 0; k < count; k++) {
      const last = k === count - 1;
      const col = columns[
        Math.min(columns.length - 1, 1 + Math.floor((k / count) * (columns.length - 1)))
      ] as string;
      const roll = r();
      const kind: ViewKind = last
        ? "cash"
        : roll < 0.15
          ? "dec"
          : roll < 0.22
            ? "race"
            : roll < 0.6
              ? "att"
              : "time";
      const sid = `${id}s${k}`;
      stations.push({
        id: sid,
        kind,
        line: id,
        column: last ? "Money" : col,
        // Steps keep their order along a line; the last is the payment.
        label: last ? "Paid" : (STEPS[Math.floor((k / count) * STEPS.length)] as string),
        sub: `${Math.floor(r() * 40) + 1}`,
      });
      const person = r() < 0.3;
      tracks.push({
        from: prev,
        to: sid,
        by: person ? "person" : "system",
        ...(person ? { owner: "WJ", promise: `${1 + Math.floor(r() * 48)}h` } : {}),
        ...(prev !== "hub" && stations.find((s) => s.id === prev)?.kind === "dec"
          ? { label: "yes" }
          : {}),
      });
      // A decision or a race also loses some people: a red exit.
      if (kind === "dec" || kind === "race" || (r() < 0.12 && !last)) {
        const ex = `${sid}x`;
        stations.push({
          id: ex,
          kind: "exit",
          line: id,
          column: last ? "Money" : col,
          label: "Lost",
          sub: `${Math.floor(r() * 9) + 1}`,
          bad: true,
        });
        tracks.push({
          from: sid,
          to: ex,
          by: "system",
          ...(kind === "dec" ? { label: "no" } : {}),
        });
      }
      prev = sid;
    }
    ends.push(prev);
  }
  // An upsell: the first line's money feeds the second line's last step.
  if (nLines > 1) {
    const to = stations.filter((s) => s.line === "l1" && s.kind !== "exit").at(-1)?.id;
    if (to && ends[0])
      tracks.push({ from: ends[0], to, by: "person", owner: "WJ", promise: "7d", label: "upsell" });
  }
  return { title: `Generated funnel, ${n} stations`, lines, stations, tracks, columns };
}
