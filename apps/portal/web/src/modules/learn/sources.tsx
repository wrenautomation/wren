/**
 * Learn's Sources, grouped by kind: follow a channel, podcast, newsletter or blog by its page or
 * feed, say how loud each is, stop one. Each opens to its items. Each card has your own alert
 * pick; a manager also sets the workspace's under it (everyone without a pick, and on Wren's,
 * the Discord push).
 */
import {
  Button,
  clipProps,
  cx,
  Empty,
  FormKept,
  LATEST,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  Rows,
  type RowsLine,
  relative,
  SelectField,
  say,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { toast } from "@wren/ui/lib/toast";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { useFolds } from "../../use-folds.js";
import {
  type AlertPick,
  clientOf,
  inWorkspace,
  keyOf,
  learn,
  onChanged,
  type SourceRow,
} from "./api.js";
import { FindCreators } from "./find.js";
import { Avatar, KIND_LABELS, KIND_TYPE, TypeMark } from "./kinds.js";
import { act } from "./menus.js";
import { PICKS } from "./today.js";

/** What a new source rings for, for everyone here who hasn't picked their own. */
const TELLS = [
  ["top", "High score"],
  ["every", "Every post"],
  ["digest", "Off"],
] as const;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The sources by kind: a fold for each kind, its sources under it. */
function linesOf(
  kinds: { kind: SourceRow["kind"]; sources: SourceRow[] }[],
): RowsLine<SourceRow>[] {
  const out: RowsLine<SourceRow>[] = [];
  for (const k of kinds) {
    out.push({
      kind: "group",
      key: k.kind,
      label: (
        <span className="inline-flex items-center gap-2">
          <TypeMark type={KIND_TYPE[k.kind]} size={16} />
          {KIND_LABELS[k.kind]}
        </span>
      ),
    });
    for (const s of k.sources)
      out.push({ kind: "row", key: String(s.id), index: out.length, row: s });
  }
  return out;
}

export function SourcesPage({ client }: PageProps) {
  inWorkspace(client);
  return <SourcesBody title="Sources" />;
}

/** The list with the search on top; Marketing → Feed shows it too, one set of follows. */
export function SourcesBody({ title, tabs }: { title: string; tabs?: ReactNode }) {
  const load = useCall(keyOf("learn.sources"), learn.sources);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  const narrow = useNarrow();
  const folds = useFolds();
  const may = load.data?.may ?? false;
  const kinds = load.data?.kinds.filter((k) => k.sources.length) ?? [];
  const total = kinds.reduce((n, k) => n + k.sources.length, 0);
  return (
    <div className="flex flex-col gap-8 pb-16">
      <header className="flex flex-col gap-4 border-(--ui-hair) border-b pb-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className={PAGE_TITLE}>{title}</h1>
          {load.data ? (
            <span className="text-[14px] text-(--ui-ink-2) tabular-nums">{total}</span>
          ) : null}
        </div>
        {tabs}
        {clientOf() === null ? <FindCreators /> : null}
        <Follow />
      </header>
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={4} shape="rows" />
      ) : !kinds.length ? (
        <Empty>
          Paste a channel, podcast, newsletter, blog or creator above. Its page works, and so does
          its feed. Instagram, X and TikTok creators work by their profile address. New posts are
          read, summed up and scored, then land in your Inbox.
        </Empty>
      ) : (
        <Rows<SourceRow>
          label="sources"
          noun="source"
          narrow={narrow}
          scroller="window"
          lines={linesOf(kinds)}
          group={folds}
          name={{
            label: "Source",
            icon: "user",
            min: 200,
            title: (s) => s.name,
            href: (s) => `/learn/items?in=s${s.id}`,
            mark: (s) => <Avatar url={s.avatar} name={s.name} size={24} />,
            weight: (s) =>
              s.stopped ? "font-[650] text-(--ui-ink-2)" : "font-[650] text-(--ui-ink)",
            // A phone's facts line already says how many are new.
            tail: (s) =>
              s.fresh && !narrow ? (
                <span className="shrink-0 bg-(--ui-live) px-1.5 py-0.5 font-semibold text-(--ui-on-accent) text-[11.5px] tabular-nums">
                  {s.fresh} new
                </span>
              ) : null,
            // A phone has one column: the rest of the card goes under the name.
            sub: (s) => (narrow ? <SourceSub s={s} may={may} /> : <SourceHost s={s} />),
          }}
          columns={[
            {
              key: "facts",
              label: "Reads",
              icon: "text",
              min: 180,
              cell: (s) => factsOf(s).join(" · "),
            },
            {
              key: "alerts",
              label: "Your alerts",
              icon: "alert",
              width: 130,
              phone: true,
              cell: (s) => (s.stopped ? <Stopped /> : <AlertSelect s={s} />),
            },
            ...(may
              ? [
                  {
                    key: "tell",
                    label: clientOf() === null ? "Everyone and Discord" : "Everyone here",
                    icon: "people" as const,
                    width: 140,
                    cell: (s: SourceRow) => (s.stopped ? null : <TellSelect s={s} />),
                  },
                ]
              : []),
            {
              key: "stop",
              label: "Stop",
              icon: "close",
              width: 120,
              cell: (s) => (s.stopped ? null : <StopButton s={s} />),
            },
          ]}
        />
      )}
    </div>
  );
}

