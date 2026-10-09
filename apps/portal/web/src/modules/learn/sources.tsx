/**
 * Learn's Sources, grouped by kind: follow a channel, podcast, newsletter or blog by its page or
 * feed, say how loud each is, stop one. Each opens to its items. Each card has your own alert
 * pick; a manager also sets the workspace's under it (everyone without a pick, and on Wren's,
 * the Discord push).
 */
import {
  Button,
  cx,
  Empty,
  InDevelopment,
  Input,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  relative,
  SECTION_TITLE,
  say,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { type FormEvent, useEffect, useState } from "react";
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
  return <SourcesBody />;
}

function SourcesBody() {
  const load = useCall(keyOf("learn.sources"), learn.sources);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  const kinds = load.data?.kinds.filter((k) => k.sources.length) ?? [];
  const total = kinds.reduce((n, k) => n + k.sources.length, 0);
  return (
    <div className="flex flex-col gap-8 pb-16">
      <header className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className={PAGE_TITLE}>Sources</h1>
          {load.data ? (
            <span className="text-[14px] text-(--ui-ink-2) tabular-nums">{total}</span>
          ) : null}
        </div>
        <Follow />
      </header>
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={4} shape="cards" />
      ) : !kinds.length ? (
        <Empty>
          Paste a channel, podcast, newsletter or blog above. Its page works, and so does its feed.
          New posts are read, summed up and scored, then land in your Inbox.
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
      <section className="flex flex-col gap-3 border-(--ui-hair) border-t pt-6">
        <h2 className={cx("m-0 flex flex-wrap items-center gap-2", SECTION_TITLE)}>
          <TypeMark type="instagram" size={16} />
          <TypeMark type="tiktok" size={16} />
          <TypeMark type="x" size={16} />
          Instagram, TikTok and X creators
        </h2>
        <InDevelopment>
          Following them is in development. Save their posts from your phone meanwhile; each plays
          here in its own embed.
        </InDevelopment>
      </section>
    </div>
  );
}

function Follow() {
  const [url, setUrl] = useState("");
  const [tell, setTell] = useState("top");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const f = await learn.follow(url.trim(), tell);
      setUrl("");
      say.done(
        `Following ${f.name}. ${f.items ? `Its last ${f.items} posts are in Archived; new ones` : "Its next posts"} land in your Inbox.`,
      );
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
      <Input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="A channel, podcast, newsletter or blog"
        aria-label="Address to follow"
        className="min-w-0 flex-1"
      />
      <div className="flex gap-2">
        <label className="inline-flex h-9 items-center border border-(--ui-hair) bg-(--ui-paper) text-[13px]">
          <span className="sr-only">Alerts for everyone here</span>
          <select
            value={tell}
            onChange={(e) => setTell(e.target.value)}
            className="h-full cursor-pointer bg-transparent px-2 outline-none"
          >
            {TELLS.map(([id, label]) => (
              <option key={id} value={id}>
                Alerts: {label.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <Button size="dense" type="submit" busy={busy} disabled={!url.trim()} className="h-9">
          Follow
        </Button>
      </div>
    </form>
  );
}

function SourceCard({ s, may }: { s: SourceRow; may: boolean }) {
  const [stopping, setStopping] = useState(false);
  const facts = [
    s.fresh ? `${s.fresh} new` : null,
    `${s.items} ${s.items === 1 ? "item" : "items"}`,
    s.top !== null ? `best ${s.top}/10` : null,
    s.last ? `posted ${relative(new Date(s.last))}` : null,
  ].filter(Boolean);
  return (
    <div
      className={cx(
        "flex flex-col gap-3 border border-(--ui-hair) bg-(--ui-paper) p-4",
        s.stopped && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Avatar url={s.avatar} name={s.name} size={40} />
        <div className="min-w-0 flex-1">
          <a
            href={`/learn/items?in=s${s.id}`}
            className="block truncate font-semibold text-[14.5px] text-(--ui-ink) no-underline hover:underline"
          >
            {s.name}
          </a>
          <a
            href={s.page ?? s.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[12.5px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
          >
            {hostOf(s.page ?? s.url)}
          </a>
        </div>
        {s.fresh ? (
          <span className="shrink-0 bg-(--ui-accent) px-1.5 py-0.5 font-semibold text-(--ui-on-accent) text-[11.5px] tabular-nums">
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
            value={s.alert ?? "top"}
            onChange={(e) => void act(learn.pick(s.id, e.target.value as AlertPick), "Saved")}
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
                value={s.tell}
                onChange={(e) => void act(learn.tell(s.id, e.target.value), "Saved for everyone")}
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
