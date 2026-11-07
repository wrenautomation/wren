/** A page subject with four batches, for the generation tree. Synthetic; the preview's examples. */
import { ago } from "./shell.js";

type Look = "shader" | "3d" | "type" | "grid" | "film" | "list" | "terminal";
/** a sketch of the sample's kind, 80×50, as the poster (the preview's snapshots) */
function poster(id: number, looks: Look[]): string {
  const h = (id * 53 + 200) % 360;
  const M = `hsl(${h} 70% 84%)`;
  const k = id % 3;
  const one = (l: Look, a: number) => {
    if (l === "shader")
      return [0, 1, 2]
        .map(
          (i) =>
            `<path d="M-4 ${18 + i * 9 + k}C18 ${6 + i * 9},44 ${32 + i * 9 - k * 2},84 ${14 + i * 9}" fill="none" stroke="${M}" stroke-width="${3.2 - i * 0.8}" stroke-linecap="round" opacity="${a * (0.95 - i * 0.27)}"/>`,
        )
        .join("");
    if (l === "3d")
      return `<g opacity="${a}"><ellipse cx="40" cy="42" rx="17" ry="3" fill="#000" opacity=".28"/><path d="M40 9 55 17 40 25 25 17z" fill="${M}"/><path d="M25 17 40 25v14l-15-8z" fill="${M}" opacity=".7"/><path d="M55 17 40 25v14l15-8z" fill="${M}" opacity=".42"/></g>`;
    if (l === "type")
      return `<g opacity="${a}"><text x="9" y="35" font-family="system-ui,sans-serif" font-weight="800" font-size="25" fill="${M}">Aa</text><rect x="10" y="40" width="${30 + k * 6}" height="3" rx="1.5" fill="${M}" opacity=".55"/></g>`;
    if (l === "grid")
      return `<g opacity="${a}">${[0, 1, 2]
        .flatMap((i) =>
          [0, 1].map(
            (j) =>
              `<rect x="${8 + i * 22}" y="${8 + j * 18}" width="18" height="14" rx="2" fill="${M}" opacity="${(i + j + k) % 3 ? 0.5 : 0.92}"/>`,
          ),
        )
        .join("")}</g>`;
    if (l === "film")
      return `<g opacity="${a}"><rect x="0" y="11" width="80" height="28" fill="#000" opacity=".3"/>${[
        0, 1, 2,
      ]
        .map(
          (i) =>
            `<rect x="${5 + i * 24}" y="18" width="21" height="14" rx="1.5" fill="${M}" opacity="${i === 1 ? 0.92 : 0.6}"/>`,
        )
        .join("")}</g>`;
    if (l === "list")
      return `<g opacity="${a}">${[0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<rect x="9" y="${9 + i * 7}" width="4" height="3" rx="1" fill="${M}" opacity=".6"/><rect x="17" y="${9 + i * 7}" width="${54 - i * 7}" height="3" rx="1" fill="${M}" opacity=".88"/>`,
        )
        .join("")}</g>`;
    return `<g opacity="${a}"><rect width="80" height="50" fill="#121212"/><text x="8" y="19" font-family="ui-monospace,monospace" font-weight="700" font-size="11" fill="#7ee2a0">&gt;_</text></g>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 50"><rect width="80" height="50" fill="hsl(${h} 38% 30%)"/>${looks.map((l, i) => one(l, i < looks.length - 1 ? 0.4 : 1)).join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type V = "amazing" | "good" | "bad" | null;
const row = (
  id: number,
  look: Look | Look[],
  verdict: V,
  change: string,
  parent: number | number[] | null = null,
  note?: string,
  /** what it took from each parent, by parent id; a name the agent gave */
  x: { took?: Record<number, string>; name?: string } = {},
) => ({
  id,
  body: null,
  media: null,
  poster: null,
  mediaUrl: `/variants/scene-${(id % 3) + 1}.html`,
  posterUrl: poster(id, ([] as Look[]).concat(look)),
  verdict,
  keptAt: id === 13 ? ago(3) : null,
  notes: note ? [{ id: id * 10, anchor: null, tone: null, text: note }] : [],
  change,
  name: x.name ?? null,
  parents: ([] as number[]).concat(parent ?? []).map((id) => ({ id, took: x.took?.[id] ?? null })),
});