function Follow() {
  // An address typed and not followed yet stays put: another page and back gives it again.
  const form = useEditForm({
    key: "learn:follow-address",
    defaults: { address: "", tell: "top" },
  });
  const flying = useRef(false);
  const submit = form.onSend(
    async (v) => {
      if (!v.address.trim() || flying.current) return false;
      flying.current = true;
      try {
        const f = await learn.follow(v.address.trim(), v.tell);
        say.done(
          `Following ${f.name}. ${f.items ? `Its last ${f.items} posts are in Archived; new ones` : "Its next posts"} land in your Inbox.`,
        );
      } catch (err) {
        say.failed(err);
        return false;
      } finally {
        flying.current = false;
      }
    },
    { clear: true },
  );
  return (
    <>
      <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
        <TextField
          form={form}
          name="address"
          type="url"
          placeholder="A channel, podcast, blog, or a creator's profile"
          aria-label="Address to follow"
          box="min-w-0 flex-1"
        />
        <div className="flex gap-2">
          <div className="inline-flex h-9 items-center text-[13px]">
            <SelectField
              form={form}
              name="tell"
              aria-label="Alerts for everyone here"
              box="h-full min-h-0 w-auto cursor-pointer px-2 py-0 text-[13px]"
              options={TELLS.map(([id, label]) => [id, `Alerts: ${label.toLowerCase()}`])}
            />
          </div>
          <Button
            tone="primary"
            size="dense"
            type="submit"
            busy={form.formState.isSubmitting}
            disabled={!form.watch("address").trim()}
            className="h-9"
          >
            Follow
          </Button>
        </div>
      </form>
      <FormKept form={form} what="address" />
    </>
  );
}

/**
 * A select saved as it changes: his pick shows at once, its writes go one at a time with the
 * newest last (two quick picks never land out of order), and a refusal puts the saved one back.
 */
function usePicked<T extends string>(
  key: string,
  server: T,
  send: (v: T) => Promise<unknown>,
  line: string,
): [T, (v: T) => void] {
  const [mine, setMine] = useState<T | null>(null);
  // A new read: what it says stands once nothing of his is on its way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new read clears his pick.
  useEffect(() => {
    if (!LATEST.busy(key)) setMine(null);
  }, [server]);
  const set = (v: T) => {
    setMine(v);
    void LATEST.write(key, v, send).then((r) => {
      if (r.status === "saved") toast.success(line);
      else if (r.status === "failed") {
        say.failed(r.error);
        if (!LATEST.busy(key)) setMine(null);
      }
    });
  };
  return [mine ?? server, set];
}

