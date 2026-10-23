/**
 * Sample data for stories and tests, beside the scenes in data.ts: the glyph tables of sections 04
 * and 09, and the two maps that fold by hand-built groups (section 08 retainer loop, section 09
 * sales protocol). Synthetic: no real prices or people.
 */
import { INDUSTRIES, LOOP_SCENE, OFFERS_SCENE, SCENARIOS, ZOOM_SCENE } from "./data.js";
import { autoZoom, type Flags, flagZoom, type MetroZoom } from "./fold.js";
import {
  type ChipSpec,
  type FoldSpec,
  isMark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type Point,
  type SceneStation,
  type Weight,
  type Zone,
} from "./types.js";
import type { MetroView } from "./view.js";

export { INDUSTRIES, LOOP_SCENE, OFFERS_SCENE, SCENARIOS, ZOOM_SCENE };

// ---------------------------------------------------------------------------------------------
// Glyph tables (sections 04 and 09): one 88 x 44 cell per mark.

export interface GlyphRow {
  name: string;
  what: string;
  how: string;
  example?: string;
  scene: MetroScene;
}

const cell = (o: Partial<MetroScene>): MetroScene => ({ w: 88, h: 44, st: [], tr: [], ...o });
const mid = (type: MarkStation["t"], o: Partial<MarkStation> = {}): MarkStation => ({
  id: type,
  t: type,
  x: 44,
  y: 22,
  ...o,
});
const run = (l: string, w: Weight, o: Partial<MetroTrack> = {}): MetroTrack => ({
  l,
  w,
  pa: [6, 22],
  pc: [82, 22],
  ...o,
});

export const LINE_GLYPHS: GlyphRow[] = [
  {
    name: "Outreach",
    what: "A channel that makes first touches. No offer, no price.",
    how: "Grey, thin. Every outreach line ends at the hub.",
    example: "Reddit, YouTube, cold email",
    scene: cell({ tr: [run("out", "out")] }),
  },
  {
    name: "Front end",
    what: "An offer whose job is to win trust or fund ads, then feed the core.",
    how: "Medium weight, own colour. Free or paid.",
    example: "Paid webinar $97, free audit",
    scene: cell({ tr: [run("web", "front")] }),
  },
  {
    name: "Core",
    what: "The offer that makes the profit. Most front ends transfer into it.",
    how: "Thick, own colour. One or two per business.",
    example: "Growth Partner $12k / mo",
    scene: cell({ tr: [run("gp", "core")] }),
  },
  {
    name: "Planned",
    what: "An offer that is not live yet.",
    how: "Dotted, in its future colour. Shows the launch date when there is one.",
    example: "Backend 10x",
    scene: cell({ tr: [run("gp", "front", { k: "plan" })] }),
  },
];

export const STATION_GLYPHS: GlyphRow[] = [
  {
    name: "Hub",
    what: "Where all outreach lands: the first time we know the person.",
    how: "Lavender marker, inbox icon. One per map. Outreach ends here; offer lines start here.",
    example: "First touch",
    scene: cell({ st: [mid("hub")] }),
  },
  {
    name: "Attention",
    what: "The person gave a look, a click or a reply. Low commitment.",
    how: "Light disc, eye icon.",
    example: "Visited the lander, replied to a DM",
    scene: cell({ st: [mid("att")] }),
  },
  {
    name: "Time",
    what: "The person gave time on a calendar. No cash yet.",
    how: "Dark disc, clock icon.",
    example: "Call booked, call held, attended",
    scene: cell({ st: [mid("time")] }),
  },
  {
    name: "Money",
    what: "Cash comes in.",
    how: "Dark square, $ icon. Recurring cash adds a repeat chip.",
    example: "Ticket $97, retainer",
    scene: cell({ st: [mid("cash")] }),
  },
  {
    name: "Exit",
    what: "The person leaves this line.",
    how: "Light pill when the person is done. Always red for a failure: no, churn, failed payment.",
    example: "No-show, lost, churned",
    scene: cell({
      st: [
        { id: "done", t: "exit", x: 22, y: 22 },
        { id: "bad", t: "exit", x: 64, y: 22, bad: true },
      ],
    }),
  },
  {
    name: "Planned",
    what: "A step we intend to add.",
    how: "Dashed disc, plus icon.",
    example: "Referral ask after month 3",
    scene: cell({ st: [mid("plan")] }),
  },
  {
    name: "Capsule",
    what: "A run of stations, folded by zoom.",
    how: "First to last station, line colour, people inside now. Amber ring when a person track inside is late.",
    example: "Sales, 11 people",
    scene: cell({
      tr: [run("gp", "core", { pa: [0, 22], pc: [88, 22] })],
      st: [{ id: "g", cap: [24, 64], y: 22, l: "gp", now: 11, n: "" }],
    }),
  },
];

