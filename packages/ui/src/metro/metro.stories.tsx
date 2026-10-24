import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FactsTable } from "../table.js";
import { MetroSvg } from "./draw.js";
import type { FocusSpec } from "./focus.js";
import type { MetroZoom } from "./fold.js";
import { MetroMap, type MetroPick } from "./map.js";
import { layoutView } from "./place.js";
import {
  COLD_OUTBOUND_VIEW,
  DIFF_VIEW,
  DOWNSELL_VIEW,
  type GlyphRow,
  INDUSTRIES,
  LADDER_VIEW,
  LATE_VIEW,
  LINE_GLYPHS,
  LOGIC_GLYPHS,
  loopZoom,
  OFFERS_SCENE,
  PLANNED_VIEW,
  protocolZoom,
  REFERRAL_VIEW,
  SAMPLE_VIEWS,
  SCENARIOS,
  STATION_GLYPHS,
  TRACK_GLYPHS,
  TWINS_VIEW,
  WEBINAR_VIEW,
  zoomScenario,
} from "./samples.js";
import { fullDepth } from "./tree.js";
import type { MetroPart, MetroScene } from "./types.js";

export default { title: "Metro", parameters: { layout: "padded" } } satisfies Meta;

type Story = StoryObj;

const stack = "grid gap-8";

/** The number in the count line: "Depth 1 of 2: 12 marks, 3 folded of 27." */
const marksIn = (root: HTMLElement) =>
  Number(/(\d+)\s*marks/.exec(root.querySelector(".metro-count")?.textContent ?? "")?.[1] ?? 0);
/** A view lays out async: wait until the skeleton gives way to the map. */
const drawn = (root: HTMLElement) =>
  waitFor(() => expect(root.querySelector(".metro-skeleton")).toBeNull());
const head = "m-0 mb-2 text-sm font-semibold";
const note = "m-0 mb-3 max-w-prose text-sm text-[var(--ui-ink-2)]";
/** A cut under every node: all open but the side-by-side folds. */
const OPEN = 9;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={head}>{title}</h2>
      {children}
    </section>
  );
}

