/**
 * Offer shapes from Orrery (WA-1160): the artifact's funnels and every money-model play
 * (`packages/ui/src/metro/money-models.ts`, sops/money-models), drawn by the Map's own parts.
 * Flat or Layers, as on the Map; in Layers a plate's own folds lift plates over it.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SELECT_CLASS, Seg } from "@wren/ui";
import {
  type LayerFloor,
  type LayerSplit,
  MetroLayers,
  MetroMap,
  type MetroView,
  viewZoom,
} from "@wren/ui/metro";
import { GROWTH_RETAINER, GYM_MODEL, MONEY_STAGES, SAMPLE_VIEWS } from "@wren/ui/metro/shapes";
import { useEffect, useMemo, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta: Meta = { title: "Wren/Map/Offer shapes", parameters: { layout: "fullscreen" } };
export default meta;

type Story = StoryObj;

type Play = { view: MetroView; note?: string };

type Look = "flat" | "layers";

/** One play at a time, full size: pick it, then Flat or Layers. */
function Board({
  goal,
  plays,
  start = "flat",
}: {
  goal: string;
  plays: readonly Play[];
  start?: Look;
}) {
  const [at, setAt] = useState(0);
  const [look, setLook] = useState<Look>(start);
  const [floor, setFloor] = useState<LayerFloor>(null);
  const [split, setSplit] = useState<LayerSplit>("folds");
  const [shut, setShut] = useState<string[]>([]);
  const [lift, setLift] = useState<string[]>([]);
  const play = plays[at] ?? plays[0];
  const zoom = useMemo(() => (play ? viewZoom(play.view) : null), [play]);
  // plate keys belong to one play
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new play clears them.
  useEffect(() => {
    setFloor(null);
    setShut([]);
    setLift([]);
  }, [at]);
  if (!play || !zoom) return null;
  return (
    <div className="flex h-dvh min-h-[560px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Play"
          className={`${SELECT_CLASS.replace("w-full", "w-auto")} max-w-full`}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
        >
          {plays.map((p, i) => (
            <option key={p.view.title ?? i} value={i}>
              {p.view.title ?? `Shape ${i + 1}`}
            </option>
          ))}
        </select>
        <Seg
          label="Look"
          dense
          items={[
            { value: "flat", label: "Flat" },
            { value: "layers", label: "Layers" },
          ]}
          value={look}
          onChange={setLook}
        />
      </header>
      <p className="m-0 max-w-prose text-sm text-(--ui-ink-2)">{play.note ?? goal}</p>
      <div className="relative min-h-0 flex-1">
        {look === "layers" ? (
          <MetroLayers
            zoom={zoom}
            floor={floor}
            onFloor={(f) => {
              setFloor(f);
              setShut([]);
              setLift([]);
            }}
            split={split}
            onSplit={(s) => {
              setSplit(s);
              setShut([]);
              setLift([]);
            }}
            shut={shut}
            onShut={setShut}
            lift={lift}
            onLift={setLift}
            className="h-full"
          />
        ) : (
          <MetroMap key={at} view={play.view} intro={false} className="metro-fill h-full" />
        )}
      </div>
    </div>
  );
}

/** Drawn flat, then as Layers, then flat again. */
const drawn: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const ui = within(canvasElement);
  const late = { timeout: 10_000 };
  await waitFor(
    () => expect(canvasElement.querySelector("svg[role='group']")).not.toBeNull(),
    late,
  );
  await userEvent.click(ui.getByRole("button", { name: "Layers" }));
  await waitFor(() => expect(canvasElement.querySelector(".mlay-floor")).not.toBeNull(), late);
  await userEvent.click(ui.getByRole("button", { name: "Flat" }));
  await waitFor(
    () => expect(canvasElement.querySelector("svg[role='group']")).not.toBeNull(),
    late,
  );
};

const stage = (title: string) => {
  const s = MONEY_STAGES.find((m) => m.title === title);
  if (!s) throw new Error(`no stage ${title}`);
  return s;
};

const stageStory = (title: string): Story => ({
  render: () => <Board goal={stage(title).goal} plays={stage(title).plays} />,
  play: drawn,
});

/** The artifact's funnels and the Growth Retainer loop. */
export const Funnels: Story = {
  render: () => (
    <Board
      goal="The design artifact's sample funnels, and a retainer that loops."
      plays={[...SAMPLE_VIEWS, GROWTH_RETAINER].map((view) => ({ view }))}
    />
  ),
  play: drawn,
};

export const Attraction = stageStory("Attraction");

export const Upsells = stageStory("Upsells");

export const Downsells = stageStory("Downsells");

export const Continuity = stageStory("Continuity");

/** The video's gym: a win-back challenge rolls into a membership, with a prepay upsell and a plan on a no. */
export const WholeModel: Story = {
  render: () => (
    <Board
      goal="Attraction pays for the ad. The win rolls into a membership. A no still ends on a plan."
      plays={[{ view: GYM_MODEL }]}
    />
  ),
  play: drawn,
};

/**
 * Nested plates (spec S8): a retainer's offer holds Onboarding and the Monthly lap. Each is a knob
 * on the offer's plate; a click lifts it one step over the offer, and its x shuts it.
 */
export const Nested: Story = {
  render: () => (
    <Board
      goal="A plate's own folds lift plates over it."
      plays={[{ view: GROWTH_RETAINER }]}
      start="layers"
    />
  ),
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    const late = { timeout: 10_000 };
    const knob = await ui.findByRole("button", { name: "Lift Monthly lap" }, late);
    await expect(knob).toHaveAttribute("aria-expanded", "false");
    await expect(knob.closest(".mlay-face")).not.toBeNull();
    // keys: the offer's face is not in hand, so focus the knob itself
    knob.focus();
    await userEvent.keyboard("{Enter}");
    const up = await ui.findByRole("button", { name: "Fold Monthly lap" }, late);
    await expect(up).toHaveAttribute("aria-expanded", "true");
    await expect(canvasElement.querySelector('.mlay-slot[data-part="node:loop"]')).not.toHaveClass(
      "shut",
    );
    // − shuts the deepest level first
    await userEvent.click(ui.getByRole("button", { name: "Shut one level" }));
    await waitFor(
      () => expect(ui.getByRole("button", { name: "Lift Monthly lap" })).toBeInTheDocument(),
      late,
    );
  },
};
