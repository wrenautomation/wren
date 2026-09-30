/** What we found, in numbers, and the people to call first. */
import { Alert, Empty, Loading, num, PageHeader, Section, Stat, StatStrip } from "@wren/ui";
import { call, type Overview as Data } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Reasons, stripMarks } from "./bits.js";
import { at } from "./nav.js";

export function Overview({ client }: PageProps) {
  const o = useCall(`overview:${client}`, () => call<Data>("overview", { client }));
  return (
    <>
      <PageHeader title="Overview" lede="What we found on your list, and who to call first." />
      {o.error && !o.data ? <Alert>{o.error.message}</Alert> : null}
      {o.data ? <Found d={o.data} /> : o.error ? null : <Loading lines={8} />}
    </>
  );
}

function Found({ d }: { d: Data }) {
  const pct = (n: number) =>
    d.lookedUp ? `${Math.round((n / d.lookedUp) * 100)}% of those looked up` : "";
  return (
    <>
      <StatStrip>
        <Stat
          label="People on your list"
          value={num(d.people)}
          note={`at ${num(d.companies)} companies`}
        />
        <Stat
          label="Looked up"
          value={num(d.lookedUp)}
          note={d.people ? `${Math.round((d.lookedUp / d.people) * 100)}% of the list` : ""}
        />
        <Stat
          label="Moved to a new company"
          value={num(d.moved)}
          note={pct(d.moved)}
          href={at("people", { filter: "moved" })}
        />
        <Stat
          label="Work where there's hiring now"
          value={num(d.atHiring)}
          note={`${num(d.hiringCompanies)} companies hiring`}
          href={at("people", { filter: "hiring" })}
        />
      </StatStrip>

      <Section
        title="Call these first"
        note="Ranked by why now: a move, hiring at their company, time since you last spoke. Each has a brief with its sources."
      >
        {d.top.length ? (
          <ol className="rx-top">
            {d.top.map((c, i) => (
              <li key={c.personId}>
                <a className="rx-top-row" href={at("people", { person: c.personId })}>
                  <span className="rx-rank">{i + 1}</span>
                  <span className="rx-top-who">
                    <span>
                      <b>{c.name}</b>
                      <span className="rx-quiet"> · {c.firm}</span>
                    </span>
                    {c.brief ? <span className="rx-top-brief">{stripMarks(c.brief)}</span> : null}
                  </span>
                  <span className="rx-top-why">
                    <span className="rx-score" title="Score">
                      {c.score}
                    </span>
                    <Reasons reasons={c.reasons.slice(0, 3)} />
                  </span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Nobody ranked yet. People show up here once their lookups finish.</Empty>
        )}
      </Section>
    </>
  );
}
