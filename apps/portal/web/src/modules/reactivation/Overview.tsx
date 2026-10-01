/** Home: what this is, where the work stands, what waits on you, and who to call first. */
import {
  Alert,
  ButtonLink,
  Loading,
  num,
  PageHeader,
  Rail,
  Section,
  Stat,
  StatStrip,
  soon,
  Tag,
} from "@wren/ui";
import type { ReactNode } from "react";
import { call, type Overview as Data, type PipelineStep } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Reasons, stripMarks } from "./bits.js";
import { at } from "./nav.js";
import { railOf } from "./steps.js";

export function Overview({ client, demo }: PageProps) {
  const o = useCall(`overview:${client}`, () => call<Data>("overview", { client }));
  return (
    <>
      <PageHeader
        title="Reactivation"
        lede="Every past client on your list, looked up for a reason to call now. Each one gets a brief with its sources and an email that waits for your OK."
      />
      {o.error && !o.data ? <Alert onRetry={o.retry}>{o.error.message}</Alert> : null}
      {o.data ? <Home d={o.data} demo={demo} /> : o.error ? null : <Loading lines={10} />}
    </>
  );
}

function Home({ d, demo }: { d: Data; demo: boolean }) {
  const pct = (n: number) =>
    d.lookedUp ? `${Math.round((n / d.lookedUp) * 100)}% of those looked up` : "";
  return (
    <>
      <Section
        title="Where your list stands"
        note="Left to right, from your CRM to the replies. Each step opens the people or emails in it."
      >
        <Rail groups={railOf(d.pipeline, demo)} label="Reactivation steps" />
      </Section>

      <Next steps={d.pipeline.steps} demo={demo} />

      <Section title="What we found">
        <StatStrip>
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
          <Stat
            label="Still at the same company"
            value={num(d.stillThere)}
            note={pct(d.stillThere)}
            href={at("people", { filter: "there" })}
          />
          <Stat
            label="Briefs written"
            value={num(d.briefs)}
            note={`for ${num(d.people)} people`}
            href={at("people")}
          />
        </StatStrip>
      </Section>

      <Section
        title="Call these first"
        note="Ranked by why now: a move, hiring at their company, time since you last spoke."
        actions={
          d.top.length > 3 ? (
            <ButtonLink href={at("people")} tone="quiet">
              All {num(d.people)} ranked
            </ButtonLink>
          ) : null
        }
      >
        {d.top.length ? (
          <ol className="rx-top">
            {d.top.slice(0, 3).map((c, i) => (
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
          <p className="rx-quiet">
            Nobody ranked yet. People show up here once their lookups finish.
          </p>
        )}
      </Section>
    </>
  );
}

interface NextItem {
  id: string;
  tag: ReactNode;
  text: ReactNode;
  action?: ReactNode;
}

/** What's next, most urgent first: what waits on you, what runs next, what's parked and till when. */
function Next({ steps, demo }: { steps: PipelineStep[]; demo: boolean }) {
  const step = (id: PipelineStep["id"]) => steps.find((s) => s.id === id);
  const items: NextItem[] = [];
  const ok = step("approve");
  if (ok?.state === "yours")
    items.push({
      id: "approve",
      tag: <Tag tone="rust">Needs you</Tag>,
      text: (
        <>
          <b>
            {num(ok.count)} {ok.count === 1 ? "draft waits" : "drafts wait"} for your OK.
          </b>{" "}
          {demo
            ? "Each one shows the brief it came from. Approving is off on the demo."
            : "Nothing sends until you approve it."}
        </>
      ),
      action: (
        <ButtonLink href={at("emails", { filter: "awaiting" })} tone="primary" arrow>
          Read the drafts
        </ButtonLink>
      ),
    });
  for (const s of steps) {
    if (s.state === "next")
      items.push({
        id: s.id,
        tag: <Tag>Runs next</Tag>,
        text: <>{DUE[s.id](s.of !== null ? s.of - s.count : null)}</>,
      });
    if (s.state === "waiting") {
      const when = soon(s.resumesAt);
      items.push({
        id: s.id,
        tag: <Tag>Waiting</Tag>,
        text: (
          <>
            <b>{PARKED[s.id](s.parked)}</b> They wait on a daily research limit and{" "}
            {when ? `pick up at ${when}, your time.` : "pick up on the next pass."}
          </>
        ),
      });
    }
  }
  if (!items.length) return null;
  return (
    <Section title="What's next">
      <ul className="rx-next">
        {items.map((it) => (
          <li key={it.id}>
            <span className="rx-next-tag">{it.tag}</span>
            <p>{it.text}</p>
            {it.action ? <span className="rx-next-action">{it.action}</span> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

/** What's parked at a step, as a sentence. */
const PARKED: Record<PipelineStep["id"], (n: number) => string> = {
  list: (n) => `${plural(n, "row", "rows")} wait to load.`,
  emails: (n) => `${plural(n, "address", "addresses")} wait for a check.`,
  where: (n) => `${plural(n, "person", "people")} wait for a lookup.`,
  hiring: (n) => `${plural(n, "company", "companies")} wait for a hiring check.`,
  score: (n) => `${plural(n, "person", "people")} wait to be ranked.`,
  briefs: (n) => `${plural(n, "brief", "briefs")} wait to be written.`,
  drafts: (n) => `${plural(n, "draft", "drafts")} wait to be written.`,
  approve: (n) => `${plural(n, "draft", "drafts")} wait for your OK.`,
  sent: (n) => `${plural(n, "email", "emails")} wait to send.`,
  replies: (n) => `${plural(n, "reply", "replies")} wait.`,
};

/** What runs on the next pass at a step. */
const DUE: Record<PipelineStep["id"], (left: number | null) => string> = {
  list: () => "Your list loads next.",
  emails: (n) =>
    n ? `${plural(n, "address gets", "addresses get")} checked next.` : "Email checks run next.",
  where: (n) =>
    n ? `${plural(n, "person gets", "people get")} looked up next.` : "Lookups run next.",
  hiring: (n) =>
    n
      ? `${plural(n, "company gets", "companies get")} a hiring check next.`
      : "Hiring checks run next.",
  score: () => "Ranking runs next.",
  briefs: () => "More briefs get written next.",
  drafts: () => "More drafts get written next.",
  approve: () => "Drafts wait for your OK.",
  sent: () => "Approved emails send next.",
  replies: () => "Replies get read next.",
};