export const TRACK_GLYPHS: GlyphRow[] = [
  {
    name: "System",
    what: "Software moves the person. No one has to act.",
    how: "Plain track, no badge.",
    example: "Booking link, checkout, email sequence",
    scene: cell({ tr: [run("ob", "front")] }),
  },
  {
    name: "Person",
    what: "Someone must act: a task with an owner and a promised time.",
    how: "Pill with the owner and the promise. Shows on Today.",
    example: "William replies to a form fill in 5 min",
    scene: cell({ tr: [run("ob", "front", { who: "WJ · 5m", at: [44, 22] })] }),
  },
  {
    name: "Person, late",
    what: "The median wait is longer than the promise.",
    how: "Same pill, amber. A state, not a type.",
    example: "Promise 5 min, median 3 h",
    scene: cell({ tr: [run("ob", "front", { who: "WJ · 3h", late: true, at: [44, 22] })] }),
  },
  {
    name: "Transfer",
    what: "The person moves to another offer's line.",
    how: "45 degree connector into the line they join, in its colour, with a label: upsell, downsell, cross-sell.",
    example: "Webinar buyer books a Growth Partner call",
    scene: cell({
      st: [mid("time", { id: "from", x: 12, y: 8 })],
      tr: [
        { k: "xfer", l: "gp", pa: [12, 8], pc: [60, 36] },
        run("gp", "core", { pa: [46, 36], pc: [84, 36] }),
      ],
    }),
  },
  {
    name: "Exit spur",
    what: "The path out of the line.",
    how: "Dotted. Red when it ends at a failure, grey when the person is done.",
    example: "Call held to lost",
    scene: cell({
      st: [{ id: "lost", t: "exit", x: 66, y: 22, bad: true }],
      tr: [{ k: "exit", pa: [6, 22], b: "lost" }],
    }),
  },
  {
    name: "Repeat",
    what: "The same payment comes back on a period.",
    how: "Chip under a money station. Not a track.",
    example: "Retainer renews monthly",
    scene: cell({ chips: [{ x: 44, y: 22, t: "monthly" }] }),
  },
  {
    name: "Planned track",
    what: "A move we intend to add.",
    how: "Dotted.",
    example: "Auto follow-up after a no-show",
    scene: cell({ tr: [run("ob", "front", { k: "plan" })] }),
  },
];

const chip1 = (t: string, icon: ChipSpec["icon"]): MetroScene =>
  cell({ chips: [{ x: 44, y: 22, t, ...(icon === undefined ? {} : { icon }) }] });

export const LOGIC_GLYPHS: GlyphRow[] = [
  {
    name: "Condition",
    what: "Tests what we know. Hollow diamond.",
    how: "Branch chips of 4 words or fewer. Max 3 branches. One is always else.",
    scene: cell({ st: [mid("dec")] }),
  },
  {
    name: "Event race",
    what: "Waits. The first event picks the branch. Filled diamond.",
    how: "Always one clock branch, so no one waits for ever.",
    scene: cell({ st: [mid("race")] }),
  },
  {
    name: "Split, join",
    what: "Every lane runs at once; lanes meet again.",
    how: "A short gate where lanes fork or meet. Its tag says all, any or N of M.",
    scene: cell({
      st: [{ id: "gate", t: "par", x: 14, y: 30, rule: "all" }],
      tr: [
        {
          l: "out",
          w: "front",
          r: 12,
          pts: [
            [4, 30],
            [24, 30],
            [40, 14],
            [84, 14],
          ],
        },
        {
          l: "out",
          w: "front",
          r: 12,
          pts: [
            [24, 30],
            [40, 46],
            [84, 46],
          ],
        },
      ],
    }),
  },
  {
    name: "A/B split",
    what: "Random, for a test. Not an if.",
    how: "Dashed ring, thin arms, a percent on each arm.",
    scene: cell({
      st: [mid("ab", { x: 22 })],
      tr: [
        {
          l: "out",
          w: "front",
          pts: [
            [4, 22],
            [22, 22],
          ],
        },
        {
          l: "out",
          w: "front",
          pts: [
            [66, 22],
            [84, 22],
          ],
        },
        {
          k: "ab",
          l: "out",
          w: "out",
          r: 12,
          pts: [
            [22, 22],
            [34, 22],
            [46, 8],
            [58, 22],
            [66, 22],
          ],
        },
        {
          k: "ab",
          l: "out",
          w: "out",
          r: 12,
          pts: [
            [22, 22],
            [34, 22],
            [46, 36],
            [58, 22],
            [66, 22],
          ],
        },
      ],
    }),
  },
  {
    name: "Branch label",
    what: "The condition or event on a branch.",
    how: "Else is dashed and grey.",
    scene: cell({
      tr: [run("out", "front", { cond: "7 days", condGlyph: "clock", cat: [44, 22] })],
    }),
  },
  {
    name: "Approval",
    what: "A person says yes before it goes out.",
    how: "Shows how many wait.",
    scene: cell({ st: [mid("ok")] }),
  },
  {
    name: "Person step",
    what: "Someone must act before the person moves on.",
    how: "The person pill from section 04. No pill: software acts.",
    scene: cell({ tr: [run("out", "front", { who: "WJ · 4h", at: [44, 22] })] }),
  },
  {
    name: "Retry",
    what: "A failed step tries again.",
    how: "Capped. Past the cap, a red exit.",
    scene: chip1("retry · 1 of 2", "undo"),
  },
  {
    name: "Hold",
    what: "Parked, no exit. Conflict, unit hold or by hand.",
    how: "Ends by time or by hand.",
    scene: chip1("held · 2", "pause"),
  },
  {
    name: "Shared flow",
    what: "Opens another map used in many places.",
    how: "A fold is inline. A shared flow is linked.",
    scene: cell({ st: [mid("link")] }),
  },
  {
    name: "Interrupt",
    what: "From anywhere inside, an event takes the person out.",
    how: "A dashed red frame with one red exit.",
    scene: cell({ frames: [{ x: 6, y: 6, w: 76, h: 32 }] }),
  },
  {
    name: "Version",
    what: "People inside keep their version.",
    how: "Chip on the start. History in the sheet.",
    scene: chip1("v3 · 12 on v2", "history"),
  },
];

