/**
 * Overview answers five things on open (D7): where we are, what we did lately, what's next,
 * what we need from you, and results so far. Before the first update it's a welcome.
 * It also takes the weekly pulse (D10), from a tap here or a link in the Friday mail, and
 * a review at each moment (D13), with what's next once they're halfway.
 */
import { GOOGLE_REVIEW_URL, PULSE_WORDS, REVIEW_WORDS } from "@wren/delivery/routes";
import { Button, ButtonLink, Callout, PageHeader, Section, Stat, StatStrip, Tag } from "@wren/ui";
import { Fragment, useEffect, useState } from "react";
import type { EngagementView, MomentView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import {
  dayLabel,
  Engagements,
  Form,
  field,
  figure,
  ofThisApp,
  StateTag,
  useAct,
  useWork,
} from "./bits.js";
import { at } from "./nav.js";

export function Home(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  usePulseLink(props, act);
  const rated = useReviewLink(props, act);
  return (
    <>
      <PageHeader title="Overview" lede="Where your project stands, and what we need from you." />
      {act.error ? (
        <p className="wk-error" role="alert">
          {act.error}
        </p>
      ) : null}
      <Engagements work={work} props={props}>
        {(e) => <Glance e={e} props={props} act={act} rated={rated} />}
      </Engagements>
    </>
  );
}

/**
 * A product's overview, above its own numbers: getting started, the review asked for, what
 * waits on them and what's next. The mail's pulse and review links land here too.
 */
export function EngagementBar(props: PageProps) {
  return props.demo ? null : <Bar {...props} />;
}

function Bar(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  usePulseLink(props, act);
  const rated = useReviewLink(props, act);
  return (
    <>
      {act.error ? (
        <p className="wk-error" role="alert">
          {act.error}
        </p>
      ) : null}
      {ofThisApp(work.data?.engagements ?? []).map((e) => (
        <Fragment key={e.id}>
          <Checklist e={e} team={props.team} />
          <Review e={e} props={props} act={act} rated={rated} />
          <NeedsYou e={e} />
          <Next e={e} props={props} act={act} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * Getting started, in order: sign, pay the setup fee, grant access, then the first step's
 * asks (the export, a contact, the kickoff). Gone once all of it is done.
 */
export function Checklist({ e, team }: { e: EngagementView; team: boolean }) {
  const p = e.paperwork;
  const first = e.steps[0]?.name;
  const items: { label: string; done: boolean; href: string }[] = [
    ...(p.contract
      ? [
          {
            label: "Sign the contract",
            done: p.contract.signedAt !== null,
            href: at("contract", { e: e.id }),
          },
        ]
      : []),
    ...(p.setupPaid === null
      ? []
      : [{ label: "Pay the setup invoice", done: p.setupPaid, href: "/account/billing" }]),
    ...p.access.map((a) => ({
      label: `Give us access to ${a.system}`,
      done: a.status !== "open",
      href: at("paperwork"),
    })),
    ...e.asks
      .filter((a) => first !== undefined && a.step === first)
      .map((a) => ({ label: a.text, done: a.answeredAt !== null, href: at("needs-you") })),
  ];
  const left = items.filter((i) => !i.done).length;
  if (left === 0) return null;
  return (
    <Section
      title="Getting started"
      note={
        e.status === "onboarding"
          ? "The plan starts the day the paperwork is done."
          : `${left} left from the first step.`
      }
    >
      <ul className="wk-list">
        {items.map((i) => (
          <li key={i.label}>
            {i.done ? <Tag tone="green">Done</Tag> : <Tag tone="rust">To do</Tag>}{" "}
            {i.done || team ? i.label : <a href={i.href}>{i.label}</a>}
          </li>
        ))}
      </ul>
      <p className="wk-quiet">
        New here? <a href={at("welcome")}>Read the welcome guide</a>.
      </p>
    </Section>
  );
}

/** Deliverables waiting on their OK and the first open asks. */
function NeedsYou({ e }: { e: EngagementView }) {
  const open = e.asks.filter((a) => !a.answeredAt);
  const toApprove = e.deliverables.filter((d) => d.status === "waiting");
  if (!open.length && !toApprove.length) return null;
  return (
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

/**
 * `?review=halfway&score=5&e=12` or `?next=<offer>&e=12` from a moment's mail: record the
 * tap, drop it from the address, and say which moment was rated so its card asks for a line.
 */
function useReviewLink({ params, team, demo }: PageProps, act: ReturnType<typeof useAct>) {
  const [rated, setRated] = useState<string | null>(null);
  const moment = params.get("review");
  const score = Number(params.get("score"));
  const offerId = params.get("next");
  const engagementId = Number(params.get("e")) || undefined;
  useEffect(() => {
    if (!moment && !offerId) return;
    if (!team && !demo) {
      if (moment && score) {
        void act.run("review", { engagementId, moment, score });
        setRated(`${engagementId} ${moment}`);
      }
      if (offerId) void act.run("interest", { engagementId, offerId });
    }
    navigate(
      href(location.pathname, { review: null, score: null, next: null, e: null }, params),
      true,
    );
  }, [moment, score, offerId, engagementId, team, demo, act.run, params]);
  return rated;
}

function Glance({
  e,
  props,
  act,
  rated,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
  rated: string | null;
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
      <Checklist e={e} team={props.team} />
      {e.status !== "onboarding" && welcome ? (
        <Callout>
          Welcome. Your plan below is dated from {dayLabel(e.startsOn)}. We post here as the work
          moves, and anything we need from you shows under Needs you.{" "}
          <a href={at("welcome")}>The welcome guide</a> has the rest.
        </Callout>
      ) : null}

      <Review e={e} props={props} act={act} rated={rated} />

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

      <NeedsYou e={e} />

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

      <Next e={e} props={props} act={act} />

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
          ? "Works in your own workspace."
          : mine
            ? `You said ${PULSE_WORDS[mine]}. Tap another to change it.`
            : "One tap. Each one reaches us."}
      </p>
    </Section>
  );
}

const QUOTE_CHOICES = [
  ["private", "Just for Wren"],
  ["anonymous", "Quote me without my name"],
  ["named", "Quote me with my name and firm"],
] as const;

/**
 * At a moment (D13): stars, then a line and whether we may quote it. A client sees the
 * newest moment they haven't answered; Wren's team sees everyone's reviews.
 */
function Review({
  e,
  props,
  act,
  rated,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
  rated: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [thanked, setThanked] = useState<{ score: number; words: string } | null>(null);
  if (props.team) return <Reviews moments={e.moments} />;
  const asked = (m: MomentView) => m.moment === open || `${e.id} ${m.moment}` === rated;
  const m = e.moments.find(asked) ?? e.moments.find((x) => !x.mine);
  if (!m) return thanked ? <Thanks {...thanked} /> : null;
  const score = m.mine?.score ?? null;
  const send = (body: Record<string, unknown>) =>
    act.run("review", { engagementId: e.id, moment: m.moment, ...body });

  return (
    <Section title={`${m.label}. How are we doing?`}>
      <div className="wk-tools">
        {[5, 4, 3, 2, 1].map((n) => (
          <Button
            key={n}
            size="sm"
            tone={score === n ? "primary" : "secondary"}
            aria-pressed={score === n}
            disabled={act.busy || props.demo}
            onClick={async () => {
              if (await send({ score: n })) setOpen(m.moment);
            }}
          >
            {REVIEW_WORDS[n]}
          </Button>
        ))}
        {score === null ? (
          <Button
            size="sm"
            tone="quiet"
            disabled={act.busy || props.demo}
            onClick={() => void send({ score: null })}
          >
            Not now
          </Button>
        ) : null}
      </div>
      {score === null ? (
        <p className="wk-quiet">
          {props.demo ? "Works in your own workspace." : "One tap. It reaches William."}
        </p>
      ) : (
        <Form
          label="Say more"
          submit="Send"
          act={act}
          demo={props.demo}
          onSubmit={async (f) => {
            const ok = await send({
              score,
              words: field(f, "words"),
              mayQuote: score >= 4 ? field(f, "mayQuote") : "private",
            });
            if (ok) {
              setOpen(null);
              setThanked({ score, words: field(f, "words") ?? "" });
            }
            return ok;
          }}
        >
          <label className="wk-field wk-wide">
            <span>
              {score >= 4
                ? "Glad to hear it. What made the difference?"
                : "What should we do better?"}
            </span>
            <textarea name="words" rows={3} maxLength={4000} defaultValue={m.mine?.words ?? ""} />
          </label>
          {score >= 4 ? (
            <label className="wk-field">
              <span>May we quote you?</span>
              <select name="mayQuote" defaultValue={m.mine?.mayQuote ?? "private"}>
                {QUOTE_CHOICES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Form>
      )}
    </Section>
  );
}

/** Wren's team: every review so far, newest moment first. */
function Reviews({ moments }: { moments: MomentView[] }) {
  const said = moments.filter((m) => m.reviews.some((r) => r.score !== null));
  if (said.length === 0) return null;
  const quote = Object.fromEntries(QUOTE_CHOICES);
  return (
    <Section title="Reviews">
      <ul className="wk-list">
        {said.flatMap((m) =>
          m.reviews
            .filter((r) => r.score !== null)
            .map((r) => (
              <li key={`${m.moment} ${r.email}`}>
                <span className="wk-quiet">
                  {m.label}, {dayLabel(m.reachedOn)}
                </span>{" "}
                <b>{REVIEW_WORDS[r.score ?? 0]}</b> from {r.email}
                {r.words ? `: "${r.words}"` : ""} <Tag>{quote[r.mayQuote]}</Tag>
              </li>
            )),
        )}
      </ul>
    </Section>
  );
}

/** From halfway (D13): what they can do next with us, one tap to hear more. */
function Next({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  if (e.next.length === 0) return null;
  return (
    <Section title="When you're ready for more">
      <ul className="wk-list">
        {e.next.map((o) => (
          <li key={o.id}>
            <b>{o.name}.</b> {o.pitch}{" "}
            {props.team ? null : o.interested ? (
              <Tag>We'll be in touch</Tag>
            ) : (
              <Button
                size="sm"
                tone="secondary"
                disabled={act.busy || props.demo}
                onClick={() => void act.run("interest", { engagementId: e.id, offerId: o.id })}
              >
                I'm interested
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * After a review (D13). A happy one (4 or 5) gets a one-tap way to post it on Google,
 * words copied; a low one stays with us (William, 10-01).
 */
function Thanks({ score, words }: { score: number; words: string }) {
  if (!GOOGLE_REVIEW_URL || score < 4)
    return (
      <Callout>Thanks. William reads every review{score < 4 ? " and will follow up" : ""}.</Callout>
    );
  const url = GOOGLE_REVIEW_URL;
  return (
    <Section title="Thank you. Would you post it on Google?">
      <p>
        It helps other firms find us.{" "}
        {words ? "Tap below and your words are copied, ready to paste." : ""}
      </p>
      <div className="wk-tools">
        <Button
          size="sm"
          onClick={() => {
            if (words) void navigator.clipboard?.writeText(words).catch(() => undefined);
            window.open(url, "_blank", "noopener");
          }}
        >
          Post it on Google
        </Button>
      </div>
    </Section>
  );
}