const SUBJECT = {
  id: 3,
  slug: "hero-background",
  name: "Hero background",
  kind: "page",
  brief: "A scene that moves with scroll. Calm at rest.",
  state: "open",
  samples: 24,
  kept: 1,
  toPick: 6,
};

export const TREE_SUBJECT = {
  subject: SUBJECT,
  leaders: [],
  guides: [
    {
      id: 11,
      text: "Type is the hero",
      source: "william",
      state: "locked",
      subjectId: 3,
      kind: null,
      decidedAt: ago(4.5),
      effect: { with: { good: 4, n: 5 }, without: { good: 3, n: 13 }, diff: 0.57, early: true },
    },
    {
      id: 12,
      text: "One motion at a time",
      source: "william",
      state: "locked",
      subjectId: 3,
      kind: null,
      decidedAt: ago(4.4),
      effect: { with: { good: 3, n: 4 }, without: { good: 4, n: 14 }, diff: 0.46, early: true },
    },
  ],
  batches: [
    {
      id: 21,
      n: 1,
      why: "Six background techniques, one per sample.",
      note: "All six keep parts of the old site. I want a full redesign.",
      state: "closed",
      createdAt: ago(9),
      closedAt: ago(8.5),
      goodRate: 0,
      samples: [
        row(1, "shader", "bad", "Particle ribbons: 65k ink points as silk beside the copy."),
        row(2, "shader", "bad", "Ink in water: a fluid plume the pointer stirs."),
        row(3, "3d", "bad", "Clay still life: raymarched blobs that merge."),
        row(4, "3d", "bad", "Dithered planet: a dark wild card in 3 tones."),
        row(5, "shader", "bad", "Coral growth: reaction-diffusion across the page."),
        row(6, "shader", "bad", "Pool caustics: a warm light network on the page."),
      ],
    },
    {
      id: 22,
      n: 2,
      why: "From your batch 1 note: six full page directions, not backgrounds.",
      note: "Kinetic type is close. The type is the hero. The 3D scene is too heavy.",
      state: "closed",
      createdAt: ago(8),
      closedAt: ago(7),
      goodRate: 0.5,
      samples: [
        row(
          7,
          "type",
          "amazing",
          "Kinetic type: the headline is the hero.",
          null,
          "This is the direction.",
        ),
        row(8, "grid", "good", "Editorial grid: 12 columns, work as an index."),
        row(9, "film", "bad", "Case film scroll: one project as a scroll film.", null, "Too slow."),
        row(10, "list", "bad", "Brutalist index: raw list, system type, no motion."),
        row(11, "grid", "bad", "Swiss mono: one tone, strict grid, small type."),
        row(
          12,
          "3d",
          "good",
          "Lit desk scene: the caustic light on a 3D desk.",
          6,
          "Nice light. Too heavy.",
        ),
      ],
    },
    {
      id: 23,
      n: 3,
      why: "From your batch 2 note: keep type as the hero, drop heavy 3D, test slower motion.",
      note: "Type, slow ease is the one. Keep the type. Slow the motion more.",
      state: "closed",
      createdAt: ago(6),
      closedAt: ago(4.6),
      goodRate: 0.67,
      samples: [
        row(
          13,
          "type",
          "amazing",
          "Type, slow ease: a longer, softer ease.",
          7,
          "This is the one.",
        ),
        row(
          14,
          ["film", "type"],
          "amazing",
          "Type and reel: kinetic type over a muted reel.",
          [7, 9],
          undefined,
          { took: { 7: "the moving headline", 9: "a muted reel" } },
        ),
        row(15, "type", "good", "Type on a curve: the headline set on a slow curve.", 7),
        row(
          16,
          ["grid", "type"],
          "good",
          "Grid and type: the grid with the kinetic headline.",
          [8, 7],
          undefined,
          { name: "Index with type", took: { 7: "the headline" } },
        ),
        row(17, "terminal", "bad", "Terminal intro: the page types itself in.", null, "A gimmick."),
        row(18, "3d", "bad", "Desk, flat light: less geometry.", 12),
      ],
    },
    {
      id: 24,
      n: 4,
      why: "From your batch 3 note: test ease length and a reel under the type.",
      note: null,
      state: "open",
      createdAt: ago(4),
      closedAt: null,
      goodRate: null,
      samples: [19, 20, 21, 22, 23, 24].map((id) => ({
        ...row(id, "type", null, ""),
        change: null,
        name: null,
        parents: [],
      })),
    },
  ],
};