// ---------------------------------------------------------------------------------------------
// Section 05: the zoom scenario.

/** Parts, Groups, Stations: a scene that names its lines and groups folds by rule. */
export const zoomScenario = (): MetroZoom => autoZoom(ZOOM_SCENE);

// ---------------------------------------------------------------------------------------------
// Section 08: the retainer loop, folded by groups.

const byId = <T extends SceneStation>(list: T[]) => new Map(list.map((s) => [s.id, s]));
const LOOP_ST = byId(LOOP_SCENE.st);
const LOOP_TR = new Map(LOOP_SCENE.tr.map((r) => [r.id ?? "", r]));

const mark = (id: string): MarkStation => {
  const s = LOOP_ST.get(id);
  if (!s || !isMark(s)) throw new Error(`loop: no station ${id}`);
  return s;
};
const track = (id: string): MetroTrack => {
  const r = LOOP_TR.get(id);
  if (!r) throw new Error(`loop: no track ${id}`);
  return r;
};
/** A track with its start station dropped, so it starts at a point. */
const fromPoint = (r: MetroTrack, pa: Point): MetroTrack => {
  const { a: _a, ...rest } = r;
  return { ...rest, pa };
};
const shift = (p: Point, dx: number): Point => [p[0] + dx, p[1]];

/** The loop at the folds `g`: offer, on (onboarding), loop (monthly lap), rw (rewarm). */
export function composeLoop(g: Flags): MetroScene {
  const st: SceneStation[] = [{ ...mark("hub") }];
  const tr: MetroTrack[] = [];
  const folds: FoldSpec[] = [];
  let ch: Point;
  let zones: Zone[] = LOOP_SCENE.zones ?? [];
  // A folded group takes only the room its mark needs; the marks after it shift left.
  const DX = g.on ? 0 : -190;
  const move = (s: MarkStation): MarkStation => ({ ...s, x: s.x + DX });

  if (!g.offer) {
    st.push(
      {
        badge: true,
        id: "offer",
        grp: "offer",
        x: 420,
        y: 120,
        l: "gp",
        n: "Growth Retainer",
        s: "$4k / mo · 7 clients · 30-day loop",
        w: 330,
      },
      { ...mark("fp"), x: 660, y: 120, p: "down" },
      { ...mark("ch"), x: 420, y: 230 },
    );
    tr.push(
      { id: "t-in", l: "gp", w: "core", pa: [60, 120], pc: [420, 120] },
      { id: "e-fp", k: "exit", pa: [585, 120], b: "fp" },
      { id: "e-ch", k: "exit", pa: [420, 148], b: "ch" },
    );
    ch = [420, 230];
    zones = [
      [0, 120, "Marketing"],
      [120, 255, "Sales"],
      [255, 585, "Delivery"],
      [585, 1150, "Money"],
    ];
  } else {
    st.push(mark("pp"), mark("sg"));
    tr.push(track("t-pp"), track("t-sg"));
    folds.push({ x: 200, y: 46, t: "Growth Retainer", grp: "offer" });
    if (g.on) {
      st.push(mark("ko"), mark("ac"), mark("bw"));
      tr.push(track("t-ko"), track("t-ac"), track("t-bw"));
      folds.push({ x: 450, y: 46, t: "Onboarding", grp: "on" });
    } else {
      st.push({
        cap: [335, 365],
        id: "on",
        grp: "on",
        y: 120,
        l: "gp",
        n: "Onboarding · 10 days",
        now: 2,
      });
      tr.push({ id: "t-ko", l: "gp", w: "core", pa: [250, 120], pc: [350, 120] });
    }
    const bw = mark("bw");
    const inA: Point = g.on ? [bw.x, bw.y] : [350, 120];
    if (g.loop) {
      st.push(...["pl", "mk", "sh", "bl", "rp", "rv", "fp", "ch"].map((k) => move(mark(k))));
      const lap = track("loop");
      const efp = track("e-fp");
      tr.push(
        fromPoint(track("t-in"), inA),
        {
          ...lap,
          ...(lap.pts ? { pts: lap.pts.map((p) => shift(p, DX)) } : {}),
          ...(lap.at ? { at: shift(lap.at, DX) } : {}),
        },
        { ...efp, ...(efp.pts ? { pts: efp.pts.map((p) => shift(p, DX)) } : {}) },
        track("e-ch"),
      );
      folds.push({ x: 830 + DX, y: 200, t: "every 30 days · 7 in loop", grp: "loop" });
      ch = [740 + DX, 350];
      zones = [
        [0, 120, "Marketing"],
        [120, 300, "Sales"],
        [300, 980 + DX, "Delivery"],
        [980 + DX, 1150, "Money"],
      ];
    } else {
      const x = g.on ? 680 : 490;
      st.push(
        {
          ring: true,
          id: "loop",
          grp: "loop",
          x,
          y: 120,
          l: "gp",
          n: "Monthly lap",
          s: "$4k / mo · 7 in",
        },
        { ...mark("fp"), x: x + 120, y: 120, p: "down" },
        { ...mark("ch"), x, y: 230 },
      );
      tr.push(
        { id: "t-in", l: "gp", w: "core", pa: inA, pc: [x, 120] },
        { id: "e-fp", k: "exit", pa: [x + 26, 120], b: "fp" },
        { id: "e-ch", k: "exit", pa: [x, 146], b: "ch" },
      );
      ch = [x, 230];
      zones = [
        [0, 120, "Marketing"],
        [120, 300, "Sales"],
        [300, x + 60, "Delivery"],
        [x + 60, 1150, "Money"],
      ];
    }
  }
  // Rewarm runs from the churn exit back to the hub; open, its three steps spread along it.
  const Y = ch[1] + 64;
  const rwp: Point[] = [ch, [ch[0], Y], [60, Y]];
  const L = ch[0] - 60;
  const hub = st[0];
  if (hub && isMark(hub)) hub.span = [120, Y];
  if (g.offer && g.rw) {
    ["rs", "wb", "ci"].forEach((k, i) => {
      st.push({ ...mark(k), x: Math.round(ch[0] - (L * (i + 1)) / 4), y: Y });
    });
    folds.push({
      x: Math.round(ch[0] - L / 2),
      y: Y - 40,
      t: "rewarm · 4 of 11 came back",
      grp: "rw",
    });
  } else {
    const m = Math.round(60 + L * 0.55);
    st.push({
      cap: [m - 15, m + 15],
      id: "rwc",
      grp: "rw",
      y: Y,
      l: "out",
      n: "Rewarm · 3 touches",
      now: 7,
    });
  }
  tr.push({ ...track("rw"), pts: rwp });
  return {
    ...LOOP_SCENE,
    h: Y + (g.offer && g.rw ? 72 : 44),
    zones,
    chips: [],
    folds,
    st,
    tr,
  };
}

