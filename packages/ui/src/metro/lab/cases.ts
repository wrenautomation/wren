/**
 * The lab's cases: each a view, with the hand-placed scene when the artifact draws one. Station ids
 * match, so the score can pair stations. Generated funnels have no hand scene; they test size.
 */
import { INDUSTRIES, OFFERS_SCENE, SCENARIOS, ZOOM_SCENE } from "../data.js";
import { SAMPLE_VIEWS } from "../samples.js";
import type { MetroScene } from "../types.js";
import type { MetroView } from "../view.js";
import { funnel } from "./generate.js";
import { sceneToView } from "./to-view.js";

export interface LabCase {
  id: string;
  title: string;
  group: "scenario" | "industry" | "map" | "generated";
  view: MetroView;
  hand?: MetroScene;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const LAB_CASES: LabCase[] = [
  ...SCENARIOS.map((s, i) => ({
    id: `scenario-${slug(s.title)}`,
    title: s.title,
    group: "scenario" as const,
    view: SAMPLE_VIEWS[i] ?? sceneToView(s.scene, s.title),
    hand: s.scene,
  })),
  ...INDUSTRIES.map((s) => ({
    id: `industry-${slug(s.tab)}`,
    title: s.title,
    group: "industry" as const,
    view: sceneToView(s.scene, s.title),
    hand: s.scene,
  })),
  ...[OFFERS_SCENE, ZOOM_SCENE].map((s) => ({
    id: `map-${slug(s.title ?? "map")}`,
    title: s.title ?? "Map",
    group: "map" as const,
    view: sceneToView(s),
    hand: s,
  })),
  ...[12, 24, 40, 64].map((n) => ({
    id: `generated-${n}`,
    title: `Generated funnel, ${n} stations`,
    group: "generated" as const,
    view: funnel(n, n),
  })),
  // Loops, a retainer lap and one post on each platform: the shapes a business map really has.
  ...[24, 40, 64].map((n) => {
    const view = funnel(n, n, { loops: true, retainer: true, platforms: 5 });
    return {
      id: `generated-${n}-shaped`,
      title: view.title ?? `Generated funnel, ${n} stations`,
      group: "generated" as const,
      view,
    };
  }),
];