/** Notes only, no calls: one sample grows eight across two batches (the shape prod has). */
const IDEAS: [number, Look, string, number | null][] = [
  [101, "shader", "Curl noise ribbons: ink points beside the copy.", null],
  [102, "shader", "Ink plume: a fluid the pointer stirs.", null],
  [103, "3d", "Clay blobs: raymarched shapes that merge.", null],
  [104, "3d", "Dither planet: a wild card in three tones.", null],
  [105, "shader", "Coral growth: reaction-diffusion across the page.", null],
  [106, "shader", "Warm caustics: a light network on the page.", null],
  [107, "grid", "Swiss index: an info grid with a live clock.", null],
  [108, "film", "Live exhibits: curved screens, one sim each.", null],
  [109, "3d", "One signature object: a clay planet with contour lines.", null],
  [110, "type", "Poster: vermilion field, condensed display type.", null],
  [111, "terminal", "Ledger: mono readouts and a glyph graph.", null],
  [112, "3d", "Dusk horizon: the name curves along the earth.", 109],
  [113, "3d", "Star system: scroll climbs a telescope into the sky.", 109],
  [114, "3d", "Toy world: the camera lifts to the whole planet.", 109],
  [115, "3d", "Eyepiece: the view opens through the lens.", 109],
  [116, "grid", "Paper diorama: cut layers with soft shadows.", 109],
  [117, "3d", "Planet at night: the name over a lit rim.", 109],
  [118, "list", "Star atlas: hatched earth on deep navy.", 109],
  [119, "3d", "Star system, crisp: the climb with sharp edges.", 113],
  [120, "film", "Aurora: pastel curtains over a dark earth.", 109],
];
const NOTES_CLOSED = [
  [41, 101, 106, "Six background techniques.", "None land. I want a whole page, not a background."],
  [42, 107, 111, "From your note: five full pages.", "The planet is the one. Push it."],
  [
    43,
    112,
    116,
    "From your note: five takes on the planet.",
    "Star system is close. Try the rest too.",
  ],
  [44, 117, 120, "Star system, sharper, and three more planets.", "Aurora. Make more like it."],
] as const;
export const NOTES_ONLY = {
  subject: {
    id: 4,
    slug: "portfolio-hero",
    name: "Portfolio hero",
    kind: "page",
    brief: "A designer's landing page. One scene, award-site craft.",
    state: "open",
    samples: 27,
    kept: 0,
    toPick: 7,
  },
  leaders: [],
  guides: [],
  batches: [
    ...NOTES_CLOSED.map(([id, lo, hi, why, note], i) => ({
      id,
      n: i + 1,
      why,
      note,
      state: "closed",
      createdAt: ago(5 - i),
      closedAt: ago(4.8 - i),
      goodRate: null,
      samples: IDEAS.filter(([n]) => n >= lo && n <= hi).map(([n, look, change, parent]) =>
        row(n, look, null, change, parent),
      ),
    })),
    {
      id: 45,
      n: 5,
      why: "From your note: seven aurora takes.",
      note: null,
      state: "open",
      createdAt: ago(0.5),
      closedAt: null,
      goodRate: null,
      samples: [121, 122, 123, 124, 125, 126, 127].map((id) => ({
        ...row(id, "film", null, ""),
        change: null,
        name: null,
        parents: [],
      })),
    },
  ],
};
