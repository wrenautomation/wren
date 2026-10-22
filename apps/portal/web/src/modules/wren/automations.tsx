/**
 * Automations → All (designs/2026-10-14-automations.md): everything that runs on its own, a card
 * each in the Marketplace's look: what starts it, its runs over 30 days, what failed and waits,
 * its last and next run, its last error and its switch. Every number opens the rows behind it.
 */
import type { AutomationKind, AutomationRow, AutomationState } from "@wren/core/automations";
import type { RecordsPage } from "@wren/core/records/serve";
import {
  ButtonLink,
  cx,
  Empty,
  Icon,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  recordPatch,
  relative,
  Tag,
  type TagTone,
  tipProps,
  useNarrow,
  whenTip,
} from "@wren/ui";
import { type ReactNode, useRef, useState } from "react";
import { ApiError, call } from "../../api.js";
import { patchCalls, useCall, useSettled } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";
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
        open: href("/engage/keywords", { keyword: ref }),
        runs: href("/engage/keyword-dms", { keyword: caught }),
        failed: href("/engage/keyword-dms", { view: "failed", keyword: caught }),
      };
    }
    default:
      return { open: "/engage/auto-reply" };
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

/** The numbers a row opens, as one cell each: what its kind counts, failed, waiting, last, next. */
const RUNS_WORD = (r: AutomationRow) =>
  r.kind === "loop" ? "running" : r.kind === "keyword" ? "caught" : `runs, ${DAYS}d`;

const RUNS_TIP = (r: AutomationRow) =>
  r.kind === "loop"
    ? "Keys running: open them"
    : r.kind === "keyword"
      ? "Comments caught: open the DMs"
      : `Runs in the last ${DAYS} days: open them`;

/** The Test run icon at a row's end: walks the workflow dry, nothing sends. */
function TestRun({ to }: { to: string }) {
  return (
    <a
      href={to}
      aria-label="Test run"
      className="inline-grid size-7 place-items-center text-(--ui-ink-3) no-underline [border-radius:var(--ui-leaf-button)] hover:bg-(--ui-accent-tint) hover:text-(--ui-link) focus-visible:outline-2 focus-visible:outline-(--ui-focus) pointer-coarse:size-11"
      {...tipProps("Test run: walk it dry with a made-up event. Nothing sends.")}
    >
      <Icon name="play" size={16} />
    </a>
  );
}

/** Automations as rows, a fold per kind: name, what starts it, its switch, its numbers. */
function AutomationRows({
  rows,
  busy,
  errors,
  onFlip,
}: {
  rows: AutomationRow[];
  busy: ReadonlySet<string>;
  errors: Record<string, string>;
  onFlip: (r: AutomationRow, on: boolean) => void;
}) {
  const narrow = useNarrow();
  const groups = GROUPS.flatMap((g) => {
    const these = rows.filter((r) => g.kinds.includes(r.kind));
    return these.length
      ? [{ key: g.label, label: <span {...tipProps(g.about)}>{g.label}</span>, rows: these }]
      : [];
  });
  return (
    <RowsPanel<AutomationRow>
      groups={groups}
      rowKey={(r) => r.id}
      label="automations"
      noun="automation"
      end={(r) => {
        const to = linksOf(r).test;
        return to ? <TestRun to={to} /> : null;
      }}
      name={{
        label: "Automation",
        icon: "text",
        width: 200,
        title: (r) => r.name,
        href: (r) => linksOf(r).open,
        // A phone's row has no columns: what starts it goes under the name. A failure shows on both.
        sub: (r) => {
          const failing = r.health === "failing" && r.error;
          const bad = errors[r.id];
          return narrow || failing || bad ? (
            <span className="grid gap-0.5 text-[12.5px]">
              {narrow ? <span className="line-clamp-2 text-(--ui-ink-2)">{r.trigger}</span> : null}
              {failing ? (
                <a
                  href={linksOf(r).failed ?? linksOf(r).open}
                  className="line-clamp-2 text-(--ui-bad) no-underline hover:underline"
                >
                  {r.error}
                </a>
              ) : null}
              {bad ? <span className="text-(--ui-bad)">{bad}</span> : null}
            </span>
          ) : null;
        },
      }}
      columns={[
        {
          key: "trigger",
          label: "Starts with",
          icon: "lines",
          min: 150,
          cell: (r) => (
            <span className="line-clamp-2 text-(--ui-ink-2)" {...tipProps(r.trigger)}>
              {r.trigger}
            </span>
          ),
        },
        {
          key: "state",
          label: "State",
          icon: "selected",
          width: 128,
          phone: true,
          cell: (r) => <StateCell r={r} busy={busy.has(r.id)} onFlip={(next) => onFlip(r, next)} />,
        },
        {
          key: "runs",
          label: "Runs, failed, waiting",
          icon: "hash",
          width: 210,
          cell: (r) =>
            r.runs !== null ? (
              <span className="whitespace-nowrap">
                <Count n={r.runs} to={linksOf(r).runs} label={RUNS_TIP(r)} /> {RUNS_WORD(r)}
                {r.failed ? (
                  <>
                    {" · "}
                    <Count n={r.failed} to={linksOf(r).failed} bad label="Open what failed" />
                    <span className="text-(--ui-bad)"> failed</span>
                  </>
                ) : null}
                {r.waiting ? (
                  <>
                    {" · "}
                    <Count n={r.waiting} to={linksOf(r).waiting} label="Open what waits" /> waiting
                  </>
                ) : null}
              </span>
            ) : (
              <span className={QUIET}>–</span>
            ),
        },
        {
          key: "last",
          label: "Last",
          icon: "clock",
          width: 104,
          quiet: true,
          cell: (r) => <When at={r.lastAt} empty={r.runs === null ? "–" : "never"} />,
        },
        {
          key: "next",
          label: "Next",
          icon: "clock",
          width: 104,
          quiet: true,
          cell: (r) => (r.nextAt ? <When at={r.nextAt} empty="" /> : null),
        },
      ]}
    />
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
  // Each row flipping, so two rows switched at once each keep their own busy.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const flying = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A read per pause in the search box, not per key.
  const asked = useSettled(q.trim());
  // One key per list: a flip patches the row in both, then re-reads this one for its tab counts.
  const list = useCall(`automations:${view}:${asked}`, () =>
    call<RecordsPage>("console/recordsList", {
      record: "console.automation",
      view,
      ...(asked ? { q: asked } : {}),
      limit: 200,
    }),
  );
  // The head's figures are over everything, whichever tab is open.
  const every = useCall("automations:all", () =>
    call<RecordsPage>("console/recordsList", { record: "console.automation", limit: 200 }),
  );
  const flip = async (r: AutomationRow, on: boolean) => {
    const asked = flipOf(r, on);
    if (!asked) return;
    if (flying.current.has(r.id)) return;
    if (!on && !confirm(`Turn off ${r.name}? Nothing new starts it until it's back on.`)) return;
    flying.current.add(r.id);
    setBusy(new Set(flying.current));
    setErrors(({ [r.id]: _, ...rest }) => rest);
    try {
      await call(asked[0], asked[1]);
      patchCalls(recordPatch("console.automation", r.id, { state: on ? "on" : "off" }));
      list.retry();
    } catch (err) {
      const why = err instanceof ApiError ? err.message : String(err);
      setErrors((e) => ({ ...e, [r.id]: why }));
    } finally {
      flying.current.delete(r.id);
      setBusy(new Set(flying.current));
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
        {/* edit-ok: search box */}
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
        <Loading shape="rows" lines={8} />
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
        <AutomationRows
          rows={rows}
          busy={busy}
          errors={errors}
          onFlip={(r, on) => void flip(r, on)}
        />
      )}
    </>
  );
}

