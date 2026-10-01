/**
 * Home answers five things on open (D7): where we are, what we did lately, what's next,
 * what we need from you, and results so far. Before the first update it's a welcome.
 */
import { ButtonLink, Callout, PageHeader, Section, Stat, StatStrip, Tag } from "@wren/ui";
import type { EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Engagements, figure, StateTag, useWork } from "./bits.js";
import { at } from "./nav.js";

export function Home(props: PageProps) {
  const work = useWork(props);
  return (
    <>
      <PageHeader title="Home" lede="Where your project stands, and what we need from you." />
      <Engagements work={work} props={props}>
        {(e) => <Glance e={e} />}
      </Engagements>
    </>
  );
}

function Glance({ e }: { e: EngagementView }) {
  const done = e.steps.filter((s) => s.state === "done").length;
  const current = e.steps.find((s) => s.state === "late" || s.state === "now");
  const coming = e.steps.find((s) => s.state === "next");
  const open = e.asks.filter((a) => !a.answeredAt);
  const toApprove = e.deliverables.filter((d) => d.status === "waiting");
  const pct = e.steps.length ? Math.round((done / e.steps.length) * 100) : 0;
  const welcome = e.updates.length === 0;

  return (
    <>
      {welcome ? (
        <Callout>
          Welcome. Your plan below is dated from {dayLabel(e.startsOn)}. We post here as the work
          moves, and anything we need from you shows under Needs you.
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

      <Section title="What we promised">
        <p>{e.offer.promise}</p>
        {e.offer.guarantee ? <p className="wk-quiet">{e.offer.guarantee}</p> : null}
      </Section>
    </>
  );
}
