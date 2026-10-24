/**
 * "Research this person" on a profile (designs/2026-10-17-people-depth.md): the action that
 * starts a run, the Research section (the newest run, and what every run found, grouped by what
 * was decided), and the Findings page where findings are kept or dropped in bulk. Wren's own
 * people only: the server describes the action and the record to Wren's console alone.
 */
import type { ResearchDetail, ResearchFinding } from "@wren/core/profile-findings";
import { type Action, Button, Facts, PlatformMark, type RecordAct } from "@wren/ui";
import { type ReactNode, useRef, useState } from "react";
import type { ListPage } from "../../module.js";

/** How often the profile reads again while a run works. */
export const RESEARCH_POLL_MS = 3000;

/** Start a run for the open person. The server refuses while one is queued or running. */
export const researchAction: Action = {
  id: "people.research",
  label: "Research this person",
  handler: "people/research",
  confirm: "Look for their pages and job on the web? It uses a few searches.",
  done: () => "Research started",
};

const keepWords = (answer: unknown) => {
  const a = answer as { done?: unknown[]; keys?: number } | null;
  const n = a?.done?.length ?? 0;
  return `Kept ${n}${a?.keys ? `, ${a.keys} added to the person` : ""}`;
};

/** Keep what looks right. A kept handle joins the person as an address. */
export const keepFinding: Action = {
  id: "people.findingKeep",
  label: "Keep",
  handler: "people/findingKeep",
  bulk: true,
  when: { state: ["found", "dropped"] },
  confirm: "Keep these? A kept handle joins the person as an address.",
  done: keepWords,
};

/** Drop what is not them. A new run leaves it dropped. */
export const dropFinding: Action = {
  id: "people.findingDrop",
  label: "Drop",
  icon: "close",
  handler: "people/findingDrop",
  bulk: true,
  when: { state: ["found", "kept"] },
  confirm: "Drop these? A new run leaves them dropped.",
  done: (answer) => `Dropped ${(answer as { done?: unknown[] } | null)?.done?.length ?? 0}`,
};

/** The same two, pressed from the person's own page, on one finding: never a head button. */
export const inlineDecide: Action[] = [
  { ...keepFinding, inline: true },
  { ...dropFinding, inline: true },
];

export const findingsPage: ListPage = {
  id: "findings",
  label: "Findings",
  about: "What research found about people, to keep or drop.",
  hidden: true,
  template: "list",
  record: "people.finding",
  columns: ["who", "kind", "platform", "value", "source", "confidence", "state"],
  empty: {
    new: "Nothing waits. Research a person to find their pages and job.",
    kept: "Nothing kept yet.",
    dropped: "Nothing dropped yet.",
    all: "Nothing found yet. Research a person to find their pages and job.",
  },
  actions: [keepFinding, dropFinding],
};

const GROUPS = [
  ["found", "To look at"],
  ["kept", "Kept"],
  ["dropped", "Dropped"],
] as const;

const SOURCES: Readonly<Record<string, string>> = {
  cache: "Held search",
  google: "Google",
  search: "Search",
  linkedin: "LinkedIn",
  elsewhere: "Web search",
};

const RUN_STATES: Readonly<Record<string, string>> = {
  queued: "Waiting to start",
  running: "Running now",
  done: "Done",
  failed: "Failed",
};

const OUTCOMES: Readonly<Record<string, string>> = {
  matched: "found their LinkedIn page",
  unresolved: "found no LinkedIn page",
  capped: "stopped early at a daily limit",
  skipped: "had nothing to search with",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** Whether a run is still going: the profile reads again until it is not. */
export const researching = (r: ResearchDetail | null | undefined) =>
  r?.run?.state === "queued" || r?.run?.state === "running";

/** The newest run in lines: its state, when, each step it tried, and why it stopped. */
function RunFacts({ run }: { run: NonNullable<ResearchDetail["run"]> }) {
  const state = RUN_STATES[run.state] ?? run.state;
  const outcome = run.state === "done" && run.outcome ? OUTCOMES[run.outcome] : null;
  const items: [string, ReactNode][] = [
    ["Run", outcome ? `${state}: ${outcome}` : state],
    ["Asked", `${when(run.at)}${run.by ? ` by ${run.by}` : ""}`],
  ];
  if (run.finishedAt) items.push(["Ended", when(run.finishedAt)]);
  if (run.steps.length)
    items.push([
      "Tried",
      <ul key="steps" className="grid gap-1">
        {run.steps.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same line can repeat; the list never reorders.
          <li key={i}>{s}</li>
        ))}
      </ul>,
    ]);
  else if (run.state === "running") items.push(["Tried", "Starting"]);
  if (run.retryAt) items.push(["Try again after", when(run.retryAt)]);
  if (run.error) items.push(["Why it failed", run.error]);
  return <Facts items={items} />;
}