/** The keyword DM: its own sender, set up on Marketing → Keywords, not a workflow. */
const KEYWORD_CARD = {
  name: "Comment keyword: DM the link",
  blurb: "Someone comments the word on your post and gets your DM. Runs on its own sender.",
  steps: ["A comment has the word", "DM them", "Reply to the comment"],
  href: "/engage/keywords",
  cta: "Add a keyword",
};

function TemplateCard({
  name,
  blurb,
  steps = [],
  note,
  href: to,
  cta,
}: {
  name: string;
  blurb: string;
  steps?: readonly string[];
  /** Why it can't run yet, when it can't. */
  note?: string | null;
  href: string;
  cta: string;
}) {
  return (
    <a
      href={to}
      className="flex h-full flex-col gap-1.5 border border-(--ui-hair) bg-(--ui-paper) p-4 text-left no-underline hover:bg-(--ui-wash)"
    >
      <span className="text-[14.5px] font-medium text-(--ui-ink)">{name}</span>
      <span className={cx("text-[13px]", QUIET)}>{blurb}</span>
      {steps.length ? (
        <ol className="m-0 mt-1 grid list-none gap-1 p-0 text-[12.5px] text-(--ui-ink-2)">
          {steps.map((s, i) => (
            <li key={s} className="flex items-baseline gap-2">
              <span className="w-4 shrink-0 text-right tabular-nums text-(--ui-ink-3)">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      ) : null}
      {note ? <span className="text-[12.5px] text-(--ui-ink-3)">{note}</span> : null}
      <span className="mt-auto pt-2 text-[13px] font-medium text-(--ui-link)">{cta}</span>
    </a>
  );
}

/**
 * New: a template, a description for Claude to draw, or a blank canvas. Each template is one the
 * code runs (the Shop's templates: `template:` on a workflow in apps/worker/src/workflows.ts, and
 * any saved from the canvas); its page installs it for a client.
 */
export function NewAutomation() {
  const list = useCall("automations-new:templates", () =>
    call<RecordsPage>("console/recordsList", {
      record: "console.component",
      where: { type: ["template"] },
      limit: 100,
    }),
  );
  const rows = (list.data?.rows ?? []) as unknown as {
    id: string;
    name: string;
    blurb: string;
    missing: string | null;
  }[];
  return (
    <>
      <PageHeader
        title="New automation"
        lede="Start from a template Wren runs: open it, pick the client and install. Or describe one below and Claude draws it."
      />
      {list.error && !list.data ? (
        <LoadFailed error={list.error} onRetry={list.retry} />
      ) : !list.data ? (
        <Loading lines={4} />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((t) => (
            <li key={t.id}>
              <TemplateCard
                name={t.name}
                blurb={t.blurb}
                note={t.missing}
                href={`/marketplace/catalog/${encodeURIComponent(t.id)}`}
                cta="Open"
              />
            </li>
          ))}
          <li>
            <TemplateCard {...KEYWORD_CARD} />
          </li>
        </ul>
      )}
      <MadeHere client={null} />
    </>
  );
}
