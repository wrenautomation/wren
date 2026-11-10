/// <reference types="vite/client" />
/**
 * The Finish preview's picture: the render's own composition over the raw recording
 * (`@wren/starling-studio/props`, `RawFiles`), built from what the page has. A changed cut, crop,
 * caption or text shows at once, as the export draws it.
 */
import { COMPOSITIONS } from "@wren/starling-studio/compositions";
import type { Point } from "@wren/starling-studio/finish";
import {
  type EditPicture,
  framedProps,
  longProps,
  type RawFiles,
} from "@wren/starling-studio/props";
import type { FinishData, FinishEdit, Format, Word } from "./finish-data.js";

/** The names the compositions know the raw recording's two files by. */
export const RAW: RawFiles = { main: "recording", cam: "camera" };

// The kit's effects, served with the app (656 KB in all; a take loads when its sound first plays).
const TAKES = import.meta.glob<string>("../../../../../../packages/starling/studio/sfx/fx/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const KIT = new Map(
  Object.entries(TAKES).map(([path, url]) => [`sfx/${path.split("/sfx/")[1]}`, url]),
);

/** A file a composition names to its link; "" when the page has none (it then stays silent). */
export const previewUrl = (
  file: string,
  links: { main: string | null; cam: string | null; bed: string | null },
): string =>
  file === RAW.main
    ? (links.main ?? "")
    : file === RAW.cam
      ? (links.cam ?? "")
      : (KIT.get(file) ?? (file.startsWith("sfx/bed-") ? (links.bed ?? "") : ""));

type Drawn = {
  // biome-ignore lint/suspicious/noExplicitAny: the props are the named composition's, built beside it
  composition: { component: any; config: (typeof COMPOSITIONS)["Long"]["config"]; metadata?: any };
  props: unknown;
};

/** The composition and its props for one shape; `centre`: where a cropped shape's window sits. */
export function previewOf(
  data: FinishData,
  draw: FinishEdit,
  words: readonly Word[],
  view: Format,
  centre: Point | null,
): Drawn {
  const track = ([width, height]: [number, number]) => ({
    path: "",
    durationS: data.durationS,
    width,
    height,
    fps: data.fps,
  });
  const edit: EditPicture = {
    id: 0,
    tracks: {
      main: track(data.size),
      ...(data.camSize ? { cam: { ...track(data.camSize), offsetS: 0 } } : {}),
      ...(data.camBox ? { camBox: data.camBox } : {}),
    },
    files: {},
    cuts: draw.cuts,
    words: words.map(({ w, s, e }) => ({ w, s, e })),
    stress: words.flatMap((w, i) => (w.stress ? [i] : [])),
    layout: data.layout ?? [],
    captions: draw.captions,
    overlays: draw.overlays,
    sounds: data.sounds ?? [],
    music: data.music ?? null,
    crops: view !== "long" && centre ? { ...draw.crops, [view]: centre } : draw.crops,
  };
  return view === "long"
    ? { composition: COMPOSITIONS.Long, props: longProps(edit, [], { raw: RAW }) }
    : { composition: COMPOSITIONS.Framed, props: framedProps(edit, view, [], { raw: RAW }) };
}
