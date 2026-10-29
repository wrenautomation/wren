// @vitest-environment happy-dom

import { openSet } from "@wrenautomation/orrery";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { landTimes, MetroSvg } from "./draw.js";
import { viewZoom } from "./fold.js";
import { MetroMap } from "./map.js";
import { layoutView } from "./place.js";
import {
  COLD_OUTBOUND_VIEW,
  DIFF_VIEW,
  INDUSTRIES,
  loopZoom,
  OFFERS_SCENE,
  protocolZoom,
  SAMPLE_VIEWS,
  SCENARIOS,
  WEBINAR_VIEW,
  ZOOM_SCENE,
  zoomScenario,
} from "./samples.js";
import type { MetroView } from "./view.js";

/** Lay a view out at this depth ahead, so a render draws it at once (ELK is async). */
async function warm(view: MetroView, depth = 9) {
  const z = viewZoom(view);
  await z.scene(openSet(z.nodes, { depth, open: {} }));
}

const names = (html: string) =>
  [...html.matchAll(/data-id="([^"]+)"[^>]*aria-label="([^"]*)"/g)].map((m) => [m[1], m[2]]);

describe("MetroSvg", () => {
  it("draws every scene in the artifact", async () => {
    const scenes = [
      ZOOM_SCENE,
      OFFERS_SCENE,
      ...SCENARIOS.map((s) => s.scene),
      ...INDUSTRIES.map((s) => s.scene),
      ...(await Promise.all(SAMPLE_VIEWS.map((v) => layoutView(v)))),
    ];
    for (const scene of scenes) {
      const html = renderToStaticMarkup(<MetroSvg scene={scene} />);
      expect(html.startsWith("<svg")).toBe(true);
      expect(html).toContain("<path");
    }
  });

  it("gives the SVG a name a screen reader can use", async () => {
    const html = renderToStaticMarkup(<MetroSvg scene={await layoutView(COLD_OUTBOUND_VIEW)} />);
    expect(html).toMatch(/<svg[^>]*(aria-label|role)=/);
  });

  it("uses tokens, never a fixed colour, in the markup", async () => {
    for (const v of SAMPLE_VIEWS) {
      const html = renderToStaticMarkup(<MetroSvg scene={await layoutView(v)} />);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
    }
  });

  it("marks a line on each part that belongs to it, so hover can light it", async () => {
    const html = renderToStaticMarkup(
      <MetroSvg scene={await layoutView(COLD_OUTBOUND_VIEW)} lit="gp" />,
    );
    expect(html).toContain('data-l="gp"');
    expect(html).toMatch(
      /class="[^"]*\bon\b[^"]*"[^>]*data-l="gp"|data-l="gp"[^>]*class="[^"]*\bon\b/,
    );
  });

  it("delays each station by its place in the first load, and not otherwise", async () => {
    const scene = await layoutView(COLD_OUTBOUND_VIEW);
    expect(renderToStaticMarkup(<MetroSvg scene={scene} />)).not.toContain("animation-delay");
    expect(renderToStaticMarkup(<MetroSvg scene={scene} intro />)).toContain("animation-delay");
  });
});

