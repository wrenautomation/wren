/**
 * Under a project's numbers, on its app's Overview: the review asked at each moment (D13), what
 * they can do next with us, and the weekly pulse (D10). The Friday mail's pulse and review links
 * land here too. A client's own, so never on the demo.
 */
import { GOOGLE_REVIEW_URL, PULSE_WORDS, REVIEW_WORDS } from "@wren/delivery/routes";
import { Button, Callout, Section, Tag, Textarea } from "@wren/ui";
import { Fragment, useEffect, useState } from "react";
import type { EngagementView, MomentView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import {
  dayLabel,
  FIELD,
  Form,
  field,
  LIST,
  ofThisApp,
  QUIET,
  SELECT,
  TOOLS,
  useAct,
  useWork,
  WIDE,
} from "./bits.js";
import { at } from "./nav.js";

export function Feedback(props: PageProps) {
  return props.demo ? null : <Mine {...props} />;
}

function Mine(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  usePulseLink(props, act);
  const rated = useReviewLink(props, act);
  return (
    <div className="mx-auto mt-10 grid w-full max-w-[1200px] gap-8">
      {act.error ? (
        <p className="text-[13.5px] text-(--ui-bad)" role="alert">
          {act.error}
        </p>
      ) : null}
      {ofThisApp(work.data?.engagements ?? []).map((e) => (
        <Fragment key={e.id}>
          {e.status !== "onboarding" && e.updates.length === 0 ? (
            <Callout>
              Welcome. Your plan is dated from {dayLabel(e.startsOn)}. We post updates as the work
              moves, and anything we need from you shows under Needs you.{" "}
              <a href={at("welcome")}>The welcome guide</a> has the rest.
            </Callout>
          ) : null}
          <Review e={e} props={props} act={act} rated={rated} />
          <Next e={e} props={props} act={act} />
          <Pulse e={e} props={props} act={act} />
        </Fragment>
      ))}
    </div>
  );
}

/** `?pulse=4&e=12` from the Friday mail: record the tap, then drop it from the address. */
function usePulseLink({ params, team }: PageProps, act: ReturnType<typeof useAct>) {
  const score = Number(params.get("pulse"));
  const engagementId = Number(params.get("e")) || undefined;
  useEffect(() => {
    if (!score) return;
    if (!team) void act.run("pulse", { engagementId, score });
    navigate(href(location.pathname, { pulse: null, e: null }, params), true);
  }, [score, engagementId, team, act.run, params]);
}

/**
 * `?review=halfway&score=5&e=12` or `?next=<offer>&e=12` from a moment's mail: record the
 * tap, drop it from the address, and say which moment was rated so its card asks for a line.
 */
function useReviewLink({ params, team }: PageProps, act: ReturnType<typeof useAct>) {
  const [rated, setRated] = useState<string | null>(null);
  const moment = params.get("review");
  const score = Number(params.get("score"));
  const offerId = params.get("next");
  const engagementId = Number(params.get("e")) || undefined;
  useEffect(() => {
    if (!moment && !offerId) return;
    if (!team) {
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
  }, [moment, score, offerId, engagementId, team, act.run, params]);
  return rated;
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
      <div className={TOOLS}>
        {[5, 4, 3, 2, 1].map((n) => (
          <Button
            key={n}
            size="dense"
            tone={mine === n ? "primary" : "secondary"}
            aria-pressed={mine === n}
            disabled={act.busy}
            onClick={() => void act.run("pulse", { engagementId: e.id, score: n })}
          >
            {PULSE_WORDS[n]}
          </Button>
        ))}
      </div>
      <p className={QUIET}>
        {mine
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
      <div className={TOOLS}>
        {[5, 4, 3, 2, 1].map((n) => (
          <Button
            key={n}
            size="dense"
            tone={score === n ? "primary" : "secondary"}
            aria-pressed={score === n}
            disabled={act.busy}
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
            disabled={act.busy}
            onClick={() => void send({ score: null })}
          >
            Not now
          </Button>
        ) : null}
      </div>
      {score === null ? (
        <p className={QUIET}>One tap. It reaches William.</p>
      ) : (
        <Form
          label="Say more"
          submit="Send"
          act={act}
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
          <label className={`${FIELD} ${WIDE}`}>
            <span>
              {score >= 4
                ? "Glad to hear it. What made the difference?"
                : "What should we do better?"}
            </span>
            <Textarea name="words" rows={3} maxLength={4000} defaultValue={m.mine?.words ?? ""} />
          </label>
          {score >= 4 ? (
            <label className={FIELD}>
              <span>May we quote you?</span>
              <select
                className={SELECT}
                name="mayQuote"
                defaultValue={m.mine?.mayQuote ?? "private"}
              >
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
      <ul className={LIST}>
        {said.flatMap((m) =>
          m.reviews
            .filter((r) => r.score !== null)
            .map((r) => (
              <li key={`${m.moment} ${r.email}`}>
                <span className={QUIET}>
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
      <ul className={LIST}>
        {e.next.map((o) => (
          <li key={o.id}>
            <b>{o.name}.</b> {o.pitch}{" "}
            {props.team ? null : o.interested ? (
              <Tag>We'll be in touch</Tag>
            ) : (
              <Button
                size="dense"
                tone="secondary"
                disabled={act.busy}
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
      <div className={TOOLS}>
        <Button
          size="dense"
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
