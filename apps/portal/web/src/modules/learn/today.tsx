/**
 * Learn's Today: your daily digest. What came in over the last 24 hours, best first, each with
 * its score and one line, and whether the bell rang for it or held it for the hour's limit. Then
 * your pick for saved links, and whether this workspace mails the digest (off until someone who
 * manages it turns it on).
 */
import {
  Alert,
  Button,
  ButtonLink,
  cx,
  Empty,
  Loading,
  PageHeader,
  relative,
  Section,
  Tag,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useEffect, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import {
  type AlertPick,
  type AlertSettings,
  inWorkspace,
  keyOf,
  learn,
  onChanged,
  type TodayLine,
} from "./api.js";
import { LearnFrame } from "./frame.js";
import { ScoreBadge, TypeMark } from "./kinds.js";
import { act } from "./menus.js";

/** Each pick as a person reads it. */
export const PICKS: [AlertPick, string][] = [
  ["every", "Every post"],
  ["top", "High score"],
  ["off", "Off"],
];

/** Every post, high score only, or off: a row of three, one pressed. */
export function PickGroup({
  value,
  onPick,
  label,
  only,
  className,
}: {
  value: AlertPick | null;
  onPick: (p: AlertPick) => void;
  label: string;
  only?: readonly AlertPick[];
  className?: string;
}) {
  const shown = PICKS.filter(([id]) => !only || only.includes(id));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex border border-(--ui-hair) bg-(--ui-paper)", className)}
    >
      {shown.map(([id, name]) => {
        const on = value === id;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a pressed row of buttons reads better than radios here.
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onPick(id)}
            className={cx(
              "h-8 cursor-pointer border-0 border-(--ui-hair) border-l px-2.5 text-[12.5px] first:border-l-0",
              on
                ? "bg-(--ui-ink) font-medium text-(--ui-on-ink)"
                : "bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

export function TodayPage({ client }: PageProps) {
  inWorkspace(client);
  return (
    <LearnFrame here="today">
      <TodayBody />
    </LearnFrame>
  );
}

function TodayBody() {
  const today = useCall(keyOf("learn.today"), learn.today);
  const settings = useCall(keyOf("learn.alerts"), learn.alerts);
  const { retry: again } = today;
  const { retry: againSettings } = settings;
  useEffect(() => onChanged(again), [again]);
  useEffect(() => onChanged(againSettings), [againSettings]);
  const t = today.data;
  const s = settings.data;
  const lede = !t
    ? "The last 24 hours, best first."
    : t.total
      ? `${t.total} new in the last 24 hours, best first.`
      : "Nothing new in the last 24 hours.";
  return (
    <div className="pb-16">
      <PageHeader
        title="Today"
        lede={lede}
        actions={
          <ButtonLink href="/learn/sources" size="dense" tone="secondary">
            Sources
          </ButtonLink>
        }
      />
      {today.error && !t ? (
        <Alert onRetry={today.retry}>{today.error.message}</Alert>
      ) : !t ? (
        <Loading lines={6} />
      ) : !t.items.length ? (
        <Empty>New posts from your sources and links you save land here as they're scored.</Empty>
      ) : (
        <Section
          title="New"
          note={
            t.held && s
              ? `${t.held} held back from your bell, which rings at most ${s.perHour} times an hour.`
              : undefined
          }
        >
          <ul className="m-0 list-none border-(--ui-hair) border-t p-0">
            {t.items.map((i) => (
              <Line key={i.id} i={i} />
            ))}
          </ul>
          {t.total > t.items.length ? (
            <p className="m-0 pt-3 text-[13px] text-(--ui-ink-2)">
              And {t.total - t.items.length} more in{" "}
              <a href="/learn/items?in=all&sort=score">All items</a>.
            </p>
          ) : null}
        </Section>
      )}
      {settings.error && !s ? (
        <Alert onRetry={settings.retry}>{settings.error.message}</Alert>
      ) : s ? (
        <>
          <Alerts s={s} />
          <Mail s={s} />
        </>
      ) : null}
    </div>
  );
}

const TOLD: Record<
  NonNullable<TodayLine["told"]>,
  { label: string; tone: "accent" | "neutral" }
> = {
  bell: { label: "Rang", tone: "accent" },
  digest: { label: "Held", tone: "neutral" },
};

function Line({ i }: { i: TodayLine }) {
  const told = i.told ? TOLD[i.told] : null;
  return (
    <li className="flex gap-3 border-(--ui-hair) border-b py-3">
      <span className="flex w-6 shrink-0 justify-center pt-0.5">
        {i.score !== null ? (
          <ScoreBadge score={i.score} />
        ) : (
          <span className="text-[12px] text-(--ui-ink-2)" title="Not scored yet">
            -
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={`/learn/items/${i.id}`}
          className={cx(
            "line-clamp-2 text-[14.5px] text-(--ui-ink) leading-5 no-underline hover:underline",
            i.read ? "font-normal" : "font-semibold",
          )}
        >
          {i.title}
        </a>
        {i.line ? (
          <p className="m-0 mt-0.5 text-[13.5px] text-(--ui-ink-2) text-pretty">{i.line}</p>
        ) : null}
        <p className="m-0 mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
          <TypeMark type={i.type} size={13} />
          <span className="truncate">{i.source}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{relative(new Date(i.at))}</span>
        </p>
      </div>
      {told ? (
        <Tag tone={told.tone} className="shrink-0 self-start">
          {told.label}
        </Tag>
      ) : null}
    </li>
  );
}

function Alerts({ s }: { s: AlertSettings }) {
  return (
    <Section
      title="Your alerts"
      note={`Your bell rings at most ${s.perHour} times an hour. The rest wait here.`}
      className="mt-6"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="m-0 font-medium text-[14px]">Links you save</p>
            <p className="m-0 text-[13px] text-(--ui-ink-2)">
              Rings once a saved link is read and scores 8 or more.
            </p>
          </div>
          <PickGroup
            label="Links you save"
            value={s.saved}
            only={["top", "off"]}
            onPick={(p) => void act(learn.pick("saved", p), "Saved")}
          />
        </div>
        <p className="m-0 border-(--ui-hair) border-t pt-3 text-[13px] text-(--ui-ink-2)">
          Each source has its own pick on <a href="/learn/sources">Sources</a>: every post, high
          score only, or off. Your picks are yours alone.
        </p>
      </div>
    </Section>
  );
}

function Mail({ s }: { s: AlertSettings }) {
  const [asking, setAsking] = useState(false);
  const turn = async (on: boolean) => {
    if (await act(learn.digestMail(on), on ? "Digest mail on" : "Digest mail off"))
      setAsking(false);
  };
  return (
    <Section
      title="Digest by email"
      note={
        s.mail.on
          ? `On. Each person here gets this list by email at 9:00, at the address they sign in with. Yours goes to ${s.mail.to}.`
          : "Off. Nothing is mailed. When it's on, each person here gets this list by email at 9:00, at the address they sign in with."
      }
      actions={
        s.mail.may ? (
          s.mail.on ? (
            <Button size="dense" tone="secondary" onClick={() => void turn(false)}>
              Turn off
            </Button>
          ) : (
            <Button size="dense" tone="secondary" onClick={() => setAsking(true)}>
              Turn on
            </Button>
          )
        ) : undefined
      }
      className="mt-6"
    >
      <div id="mail" className="text-[13px] text-(--ui-ink-2)">
        {s.mail.may
          ? "Only people who manage this workspace can change this."
          : "Someone who manages this workspace can turn it on."}
      </div>
      {asking ? (
        <Dialog open onOpenChange={(o) => (o ? null : setAsking(false))}>
          <DialogContent className="gap-3 sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mail everyone their digest?</DialogTitle>
              <DialogDescription>
                Each person with Learn here gets one email a day at 9:00, at the address they sign
                in with. Days with nothing new send nothing.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button size="dense" tone="secondary" onClick={() => setAsking(false)}>
                Keep it off
              </Button>
              <Button size="dense" onClick={() => void turn(true)}>
                Turn on
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Section>
  );
}