/** Offer, Groups, Stations. Opening the offer jumps to Groups. */
export const loopZoom = (): MetroZoom =>
  flagZoom({
    names: ["Offer", "Groups", "Stations"],
    presets: [
      { offer: false },
      { offer: true, on: false, loop: false, rw: false },
      { offer: true, on: true, loop: true, rw: true },
    ],
    compose: composeLoop,
    total: LOOP_SCENE.st.length,
    opens: { offer: { level: 1 } },
    foldId: { rw: "rwc" },
    // A folded offer hides everything inside it.
    same: (p, g) =>
      Object.keys({ ...p, ...g }).every((k) => !!p[k] === !!g[k] || (!g.offer && k !== "offer")),
  });

// ---------------------------------------------------------------------------------------------
// Section 09: one sales protocol that holds every logic mark.

const LGM = 230;
const LGE = 140;
const LGL = 320;
const LGP = { send: 450, wait: 200, sort: 260 };
const LGF = { send: 170, wait: 170, sort: 150 };

/** A fork runs 20 px straight out of its gate, then 45 degrees to the lane, so the rule tag stays clear. */
export const lane = (F: number, M: number, y: number, J: number, run = 20): Point[] => {
  const d = Math.abs(y - M);
  return [
    [F, M],
    [F + run, M],
    [F + run + d, y],
    [J - run - d, y],
    [J - run, M],
    [J, M],
  ];
};