/** A glyph table (sections 04 and 09): one cell per mark, with what it says and how it works. */
function GlyphTable({ rows }: { rows: GlyphRow[] }) {
  return (
    <FactsTable
      head={["Mark", "What it says", "How it works"]}
      rows={rows.map((r) => [
        <div key="mark" className="w-[88px]">
          <MetroSvg scene={r.scene} bare still width={88} />
          <div className="font-medium">{r.name}</div>
        </div>,
        <div key="what">
          {r.what}
          {r.example ? <div className="text-[var(--ui-ink-3)]">{r.example}</div> : null}
        </div>,
        <span key="how" className="text-[var(--ui-ink-2)]">
          {r.how}
        </span>,
      ])}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Sections 04 and 09: the marks.

/** Section 04: lines and weights. */
export const LineGlyphs: Story = { render: () => <GlyphTable rows={LINE_GLYPHS} /> };

/** Section 04: stations and capsules. */
export const StationGlyphs: Story = { render: () => <GlyphTable rows={STATION_GLYPHS} /> };

/** Section 04: tracks, transfers, person pills, chips. */
export const TrackGlyphs: Story = { render: () => <GlyphTable rows={TRACK_GLYPHS} /> };

/** Section 09: condition, race, split and join gates, A/B ring, approval, shared flow, interrupt. */
export const LogicGlyphs: Story = { render: () => <GlyphTable rows={LOGIC_GLYPHS} /> };

// ---------------------------------------------------------------------------------------------
// Section 05: zoom.

/** Section 05: the fold depth buttons and the path. */
export const Zoom: Story = {
  render: () => <MetroMap zoom={zoomScenario()} intro={false} />,
};

/** Each depth on its own, from one circle per node to every station. */
function Depths({ make }: { make: () => MetroZoom }) {
  const full = fullDepth(make().nodes);
  return (
    <div className={stack}>
      {Array.from({ length: full + 1 }, (_, d) => `Depth ${d} of ${full}`).map((title, d) => (
        <Section key={title} title={title}>
          <MetroMap zoom={make()} depth={d} controls={false} intro={false} />
        </Section>
      ))}
    </div>
  );
}

export const ZoomDepths: Story = { render: () => <Depths make={zoomScenario} /> };

/** Hover a station: its line stays lit and the rest fade. Enter on a capsule opens it. */
export const ZoomPlay: Story = {
  render: () => <MetroMap zoom={zoomScenario()} intro={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const svg = canvasElement.querySelector("svg.mm");
    expect(svg).not.toBeNull();
    const line = canvasElement.querySelector<SVGElement>("[data-id][data-l], [data-l]");
    if (!line) throw new Error("no line to light");
    await userEvent.hover(line);
    await waitFor(() => expect(svg?.classList.contains("focus")).toBe(true));
    await userEvent.unhover(line);
    await waitFor(() => expect(svg?.classList.contains("focus")).toBe(false));

    // One level deeper shows more.
    const before = marksIn(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open one level" }));
    await waitFor(() => expect(marksIn(canvasElement)).toBeGreaterThan(before));
    await expect(canvas.getByText(/^Depth 1 of/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Fold one level" }));
    await waitFor(() => expect(marksIn(canvasElement)).toBe(before));
  },
};

/** Enter on a folded capsule opens it, and the map calls `onPick` with the group. */
export const OpenWithEnter: Story = {
  render: function Render() {
    const [picked, setPicked] = useState<MetroPick | null>(null);
    return (
      <MetroMap zoom={zoomScenario()} intro={false} onPick={setPicked}>
        <output className="text-sm text-[var(--ui-ink-2)]">
          {picked ? `Picked ${picked.kind} ${picked.id}` : "Nothing picked"}
        </output>
      </MetroMap>
    );
  },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const caps = canvasElement.querySelectorAll<SVGElement>("[data-grp]");
    expect(caps.length).toBeGreaterThan(0);
    const before = marksIn(canvasElement);
    const first = caps[0] as SVGElement;
    // SVG units: the map may scale when it grows. The expand leaf sits under the circle.
    const was = (first.querySelector(".fc .rest .lf") as SVGGraphicsElement).getBBox();
    first.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(marksIn(canvasElement)).toBeGreaterThan(before));
    await expect(canvas.getByText(/^Picked group/)).toBeVisible();
    // A hand change over the cut reads as a mix, and the path names the node.
    await expect(canvas.getByText(/^Mixed/)).toBeVisible();
    expect(canvasElement.querySelector(".metro-path [aria-current]")).not.toBeNull();
    // A node in one column opens to a box: the fold leaf sits on the box's top edge, over the
    // column the circle stood in.
    const knob = await canvas.findByRole("button", { name: /^Fold (?!one level)/ });
    const k = (knob.querySelector(".lf") as SVGGraphicsElement).getBBox();
    expect(k.y + k.height / 2).toBeLessThan(was.y + was.height / 2);
    expect(Math.abs(k.x + k.width / 2 - (was.x + was.width / 2))).toBeLessThan(k.width / 2);
    await userEvent.click(knob);
    await waitFor(() => expect(marksIn(canvasElement)).toBe(before));
    expect(canvas.queryByRole("button", { name: /^Fold (?!one level)/ })).toBeNull();
  },
};

/**
 * One post on five platforms folds into one stacked station with the people added up. TikTok does
 * badly, so it stays out. Click the fold to show each platform; the fold tab folds them back.
 */
export const SideBySide: Story = {
  render: () => <MetroMap view={TWINS_VIEW} depth={OPEN} intro={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    expect(canvas.queryByText("Post · LinkedIn")).toBeNull();
    await expect(canvas.getByText("Post · TikTok")).toBeVisible();
    const fold = canvasElement.querySelector<SVGElement>('[data-grp="tpl:post@so@Marketing"]');
    if (!fold) throw new Error("no side-by-side fold");
    expect(fold.querySelector(".stk")).not.toBeNull();
    await userEvent.click(fold);
    // The new stations fade in.
    await waitFor(() => expect(canvas.getByText("Post · LinkedIn")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: /^Fold Post/ }));
    await waitFor(() => expect(canvas.queryByText("Post · LinkedIn")).toBeNull());
  },
};

// ---------------------------------------------------------------------------------------------
// Section 06: seven businesses.

const Scenarios = () => (
  <div className={stack}>
    {SCENARIOS.map((s) => (
      <Section key={s.title} title={s.title}>
        <p className={note}>{s.biz}</p>
        <MetroMap scene={s.scene} depth={OPEN} controls={false} intro={false} />
      </Section>
    ))}
  </div>
);

/** Section 06: the seven scenarios, drawn from hand-built scenes. */
export const Scenarios06: Story = { name: "Seven scenarios", render: () => <Scenarios /> };

/** Section 06 again, from plain `MetroView` data through `layoutView`. No coordinates. */
export const ScenariosFromViews: Story = {
  render: () => (
    <div className={stack}>
      {SAMPLE_VIEWS.map((v) => (
        <Section key={v.title ?? ""} title={v.title ?? ""}>
          <MetroMap view={v} depth={OPEN} controls={false} intro={false} />
        </Section>
      ))}
    </div>
  ),
};

/** The views one by one, as the layout places them. */
export const ColdOutbound: Story = {
  render: () => <MetroMap view={COLD_OUTBOUND_VIEW} depth={OPEN} intro={false} />,
};
export const PaidWebinar: Story = {
  render: () => <MetroMap view={WEBINAR_VIEW} depth={OPEN} intro={false} />,
};
export const ValueLadder: Story = {
  render: () => <MetroMap view={LADDER_VIEW} depth={OPEN} intro={false} />,
};
export const Downsell: Story = {
  render: () => <MetroMap view={DOWNSELL_VIEW} depth={OPEN} intro={false} />,
};
export const Referral: Story = {
  render: () => <MetroMap view={REFERRAL_VIEW} depth={OPEN} intro={false} />,
};
/** A person track past its promise rings amber. */
export const LateTrack: Story = {
  render: () => <MetroMap view={LATE_VIEW} depth={OPEN} intro={false} />,
};
export const PlannedOffer: Story = {
  render: () => <MetroMap view={PLANNED_VIEW} depth={OPEN} intro={false} />,
};

/** The layout is pure data in, a scene out: this draws it with no map around it. */
export const LayoutOnly: Story = {
  loaders: [async () => ({ scene: await layoutView(COLD_OUTBOUND_VIEW) })],
  render: (_, { loaded }) => <MetroSvg scene={loaded.scene as MetroScene} still />,
};

// ---------------------------------------------------------------------------------------------
// Section 08: offers map and loop ring.

/** Section 08: three offers, plans and a bundle. Every mark takes a click. */
export const Offers: Story = {
  render: () => <MetroMap scene={OFFERS_SCENE} intro={false} />,
};

/** Section 08: the retainer loop ring at each depth: the offer as one circle, its parts, every station. */
export const LoopRing: Story = { render: () => <Depths make={loopZoom} /> };

/** The loop with its depth buttons: open the offer, then its parts, then fold it back to one circle. */
export const LoopRingZoom: Story = {
  render: () => <MetroMap zoom={loopZoom()} intro={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const shut = marksIn(canvasElement);
    const open = canvas.getByRole("button", { name: "Open one level" });
    await userEvent.click(open);
    await waitFor(() => expect(marksIn(canvasElement)).toBeGreaterThan(shut));
    await userEvent.click(open);
    await waitFor(() => expect(canvas.getByText(/^Depth 2 of 2/)).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(marksIn(canvasElement)).toBe(shut));
  },
};

// ---------------------------------------------------------------------------------------------
// Section 09: logic marks.

/** Section 09 hero: one sales protocol, every node open. */
export const Protocol: Story = {
  render: () => <MetroMap zoom={protocolZoom()} defaultDepth={OPEN} intro={false} />,
};

/** The protocol at each depth. */
export const ProtocolDepths: Story = { render: () => <Depths make={protocolZoom} /> };

/** One level deeper opens the protocol's nodes. */
export const ProtocolOpen: Story = {
  render: () => <MetroMap zoom={protocolZoom()} intro={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const before = marksIn(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open one level" }));
    await waitFor(() => expect(marksIn(canvasElement)).toBeGreaterThan(before));
  },
};

/** Six businesses, each with the logic marks it uses (LX). */
export const Industries: Story = {
  render: () => (
    <div className={stack}>
      {INDUSTRIES.map((s) => (
        <Section key={s.tab} title={s.title}>
          <p className={note}>
            {s.biz} Uses: {s.uses.join(", ")}.
          </p>
          <MetroMap scene={s.scene} depth={OPEN} controls={false} intro={false} />
        </Section>
      ))}
    </div>
  ),
};

// ---------------------------------------------------------------------------------------------
// Night, and the first load.

/** Night: every token flips, no mark has a colour of its own. */
export const Night: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div className={stack}>
      <MetroMap zoom={protocolZoom()} defaultDepth={OPEN} intro={false} />
      <MetroMap view={LATE_VIEW} depth={OPEN} intro={false} />
      <MetroMap scene={OFFERS_SCENE} intro={false} />
    </div>
  ),
};

/** Night glyphs. */
export const NightGlyphs: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div className={stack}>
      <GlyphTable rows={STATION_GLYPHS} />
      <GlyphTable rows={LOGIC_GLYPHS} />
    </div>
  ),
};

