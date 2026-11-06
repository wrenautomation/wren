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
  parentId: number | null = null,
  note?: string,
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
  parentId,
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
        row(14, ["film", "type"], "amazing", "Type and reel: kinetic type over a muted reel.", 7),
        row(15, "type", "good", "Type on a curve: the headline set on a slow curve.", 7),
        row(16, ["grid", "type"], "good", "Grid and type: the grid with the kinetic headline.", 8),
        row(17, "terminal", "bad", "Terminal intro: the page types itself in.", null, "A gimmick."),
        row(18, "3d", "bad", "Desk, flat light: less geometry.", 12),
      ],
    },
    {
      id: 24,
      why: "From your batch 3 note: test ease length and a reel under the type.",
      note: null,
      state: "open",
      createdAt: ago(4),
      closedAt: null,
      goodRate: null,
      samples: [19, 20, 21, 22, 23, 24].map((id) => ({
        ...row(id, "type", null, ""),
        change: null,
        parentId: null,
      })),
    },
  ],
};
