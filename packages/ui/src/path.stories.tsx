import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Path, type PathStep } from "./path.js";

export default { title: "Path" } satisfies Meta;

type Story = StoryObj;

/** One scripted run: what each step says at each tick. Synthetic. */
interface Script {
  title: string;
  summary: string;
  steps: { title: string; ticks: string[]; sources?: string[] }[];
}

const RESEARCH: Script = {
  title: "Research a person",
  summary: "Read 12 sources · 3.9 s",
  steps: [
    {
      title: "Searching",
      ticks: ["2 sources", "5 sources", "9 sources", "12 sources"],
      sources: ["reddit", "linkedin", "site", "youtube", "x", "podcast"],
    },
    {
      title: "Reading",
      ticks: ["3 of 12 · reddit.com", "8 of 12 · linkedin.com", "12 of 12 · site"],
    },
    { title: "Writing the brief", ticks: ["pulling quotes", "three themes", "done"] },
  ],
};

const SEND: Script = {
  title: "Send a reply",
  summary: "Sent · Reddit DM · 1.2 s",
  steps: [
    { title: "Checks", ticks: ["spam words", "links", "unsubscribe line", "all pass"] },
    { title: "Sending", ticks: ["from hello@ · Reddit DM"] },
    { title: "Delivered", ticks: ["1.2 s"] },
  ],
};

/** Walk a script: one tick every 700 ms; `run` again replays. */
function useRun(script: Script, again: number): PathStep[] {
  const total = script.steps.reduce((n, s) => n + s.ticks.length, 0);
  const [at, setAt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `again` restarts the run
  useEffect(() => {
    setAt(0);
    const id = setInterval(() => setAt((n) => (n >= total ? n : n + 1)), 700);
    return () => clearInterval(id);
  }, [again, total]);
  let left = at;
  return script.steps.map((s) => {
    const used = Math.min(left, s.ticks.length);
    left -= used;
    const state = used >= s.ticks.length ? "done" : used > 0 ? "run" : "wait";
    const detail = used > 0 ? s.ticks[used - 1] : undefined;
    const sources = s.sources?.slice(0, Math.ceil((used / s.ticks.length) * s.sources.length));
    return { title: s.title, state, detail, sources };
  });
}

function Run({ script }: { script: Script }) {
  const [again, setAgain] = useState(0);
  const steps = useRun(script, again);
  return (
    <div className="grid content-start gap-2">
      <Path title={script.title} steps={steps} summary={script.summary} />
      <button
        type="button"
        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-(--ui-link) underline"
        onClick={() => setAgain((n) => n + 1)}
      >
        Run again
      </button>
    </div>
  );
}

/** The wait says what it does and with what, then folds to one line that opens on a click. */
export const Steps: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-5">
      <Run script={RESEARCH} />
      <Run script={SEND} />
    </div>
  ),
};

/** Already whole when it shows: it starts folded. */
export const Folded: Story = {
  render: () => (
    <Path
      title="Open the map"
      summary="Loaded · 4 lines, 18 stations"
      steps={[
        { title: "Loading the shape", state: "done", detail: "4 lines" },
        { title: "Placing stations", state: "done", detail: "18 of 18" },
      ]}
    />
  ),
};
