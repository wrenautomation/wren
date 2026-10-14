/**
 * Automations → All (designs/2026-10-14-automations.md): everything that runs on its own, one row
 * each: what starts it, its runs over 30 days, what failed and waits, its last and next run, its
 * last error and its switch. Every number opens the rows behind it.
 */
import type { AutomationKind, AutomationRow, AutomationState } from "@wren/core/automations";
import type { RecordsPage } from "@wren/core/records/serve";
import {
  ButtonLink,
  cx,
  Empty,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  relative,
  Tag,
  type TagTone,
  tipProps,
  whenTip,
} from "@wren/ui";
import { type ReactNode, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { MadeHere } from "./made.js";

const DAYS = 30;
const VIEWS = [
  { id: "all", label: "All" },
  { id: "failing", label: "Failing" },
  { id: "off", label: "Off" },
] as const;

/** Each kind's section, in the order they show. */
const GROUPS: { kinds: AutomationKind[]; label: string; about: string }[] = [
  {
    kinds: ["made", "workflow"],
    label: "Workflows",
    about: "Run on the spine, one person or item at a time.",
  },
  {
    kinds: ["keyword"],
    label: "Comment keyword DMs",
    about: "A comment with the word gets the DM.",
  },
  { kinds: ["reply"], label: "Auto-replies", about: "What happens when someone writes in." },
  { kinds: ["loop"], label: "Loops", about: "Background passes: sync, send, read." },
];

const STATE: Record<AutomationState, { label: string; tone: TagTone }> = {
  on: { label: "On", tone: "green" },
  off: { label: "Off", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  suggest: { label: "Suggests", tone: "accent" },
  auto: { label: "Auto (held)", tone: "accent" },
};

/** Where a row and each of its numbers open. */
export function linksOf(r: Pick<AutomationRow, "kind" | "ref" | "name">): {
  open: string;
  runs?: string;
  failed?: string;
  waiting?: string;
  test?: string;
} {
  const ref = r.ref;
  switch (r.kind) {
    case "made":
    case "workflow": {
      const canvas = `/workflows/canvas?path=${encodeURIComponent(ref)}`;
      return {
        open: canvas,
        runs: `${canvas}&pane=runs`,
        failed: `${canvas}&pane=runs&runs=failed`,
        waiting: `${canvas}&pane=runs&runs=waiting`,
        test: `${canvas}&test=1`,
      };
    }
    case "loop":
      return {
        open: href("/loops/all", { q: ref }),
        runs: href("/loops/all", { q: ref, state: "running" }),
        failed: href("/loops/all", { view: "failing", q: ref }),
      };
    case "keyword": {
      // Its catches, by the word in its name ("Comment “GUIDE” → DM").
      const word = /“(.+)”/.exec(r.name)?.[1];
      const caught = word ? `~${word}` : null;
      return {
        open: href("/marketing/keywords", { keyword: ref }),
        runs: href("/marketing/keyword-dms", { keyword: caught }),
        failed: href("/marketing/keyword-dms", { view: "failed", keyword: caught }),
      };
    }
    default:
      return { open: "/marketing/auto-reply" };
  }
}

/** A number that opens its rows; a dash where it doesn't apply, plain where it has nowhere. */
function Count({
  n,
  to,
  bad,
  label,
}: {
  n: number | null;
  to?: string | undefined;
  bad?: boolean;
  label: string;
}) {
  if (n === null) return <span className={QUIET}>–</span>;
  const cls = cx("tabular-nums", n > 0 && bad ? "font-semibold text-(--ui-bad)" : n === 0 && QUIET);
  return to ? (
    <a href={to} className={cx(cls, "no-underline hover:underline")} {...tipProps(label)}>
      {n.toLocaleString()}
    </a>
  ) : (
    <span className={cls}>{n.toLocaleString()}</span>
  );
}

function When({ at, empty }: { at: string | null; empty: string }) {
  if (!at) return <span className={QUIET}>{empty}</span>;
  const d = new Date(at);
  return (
    <span className="tabular-nums" {...tipProps(whenTip(d, relative(d)))}>
      {relative(d)}
    </span>
  );
}

/** On or off, for a row that has a switch here. Off waits on a confirm; on goes at once. */
function Switch({
  on,
  busy,
  label,
  onFlip,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onFlip}
      className={cx(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 pointer-coarse:h-7 pointer-coarse:w-12",
        on ? "border-(--ui-good) bg-(--ui-good)" : "border-(--ui-line) bg-(--ui-tile)",
      )}
      {...tipProps(label)}
    >
      <span
        className={cx(
          "absolute top-[2px] size-4 rounded-full bg-(--ui-paper) shadow-sm transition-[left] pointer-coarse:size-[22px]",
          on ? "left-[18px] pointer-coarse:left-[22px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

/** The call a row's switch makes; none for a row whose switch lives on its own page. */
function flipOf(r: AutomationRow, on: boolean): [string, Record<string, unknown>] | null {
  if (r.kind === "made" && r.state !== "draft")
    return ["console/workflowSwitch", { workflow: r.ref, on }];
  if (r.kind === "keyword")
    return [
      "console/recordsEdit",
      { record: "marketing.comment_keyword", id: r.ref, patch: { state: on ? "on" : "off" } },
    ];
  return null;
}

function StateCell({
  r,
  busy,
  onFlip,
}: {
  r: AutomationRow;
  busy: boolean;
  onFlip: (on: boolean) => void;
}) {
  const s = STATE[r.state];
  const on = r.state === "on";
  if (flipOf(r, !on))
    return (
      <span className="flex items-center gap-2">
        <Switch
          on={on}
          busy={busy}
          label={on ? `Turn ${r.name} off` : `Turn ${r.name} on`}
          onFlip={() => onFlip(!on)}
        />
        <span className={cx("text-[13px]", !on && QUIET)}>{s.label}</span>
      </span>
    );
  // Built-in workflows run by their loops; loops and auto-replies switch on their own page.
  const why =
    r.kind === "workflow"
      ? "Built in: it runs while its loops run"
      : r.kind === "loop"
        ? "Start or stop each key on Loops"
        : r.kind === "reply"
          ? "Set Off, Suggest or Auto on Auto-reply"
          : "Publish it to switch it on";
  return (
    <span {...tipProps(why)}>
      <Tag tone={s.tone} dot>
        {s.label}
      </Tag>
    </span>
  );
}

const COLS =
  "grid grid-cols-[minmax(0,1fr)_128px_72px_64px_64px_104px_104px] items-center gap-x-4 max-[900px]:grid-cols-[minmax(0,1fr)_auto]";
const HEAD = "text-[12px] font-medium text-(--ui-ink-2)";

function Row({
  r,
  busy,
  error,
  onFlip,
}: {
  r: AutomationRow;
  busy: boolean;
  error: string | null;
  onFlip: (on: boolean) => void;
}) {
  const to = linksOf(r);
  const failing = r.health === "failing";
  return (
    <li className={cx(COLS, "border-b border-(--ui-hair) px-3 py-3 hover:bg-(--ui-hover)")}>
      <div className="grid min-w-0 gap-0.5">
        <a
          href={to.open}
          className="truncate text-[14.5px] font-medium text-(--ui-ink) no-underline hover:underline"
          {...tipProps(r.name, { as: "none" })}
        >
          {r.name}
        </a>
        <span className={cx("truncate text-[13px]", QUIET)} {...tipProps(r.trigger)}>
          {r.trigger}
        </span>
        {failing && r.error ? (
          <a
            href={to.failed ?? to.open}
            className="line-clamp-2 text-[13px] text-(--ui-bad) no-underline hover:underline"
          >
            {r.error}
          </a>
        ) : null}
        {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
        {to.test ? (
          <a
            href={to.test}
            className="w-fit text-[12.5px] text-(--ui-link) no-underline hover:underline"
            {...tipProps("Walk it dry with a made-up event: nothing sends")}
          >
            Test run
          </a>
        ) : null}
        {/* A phone has no columns: the numbers ride under the name. */}
        <span className={cx("hidden flex-wrap gap-x-3 text-[12.5px] max-[900px]:flex", QUIET)}>
          {r.runs !== null ? (
            <span>
              <Count n={r.runs} to={to.runs} label="Open the runs" />{" "}
              {r.kind === "loop" ? "running" : r.kind === "keyword" ? "caught" : "runs"}
            </span>
          ) : null}
          {r.failed ? (
            <span>
              <Count n={r.failed} to={to.failed} bad label="Open what failed" /> failed
            </span>
          ) : null}
          {r.waiting ? (
            <span>
              <Count n={r.waiting} to={to.waiting} label="Open what waits" /> waiting
            </span>
          ) : null}
          {r.lastAt ? (
            <span>
              Last <When at={r.lastAt} empty="" />
            </span>
          ) : null}
        </span>
      </div>
      <StateCell r={r} busy={busy} onFlip={onFlip} />
      <span className="text-right max-[900px]:hidden">
        <Count
          n={r.runs}
          to={to.runs}
          label={
            r.kind === "loop"
              ? "Keys running: open them"
              : r.kind === "keyword"
                ? "Comments caught: open the DMs"
                : `Runs in the last ${DAYS} days: open them`
          }
        />
      </span>
      <span className="text-right max-[900px]:hidden">
        <Count n={r.failed} to={to.failed} bad label="Open what failed" />
      </span>
      <span className="text-right max-[900px]:hidden">
        <Count n={r.waiting} to={to.waiting} label="Open what waits" />
      </span>
      <span className="text-right text-[13px] max-[900px]:hidden">
        <When at={r.lastAt} empty={r.runs === null ? "–" : "Never"} />
      </span>
      <span className="text-right text-[13px] max-[900px]:hidden">
        <When at={r.nextAt} empty="–" />
      </span>
    </li>
  );
}

function Head() {
  return (
    <div className={cx(COLS, "border-b border-(--ui-hair) px-3 pb-2 max-[900px]:hidden")}>
      <span className={HEAD}>Automation · starts when</span>
      <span className={HEAD}>State</span>
      <span className={cx(HEAD, "text-right")}>Runs, {DAYS}d</span>
      <span className={cx(HEAD, "text-right")}>Failed</span>
      <span className={cx(HEAD, "text-right")}>Waiting</span>
      <span className={cx(HEAD, "text-right")}>Last run</span>
      <span className={cx(HEAD, "text-right")}>Next</span>
    </div>
  );
}

function Figure({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  const body = (
    <>
      <span className="block text-[24px] font-semibold tabular-nums leading-tight">{value}</span>
      <span className={cx("text-[12.5px]", QUIET)}>{label}</span>
    </>
  );
  return to ? (
    <a href={to} className="block text-(--ui-ink) no-underline hover:underline">
      {body}
    </a>
  ) : (
    <span className="block">{body}</span>
  );
}

export function Automations({ params }: PageProps) {
  const view = VIEWS.some((v) => v.id === params.get("view"))
    ? (params.get("view") as string)
    : "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = useCall(`automations:${view}:${q.trim()}:${nonce}`, () =>
    call<RecordsPage>("console/recordsList", {
      record: "console.automation",
      view,
      ...(q.trim() ? { q: q.trim() } : {}),
      limit: 200,
    }),
  );
  // The head's figures are over everything, whichever tab is open.
  const every = useCall(`automations:all:${nonce}`, () =>
    call<RecordsPage>("console/recordsList", { record: "console.automation", limit: 200 }),
  );
  const flip = async (r: AutomationRow, on: boolean) => {
    const asked = flipOf(r, on);
    if (!asked) return;
    if (!on && !confirm(`Turn off ${r.name}? Nothing new starts it until it's back on.`)) return;
    setBusy(r.id);
    setErrors(({ [r.id]: _, ...rest }) => rest);
    try {
      await call(asked[0], asked[1]);
      setNonce((n) => n + 1);
    } catch (err) {
      const why = err instanceof ApiError ? err.message : String(err);
      setErrors((e) => ({ ...e, [r.id]: why }));
    } finally {
      setBusy(null);
    }
  };
  const all = (every.data?.rows ?? []) as unknown as AutomationRow[];
  const rows = (list.data?.rows ?? []) as unknown as AutomationRow[];
  const here = "/workflows/all";
  const on = all.filter((r) => r.state === "on" || r.state === "suggest" || r.state === "auto");
  const runs = all
    .filter((r) => r.kind === "workflow" || r.kind === "made")
    .reduce((n, r) => n + (r.runs ?? 0), 0);
  return (
    <>
      <PageHeader
        title="Automations"
        lede={`Everything that runs on its own, with what starts it and how it went. Numbers are the last ${DAYS} days.`}
        actions={
          <ButtonLink href="/workflows/new" tone="primary">
            New automation
          </ButtonLink>
        }
      />
      {every.data ? (
        <div className="mb-8 grid max-w-2xl grid-cols-4 gap-6 max-[600px]:grid-cols-2">
          <Figure label="On" value={on.length} />
          <Figure
            label="Failing"
            value={all.filter((r) => r.health === "failing").length}
            to={href(here, { view: "failing" })}
          />
          <Figure
            label="Off or draft"
            value={all.filter((r) => r.state === "off" || r.state === "draft").length}
            to={href(here, { view: "off" })}
          />
          <Figure label={`Workflow runs, ${DAYS} days`} value={runs} to="/workflows/runs" />
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Which automations">
          {VIEWS.map((v) => (
            <a
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              href={href(here, { view: v.id === "all" ? null : v.id }, params)}
              className={cx(
                "h-8 px-3 text-[13.5px] leading-8 no-underline",
                view === v.id
                  ? "bg-(--ui-ink) text-(--ui-paper)"
                  : "text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
              )}
            >
              {v.label}
              {list.data?.counts[v.id] !== undefined ? (
                <span className="ml-1.5 tabular-nums opacity-70">{list.data.counts[v.id]}</span>
              ) : null}
            </a>
          ))}
        </div>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an automation"
          aria-label="Find an automation"
          className="h-8 max-w-xs text-[13.5px]"
        />
      </div>
      {list.error && !list.data ? (
        <LoadFailed error={list.error} onRetry={list.retry} />
      ) : !list.data ? (
        <Loading lines={8} />
      ) : !rows.length ? (
        <Empty>
          {q
            ? "Nothing matches that."
            : view === "failing"
              ? "Nothing is failing."
              : view === "off"
                ? "Everything is on."
                : "Nothing runs on its own yet."}
        </Empty>
      ) : (
        GROUPS.map((g) => {
          const these = rows.filter((r) => g.kinds.includes(r.kind));
          if (!these.length) return null;
          return (
            <section key={g.label} className="mb-9">
              <h2 className="mb-0.5 text-[15px] font-semibold">
                {g.label}{" "}
                <span className={cx("font-normal tabular-nums", QUIET)}>{these.length}</span>
              </h2>
              <p className={cx("mb-3 text-[13px]", QUIET)}>{g.about}</p>
              <Head />
              <ul className="m-0 list-none p-0">
                {these.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    busy={busy === r.id}
                    error={errors[r.id] ?? null}
                    onFlip={(next) => void flip(r, next)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

/** New: describe one for Claude to draw, or start blank. Nothing runs until it's published. */
export function NewAutomation() {
  return (
    <>
      <PageHeader title="New automation" />
      <MadeHere client={null} />
    </>
  );
}