/** The protocol at the folds `g`: send, ab (inside send), wait, sort. */
export function composeProtocol(g: Flags): MetroScene {
  const M = LGM;
  const E = LGE;
  const L = LGL;
  const st: SceneStation[] = [];
  const tr: MetroTrack[] = [];
  const folds: FoldSpec[] = [];
  const chips: ChipSpec[] = [];
  let x = 240;
  st.push(
    {
      id: "hub",
      t: "hub",
      x: 70,
      y: M,
      span: [M, M],
      n: "New lead",
      s: "40 / wk",
      rep: "v3 · 12 on v2",
      repGlyph: "history",
    },
    { id: "ok", t: "ok", x: 160, y: M, n: "Approve", s: "4 waiting" },
  );
  tr.push({ id: "t-ok", a: "hub", b: "ok", l: "out", w: "front" });
  let prev: Point = [160, M];
  const seg = (id: string, to: Point) => {
    tr.push({ id, l: "out", w: "front", pa: prev, pc: to });
    prev = to;
  };
  const exit = (
    id: string,
    n: string,
    s: string,
    from: Point,
    at: Point,
    bad: boolean,
    p: "right" | "left" = "right",
    cond?: string,
  ) => {
    st.push({ id, t: "exit", x: at[0], y: at[1], n, s, p, bad });
    tr.push({ id: `e-${id}`, k: "exit", pa: from, b: id, ...(cond ? { cond } : {}) });
  };
  const bx0 = x - 28;

  // Send: one gate splits into two lanes; the join lets the first lane that lands go on.
  if (g.send) {
    const o = x;
    const F = o + 10;
    const J = o + 440;
    seg("t-sp", [F, M]);
    st.push(
      { id: "sp", t: "par", x: F, y: M, rule: "all" },
      { id: "jn", t: "par", x: J, y: M, rule: "any" },
    );
    const up = lane(F, M, E, J);
    const lo = lane(F, M, L, J);
    if (g.ab) {
      st.push({
        id: "ab",
        t: "ab",
        x: o + 135,
        y: E,
        n: "Subject test",
        s: "random 50 / 50",
        p: "down",
      });
      tr.push(
        { id: "t-ab", l: "out", w: "front", r: 20, pts: [...up.slice(0, 3), [o + 135, E]] },
        {
          id: "ab-a",
          k: "ab",
          l: "out",
          w: "out",
          r: 14,
          pts: [
            [o + 135, E],
            [o + 160, E],
            [o + 190, E - 34],
            [o + 250, E - 34],
            [o + 280, E],
            [o + 305, E],
          ],
          cond: "A · 50%",
          cat: [o + 220, E - 34],
        },
        {
          id: "ab-b",
          k: "ab",
          l: "out",
          w: "out",
          r: 14,
          pts: [
            [o + 135, E],
            [o + 160, E],
            [o + 190, E + 34],
            [o + 250, E + 34],
            [o + 280, E],
            [o + 305, E],
          ],
          cond: "B · 50%",
          cat: [o + 220, E + 34],
        },
        { id: "t-em", l: "out", w: "front", r: 20, pts: [[o + 305, E], ...up.slice(3)] },
      );
      folds.push({ x: o + 220, y: E - 80, t: "Subject test", grp: "ab" });
    } else {
      tr.push({ id: "t-ab", l: "out", w: "front", r: 20, pts: up });
      st.push({
        cap: [o + 170, o + 270],
        id: "abc",
        grp: "ab",
        y: E,
        l: "out",
        n: "Subject A/B",
        now: 9,
      });
    }
    st.push(
      { id: "em", t: "att", x: o + 330, y: E, n: "Email 1", s: "day 0" },
      {
        id: "cn",
        t: "att",
        x: o + 180,
        y: L,
        n: "Connect",
        s: "LinkedIn",
        rep: "held · 2",
        repGlyph: "pause",
      },
      {
        id: "dm",
        t: "att",
        x: o + 310,
        y: L,
        n: "DM",
        s: "day 2",
        rep: "retry · 1 of 2",
        repGlyph: "undo",
      },
    );
    tr.push({ id: "t-cn", l: "out", w: "front", r: 20, pts: lo });
    exit("ns", "Not sent", "after 2 tries", [o + 330, L], [o + 380, L + 72], true, "left");
    folds.push({ x: o + 220, y: 22, t: "Send · two lanes", grp: "send" });
    prev = [J, M];
    x += LGP.send;
  } else {
    st.push({
      cap: [x + 20, x + 50],
      id: "sendc",
      grp: "send",
      y: M,
      l: "out",
      n: "Send · 2 lanes",
      now: 14,
    });
    seg("t-sp", [x + 35, M]);
    exit("ns", "Not sent", "after 2 tries", [x + 35, M], [x + 35, M + 70], true);
    prev = [x + 50, M];
    x += LGF.send;
  }

  // Wait: the first event wins; the timeout loops through one follow-up, max two.
  if (g.wait) {
    const o = x;
    seg("t-wt", [o + 120, M]);
    st.push(
      { id: "rc", t: "race", x: o + 120, y: M, n: "Reply or 7 days", s: "first one wins" },
      { id: "fu", t: "att", x: o + 70, y: M + 95, n: "Follow-up", s: "max 2", p: "down" },
    );
    tr.push({
      id: "t-fu",
      l: "out",
      w: "front",
      r: 26,
      pts: [
        [o + 120, M],
        [o + 120, M + 95],
        [o + 20, M + 95],
        [o + 20, M],
      ],
      cond: "7 days",
      condGlyph: "clock",
      cat: [o + 120, M + 50],
    });
    exit("na", "No answer", "after 2 follow-ups", [o + 20, M + 95], [o + 20, M + 165], true);
    folds.push({ x: o + 100, y: M - 88, t: "Wait · race", grp: "wait" });
    prev = [o + 120, M];
    x += LGP.wait;
    const to: Point = [x + (g.sort ? 30 : 35), M];
    tr.push({
      id: "t-rp",
      l: "out",
      w: "front",
      pa: prev,
      pc: to,
      cond: "replied",
      cat: [o + 168, M],
    });
    prev = to;
  } else {
    st.push({
      cap: [x + 20, x + 50],
      id: "waitc",
      grp: "wait",
      y: M,
      l: "out",
      n: "Wait · race",
      now: 21,
    });
    seg("t-wt", [x + 35, M]);
    exit("na", "No answer", "after 2 follow-ups", [x + 35, M], [x + 35, M + 70], true);
    prev = [x + 50, M];
    x += LGF.wait;
  }

  // Sort: a condition. yes runs straight, no is red, else goes to a person.
  if (g.sort) {
    const o = x;
    if (prev[0] < o + 30) seg("t-so", [o + 30, M]);
    st.push(
      { id: "so", t: "dec", x: o + 30, y: M, n: "Sort reply", s: "3 branches" },
      { id: "rh", t: "att", x: o + 130, y: M + 110, n: "Read by hand", s: "", p: "left" },
    );
    tr.push(
      {
        id: "t-el",
        l: "out",
        w: "front",
        r: 16,
        pts: [
          [o + 30, M],
          [o + 48, M],
          [o + 130, M + 82],
          [o + 130, M + 110],
        ],
        cond: "else",
        cat: [o + 68, M + 20],
        who: "WJ · 4h",
        at: [o + 106, M + 58],
      },
      {
        id: "x-rh",
        l: "out",
        w: "front",
        r: 16,
        pts: [
          [o + 130, M + 110],
          [o + 148, M + 110],
          [o + 228, M + 30],
          [o + 228, M],
        ],
        cond: "yes",
        cat: [o + 188, M + 70],
      },
    );
    st.push({
      id: "no",
      t: "exit",
      x: o + 120,
      y: M - 85,
      n: "Said no",
      s: "6",
      p: "right",
      bad: true,
    });
    tr.push({
      id: "e-no",
      k: "exit",
      pts: [
        [o + 30, M],
        [o + 48, M],
        [o + 120, M - 72],
        [o + 120, M - 85],
      ],
      b: "no",
      cond: "no",
      cat: [o + 84, M - 36],
    });
    exit("lt", "Later", "rest 90 days", [o + 130, M + 110], [o + 70, M + 190], false, "left");
    tr.push({
      id: "t-ys",
      l: "out",
      w: "front",
      pa: [o + 30, M],
      pc: [o + LGP.sort, M],
      cond: "yes AND ≥ $1k",
      cat: [o + 150, M - 1],
    });
    folds.push({ x: o + 130, y: M - 135, t: "Sort · condition", grp: "sort" });
    prev = [o + LGP.sort, M];
    x += LGP.sort;
  } else {
    st.push({
      cap: [x + 20, x + 50],
      id: "sortc",
      grp: "sort",
      y: M,
      l: "out",
      n: "Sort reply",
      now: 5,
    });
    if (prev[0] < x + 35) seg("t-so", [x + 35, M]);
    exit("no", "Said no", "6", [x + 35, M], [x + 35, M - 75], true);
    exit("lt", "Later", "rest 90 days", [x + 35, M], [x + 35, M + 75], false);
    prev = [x + 50, M];
    x += LGF.sort;
  }
  const bx1 = x + 12;
  st.push(
    { id: "bf", t: "link", x: x + 50, y: M, n: "Booking flow", s: "shared · 3 offers" },
    { id: "bk", t: "exit", x: x + 150, y: M, n: "Booked", s: "9 this week", p: "down" },
  );
  tr.push(
    { id: "t-bf", l: "out", w: "front", pa: prev, pc: [x + 50, M] },
    { id: "e-bk", k: "exit", a: "bf", b: "bk" },
  );
  // Stop anywhere: a frame round the protocol, one red exit off its edge.
  const top = g.send ? 4 : g.sort ? M - 157 : M - 112;
  const bot = Math.max(M + 112, g.send ? L + 110 : 0, g.wait ? M + 200 : 0, g.sort ? M + 225 : 0);
  chips.push({ x: bx0 + 100, y: bot - 18, t: "stop word · unsubscribe", icon: "stop" });
  st.push({
    id: "sp0",
    t: "exit",
    x: bx1 + 60,
    y: bot,
    n: "Stopped",
    s: "3",
    p: "right",
    bad: true,
  });
  tr.push({ id: "e-sp0", k: "exit", pa: [bx1, bot], b: "sp0" });
  return {
    title: "A sales protocol with every logic mark",
    w: x + 210,
    h: bot + 44,
    click: true,
    still: true,
    zones: [],
    frames: [{ x: bx0, y: top, w: bx1 - bx0, h: bot - top }],
    chips,
    folds,
    st,
    tr,
  };
}

