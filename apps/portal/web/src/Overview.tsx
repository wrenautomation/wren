/** What we found, in numbers, and the people to call first. */
import { call, type Overview as Data } from "./api.js";
import { href } from "./route.js";
import { Failed, num, Reasons, Stat, useCall } from "./ui.js";

export function Overview({ client }: { client: string }) {
  const o = useCall(`overview:${client}`, () => call<Data>("overview", { client }));
  if (o.error && !o.data) return <Failed error={o.error} />;
  if (!o.data) return <div className="loading">Loading…</div>;
  const d = o.data;
  const pct = (n: number) =>
    d.lookedUp ? `${Math.round((n / d.lookedUp) * 100)}% of those looked up` : "";

  return (
    <div className="page">
      <section className="stats">
        <Stat
          value={num(d.people)}
          label="People on your list"
          note={`at ${num(d.companies)} companies`}
        />
        <Stat
          value={num(d.lookedUp)}
          label="Looked up"
          note={d.people ? `${Math.round((d.lookedUp / d.people) * 100)}% of the list` : ""}
        />
        <Stat
          value={<a href={href("people", { filter: "moved" })}>{num(d.moved)}</a>}
          label="Moved to a new company"
          note={pct(d.moved)}
        />
        <Stat
          value={<a href={href("people", { filter: "hiring" })}>{num(d.atHiring)}</a>}
          label="Work where there's hiring now"
          note={`${num(d.hiringCompanies)} companies hiring`}
        />
      </section>

      <section>
        <div className="section-head">
          <h2>Call these first</h2>
          <p className="quiet">
            Ranked by why now: a move, hiring at their company, time since you last spoke. Each has
            a brief with its sources.
          </p>
        </div>
        {d.top.length ? (
          <ol className="top">
            {d.top.map((c, i) => (
              <li key={c.personId}>
                <a className="top-row" href={href("people", { person: c.personId })}>
                  <span className="rank">{i + 1}</span>
                  <span className="top-who">
                    <b>{c.name}</b>
                    <span className="quiet"> · {c.firm}</span>
                    {c.brief ? <span className="top-brief">{stripMarks(c.brief)}</span> : null}
                  </span>
                  <span className="top-why">
                    <span className="score">{c.score}</span>
                    <Reasons reasons={c.reasons.slice(0, 3)} />
                  </span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">Nobody ranked yet. People show up here once their lookups finish.</p>
        )}
      </section>
    </div>
  );
}

/** The overview shows the brief's words; its marks are for the drawer. */
export const MARKS = /\[\s*([fc]\d+(?:\s*[,;]\s*[fc]\d+)*)\s*\]/gi;
export const stripMarks = (s: string) => s.replace(MARKS, "").replace(/\s+([.,;])/g, "$1");