/** One finding: the site's mark, its link, where it came from and how sure, and its two buttons. */
function FindingLine({
  f,
  decide,
  busy,
}: {
  f: ResearchFinding;
  decide: (f: ResearchFinding, verb: "Keep" | "Drop") => void;
  busy: string | null;
}) {
  const shown = f.url ? (
    <a href={f.url} target="_blank" rel="noreferrer" title={f.url}>
      {f.value}
    </a>
  ) : (
    f.value
  );
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--ui-hair) py-2 text-[14px]">
      <span className="flex min-w-0 flex-[1_1_14rem] items-center gap-2 [overflow-wrap:anywhere]">
        {f.platform ? <PlatformMark mark={f.platform} /> : null}
        <span>{shown}</span>
      </span>
      <span className="text-[13px] text-(--ui-ink-2)">
        {SOURCES[f.source] ?? f.source}, {percent(f.confidence)} sure
      </span>
      <span className="flex gap-1">
        {f.state !== "kept" ? (
          <Button
            tone="quiet"
            size="dense"
            busy={busy === `Keep ${f.id}`}
            disabled={busy !== null}
            onClick={() => decide(f, "Keep")}
          >
            Keep
          </Button>
        ) : null}
        {f.state !== "dropped" ? (
          <Button
            tone="quiet"
            size="dense"
            busy={busy === `Drop ${f.id}`}
            disabled={busy !== null}
            onClick={() => decide(f, "Drop")}
          >
            Drop
          </Button>
        ) : null}
      </span>
    </li>
  );
}

/** The section: the newest run, then findings by state. Keep and Drop act on one finding. */
export function Research({ research, act }: { research: ResearchDetail; act: RecordAct }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  // One press at a time, held in a ref: a double click runs once.
  const flying = useRef(false);
  const decide = async (f: ResearchFinding, verb: "Keep" | "Drop") => {
    if (flying.current) return;
    flying.current = true;
    setBusy(`${verb} ${f.id}`);
    setSaid(null);
    try {
      await act(verb === "Keep" ? "people.findingKeep" : "people.findingDrop", { ids: [f.id] });
      setSaid({ text: verb === "Keep" ? "Kept." : "Dropped.", bad: false });
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), bad: true });
    } finally {
      flying.current = false;
      setBusy(null);
    }
  };
  if (!research.run && !research.findings.length)
    return (
      <p className="text-(--ui-ink-2)">
        Not researched yet. Press Research this person to look for their pages and job.
      </p>
    );
  return (
    <div className="grid gap-4">
      {research.run ? <RunFacts run={research.run} /> : null}
      {research.findings.length ? (
        GROUPS.map(([state, label]) => {
          const list = research.findings.filter((f) => f.state === state);
          return list.length ? (
            <div key={state} className="grid gap-1">
              <h4 className="text-[13px] font-medium text-(--ui-ink-2)">
                {label} ({list.length})
              </h4>
              <ul>
                {list.map((f) => (
                  <FindingLine key={f.id} f={f} decide={decide} busy={busy} />
                ))}
              </ul>
            </div>
          ) : null;
        })
      ) : research.run && !researching(research) ? (
        <p className="text-(--ui-ink-2)">The run found nothing to add.</p>
      ) : null}
      {said ? (
        <p
          aria-live="polite"
          className={said.bad ? "text-[13px] text-(--ui-bad)" : "text-[13px] text-(--ui-ink-2)"}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