/** Folded, Groups, All. Opening the A/B test opens Send with it. */
export const protocolZoom = (): MetroZoom =>
  flagZoom({
    names: ["Folded", "Groups", "All"],
    presets: [
      {},
      { send: true, wait: true, sort: true },
      { send: true, ab: true, wait: true, sort: true },
    ],
    compose: composeProtocol,
    total: composeProtocol({ send: true, ab: true, wait: true, sort: true }).st.length,
    opens: { ab: { also: ["send"] } },
    foldId: { send: "sendc", wait: "waitc", sort: "sortc", ab: "abc" },
  });

// ---------------------------------------------------------------------------------------------
// Section 06 again, as plain data: a `MetroView` that `layoutMetro` places.

/** Cold outbound to a retainer, with no positions. */
export const COLD_OUTBOUND_VIEW: MetroView = {
  title: "Cold outbound to a retainer",
  lines: [
    { id: "cold", tier: "out" },
    { id: "gp", offer: "Retainer", tier: "core", colour: 2 },
  ],
  stations: [
    { id: "c1", kind: "att", line: "cold", column: "Marketing", label: "Cold email", sub: "60" },
    {
      id: "hub",
      kind: "hub",
      line: "cold",
      column: "Marketing",
      label: "First touch",
      sub: "60 / wk",
    },
    {
      id: "rep",
      kind: "att",
      line: "gp",
      column: "Sales",
      label: "Replied",
      sub: "9",
      group: "sales",
      now: 9,
    },
    {
      id: "bk",
      kind: "time",
      line: "gp",
      column: "Sales",
      label: "Call booked",
      sub: "6",
      group: "sales",
      now: 6,
    },
    {
      id: "held",
      kind: "time",
      line: "gp",
      column: "Sales",
      label: "Call held",
      sub: "5",
      group: "sales",
      now: 5,
    },
    { id: "lost", kind: "exit", line: "gp", column: "Sales", label: "Lost", sub: "3", bad: true },
    {
      id: "pay",
      kind: "cash",
      line: "gp",
      column: "Money",
      label: "Retainer",
      sub: "$12k / mo",
      repeat: "monthly",
    },
  ],
  tracks: [
    { from: "c1", to: "hub", by: "system" },
    { from: "hub", to: "rep", by: "system" },
    { from: "rep", to: "bk", by: "person", owner: "WJ", promise: "24h" },
    { from: "bk", to: "held", by: "system" },
    { from: "held", to: "pay", by: "person", owner: "WJ", promise: "2d" },
    { from: "held", to: "lost", by: "system" },
  ],
};

