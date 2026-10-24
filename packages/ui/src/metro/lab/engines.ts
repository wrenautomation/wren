/**
 * The layout lab's engine (designs/2026-10-23-metro-layout-lab.md): the map's one layout, ELK with
 * Brandes-Köpf (place.ts). The LP and today's row placer lost to it and are gone (10-23).
 */
import { layoutView, STEP } from "../place.js";
import type { MetroScene } from "../types.js";
import type { MetroView } from "../view.js";

export interface Engine {
  id: string;
  name: string;
  /** What it does, in one line. */
  note: string;
  /** `step`: the px between two x slots. */
  run: (view: MetroView, step?: number) => Promise<MetroScene>;
}

/** The step between two x slots, in px: the map's width. */
export const STEPS = [90, 105, 120, 150] as const;
export const DEFAULT_STEP = STEP;

export const ENGINES: Engine[] = [
  {
    id: "elk-bk",
    name: "ELK BK",
    note: "ELK's layers, even steps, ELK's Brandes-Köpf y",
    run: (v, step) => layoutView(v, step),
  },
];