describe("diff marks", () => {
  let html = "";
  beforeAll(async () => {
    await warm(DIFF_VIEW);
    await warm(DIFF_VIEW, 0);
    await warm(COLD_OUTBOUND_VIEW);
    html = renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={9} intro={false} />);
  });

  it("says each mark in the name of the station", () => {
    const found = Object.fromEntries(names(html).map(([id, label]) => [id, label]));
    expect(found.chk).toBe("Replied, 9, added");
    expect(found.bk).toBe("Call booked, 6, changed");
    expect(found.old).toMatch(/removed$/);
    expect(found.hub).toBe("First touch, 18 leads");
  });

  it("says each mark on a track: a named tag on a plain track, the pill on a person track", () => {
    expect(html).toContain('aria-label="Track from YouTube to First touch, changed"');
    expect(html).toContain('aria-label="Track from Replied to Call booked, added"');
    expect(html).toContain('aria-label="Track from Call booked to Dropped, removed"');
    expect(html).toContain('aria-label="Person task, WJ, 2d, removed"');
  });

  it("leaves the inline stroke off an added or changed track, so the mark colour shows", () => {
    expect(html).toMatch(/<path class="trk"[^>]*data-mark="added"[^>]*style="stroke-width:/);
    expect(html).toMatch(/<path class="trk"[^>]*data-mark="removed"[^>]*style="stroke:var\(--ui-/);
  });

  it("stops the dots on a removed track", async () => {
    const scene = await layoutView(DIFF_VIEW);
    const moving = renderToStaticMarkup(<MetroSvg scene={scene} />);
    const paths = [...moving.matchAll(/<animateMotion[^>]*path="([^"]*)"/g)].map((m) => m[1]);
    // The removed person track runs from Call booked to Growth Partner: its path has no dots.
    const bk = scene.st.find((m) => m.id === "bk");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p?.startsWith(`M${bk?.x} ${bk?.y}`))).toBe(false);
  });

  it("shows the legend only when the map has a mark", () => {
    expect(html).toContain("metro-legend");
    for (const w of ["Added", "Changed", "Removed"]) expect(html).toContain(w);
    const plain = renderToStaticMarkup(
      <MetroMap view={COLD_OUTBOUND_VIEW} depth={9} intro={false} />,
    );
    expect(plain).not.toContain("metro-legend");
  });

  it("puts the legend in the bar, or over the corner when the bar is off", () => {
    expect(html).toMatch(/metro-bar[\s\S]*metro-legend/);
    const bare = renderToStaticMarkup(
      <MetroMap view={DIFF_VIEW} depth={9} intro={false} controls={false} />,
    );
    expect(bare).toContain("metro-legend over");
    expect(bare).not.toContain("metro-bar");
  });

  it("shows a mark on a folded capsule", () => {
    const folded = renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={0} intro={false} />);
    expect(folded).toMatch(/class="cap[^"]*"[^>]*><g class="mk[^"]*" data-mark="added"/);
    expect(folded).toContain("metro-legend");
  });

  it("draws a fold stacked, with its kind's glyph and its steps in the sub line", () => {
    const folded = renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={0} intro={false} />);
    expect(folded).toMatch(/class="cap"[^>]*><g class="mk m-cash"[^>]*><rect class="stk"/);
    expect(folded).not.toContain('class="cnt"');
    expect(folded).toMatch(/class="sub"[^>]*><tspan class="num">2 steps</);
    expect(folded).not.toContain('class="fc"');
  });

  it("draws what a step does: its own glyph, and a fold wears its last step's", async () => {
    const view = {
      ...DIFF_VIEW,
      stations: DIFF_VIEW.stations.map((s) => ({ ...s, icon: "mail" as const })),
    };
    await warm(view);
    await warm(view, 0);
    expect(renderToStaticMarkup(<MetroMap view={view} depth={9} intro={false} />)).toContain(
      "lucide-mail",
    );
    expect(renderToStaticMarkup(<MetroMap view={view} depth={0} intro={false} />)).toContain(
      "lucide-mail",
    );
    expect(
      renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={0} intro={false} />),
    ).not.toContain("lucide-mail");
  });
});

describe("an empty column", () => {
  it("shows a planned stop to map, on the row through it", async () => {
    // This view names Delivery, and none of its stations is in it.
    expect(DIFF_VIEW.stations.some((s) => s.column === "Delivery")).toBe(false);
    await warm(DIFF_VIEW);
    const html = renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={9} intro={false} />);
    expect(html.match(/>To map<\/text>/g)).toHaveLength(1);
    // Without that column, nothing is left to map.
    const full = { ...DIFF_VIEW, columns: ["Marketing", "Sales", "Money"] };
    await warm(full);
    expect(renderToStaticMarkup(<MetroMap view={full} depth={9} intro={false} />)).not.toContain(
      ">To map</text>",
    );
  });
});