/** Paid webinar funds the core: a front-end line with its own money station. */
export const WEBINAR_VIEW: MetroView = {
  title: "Paid webinar funds the core",
  lines: [
    { id: "yt", tier: "out" },
    { id: "web", offer: "Webinar", tier: "front", colour: 0 },
    { id: "gp", offer: "Growth Partner", tier: "core", colour: 2 },
  ],
  stations: [
    { id: "yt", kind: "att", line: "yt", column: "Marketing", label: "YouTube" },
    {
      id: "hub",
      kind: "hub",
      line: "yt",
      column: "Marketing",
      label: "First touch",
      sub: "420 / wk",
    },
    {
      id: "lan",
      kind: "att",
      line: "web",
      column: "Sales",
      flow: "Webinar funnel",
      label: "Visited lander",
      sub: "180",
    },
    {
      id: "tix",
      kind: "cash",
      line: "web",
      column: "Sales",
      flow: "Webinar funnel",
      label: "Webinar ticket",
      sub: "46 · $97",
    },
    {
      id: "att",
      kind: "time",
      line: "web",
      column: "Sales",
      flow: "Webinar funnel",
      label: "Attended",
      sub: "31",
    },
    { id: "bk", kind: "time", line: "gp", column: "Sales", label: "Call booked", sub: "12" },
    {
      id: "pay",
      kind: "cash",
      line: "gp",
      column: "Money",
      label: "Growth Partner",
      sub: "$12k / mo",
    },
  ],
  tracks: [
    { from: "yt", to: "hub", by: "system" },
    { from: "hub", to: "lan", by: "system" },
    { from: "lan", to: "tix", by: "system" },
    { from: "tix", to: "att", by: "system" },
    { from: "hub", to: "bk", by: "system" },
    { from: "bk", to: "pay", by: "person", owner: "WJ", promise: "2d" },
    { from: "att", to: "bk", by: "system", label: "upsell" },
  ],
};

/**
 * A draft against live: one of each diff mark on stations, tracks and a whole line, and the
 * store's track ids on every track. Synthetic.
 */
export const DIFF_VIEW: MetroView = {
  title: "A draft against live",
  lines: [
    { id: "yt", tier: "out" },
    // A whole new line: its stations and tracks take the mark.
    { id: "web", offer: "Webinar", tier: "front", colour: 0, mark: "added" },
    { id: "gp", offer: "Growth Partner", tier: "core", colour: 2 },
  ],
  stations: [
    { id: "yt", kind: "att", line: "yt", column: "Marketing", label: "YouTube", sub: "420" },
    {
      id: "hub",
      kind: "hub",
      line: "yt",
      column: "Marketing",
      label: "First touch",
      sub: "18 leads",
    },
    { id: "lan", kind: "att", line: "web", column: "Sales", label: "Visited lander", sub: "180" },
    { id: "tix", kind: "cash", line: "web", column: "Sales", label: "Webinar ticket", sub: "46" },
    {
      id: "chk",
      kind: "att",
      line: "gp",
      column: "Sales",
      label: "Replied",
      sub: "9",
      mark: "added",
    },
    {
      id: "bk",
      kind: "time",
      line: "gp",
      column: "Sales",
      label: "Call booked",
      sub: "6",
      mark: "changed",
    },
    {
      id: "old",
      kind: "exit",
      line: "gp",
      column: "Sales",
      label: "Dropped",
      bad: true,
      mark: "removed",
    },
    { id: "pay", kind: "cash", line: "gp", column: "Money", label: "Growth Partner", sub: "3" },
  ],
  tracks: [
    { id: "t-yt-hub", from: "yt", to: "hub", by: "system", mark: "changed" },
    { id: "t-hub-lan", from: "hub", to: "lan", by: "system" },
    { id: "t-lan-tix", from: "lan", to: "tix", by: "system" },
    { id: "t-hub-chk", from: "hub", to: "chk", by: "system" },
    { id: "t-chk-bk", from: "chk", to: "bk", by: "system", mark: "added" },
    { id: "t-bk-old", from: "bk", to: "old", by: "system", mark: "removed" },
    {
      id: "t-bk-pay",
      from: "bk",
      to: "pay",
      by: "person",
      owner: "WJ",
      promise: "2d",
      mark: "removed",
    },
  ],
};

/** Value ladder: each rung is a money station; upsell connectors carry people up. */
export const LADDER_VIEW: MetroView = {
  title: "Value ladder",
  lines: [
    { id: "li", tier: "out" },
    { id: "lm", offer: "Guide and audit", tier: "front", colour: 3 },
    { id: "ob", offer: "Offer Builder", tier: "front", colour: 1 },
    { id: "gp", offer: "Growth Partner", tier: "core", colour: 2 },
  ],
  stations: [
    { id: "li", kind: "att", line: "li", column: "Marketing", label: "LinkedIn" },
    {
      id: "hub",
      kind: "hub",
      line: "li",
      column: "Marketing",
      label: "First touch",
      sub: "300 / wk",
    },
    { id: "opt", kind: "att", line: "lm", column: "Sales", label: "Free guide", sub: "120" },
    { id: "aud", kind: "cash", line: "lm", column: "Sales", label: "Audit", sub: "14 · $500" },
    {
      id: "ob",
      kind: "cash",
      line: "ob",
      column: "Delivery",
      label: "Offer Builder",
      sub: "6 · $3.1k / mo",
      repeat: "monthly",
    },
    {
      id: "gp",
      kind: "cash",
      line: "gp",
      column: "Money",
      label: "Growth Partner",
      sub: "2 · $12k / mo",
    },
  ],
  tracks: [
    { from: "li", to: "hub", by: "system" },
    { from: "hub", to: "opt", by: "system" },
    { from: "opt", to: "aud", by: "system" },
    { from: "hub", to: "ob", by: "system" },
    { from: "hub", to: "gp", by: "system" },
    { from: "aud", to: "ob", by: "system", label: "upsell" },
    { from: "ob", to: "gp", by: "system", label: "upsell" },
  ],
};