function factsOf(s: SourceRow) {
  return [
    s.fresh ? `${s.fresh} new` : null,
    `${s.items} ${s.items === 1 ? "item" : "items"}`,
    s.top !== null ? `best ${s.top}/10` : null,
    s.last ? `posted ${relative(new Date(s.last))}` : null,
  ].filter(Boolean) as string[];
}

const SELECT =
  "h-8 w-full cursor-pointer border border-(--ui-hair) bg-transparent px-2 text-[12.5px] text-(--ui-ink) outline-none";

const Stopped = () => <span className="text-[12.5px] text-(--ui-ink-2)">Not followed</span>;

/** Where it lives, under the name; a failed read shows beside it. */
function SourceHost({ s }: { s: SourceRow }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <a
        href={s.page ?? s.url}
        target="_blank"
        rel="noreferrer"
        className="truncate text-[12.5px] text-(--ui-ink-3) no-underline hover:text-(--ui-ink)"
        {...clipProps()}
      >
        {hostOf(s.page ?? s.url)}
      </a>
      <Failure s={s} />
    </span>
  );
}

function Failure({ s }: { s: SourceRow }) {
  return s.failure ? (
    <span className="border-(--ui-bad) border-l-2 pl-2 text-[12.5px] text-(--ui-bad)">
      Last read failed: {s.failure}
    </span>
  ) : null;
}

/** On a phone: the facts, the failure, the everyone pick and Stop, under the name. */
function SourceSub({ s, may }: { s: SourceRow; may: boolean }) {
  return (
    <div className="mt-1 flex flex-col gap-1.5 text-[12.5px] text-(--ui-ink-2)">
      <SourceHost s={s} />
      <span>{factsOf(s).join(" · ")}</span>
      {s.stopped ? (
        <Stopped />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {may ? <TellSelect s={s} className="w-auto" /> : null}
          <StopButton s={s} />
        </div>
      )}
    </div>
  );
}

function AlertSelect({ s }: { s: SourceRow }) {
  const [alertPick, pick] = usePicked<AlertPick>(
    `learn.pick:${s.id}`,
    s.alert ?? "top",
    (v) => learn.pick(s.id, v),
    "Saved",
  );
  return (
    <select
      aria-label={`Your alerts for ${s.name}`}
      value={alertPick}
      onChange={(e) => pick(e.target.value as AlertPick)}
      className={SELECT}
    >
      {PICKS.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}

function TellSelect({ s, className }: { s: SourceRow; className?: string }) {
  const [tell, setTell] = usePicked<string>(
    `learn.tell:${s.id}`,
    s.tell,
    (v) => learn.tell(s.id, v),
    "Saved for everyone",
  );
  return (
    <select
      aria-label={`${clientOf() === null ? "Everyone here and Discord" : "Everyone here"} for ${s.name}`}
      value={tell}
      onChange={(e) => setTell(e.target.value)}
      className={cx(SELECT, className)}
    >
      {TELLS.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}

function StopButton({ s }: { s: SourceRow }) {
  const [stopping, setStopping] = useState(false);
  // One stop per press: a quick second press while it is out sends nothing.
  const flying = useRef(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setStopping(true)}
        className="h-8 whitespace-nowrap border-0 bg-transparent px-2 text-[12.5px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
      >
        Stop following
      </button>
      {stopping ? (
        <Dialog open onOpenChange={(o) => (o ? null : setStopping(false))}>
          <DialogContent className="gap-3 sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Stop following {s.name}?</DialogTitle>
              <DialogDescription>
                Nothing new is read from it. Its items stay where they are.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button size="dense" tone="secondary" onClick={() => setStopping(false)}>
                Keep it
              </Button>
              <Button
                tone="primary"
                size="dense"
                onClick={async () => {
                  if (flying.current) return;
                  flying.current = true;
                  try {
                    if (await act(learn.unfollow(s.id), `Stopped following ${s.name}`))
                      setStopping(false);
                  } finally {
                    flying.current = false;
                  }
                }}
              >
                Stop following
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