describe("the hub", () => {
  it("draws its count under its label", async () => {
    await warm(DIFF_VIEW);
    const html = renderToStaticMarkup(<MetroMap view={DIFF_VIEW} depth={9} intro={false} />);
    expect(html).toMatch(/class="lab"[^>]*>First touch<\/text><text class="sub"[^>]*>.*18 leads/);
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
  beforeAll(async () => {
    for (const v of SAMPLE_VIEWS) await warm(v);
    await warm(WEBINAR_VIEW);
  });

  it("opens folded, at depth 0", async () => {
    const z = zoomScenario();
    await z.scene(openSet(z.nodes, { depth: 0, open: {} }));
    const html = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} intro={false} />);
    expect(html).toContain('data-depth="0"');
    expect(html).toContain("folded");
  });

  it("takes the depth as a prop", () => {
    const html = renderToStaticMarkup(<MetroMap zoom={protocolZoom()} depth={2} intro={false} />);
    expect(html).toContain('data-depth="2"');
    expect(html).toContain("Depth 2 of 2");
    expect(html).not.toContain("folded");
  });

  it("draws the first load only when asked, once", () => {
    const on = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} />);
    const off = renderToStaticMarkup(<MetroMap zoom={zoomScenario()} intro={false} />);
    expect(on).toMatch(/class="metro-host ld"/);
    expect(off).not.toMatch(/\bld\b/);
  });

  it("steps the depth with two buttons, and shows no path that names only the map", () => {
    const html = renderToStaticMarkup(<MetroMap zoom={protocolZoom()} depth={1} intro={false} />);
    expect(html).toContain('aria-label="Fold one level"');
    expect(html).toContain('aria-label="Open one level"');
    // A node opened by hand puts the path back (the OpenWithEnter story checks it in the browser).
    expect(html).not.toContain('aria-label="Fold path"');
    expect(html).toContain("Depth 1 of 2");
  });

  it("draws the skeleton until the first layout is ready", () => {
    const fresh: MetroView = { ...COLD_OUTBOUND_VIEW, title: "Not laid out yet" };
    const html = renderToStaticMarkup(<MetroMap view={fresh} intro={false} />);
    expect(html).not.toContain('<svg class="mm');
  });

  it("hides the bar when controls are off", () => {
    const html = renderToStaticMarkup(
      <MetroMap zoom={loopZoom()} controls={false} intro={false} />,
    );
    expect(html).not.toContain("metro-bar");
  });

  it("lays out a view and gives every station an accessible name", () => {
    for (const view of SAMPLE_VIEWS) {
      const html = renderToStaticMarkup(<MetroMap view={view} depth={9} intro={false} />);
      const found = names(html);
      expect(found.length, view.title).toBeGreaterThan(0);
      for (const [id, label] of found) expect(label, `${view.title}: ${id}`).toBeTruthy();
    }
  });

  it("draws a focused part: its stations, stub buttons with a name, and no depth buttons", () => {
    const html = renderToStaticMarkup(
      <MetroMap view={WEBINAR_VIEW} focus={{ kind: "flow", id: "Webinar funnel" }} intro={false} />,
    );
    expect(html).toContain('data-focus="flow:Webinar funnel"');
    expect(html).not.toContain("metro-depth");
    expect(html).toContain("from First touch");
    expect(html).toMatch(/data-stub="hub"[^>]*aria-label="from First touch"/);
    expect(html).toContain("Focus: Webinar funnel");
    expect(html).not.toContain('data-id="bk"');
  });
});

describe("MetroMap first load", () => {
  const mount = async (node: React.ReactElement) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return { host, root };
  };

  it("plays on mount", async () => {
    await warm(WEBINAR_VIEW);
    const { host, root } = await mount(<MetroMap view={WEBINAR_VIEW} depth={9} />);
    expect(host.querySelector(".metro-host.ld")).not.toBeNull();
    expect(host.innerHTML).toContain("animation-delay");
    await act(async () => root.unmount());
    host.remove();
  });

  it("never plays again when the shape changes inside its window", async () => {
    const { host, root } = await mount(<MetroMap view={WEBINAR_VIEW} depth={9} />);
    expect(host.querySelector(".ld")).not.toBeNull();
    await act(async () =>
      root.render(
        <MetroMap view={WEBINAR_VIEW} depth={9} focus={{ kind: "flow", id: "Webinar funnel" }} />,
      ),
    );
    expect(host.querySelector(".ld")).toBeNull();
    expect(host.querySelector(".metro-host svg")?.getAttribute("class")).not.toContain("ld");
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("MetroMap scale and memo", () => {
  const mount = async (node: React.ReactElement) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return { host, root };
  };

  it("draws one scene px as one css px: the svg is as wide and as high as the scene", async () => {
    const s = await viewZoom(COLD_OUTBOUND_VIEW).scene(
      openSet(viewZoom(COLD_OUTBOUND_VIEW).nodes, { depth: 9, open: {} }),
    );
    const html = renderToStaticMarkup(
      <MetroMap view={COLD_OUTBOUND_VIEW} depth={9} intro={false} />,
    );
    const svg = html.match(/<svg[^>]*>/)?.[0] ?? "";
    expect(svg).toContain(`width="${s.w}"`);
    expect(svg).toContain(`height="${s.h}"`);
  });

  it("keeps a glyph table at the width it asks for", async () => {
    const s = await layoutView(COLD_OUTBOUND_VIEW);
    const html = renderToStaticMarkup(<MetroSvg scene={s} width={300} />);
    expect(html.match(/<svg[^>]*>/)?.[0]).toContain('width="300"');
  });

  it("lays the view out once per view, not once per render", async () => {
    let reads = 0;
    const counted: typeof COLD_OUTBOUND_VIEW = {
      ...COLD_OUTBOUND_VIEW,
      get stations() {
        reads++;
        return COLD_OUTBOUND_VIEW.stations;
      },
    };
    await warm(counted);
    const { host, root } = await mount(<MetroMap view={counted} depth={9} intro={false} />);
    const first = reads;
    expect(first).toBeGreaterThan(0);
    for (const lit of ["cold", "gp", null])
      await act(async () =>
        root.render(<MetroMap view={counted} depth={9} intro={false} lit={lit} selected="rep" />),
      );
    expect(reads).toBe(first);
    await act(async () => root.unmount());
    host.remove();
  });
});
