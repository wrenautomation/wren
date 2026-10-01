/**
 * Home answers five things on open (D7): where we are, what we did lately, what's next,
 * what we need from you, and results so far. Before the first update it's a welcome.
 * It also takes the weekly pulse (D10), from a tap here or a link in the Friday mail.
 */
import { PULSE_WORDS } from "@wren/delivery/routes";
import { Button, ButtonLink, Callout, PageHeader, Section, Stat, StatStrip, Tag } from "@wren/ui";
import { useEffect } from "react";
import type { EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { dayLabel, Engagements, figure, StateTag, useAct, useWork } from "./bits.js";
import { at } from "./nav.js";
import { waitingOn } from "./Paperwork.js";

export function Home(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  usePulseLink(props, act);
  return (
    <>
      <PageHeader title="Home" lede="Where your project stands, and what we need from you." />
      {act.error ? (
        <p className="wk-error" role="alert">
          {act.error}
        </p>
      ) : null}
      <Engagements work={work} props={props}>
        {(e) => <Glance e={e} props={props} act={act} />}
      </Engagements>
    </>
  );
}

/** `?pulse=4&e=12` from the Friday mail: record the tap, then drop it from the address. */
function usePulseLink({ params, team, demo }: PageProps, act: ReturnType<typeof useAct>) {
  const score = Number(params.get("pulse"));
  const engagementId = Number(params.get("e")) || undefined;
  useEffect(() => {
    if (!score) return;
    if (!team && !demo) void act.run("pulse", { engagementId, score });
    navigate(href(location.pathname, { pulse: null, e: null }, params), true);
  }, [score, engagementId, team, demo, act.run, params]);
}

function Glance({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const done = e.steps.filter((s) => s.state === "done").length;
  const current = e.steps.find((s) => s.state === "late" || s.state === "now");
  const coming = e.steps.find((s) => s.state === "next");
  const open = e.asks.filter((a) => !a.answeredAt);
  const toApprove = e.deliverables.filter((d) => d.status === "waiting");
  const pct = e.steps.length ? Math.round((done / e.steps.length) * 100) : 0;
  const welcome = e.updates.length === 0;

  return (
    <>
      {e.status === "onboarding" ? (
        <Section
          title="Before we start"
          actions={
            <ButtonLink href={at("paperwork")} tone="primary" size="sm" arrow>
              Paperwork
            </ButtonLink>
          }
        >
          <p>
            {waitingOn(e).length
              ? `Still to do: ${waitingOn(e).join(", ")}. The plan starts the day that's done.`
              : "All done. The plan starts today."}{" "}
            New here? <a href={at("welcome")}>Read the welcome guide</a>.
          </p>
        </Section>
      ) : welcome ? (
        <Callout>
          Welcome. Your plan below is dated from {dayLabel(e.startsOn)}. We post here as the work
          moves, and anything we need from you shows under Needs you.{" "}
          <a href={at("welcome")}>The welcome guide</a> has the rest.
        </Callout>
      ) : null}

      <Section title="Where we are">
        <StatStrip>
          <Stat
            label="Now"
            value={current?.name ?? (done === e.steps.length ? "All done" : "Starting")}
            note={
              current ? (
                <>
                  <StateTag state={current.state} /> due {dayLabel(current.dueOn)}
                </>
              ) : coming ? (
                `${coming.name} starts ${dayLabel(coming.plannedFrom)}`
              ) : null
            }
            href={at("plan")}
          />
          <Stat
            label="Plan done"
            value={`${pct}%`}
            note={`${done} of ${e.steps.length} steps`}
            href={at("plan")}
          />
          <Stat
            label="Needs you"
            value={open.length + toApprove.length}
            note={open.some((a) => a.overdue) ? "some are overdue" : "open items"}
            href={at("needs-you")}
          />
        </StatStrip>
      </Section>

      {open.length || toApprove.length ? (
        <Section
          title="What we need from you"
          actions={
            <ButtonLink href={at("needs-you")} tone="primary" size="sm" arrow>
              Answer
            </ButtonLink>
          }
        >
          <ul className="wk-list">
            {toApprove.map((d) => (
              <li key={`d${d.id}`}>
                <Tag tone="rust">Your OK</Tag> <a href={at("deliverables")}>{d.title}</a>
              </li>
            ))}
            {open.slice(0, 5).map((a) => (
              <li key={a.id}>
                {a.overdue ? <Tag tone="rust">Overdue</Tag> : <Tag>Due {dayLabel(a.dueOn)}</Tag>}{" "}
                {a.text}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {e.updates.length ? (
        <Section
          title="What we did lately"
          actions={
            <ButtonLink href={at("updates")} tone="quiet" size="sm">
              All updates
            </ButtonLink>
          }
        >
          <ul className="wk-list">
            {e.updates.slice(0, 3).map((u) => (
              <li key={u.id}>
                <span className="wk-quiet">{dayLabel(u.at)}</span> {u.body}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {coming ? (
        <Section title="What's next">
          <p>
            <b>{coming.name}</b> starts {dayLabel(coming.plannedFrom)}
            {coming.dueOn ? `, due ${dayLabel(coming.dueOn)}` : ""}.
          </p>
        </Section>
      ) : null}

      <Section
        title="Results so far"
        actions={
          <ButtonLink href={at("results")} tone="quiet" size="sm">
            Details
          </ButtonLink>
        }
      >
        <StatStrip>
          {e.results.map((r) => (
            <Stat key={r.key} label={r.label} value={figure(r)} />
          ))}
        </StatStrip>
      </Section>

      <Pulse e={e} props={props} act={act} />

      <Section title="What we promised">
        <p>{e.offer.promise}</p>
        {e.offer.guarantee ? <p className="wk-quiet">{e.offer.guarantee}</p> : null}
      </Section>
    </>
  );
}

/** One tap a week from the client's people; Wren's team sees the taps. A low one pings us. */
function Pulse({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const { mine, scores } = e.pulse;
  if (props.team)
    return (
      <Section title="This week's pulse">
        <p>
          {scores.length
            ? scores.map((n) => `${n} ${PULSE_WORDS[n]}`).join(", ")
            : "Nobody has rated this week yet."}
        </p>
      </Section>
    );
  return (
    <Section title="How's this week going?">
      <div className="wk-tools">
        {[5, 4, 3, 2, 1].map((n) => (
          <Button
            key={n}
            size="sm"
            tone={mine === n ? "primary" : "secondary"}
            aria-pressed={mine === n}
            disabled={act.busy || props.demo}
            onClick={() => void act.run("pulse", { engagementId: e.id, score: n })}
          >
            {PULSE_WORDS[n]}
          </Button>
        ))}
      </div>
      <p className="wk-quiet">
        {props.demo
          ? "Off on the demo."
          : mine
            ? `You said ${PULSE_WORDS[mine]}. Tap another to change it.`
            : "One tap. Each one reaches us."}
      </p>
    </Section>
  );
}