/** The first load: lines draw, stations land, labels fade, numbers fade in last. Once, on mount. */
export const FirstLoad: Story = {
  render: () => <MetroMap view={COLD_OUTBOUND_VIEW} depth={OPEN} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    // Tests run with reduced motion; the class is still on for the first moments.
    expect(canvasElement.querySelector(".metro-host")).not.toBeNull();
    expect(canvasElement.querySelectorAll("[data-id]").length).toBeGreaterThan(0);
  },
};

// ---------------------------------------------------------------------------------------------
// Focus: one part of the map, with faded stubs to where its tracks come from and go to.

const stubNote = "Stubs are faded. Click one to go to the part on its far side.";

function Focused({ focus, view }: { focus: FocusSpec; view?: typeof WEBINAR_VIEW }) {
  const [now, setNow] = useState<FocusSpec>(focus);
  const [last, setLast] = useState<MetroPart | null>(null);
  return (
    <MetroMap
      {...(view ? { view } : { zoom: zoomScenario() })}
      focus={now}
      intro={false}
      onStub={(p) => {
        setLast(p);
        setNow(p);
      }}
    >
      <output className="text-sm text-[var(--ui-ink-2)]">
        {stubNote} {last ? `Went to ${last.kind} ${last.id}.` : ""}
      </output>
    </MetroMap>
  );
}

