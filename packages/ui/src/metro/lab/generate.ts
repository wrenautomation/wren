/**
 * `funnel(n, seed, shape)`: a made-up business map of about `n` stations, the same for the same
 * seed. Outreach lines feed one hub; offer lines leave it and run left to right through the
 * columns, with decisions, person steps, failure exits and an upsell between lines. `shape` adds
 * loops (back tracks), a retainer lap and one job done side by side on each platform (template
 * stations). Synthetic names only.
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
const PLATFORMS: [string, string][] = [
  ["x", "X"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["threads", "Threads"],
];

export interface Shape {
  /** Back tracks on the offer lines: a step sends the person back two steps. */
  loops?: boolean;
  /** The core line ends in a monthly lap: work, report, invoice, round again. */
  retainer?: boolean;
  /** One post on this many platforms, side by side, into the hub. The last one does badly. */
  platforms?: number;
}

export function funnel(n: number, seed = 1, shape: Shape = {}): MetroView {
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
  // The same post on each platform: one template, a station per platform, side by side.
  const nPost = Math.min(PLATFORMS.length, shape.platforms ?? 0);
  if (nPost > 1) {
    lines.push({ id: "op", tier: "out" });
    stations.push({ id: "opw", kind: "att", line: "op", column: "Marketing", label: "Write post" });
    for (const [i, [key, name]] of PLATFORMS.slice(0, nPost).entries()) {
      const arrived = 30 + Math.floor(r() * 20);
      // The last platform keeps far more people stuck than the rest: the outlier.
      const now = i === nPost - 1 ? Math.round(arrived * 0.7) : Math.floor(r() * 5);
      stations.push({
        id: `op${key}`,
        kind: "att",
        line: "op",
        column: "Marketing",
        label: `Post · ${name}`,
        sub: `${now} now`,
        template: "post",
        platform: key,
        now,
        arrived,
      });
      tracks.push({ from: "opw", to: `op${key}`, by: "system" });
      tracks.push({ from: `op${key}`, to: "hub", by: "system" });
    }
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
    // A loop: a later step sends the person back two steps ("redo"), drawn as a back track.
    const steps = stations.filter((s) => s.line === id && s.kind !== "exit" && s.kind !== "cash");
    if (shape.loops && steps.length >= 4 && r() < 0.7) {
      const at = 2 + Math.floor(r() * (steps.length - 2));
      const [from, to] = [steps[at]?.id, steps[at - 2]?.id];
      if (from && to)
        tracks.push({
          from,
          to,
          by: "person",
          owner: "WJ",
          promise: "2d",
          label: "redo",
          back: true,
        });
    }
    // A retainer: after the first payment, a lap in Money that goes round each month.
    if (shape.retainer && l === 0) {
      const lap: [string, ViewKind, string][] = [
        ["work", "att", "Month's work"],
        ["report", "att", "Report"],
        ["invoice", "cash", "Invoice"],
      ];
      for (const [i, [key, kind, label]] of lap.entries()) {
        const sid = `${id}r${key}`;
        stations.push({
          id: sid,
          kind,
          line: id,
          column: "Money",
          group: `${id}-retainer`,
          label,
          sub: `${Math.floor(r() * 12) + 1}`,
          ...(i === 0 ? { repeat: "every 30 days" } : {}),
        });
        tracks.push({ from: prev, to: sid, by: "system" });
        prev = sid;
      }
      tracks.push({
        from: prev,
        to: `${id}rwork`,
        by: "system",
        label: "next month",
        back: true,
      });
      stations.push({
        id: `${id}rx`,
        kind: "exit",
        line: id,
        column: "Money",
        label: "Cancelled",
        sub: `${Math.floor(r() * 4) + 1}`,
        bad: true,
      });
      tracks.push({ from: `${id}rreport`, to: `${id}rx`, by: "system" });
    }
    ends.push(prev);
  }
  // An upsell: the first line's money feeds the second line's last step.
  if (nLines > 1) {
    const to = stations.filter((s) => s.line === "l1" && s.kind !== "exit").at(-1)?.id;
    if (to && ends[0])
      tracks.push({ from: ends[0], to, by: "person", owner: "WJ", promise: "7d", label: "upsell" });
  }
  const extra = [
    shape.loops && "loops",
    shape.retainer && "a retainer",
    nPost > 1 && `${nPost} platforms`,
  ].filter(Boolean);
  return {
    title: `Generated funnel, ${n} stations${extra.length ? `, ${extra.join(", ")}` : ""}`,
    lines,
    stations,
    tracks,
    columns,
    ...(shape.retainer ? { groups: [{ id: "l0-retainer", label: "Retainer" }] } : {}),
  };
}
