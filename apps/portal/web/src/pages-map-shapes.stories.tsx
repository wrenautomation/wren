/**
 * Offer shapes from Orrery (WA-1160): the artifact's funnels and every money-model play
 * (`packages/ui/src/metro/money-models.ts`, sops/money-models), drawn by the Map's own parts.
 * Flat or Layers, as on the Map; a plate's Open makes its part the main flat view.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, SELECT_CLASS, Seg } from "@wren/ui";
import {
  type FocusSpec,
  type LayerFloor,
  type LayerSplit,
  MetroLayers,
  MetroMap,
  type MetroView,
  partFocus,
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
function Board({ goal, plays }: { goal: string; plays: readonly Play[] }) {
  const [at, setAt] = useState(0);
  const [look, setLook] = useState<Look>("flat");
  const [floor, setFloor] = useState<LayerFloor>(null);
  const [split, setSplit] = useState<LayerSplit>("folds");
  const [shut, setShut] = useState<string[]>([]);
  const [open, setOpen] = useState<{ spec: FocusSpec; label: string } | null>(null);
  const play = plays[at] ?? plays[0];
  const zoom = useMemo(() => (play ? viewZoom(play.view) : null), [play]);
  // plate keys and focus belong to one play
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new play clears them.
  useEffect(() => {
    setFloor(null);
    setShut([]);
    setOpen(null);
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
          onChange={(l) => {
            setLook(l);
            setOpen(null);
          }}
        />
        {open && look === "flat" ? (
          <span className="flex items-center gap-1 text-[13.5px]">
            <Button tone="quiet" size="dense" icon="back" onClick={() => setLook("layers")}>
              Layers
            </Button>
            <span aria-hidden="true" className="text-(--ui-ink-3)">
              ›
            </span>
            <span className="font-semibold">{open.label}</span>
            <Button tone="quiet" size="dense" onClick={() => setOpen(null)}>
              Whole map
            </Button>
          </span>
        ) : null}
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
            }}
            onOpen={(p, label) =>
              partFocus(zoom, p).then((spec) => {
                setOpen({ spec, label });
                setLook("flat");
              })
            }
            split={split}
            onSplit={(s) => {
              setSplit(s);
              setShut([]);
            }}
            shut={shut}
            onShut={setShut}
            className="h-full"
          />
        ) : (
          <MetroMap
            key={at}
            view={play.view}
            focus={open?.spec ?? null}
            intro={false}
            className="metro-fill h-full"
          />
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