/** Downsell after a call: a transfer with a label needs no new type. */
export const DOWNSELL_VIEW: MetroView = {
  title: "Downsell after a call",
  lines: [
    { id: "dm", tier: "out" },
    { id: "gp", offer: "Growth Partner", tier: "core", colour: 2 },
    { id: "ob", offer: "Offer Builder", tier: "front", colour: 1 },
  ],
  stations: [
    { id: "dm", kind: "att", line: "dm", column: "Marketing", label: "DM" },
    { id: "hub", kind: "hub", line: "dm", column: "Marketing", label: "First touch" },
    { id: "bk", kind: "time", line: "gp", column: "Sales", label: "Call booked", sub: "20" },
    { id: "held", kind: "time", line: "gp", column: "Sales", label: "Call held", sub: "17" },
    {
      id: "gp",
      kind: "cash",
      line: "gp",
      column: "Money",
      label: "Growth Partner",
      sub: "4 · $12k / mo",
    },
    {
      id: "ob",
      kind: "cash",
      line: "ob",
      column: "Money",
      label: "Offer Builder",
      sub: "5 · $3.1k / mo",
    },
  ],
  tracks: [
    { from: "dm", to: "hub", by: "system" },
    { from: "hub", to: "bk", by: "person", owner: "WJ", promise: "1h" },
    { from: "bk", to: "held", by: "system" },
    { from: "held", to: "gp", by: "person", owner: "WJ", promise: "2d" },
    { from: "held", to: "ob", by: "system", label: "downsell" },
  ],
};

/** Client becomes a channel: a planned referral ask. */
export const REFERRAL_VIEW: MetroView = {
  title: "Client becomes a channel",
  lines: [{ id: "gp", offer: "Growth Partner", tier: "core", colour: 2 }],
  stations: [
    { id: "hub", kind: "hub", line: "gp", column: "Marketing", label: "First touch" },
    { id: "bk", kind: "time", line: "gp", column: "Sales", label: "Call booked" },
    {
      id: "pay",
      kind: "cash",
      line: "gp",
      column: "Money",
      label: "Growth Partner",
      sub: "$12k / mo",
    },
    { id: "onb", kind: "time", line: "gp", column: "Delivery", label: "Month 3 review" },
    {
      id: "ask",
      kind: "plan",
      line: "gp",
      column: "Delivery",
      label: "Referral ask",
      sub: "planned",
    },
  ],
  tracks: [
    { from: "hub", to: "bk", by: "system" },
    { from: "bk", to: "pay", by: "system" },
    { from: "pay", to: "onb", by: "system" },
    { from: "onb", to: "ask", by: "system", plan: true },
  ],
};

/** Speed to lead is late: the person track carries an amber pill. */
export const LATE_VIEW: MetroView = {
  title: "Speed to lead is late",
  lines: [
    { id: "rd", tier: "out" },
    { id: "ob", offer: "Intro call", tier: "front", colour: 1 },
  ],
  stations: [
    { id: "rd", kind: "att", line: "rd", column: "Marketing", label: "Reddit" },
    { id: "hub", kind: "hub", line: "rd", column: "Marketing", label: "First touch" },
    { id: "form", kind: "att", line: "ob", column: "Sales", label: "Form fill", sub: "40" },
    { id: "bk", kind: "time", line: "ob", column: "Sales", label: "Call booked", sub: "11" },
    {
      id: "ns",
      kind: "exit",
      line: "ob",
      column: "Sales",
      label: "No answer",
      sub: "29",
      bad: true,
    },
  ],
  tracks: [
    { from: "rd", to: "hub", by: "system" },
    { from: "hub", to: "form", by: "system" },
    { from: "form", to: "bk", by: "person", owner: "WJ", promise: "5m → 3h", late: true },
    { from: "form", to: "ns", by: "system" },
  ],
};

/** A planned offer: dotted line, dashed station. */
export const PLANNED_VIEW: MetroView = {
  title: "A planned offer",
  lines: [
    { id: "gp", offer: "Retainer", tier: "core", colour: 2 },
    { id: "be", offer: "Backend", tier: "front", colour: 4, plan: true },
  ],
  stations: [
    { id: "hub", kind: "hub", line: "gp", column: "Marketing", label: "First touch" },
    { id: "pay", kind: "cash", line: "gp", column: "Money", label: "Retainer", sub: "$12k / mo" },
    { id: "be", kind: "plan", line: "be", column: "Money", label: "Backend", sub: "planned" },
  ],
  tracks: [
    { from: "hub", to: "pay", by: "system" },
    { from: "pay", to: "be", by: "system", plan: true },
  ],
};

/** Section 06, in the artifact's order. */
export const SAMPLE_VIEWS: MetroView[] = [
  COLD_OUTBOUND_VIEW,
  WEBINAR_VIEW,
  LADDER_VIEW,
  DOWNSELL_VIEW,
  REFERRAL_VIEW,
  LATE_VIEW,
  PLANNED_VIEW,
];
