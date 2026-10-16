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
  relative,
  SECTION_TITLE,
  SelectField,
  say,
  TextField,
  useEditForm,
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

export function SourcesPage({ client }: PageProps) {
  inWorkspace(client);
  return <SourcesBody title="Sources" />;
}

/** The list with the search on top; Marketing → Feed shows it too, one set of follows. */
export function SourcesBody({ title, tabs }: { title: string; tabs?: ReactNode }) {
  const load = useCall(keyOf("learn.sources"), learn.sources);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
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
        <Loading lines={4} shape="cards" />
      ) : !kinds.length ? (
        <Empty>
          Paste a channel, podcast, newsletter, blog or creator above. Its page works, and so does
          its feed. Instagram, X and TikTok creators work by their profile address. New posts are
          read, summed up and scored, then land in your Inbox.
        </Empty>
      ) : (
        kinds.map((k) => (
          <section key={k.kind} className="flex flex-col gap-3">
            <h2 className={cx("m-0 flex items-center gap-2", SECTION_TITLE)}>
              <TypeMark type={KIND_TYPE[k.kind]} size={18} />
              {KIND_LABELS[k.kind]}
              <span className="font-normal text-[14px] text-(--ui-ink-2) tabular-nums">
                {k.sources.length}
              </span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {k.sources.map((s) => (
                <SourceCard key={s.id} s={s} may={load.data?.may ?? false} />
              ))}
            </div>
          </section>
        ))
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

function SourceCard({ s, may }: { s: SourceRow; may: boolean }) {
  const [stopping, setStopping] = useState(false);
  const [alertPick, pick] = usePicked<AlertPick>(
    `learn.pick:${s.id}`,
    s.alert ?? "top",
    (v) => learn.pick(s.id, v),
    "Saved",
  );
  const [tell, setTell] = usePicked<string>(
    `learn.tell:${s.id}`,
    s.tell,
    (v) => learn.tell(s.id, v),
    "Saved for everyone",
  );
  const facts = [
    s.fresh ? `${s.fresh} new` : null,
    `${s.items} ${s.items === 1 ? "item" : "items"}`,
    s.top !== null ? `best ${s.top}/10` : null,
    s.last ? `posted ${relative(new Date(s.last))}` : null,
  ].filter(Boolean);
  return (
    <div
      className={cx(
        "flex flex-col gap-3 border border-(--ui-hair) p-4",
        // Stopped reads as set aside by its ground, not by fading: faded text fails 4.5:1.
        s.stopped ? "bg-(--ui-wash)" : "bg-(--ui-paper)",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Avatar url={s.avatar} name={s.name} size={40} />
        <div className="min-w-0 flex-1">
          <a
            href={`/learn/items?in=s${s.id}`}
            className="block truncate font-semibold text-[14.5px] text-(--ui-ink) no-underline hover:underline"
            {...clipProps()}
          >
            {s.name}
          </a>
          <a
            href={s.page ?? s.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[12.5px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
            {...clipProps()}
          >
            {hostOf(s.page ?? s.url)}
          </a>
        </div>
        {s.fresh ? (
          <span className="shrink-0 bg-(--ui-live) px-1.5 py-0.5 font-semibold text-(--ui-on-accent) text-[11.5px] tabular-nums">
            {s.fresh} new
          </span>
        ) : null}
      </div>
      <p className="m-0 text-[12.5px] text-(--ui-ink-2)">{facts.join(" · ")}</p>
      {s.failure ? (
        <p className="m-0 border-(--ui-bad) border-l-2 pl-2 text-[12.5px] text-(--ui-bad)">
          Last read failed: {s.failure}
        </p>
      ) : null}
      {s.stopped ? null : (
        // Who hears of a new post: you, then everyone here. Each a labelled row.
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-(--ui-hair) border-t pt-3 text-[12.5px]">
          <label htmlFor={`alert-${s.id}`} className="text-(--ui-ink-2)">
            Your alerts
          </label>
          <select
            id={`alert-${s.id}`}
            value={alertPick}
            onChange={(e) => pick(e.target.value as AlertPick)}
            className="h-8 cursor-pointer border border-(--ui-hair) bg-transparent px-2 text-(--ui-ink) outline-none"
          >
            {PICKS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {may ? (
            <>
              <label htmlFor={`tell-${s.id}`} className="text-(--ui-ink-2)">
                {clientOf() === null ? "Everyone here and Discord" : "Everyone here"}
              </label>
              <select
                id={`tell-${s.id}`}
                value={tell}
                onChange={(e) => setTell(e.target.value)}
                className="h-8 cursor-pointer border border-(--ui-hair) bg-transparent px-2 text-(--ui-ink) outline-none"
              >
                {TELLS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        {s.stopped ? (
          <span className="text-[12.5px] text-(--ui-ink-2)">Not followed. Its items stay.</span>
        ) : (
          <button
            type="button"
            onClick={() => setStopping(true)}
            className="-ml-2 h-8 border-0 bg-transparent px-2 text-[12.5px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
          >
            Stop following
          </button>
        )}
        <a href={`/learn/items?in=s${s.id}`} className="ml-auto h-8 px-2 text-[12.5px] leading-8">
          Open
        </a>
      </div>
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
                  if (await act(learn.unfollow(s.id), `Stopped following ${s.name}`))
                    setStopping(false);
                }}
              >
                Stop following
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
