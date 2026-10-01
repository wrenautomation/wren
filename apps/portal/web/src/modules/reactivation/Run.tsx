/**
 * The run, watched (P5): a run that's going now, line by line as it writes them;
 * otherwise a replay of the work on the list, rebuilt from the records and
 * labeled as one. A run that starts while you watch the replay is offered,
 * never swapped in under you.
 */
import {
  Alert,
  Button,
  ButtonLink,
  Loading,
  PageHeader,
  type RunLine,
  type RunStep,
  RunView,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { call, type LiveRun, type RunPage } from "../../api.js";
import type { PageProps } from "../../module.js";
import { at } from "./nav.js";

/** How often to ask for new lines: while a run is going, and while nothing is. */
const POLL_LIVE_MS = 1500;
const POLL_IDLE_MS = 10_000;

/** Every step a run can take, what each builds on, and where it reads from. */
const STEPS: RunStep[] = [
  { id: "verify", label: "Check emails", short: "Emails", source: "Email check", after: [] },
  {
    id: "lookup",
    label: "Find where they are",
    short: "Where now",
    source: "Web search, LinkedIn",
    found: "moved or left",
    after: [],
  },
  {
    id: "signals",
    label: "Check hiring",
    short: "Hiring",
    source: "Job posts",
    found: "hiring",
    after: [],
  },
  {
    id: "score",
    label: "Rank who to call",
    short: "Ranked",
    source: "Moves and hiring",
    after: ["lookup", "signals"],
  },
  {
    id: "brief",
    label: "Write briefs",
    short: "Briefs",
    source: "AI, every line cited",
    after: ["score"],
  },
  {
    id: "compose",
    label: "Draft emails",
    short: "Drafts",
    source: "AI, from the brief",
    after: ["brief", "verify"],
  },
];

const INPUT = { label: "Your list", note: "From your CRM" };
const outputOf = (demo: boolean) => ({
  label: "Your OK",
  note: demo ? "Off on the demo" : "Nothing sends without it",
});

type Line = NonNullable<RunPage["story"]>["lines"][number];

const toRunLine = (l: Line): RunLine => ({
  id: l.seq,
  step: l.step,
  kind: l.kind,
  text: l.line,
  subject: l.subject,
  count: l.count,
  source: l.source,
  detail: l.detail,
});

const dayOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The first load, then new lines as they're written: fast while a run is going, slow while not. */
function useRun(client: string, team: boolean) {
  const [first, setFirst] = useState<RunPage | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<{ run?: string; after: number }>({ after: 0 });

  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = (next: LiveRun | null) => {
      if (!next) return;
      const same = cursor.current.run === next.run;
      cursor.current = { run: next.run, after: next.last };
      setLive((was) => (same && was ? { ...next, lines: [...was.lines, ...next.lines] } : next));
    };
    const poll = async (open: boolean) => {
      timer = setTimeout(
        async () => {
          if (!on) return;
          if (document.hidden) return poll(open);
          try {
            const page = await call<RunPage>("reactivation/run", {
              client,
              asClient: !team,
              ...cursor.current,
            });
            if (!on) return;
            keep(page.live);
            setError(null);
            poll(page.live?.open ?? false);
          } catch {
            if (on) poll(open);
          }
        },
        open ? POLL_LIVE_MS : POLL_IDLE_MS,
      );
    };
    call<RunPage>("reactivation/run", { client, asClient: !team }).then(
      (page) => {
        if (!on) return;
        setFirst(page);
        keep(page.live);
        poll(page.live?.open ?? false);
      },
      (err: unknown) => on && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [client, team]);

  return { first, live, error };
}

export function Run({ client, demo, team }: PageProps) {
  const { first, live, error } = useRun(client, team);
  // Watching live is a choice once the page is open; on load, a run going now wins.
  const [watch, setWatch] = useState<string | null>(null);
  const openOnLoad = first?.live?.open ? first.live.run : null;
  const watching = live && (live.run === watch || live.run === openOnLoad) ? live : null;

  return (
    <>
      <PageHeader
        title="Run"
        lede="The work on your list, step by step: who was checked, what was found, and where it came from."
      />
      {error && !first ? <Alert>{error}</Alert> : null}
      {!first ? (
        error ? null : (
          <Loading lines={8} />
        )
      ) : watching ? (
        <Live run={watching} demo={demo} />
      ) : (
        <>
          {live?.open ? (
            <div className="rx-run-now">
              <p>
                <b>A run is going now.</b> It started at {timeOf(live.startedAt)}.
              </p>
              <Button size="sm" icon="play" onClick={() => setWatch(live.run)}>
                Watch it live
              </Button>
            </div>
          ) : null}
          <Replay page={first} demo={demo} />
        </>
      )}
    </>
  );
}

function Live({ run, demo }: { run: LiveRun; demo: boolean }) {
  const label = run.open
    ? `Live. Started at ${timeOf(run.startedAt)}.`
    : `Finished at ${timeOf(run.finishedAt ?? run.startedAt)}.`;
  return (
    <RunView
      key={run.run}
      steps={STEPS}
      lines={run.lines.map(toRunLine)}
      live={run.open}
      label={label}
      input={INPUT}
      output={outputOf(demo)}
      results={<Results demo={demo} />}
    />
  );
}

function Replay({ page, demo }: { page: RunPage; demo: boolean }) {
  const story = page.story;
  if (!story?.lines.length)
    return (
      <p className="rx-quiet">
        Nothing to show yet. Once your list loads and the first checks run, this page plays them
        back.
      </p>
    );
  const day = dayOf(story.asOf);
  return (
    <RunView
      steps={STEPS}
      lines={story.lines.map(toRunLine)}
      label={`Replay of the work on your list${day ? ` as of ${day}` : ""}, sped up.`}
      input={INPUT}
      output={outputOf(demo)}
      results={<Results demo={demo} />}
    />
  );
}

/** Where the run leaves you: the people to call and the drafts to read. */
function Results({ demo }: { demo: boolean }) {
  return (
    <div className="rx-run-results">
      <p>
        <b>That's the list, worked.</b>{" "}
        {demo ? "Approving is off on the demo." : "Nothing sends until you approve it."}
      </p>
      <span className="rx-run-actions">
        <ButtonLink href={at("people")} tone="quiet">
          Who to call first
        </ButtonLink>
        <ButtonLink href={at("emails", { filter: "awaiting" })} tone="primary" arrow>
          Read the drafts
        </ButtonLink>
      </span>
    </div>
  );
}
