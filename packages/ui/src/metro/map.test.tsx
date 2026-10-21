import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { landTimes, MetroSvg } from "./draw.js";
import { layoutMetro } from "./layout.js";
import { MetroMap } from "./map.js";
import {
  COLD_OUTBOUND_VIEW,
  INDUSTRIES,
  LOOP_SCENE,
  loopZoom,
  OFFERS_SCENE,
  protocolZoom,
  SAMPLE_VIEWS,
  SCENARIOS,
  WEBINAR_VIEW,
  ZOOM_SCENE,
  zoomScenario,
} from "./samples.js";

const names = (html: string) =>
  [...html.matchAll(/data-id="([^"]+)"[^>]*aria-label="([^"]*)"/g)].map((m) => [m[1], m[2]]);

describe("MetroSvg", () => {
  it("draws every scene in the artifact", () => {
    const scenes = [
      ZOOM_SCENE,
      OFFERS_SCENE,
      LOOP_SCENE,
      ...SCENARIOS.map((s) => s.scene),
      ...INDUSTRIES.map((s) => s.scene),
      ...SAMPLE_VIEWS.map(layoutMetro),
    ];
    for (const scene of scenes) {
      const html = renderToStaticMarkup(<MetroSvg scene={scene} />);
      expect(html.startsWith("<svg")).toBe(true);
      expect(html).toContain("<path");
    }
  });

  it("gives the SVG a name a screen reader can use", () => {
    const html = renderToStaticMarkup(<MetroSvg scene={layoutMetro(COLD_OUTBOUND_VIEW)} />);
    expect(html).toMatch(/<svg[^>]*(aria-label|role)=/);
  });

  it("uses tokens, never a fixed colour, in the markup", () => {
    for (const v of SAMPLE_VIEWS) {
      const html = renderToStaticMarkup(<MetroSvg scene={layoutMetro(v)} />);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
    }
  });

  it("marks a line on each part that belongs to it, so hover can light it", () => {
    const html = renderToStaticMarkup(
      <MetroSvg scene={layoutMetro(COLD_OUTBOUND_VIEW)} lit="gp" />,
    );
    expect(html).toContain('data-l="gp"');
    expect(html).toMatch(
      /class="[^"]*\bon\b[^"]*"[^>]*data-l="gp"|data-l="gp"[^>]*class="[^"]*\bon\b/,
    );
  });

  it("delays each station by its place in the first load, and not otherwise", () => {
    const scene = layoutMetro(COLD_OUTBOUND_VIEW);
    expect(renderToStaticMarkup(<MetroSvg scene={scene} />)).not.toContain("animation-delay");
    expect(renderToStaticMarkup(<MetroSvg scene={scene} intro />)).toContain("animation-delay");
  });
});

describe("landTimes", () => {
  const scene = (xs: number[]) => ({
    h: 100,
    st: xs.map((x, i) => ({ id: `s${i}`, t: "att" as const, x, y: 10 })),
    tr: [],
  });

  it("lands the first station at 0.5 s and then every 0.55 s", () => {
    const at = landTimes(scene([10, 20, 30]));
    expect(at(10)).toBeCloseTo(0.5);
    expect(at(20)).toBeCloseTo(1.05);
    expect(at(30)).toBeCloseTo(1.6);
  });

  it("lands stations in one column together", () => {
    const at = landTimes(scene([10, 10, 20]));
    expect(at(10)).toBeCloseTo(0.5);
    expect(at(20)).toBeCloseTo(1.05);
  });

  it("packs a long map so the last station lands as the line ends", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i * 50);
    const at = landTimes(scene(xs));
    expect(at(0)).toBeCloseTo(0.5);
    expect(at(950)).toBeLessThanOrEqual(2.5);
  });
});

describe("MetroMap", () => {
  it("opens at Parts and folds what the level folds", () => {
    const html = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} intro={false} />);
    expect(html).toContain('data-level="0"');
    expect(html).toContain("Parts:");
    expect(html).toContain("folded");
  });

  it("takes the level as a prop", () => {
    const html = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} level={2} intro={false} />);
    expect(html).toContain('data-level="2"');
    expect(html).toContain("Stations:");
    expect(html).not.toContain("folded");
  });

  it("draws the first load only when asked, once", () => {
    const on = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} />);
    const off = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} intro={false} />);
    expect(on).toMatch(/class="metro-host ld"/);
    expect(off).not.toMatch(/\bld\b/);
  });

  it("shows a button per level, the current one pressed", () => {
    const html = renderToStaticMarkup(<MetroMap zoom={protocolZoom()} level={1} intro={false} />);
    for (const n of ["Folded", "Groups", "All"]) expect(html).toContain(n);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("hides the bar when controls are off", () => {
    const html = renderToStaticMarkup(
      <MetroMap zoom={loopZoom()} controls={false} intro={false} />,
    );
    expect(html).not.toContain("metro-bar");
  });

  it("lays out a view and gives every station an accessible name", () => {
    for (const view of SAMPLE_VIEWS) {
      const html = renderToStaticMarkup(<MetroMap view={view} level={2} intro={false} />);
      const found = names(html);
      expect(found.length, view.title).toBeGreaterThan(0);
      for (const [id, label] of found) expect(label, `${view.title}: ${id}`).toBeTruthy();
    }
  });

  it("draws a focused part: its stations, stub buttons with a name, and no level buttons", () => {
    const html = renderToStaticMarkup(
      <MetroMap view={WEBINAR_VIEW} focus={{ kind: "flow", id: "Webinar funnel" }} intro={false} />,
    );
    expect(html).toContain('data-focus="flow:Webinar funnel"');
    expect(html).not.toContain("metro-levels");
    expect(html).toContain("from First touch");
    expect(html).toMatch(/data-stub="hub"[^>]*aria-label="from First touch"/);
    expect(html).toContain("Focus: Webinar funnel");
    expect(html).not.toContain('data-id="bk"');
  });
});