/** A line alone: Growth Partner. */
export const FocusLine: Story = {
  render: () => <Focused focus={{ kind: "line", id: "gp" }} />,
};

/** A group alone: Reddit. */
export const FocusGroup: Story = {
  render: () => <Focused focus={{ kind: "group", id: "rd" }} />,
};

/** One station and the tracks in and out of it. */
export const FocusStation: Story = {
  render: () => <Focused focus={{ kind: "station", id: "bk" }} />,
};

/** A flow alone: the webinar funnel, from a view. */
export const FocusFlow: Story = {
  render: () => <Focused focus={{ kind: "flow", id: "Webinar funnel" }} view={WEBINAR_VIEW} />,
};

/** A click on a stub focuses the part on its far side. */
export const FocusStubPlay: Story = {
  render: () => <Focused focus={{ kind: "line", id: "gp" }} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const stub = canvas.getByRole("button", { name: "from First touch" });
    await userEvent.click(stub);
    await waitFor(() =>
      expect(canvasElement.querySelector("[data-focus]")?.getAttribute("data-focus")).toBe(
        "station:hub",
      ),
    );
    await expect(canvas.getByText(/Went to station hub/)).toBeVisible();
  },
};

// ---------------------------------------------------------------------------------------------
// Diff marks, hub count and track ids.

/** One of each mark on stations, tracks and a whole line, with the legend in the controls corner. */
export const DiffMarks: Story = {
  name: "Diff marks",
  render: () => <MetroMap view={DIFF_VIEW} depth={OPEN} intro={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    // Stations: the mark is in the name.
    await expect(canvas.getByRole("button", { name: /^Replied.*, added$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Call booked.*, changed$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Dropped, removed$/ })).toBeVisible();
    // The whole line: its own stations carry the mark.
    await expect(canvas.getByRole("button", { name: /^Visited lander.*, added$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Webinar ticket.*, added$/ })).toBeVisible();
    // Tracks: a named tag, or the pill's own name.
    await expect(
      canvas.getByRole("img", { name: "Track from YouTube to First touch, changed" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Track from Replied to Call booked, added" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Track from Call booked to Dropped, removed" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Person task, WJ, 2d, removed" }),
    ).toBeVisible();
    // The legend names the three marks.
    const legend = canvas.getByRole("list", { name: "Diff marks" });
    await expect(within(legend).getAllByRole("listitem")).toHaveLength(3);
    // A removed mark stays clickable.
    await userEvent.click(canvas.getByRole("button", { name: /^Dropped, removed$/ }));
  },
};

/** The hub draws its count under its label. */
export const HubCount: Story = {
  name: "Hub count",
  render: () => <MetroMap view={DIFF_VIEW} depth={OPEN} intro={false} controls={false} />,
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "First touch, 18 leads" })).toBeVisible();
    await expect(canvas.getByText("18 leads")).toBeVisible();
    // The legend still shows over the corner when the bar is off.
    await expect(canvas.getByRole("list", { name: "Diff marks" })).toBeVisible();
  },
};

/** A click on a track answers the track's own id. */
export const PickedTrackId: Story = {
  name: "Picked track id",
  render: function Render() {
    const [picked, setPicked] = useState<MetroPick | null>(null);
    return (
      <MetroMap view={DIFF_VIEW} depth={OPEN} intro={false} onPick={setPicked}>
        <output className="text-sm text-[var(--ui-ink-2)]">
          {picked ? `Picked ${picked.kind} ${picked.id}` : "Nothing picked"}
        </output>
      </MetroMap>
    );
  },
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
    const canvas = within(canvasElement);
    const hit = canvasElement.querySelector<SVGElement>('[data-tr="t-chk-bk"]');
    if (!hit) throw new Error("no track t-chk-bk");
    await userEvent.click(hit);
    await waitFor(() => expect(canvas.getByText("Picked track t-chk-bk")).toBeVisible());
    // A pill track answers its id too.
    await userEvent.click(canvas.getByRole("button", { name: "Person task, WJ, 2d, removed" }));
    await waitFor(() => expect(canvas.getByText("Picked track t-bk-pay")).toBeVisible());
  },
};
