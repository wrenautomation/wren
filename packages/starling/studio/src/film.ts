/**
 * The edit as an OpenFilm film (designs/2026-10-24-video-film-file.md, Decision 1): `film.html`, the
 * pages it plays, and the words as WebVTT, by OpenFilm's spec (github.com/openfilm/openfilm, SPEC.md
 * §1 and Words). A pure function of the row: the row stays the source and Remotion renders it; the
 * film is what a person reads, diffs (`wren video history`) and opens in OpenFilm Studio.
 *
 * Clips play the raw recordings (`assets/main.*`, `assets/cam.*`) by media fragment, so every time
 * in the film is a time in the edit: `#t=` in raw seconds, `at` on the cut timeline.
 */
import { extname } from "node:path";
import { createTwoFilesPatch } from "diff";
import { keepSegments, onCut, type Span, shortCutsOver, toCutTime } from "./cuts.js";
import { captionLines, shortCrop, type TextOverlay } from "./finish.js";
import { CORNER_CAM, coverRect, OVERLAY } from "./finish-look.js";
import { cutSize, FPS } from "./media.js";
import { cardOf } from "./props.js";
import type { LAYOUTS, VideoEdit, Word } from "./schema.js";
import { audioOn, kitFiles } from "./sounds.js";

type Show = (typeof LAYOUTS)[number];
/** A kept stretch of the recording under one layout: raw seconds, and where it starts on the cut. */
interface Piece {
  s: number;
  e: number;
  at: number;
  show: Show;
}
/** A film: its files by path, relative to film.html. */
export type Film = Record<string, string>;

const t3 = (x: number) => String(Math.round(x * 1000) / 1000);
const px = (x: number) => `${Math.round(x)}px`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The raw files' names in the film's folder. */
export const filmAssets = (
  e: Pick<VideoEdit, "tracks"> & Partial<Pick<VideoEdit, "sounds" | "music">>,
) => ({
  main: `assets/main${extname(e.tracks.main.path) || ".mp4"}`,
  cam: e.tracks.cam ? `assets/cam${extname(e.tracks.cam.path) || ".mp4"}` : null,
  /** The kit files it plays, as public paths (`stageSounds` copies them in). */
  sounds: kitFiles([...(e.sounds ?? []).map((x) => x.id), ...(e.music ? [e.music.id] : [])]),
});

/** The kept spans, split where the layout changes. */
function pieces(e: VideoEdit, keep: readonly Span[]): Piece[] {
  const marks = e.layout.flatMap((l) => [l.from, l.to]);
  const showAt = (t: number): Show =>
    e.layout.find((l) => t >= l.from && t < l.to)?.show ?? "corner";
  return keep.flatMap((k) => {
    const cuts = [k.s, ...marks.filter((m) => m > k.s && m < k.e).sort((a, b) => a - b), k.e];
    return cuts.slice(1).flatMap((end, i) => {
      const s = cuts[i] as number;
      return end - s < 1 / FPS ? [] : [{ s, e: end, at: onCut(s, keep), show: showAt(s) }];
    });
  });
}

const attrs = (a: Record<string, string | boolean | undefined>) =>
  Object.entries(a)
    .flatMap(([k, v]) =>
      v === undefined || v === false ? [] : [v === true ? k : `${k}="${esc(v)}"`],
    )
    .join(" ");

const style = (box: readonly number[], more = "") =>
  `left: ${px(box[0] as number)}; top: ${px(box[1] as number)}; width: ${px(box[2] as number)}; height: ${px(box[3] as number)}${more}`;

const video = (id: string, src: string, s: number, e: number, at: number, a: object = {}) =>
  `  <video ${attrs({ id, src: `${src}#t=${t3(s)},${t3(e)}`, at: t3(at), ...a })}></video>`;

const track = (clips: string[], o: { title: string; locked?: boolean }) =>
  clips.length
    ? `<section ${attrs({ title: o.title, locked: o.locked })}>\n${clips.join("\n")}\n</section>`
    : "";

function doc(w: number, h: number, sections: string[], head = ""): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    `<meta name="viewport" content="width=${w}, height=${h}">`,
    `<style>\n  .face { object-fit: cover; }\n${head}</style>`,
    "</head>",
    "<body>",
    ...sections.filter(Boolean),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** A page that draws one line of text, still, fading in and out like the render's overlays. */
