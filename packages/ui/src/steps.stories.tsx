import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { type JobStep, Steps } from "./steps.js";

export default { title: "Steps" } satisfies Meta;

type Story = StoryObj;

/** A scripted job: each step has its status lines, its cards, and how long it runs. */
interface Script {
  title: string;
  summary: string;
  steps: {
    title: string;
    lines: string[];
    ms: number;
    cards?: { key: string; label: string; mark: string }[];
    count?: string;
  }[];
}

const RESEARCH: Script = {
  title: "Research a person",
  summary: "Read 6 sources · 7.2 s",
  steps: [
    {
      title: "Searching",
      lines: ["forum, profile", "4 sources, 2 more coming", "6 sources"],
      ms: 2600,
      cards: [
        { key: "f", label: "forum.example", mark: "F" },
        { key: "p", label: "profile.example", mark: "in" },
        { key: "s", label: "site", mark: "w" },
        { key: "v", label: "video.example", mark: "▶" },
        { key: "x", label: "posts.example", mark: "X" },
        { key: "c", label: "podcast", mark: "P" },
      ],
      count: "6 sources",
    },
    {
      title: "Reading",
      lines: ["forum.example · 3 threads", "profile.example · 4 posts", "6 of 6"],
      ms: 2800,
    },
    { title: "Writing the brief", lines: ["pulling quotes", "three themes", "done"], ms: 1800 },
  ],
};

const VIDEO: Script = {
  title: "Publish a video",
  summary: "Posted to 3 platforms · 6.2 s",
  steps: [
    { title: "Render", lines: ["1080p · 2:14", "encoding", "done"], ms: 2200 },
    {
      title: "Upload",
      lines: ["YouTube", "LinkedIn", "X", "3 of 3"],
      ms: 3000,
      cards: [
        { key: "y", label: "YouTube", mark: "▶" },
        { key: "l", label: "LinkedIn", mark: "in" },
        { key: "x", label: "X", mark: "X" },
      ],
      count: "3 platforms",
    },
    { title: "Post rows", lines: ["3 posts", "written"], ms: 1000 },
  ],
};

/** Plays a script against the clock, as a caller would pass a job's state. */
function useScript(script: Script, again: number): JobStep[] {
  const [ms, setMs] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `again` restarts the run
  useEffect(() => {
    const t0 = Date.now();
    setMs(0);
    const id = setInterval(() => setMs(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [again]);
  let start = 0;
  return script.steps.map((s) => {
    const k = Math.min(1, Math.max(0, (ms - start) / s.ms));
    start += s.ms;
    const state = k >= 1 ? "done" : k > 0 ? "run" : "wait";
    const line = s.lines[Math.min(s.lines.length - 1, Math.floor(k * s.lines.length))];
    const cards = s.cards?.slice(0, Math.ceil((k / 0.7) * s.cards.length));
    return { title: s.title, state, detail: line, cards, count: s.count };
  });
}

function Run({ script }: { script: Script }) {
  const [again, setAgain] = useState(0);
  const steps = useScript(script, again);
  return (
    <div className="grid content-start gap-2">
      <Steps title={script.title} steps={steps} summary={script.summary} />
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

/** Cards fold in, stack when the step is done, and the whole job folds to a record. */
export const LongJob: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-6">
      <Run script={RESEARCH} />
      <Run script={VIDEO} />
    </div>
  ),
};

/** Past ten seconds: the clock and "you can leave". */
export const Leave: Story = {
  render: () => (
    <Steps
      title="Import contacts"
      startedAt={Date.now() - 14_000}
      steps={[
        { title: "Reading the file", state: "done", detail: "1 file" },
        { title: "Matching people", state: "run", detail: "rows 400 to 600" },
        { title: "Writing", state: "wait" },
      ]}
    />
  ),
};

/** Already whole when it shows: it starts folded. */
export const Folded: Story = {
  render: () => (
    <Steps
      title="Open the map"
      summary="Loaded · 4 lines, 18 stations"
      steps={[
        { title: "Loading the shape", state: "done", detail: "4 lines" },
        { title: "Placing stations", state: "done", detail: "18 of 18" },
      ]}
    />
  ),
};
