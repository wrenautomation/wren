/**
 * Money models (sops/money-models): every play from the $100M Money Models video as a metro map,
 * one story per stage and one for the whole model. Data in `money-models.ts`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { MetroMap } from "./map.js";
import { GYM_MODEL, MONEY_STAGES, type MoneyStage } from "./money-models.js";

export default { title: "Metro/Money models", parameters: { layout: "padded" } } satisfies Meta;

type Story = StoryObj;

const head = "m-0 mb-2 text-sm font-semibold";
const note = "m-0 mb-3 max-w-prose text-sm text-[var(--ui-ink-2)]";
/** All open: a play is small. */
const OPEN = 9;

function Stage({ stage }: { stage: MoneyStage }) {
  return (
    <div className="grid gap-8">
      <p className={note}>{stage.goal}</p>
      {stage.plays.map((p) => (
        <section key={p.view.title}>
          <h2 className={head}>{p.view.title}</h2>
          <p className={note}>{p.note}</p>
          <MetroMap view={p.view} depth={OPEN} controls={false} intro={false} />
        </section>
      ))}
    </div>
  );
}

const stageOf = (title: string): MoneyStage => {
  const s = MONEY_STAGES.find((m) => m.title === title);
  if (!s) throw new Error(`no stage ${title}`);
  return s;
};

/** Every play's heading shows, and each lays out (no skeleton left). */
const drawn =
  (title: string): NonNullable<Story["play"]> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const p of stageOf(title).plays)
      await canvas.findByRole("heading", { name: p.view.title ?? "" });
    await waitFor(() => expect(canvasElement.querySelector(".metro-skeleton")).toBeNull(), {
      timeout: 10_000,
    });
  };

export const Attraction: Story = {
  render: () => <Stage stage={stageOf("Attraction")} />,
  play: drawn("Attraction"),
};
export const Upsells: Story = {
  render: () => <Stage stage={stageOf("Upsells")} />,
  play: drawn("Upsells"),
};
export const Downsells: Story = {
  render: () => <Stage stage={stageOf("Downsells")} />,
  play: drawn("Downsells"),
};
export const Continuity: Story = {
  render: () => <Stage stage={stageOf("Continuity")} />,
  play: drawn("Continuity"),
};

/** The video's gym: a win-back challenge rolls into a membership, with a prepay upsell and a plan on a no. */
export const WholeModel: Story = {
  render: () => (
    <section className="grid gap-8">
      <p className={note}>
        Attraction pays for the ad. The win rolls into a membership. A no still ends on a plan.
      </p>
      <MetroMap view={GYM_MODEL} depth={OPEN} controls={false} intro={false} />
    </section>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector(".metro-skeleton")).toBeNull(), {
      timeout: 10_000,
    });
  },
};