function textPage(text: string, o: { durationS: number; size: number; fadeS: number }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; }
  body { display: grid; place-items: center; }
  p { margin: 0; font: 700 ${o.size}px/1.15 "General Sans", sans-serif; color: #fff; text-align: center; }
</style>
</head>
<body>
<p>${esc(text)}</p>
<script>
  const p = document.querySelector("p");
  const d = ${t3(o.durationS)}, f = ${t3(o.fadeS)};
  window.film = {
    duration: d,
    ready: Promise.resolve(),
    frame(t) { p.style.opacity = String(Math.max(0, Math.min(1, t / f, (d - t) / f))); },
  };
</script>
</body>
</html>
`;
}

/** Overlays in a `w` x `h` film, times on the cut from `from`: a page clip each. */
function overlayClips(
  overlays: readonly TextOverlay[],
  keep: readonly Span[],
  w: number,
  h: number,
  win: { from: number; to: number },
  prefix: string,
): { clips: string[]; pages: Film } {
  const pages: Film = {};
  const clips = overlays.flatMap((o, i) => {
    const s = onCut(o.from, keep);
    const e = onCut(o.to, keep);
    if (e <= win.from || s >= win.to) return [];
    const at = Math.max(s, win.from) - win.from;
    const len = Math.min(e, win.to) - Math.max(s, win.from);
    const size = Math.round(OVERLAY.scale[o.size] * Math.min(w, h));
    const bw = Math.round(OVERLAY.maxWidth * w);
    const bh = Math.round(size * 2.6);
    const file = `pages/${prefix}overlay-${i + 1}.html`;
    pages[file] = textPage(o.text, {
      durationS: len,
      size,
      fadeS: Math.min(OVERLAY.fadeS, len / 3),
    });
    return [
      `  <iframe ${attrs({ id: `overlay-${i + 1}`, title: o.text, src: `${file}#t=0,${t3(len)}`, at: t3(at), style: style([o.x * w - bw / 2, o.y * h - bh / 2, bw, bh]) })}></iframe>`,
    ];
  });
  return { clips, pages };
}

/** What the film cannot read off the row: the bed file's length, from the kit. */
export interface FilmOptions {
  bedS?: number | undefined;
}

/**
 * The edit's sounds and bed on one output's clock: an audio clip each (`sounds.ts`). A film has no
 * loop, so the bed is a clip per pass of its file (`bedS`; unknown: one clip). The duck under
 * speech is the render's alone.
 */
function soundClips(
  e: VideoEdit,
  which: "long" | "short",
  clock: (raw: number) => number | null,
  durationS: number,
  bedS?: number,
): string[] {
  const a = audioOn(e.sounds ?? [], e.music, { which, clock, words: [], fps: FPS, durationS });
  const clips = a.sounds.map(
    (x, i) =>
      `  <audio ${attrs({ id: `sound-${i + 1}`, src: x.trim ? `${x.file}#t=${t3(x.trim / FPS)}` : x.file, at: t3(x.from / FPS), volume: t3(x.volume) })}></audio>`,
  );
  const pass = bedS && bedS > 0.5 ? bedS : durationS;
  for (let at = 0, k = 1; a.music && at < durationS - 0.01; at += pass, k++)
    clips.push(
      `  <audio ${attrs({ id: `music-${k}`, src: `${a.music.file}#t=0,${t3(Math.min(pass, durationS - at))}`, at: t3(at), volume: t3(a.music.volume) })}></audio>`,
    );
  return clips;
}

const isLocked = (locked: readonly string[], ...paths: string[]) =>
  locked.some((l) => paths.some((p) => l === p || l.startsWith(`${p}.`) || p.startsWith(`${l}.`)));

/** Words as WebVTT in the recording's own seconds: a cue per caption line, a tag per word. */
export function wordsVtt(e: Pick<VideoEdit, "words" | "cuts" | "tracks">): string {
  const ts = (x: number) => {
    const ms = Math.round(x * 1000);
    const p = (n: number, k = 2) => String(n).padStart(k, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
  };
  const cues = captionLines(e.words, e.cuts, e.tracks.main.durationS).map((l) => {
    const words = l.at.map((i) => e.words[i] as Word);
    const text = words.map((w, k) => (k === 0 ? esc(w.w) : `<${ts(w.s)}>${esc(w.w)}`)).join(" ");
    return `${ts(l.s)} --> ${ts(Math.max(l.e, l.s + 0.001))}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** The long video: the recording, his camera (corner, full, or none), the overlays, the words. */
export function longFilm(e: VideoEdit, o: FilmOptions = {}): Film {
  const [w, h] = [1920, 1080];
  const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
  const files = filmAssets(e);
  const locked = e.locked ?? [];
  const all = pieces(e, keep);
  const screen = all.map((p, i) => video(`screen-${i + 1}`, files.main, p.s, p.e, p.at));
  const cam = e.tracks.cam;
  const k = h / 1080;
  const corner = [
    w - (CORNER_CAM.margin + CORNER_CAM.size) * k,
    h - (CORNER_CAM.margin + CORNER_CAM.size) * k,
    CORNER_CAM.size * k,
    CORNER_CAM.size * k,
  ];
  const camClips =
    cam && files.cam
      ? all
          .filter((p) => p.show !== "screen")
          .map((p, i) =>
            video(`cam-${i + 1}`, files.cam as string, p.s + cam.offsetS, p.e + cam.offsetS, p.at, {
              class: "face",
              volume: "0",
              style:
                p.show === "cam"
                  ? style([0, 0, w, h])
                  : style(corner, `; border-radius: ${px(CORNER_CAM.radius * k)}`),
            }),
          )
      : [];
  const total = keep.reduce((n, s) => n + (s.e - s.s), 0);
  const text = overlayClips(e.overlays ?? [], keep, w, h, { from: 0, to: total }, "");
  return {
    "film.html": doc(w, h, [
      track(text.clips, { title: "text", locked: isLocked(locked, "overlays") }),
      track(camClips, { title: "camera", locked: isLocked(locked, "layout") }),
      track(screen, { title: "recording", locked: isLocked(locked, "cuts") }),
      track(
        soundClips(e, "long", (t) => toCutTime(t, keep), total, o.bedS),
        { title: "sound", locked: isLocked(locked, "sounds", "music") },
      ),
    ]),
    ...text.pages,
    [files.main.replace(/\.[^.]+$/, ".vtt")]: wordsVtt(e),
  };
}

/** Short `n` (from 1), 1080 x 1920: face on top and screen below (corner), face alone, or screen. */
export function shortFilm(e: VideoEdit, n: number, o: FilmOptions = {}): Film {
  const short = e.shorts[n - 1];
  if (!short) throw new Error(`video ${e.id} has ${e.shorts.length} shorts; no ${n}`);
  const [w, h] = [1080, 1920];
  // A Short plays the tighter cuts too (`shortCutsOver`), so its pieces split on both.
  const keep = keepSegments(shortCutsOver(e.cuts, e.shortCuts ?? []), e.tracks.main.durationS, FPS);
  const files = filmAssets(e);
  const locked = e.locked ?? [];
  const from = onCut(short.from, keep);
  const to = onCut(short.to, keep);
  const inside = pieces(e, keep).flatMap((p) => {
    const s = Math.max(p.s, short.from);
    const end = Math.min(p.e, short.to);
    return end - s < 1 / FPS ? [] : [{ ...p, s, e: end, at: onCut(s, keep) - from }];
  });
  const { cam, camBox, main } = e.tracks;
  const faceSrc = cam && files.cam ? files.cam : camBox ? files.main : null;
  const show = (p: Piece): Show => (faceSrc ? p.show : "screen");
  const screen = inside.map((p, i) => {
    const half = show(p) === "corner";
    return video(`screen-${i + 1}`, files.main, p.s, p.e, p.at, {
      style: style([0, half ? 960 : 0, w, half ? 960 : h]),
    });
  });
  const crop = shortCrop(e.crops, n);
  const faceSize = cam ? cutSize(cam) : cutSize(main);
  const box =
    !cam && camBox
      ? (camBox.map((x) => Math.round((x * faceSize[0]) / main.width)) as [
          number,
          number,
          number,
          number,
        ])
      : null;
  const off = cam?.offsetS ?? 0;
  const face = faceSrc
    ? inside
        .filter((p) => show(p) !== "screen")
        .map((p, i) => {
          const fh = show(p) === "corner" ? 960 : h;
          const r = coverRect(faceSize, box, w, fh, crop);
          // The picture runs past the frame; the clip path keeps what the frame shows.
          const clip = `; clip-path: inset(${px(-r[1])} ${px(r[0] + r[2] - w)} ${px(r[1] + r[3] - fh)} ${px(-r[0])})`;
          return video(
            `face-${i + 1}`,
            faceSrc,
            p.s + (cam ? off : 0),
            p.e + (cam ? off : 0),
            p.at,
            {
              volume: "0",
              style: style(r, clip),
            },
          );
        })
    : [];
  const text = overlayClips(e.overlays ?? [], keep, w, h, { from, to }, `short-${n}-`);
  const card = cardOf(short, to - from);
  const pages: Film = { ...text.pages };
  const cardClip: string[] = [];
  if (card) {
    const file = `pages/short-${n}-card.html`;
    const len = card.holdS + card.fadeS;
    pages[file] = textPage(card.text, { durationS: len, size: 64, fadeS: card.fadeS });
    cardClip.push(
      `  <iframe ${attrs({ id: "card", title: card.text, src: `${file}#t=0,${t3(len)}`, at: "0", style: style([90, 300, 900, 240]) })}></iframe>`,
    );
  }
  const mine = isLocked(locked, `shorts.${n}`);
  return {
    "film.html": doc(w, h, [
      track([...cardClip, ...text.clips], {
        title: "text",
        locked: mine || isLocked(locked, "overlays"),
      }),
      track(face, { title: "face", locked: mine || isLocked(locked, "crops") }),
      track(screen, { title: "recording", locked: mine || isLocked(locked, "cuts") }),
      track(
        soundClips(
          e,
          "short",
          (t) => {
            const c = toCutTime(t, keep);
            return c === null || c < from ? null : c - from;
          },
          to - from,
          o.bedS,
        ),
        { title: "sound", locked: mine || isLocked(locked, "sounds", "music") },
      ),
    ]),
    ...pages,
    [files.main.replace(/\.[^.]+$/, ".vtt")]: wordsVtt(e),
  };
}

/** One change to the edit as a person reads it: who, when, and the film before and after. */
export interface FilmChange {
  run: string;
  command: string;
  by: string | null;
  at: string;
  fields: string[];
  /** A unified diff of each film it moved (long, short-N), film.html only. */
  diff: string;
}

/** Every film of an edit: the long video and each Short, film.html only. */
const filmsOf = (e: VideoEdit): Record<string, string> => ({
  long: longFilm(e)["film.html"] as string,
  ...Object.fromEntries(
    e.shorts.map((_, i) => [`short-${i + 1}`, shortFilm(e, i + 1)["film.html"] as string]),
  ),
});

/**
 * The edit's changes, newest first, as diffs of its films. Each `runs` row holds what its fields
 * were before (`setEdit`), so walking back from now gives each state with no other storage.
 */
export function filmHistory(
  now: VideoEdit,
  runs: readonly { run: string; command: string; by: string | null; at: string; before: object }[],
): FilmChange[] {
  let after = now;
  return runs.map((r) => {
    const { camBox, ...fields } = r.before as { camBox?: [number, number, number, number] | null };
    const before = { ...after, ...fields } as VideoEdit;
    if (camBox !== undefined) {
      const { camBox: _now, ...tracks } = after.tracks;
      before.tracks = camBox ? { ...tracks, camBox } : tracks;
    }
    const a = filmsOf(before);
    const b = filmsOf(after);
    const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .flatMap((k) =>
        a[k] === b[k]
          ? []
          : [
              createTwoFilesPatch(
                `a/${k}/film.html`,
                `b/${k}/film.html`,
                a[k] ?? "",
                b[k] ?? "",
                "",
                "",
                { context: 2 },
              ),
            ],
      )
      .join("");
    after = before;
    return {
      run: r.run,
      command: r.command,
      by: r.by,
      at: r.at,
      fields: Object.keys(r.before),
      diff,
    };
  });
}
