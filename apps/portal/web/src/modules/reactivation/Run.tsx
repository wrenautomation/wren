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
  Rail,
  type RunLine,
  type RunStep,
  RunView,
  RunWorkTrail,
} from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { call, type LiveRun, type Overview, type RunPage, type WorkView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { at } from "./nav.js";
import { railOf } from "./steps.js";

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
    id: "movers",
    label: "Find new emails",
    short: "New emails",
    source: "Their new company's site",
    found: "found",
    after: ["lookup"],
  },
  {
    id: "events",
    label: "Check company news",
    short: "News",
    source: "News search",
    found: "with news",
    after: ["movers"],
  },
  {
    id: "score",
    label: "Rank who to call",
    short: "Ranked",
    source: "Moves, hiring and news",
    after: ["lookup", "signals", "events"],
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
    after: ["brief", "verify", "movers"],
  },
];

const INPUT = { label: "Your list", note: "From your CRM" };
const OUTPUT = { label: "Your OK", note: "Nothing sends without it" };

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

/** The steps that keep their work, and what opening one shows. */
const WORK_TITLES: Record<string, (who: string) => string> = {
  lookup: (who) => `How we found where ${who} is now`,
  signals: (who) => `How we checked if ${who} is hiring`,
  movers: (who) => `How we found ${who}'s new email`,
  score: (who) => `Why ${who} ranks here`,
  brief: (who) => `What ${who}'s brief drew on`,
  compose: (who) => `How ${who}'s email was drafted`,
};

/** Each line's work, asked for once when it's opened, then kept for the visit. */
export function LineWork({
  line,
  client,
  team,
  more = true,
}: {
  line: Pick<RunLine, "step" | "subject">;
  client: string;
  team: boolean;
  /** Link to the person's page; off on that page. */
  more?: boolean;
}) {
  const key = `${line.step}|${line.subject}`;
  const [got, setGot] = useState<{ key: string; view: WorkView | null; error?: string } | null>(
    () => (WORK_SEEN.has(key) ? { key, view: WORK_SEEN.get(key) ?? null } : null),
  );
  useEffect(() => {
    if (WORK_SEEN.has(key)) return setGot({ key, view: WORK_SEEN.get(key) ?? null });
    let on = true;
    setGot(null);
    call<WorkView>("reactivation/work", {
      client,
      asClient: !team,
      step: line.step,
      subject: line.subject,
    }).then(
      (view) => {
        WORK_SEEN.set(key, view);
        if (on) setGot({ key, view });
      },
      (err: unknown) =>
        on && setGot({ key, view: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      on = false;
    };
  }, [key, client, team, line.step, line.subject]);

  const title = (WORK_TITLES[line.step] ?? ((who: string) => who))(line.subject ?? "");
  if (!got || got.key !== key) return <Loading lines={4} />;
  if (!got.view)
    return (
      <p className="text-(--ui-ink-2)">{got.error ?? "Nothing more to show for this line."}</p>
    );
  const view = got.view;
  return (
    <>
      <RunWorkTrail work={view} title={title} />
      {more && view.personId ? (
        <p className="mt-3 text-[13px] font-semibold">
          <a href={at("people", { person: view.personId })}>Open {view.subject}'s page</a>
        </p>
      ) : null}
    </>
  );
}
const WORK_SEEN = new Map<string, WorkView>();
const withWork = (line: RunLine) => !!line.subject && line.step in WORK_TITLES;

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

export function Run({ client, team, demo }: PageProps) {
  const { first, live, error } = useRun(client, team);
  // Shared with the launcher card, so it's read once.
  const o = useCall(`overview:${client}`, () =>
    call<Overview>("reactivation/overview", { client }),
  );
  // Watching live is a choice once the page is open; on load, a run going now wins.
  const [watch, setWatch] = useState<string | null>(null);
  const openOnLoad = first?.live?.open ? first.live.run : null;
  const watching = live && (live.run === watch || live.run === openOnLoad) ? live : null;

  return (
    <>
      <PageHeader title="Run" />
      {o.data ? (
        <Rail groups={railOf(o.data.pipeline, demo)} label="Reactivation steps" className="mb-6" />
      ) : null}
      {error && !first ? <Alert>{error}</Alert> : null}
      {!first ? (
        error ? null : (
          <Loading lines={8} />
        )
      ) : watching ? (
        <Live run={watching} work={workOf(client, team)} />
      ) : (
        <>
          {live?.open ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 bg-(--ui-accent-tint) px-4.5 py-3.5">
              <p>
                <b>A run is going now.</b> It started at {timeOf(live.startedAt)}.
              </p>
              <Button size="dense" icon="play" onClick={() => setWatch(live.run)}>
                Watch it live
              </Button>
            </div>
          ) : null}
          <Replay page={first} work={workOf(client, team)} />
        </>
      )}
    </>
  );
}

type WorkOf = (line: RunLine) => ReactNode;
const workOf =
  (client: string, team: boolean): WorkOf =>
  (line) =>
    withWork(line) ? <LineWork line={line} client={client} team={team} /> : null;

function Live({ run, work }: { run: LiveRun; work: WorkOf }) {
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
      work={work}
      input={INPUT}
      output={OUTPUT}
      results={<Results />}
    />
  );
}

function Replay({ page, work }: { page: RunPage; work: WorkOf }) {
  const story = page.story;
  if (!story?.lines.length)
    return (
      <p className="text-(--ui-ink-2)">
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
      work={work}
      input={INPUT}
      output={OUTPUT}
      results={<Results />}
    />
  );
}

/** Where the run leaves you: the people to call and the drafts to read. */
function Results() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-(--ui-hair) bg-(--ui-paper) px-5 py-4.5">
      <p>
        <b>That's the list, worked.</b> Nothing sends until you approve it.
      </p>
      <span className="flex flex-wrap gap-2">
        <ButtonLink href={at("people")} tone="quiet">
          Who to call first
        </ButtonLink>
        <ButtonLink size="dense" href={at("emails")} tone="primary" arrow>
          Read the drafts
        </ButtonLink>
      </span>
    </div>
  );
}
