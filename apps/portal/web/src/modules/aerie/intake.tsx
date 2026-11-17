/**
 * Aerie › Intake (aerie D19, D24; WA-1420): type or say the work once, File, and a receipt shows each task it
 * made. The mic is the kit's Dictate (the portal's own ear; no audio leaves). The server splits with its model,
 * or files one "Split intake" task a session answers; with web writes off it keeps the words for a session.
 */

import {
  Button,
  Copyable,
  DictateField,
  Empty,
  failureKind,
  Icon,
  Leaves,
  LoadFailed,
  Loading,
  Pill,
  Skeleton,
  Textarea,
  useDictateStatus,
  useSeen,
  WRITES,
} from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ApiError } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { TASKS } from "./address.js";
import {
  fileWords,
  INTAKE_PAGE,
  mergeReceipts,
  type Receipt,
  readOlderReceipts,
  type TaskRow,
  useReceipts,
} from "./data.js";
import { People } from "./list.js";
import { priorityColor, statusColor, who } from "./look.js";
import { isNoActor, NoActor } from "./no-actor.js";

/** a receipt that waits on a session re-reads this often (a CLI split may not push) */
const WAIT_MS = 15_000;

/** the File shortcut as this keyboard writes it */
const FILE_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘ Enter"
    : "Ctrl Enter";

const timeOf = (at: string) =>
  new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function IntakePage(_: PageProps) {
  const got = useReceipts();
  useSeen("list", { label: "Intake", icon: "inbox", text: "Aerie intake" });

  // receipts filed here, until page one has them; pages from Show older
  const [mine, setMine] = useState<Receipt[]>([]);
  const [older, setOlder] = useState<{ rows: Receipt[]; end: boolean }>({ rows: [], end: false });
  const [reading, setReading] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  const rows = useMemo(
    () => got.data && mergeReceipts([...got.data.rows, ...mine, ...older.rows]),
    [got.data, mine, older.rows],
  );
  const end = !got.data || (older.rows.length ? older.end : got.data.end);

  // a waiting receipt fills when a session splits it
  const waits = rows?.some((r) => r.state !== "split") ?? false;
  const retry = useRef(got.retry);
  retry.current = got.retry;
  useEffect(() => {
    if (!waits) return;
    const t = setInterval(() => retry.current(), WAIT_MS);
    return () => clearInterval(t);
  }, [waits]);

  const showOlder = async () => {
    const last = rows?.at(-1);
    if (!last) return;
    setReading(true);
    setOlderFailed(false);
    try {
      const page = await readOlderReceipts(last.id);
      setOlder((o) => ({ rows: [...o.rows, ...page.rows], end: page.end }));
    } catch {
      setOlderFailed(true);
    } finally {
      setReading(false);
    }
  };

  if (isNoActor(got.error))
    return (
      <div className="w-full max-w-[720px] min-w-0">
        <NoActor error={got.error} />
      </div>
    );

  const kind =
    got.error && !got.data ? "failed" : !rows ? "loading" : rows.length ? "list" : "empty";
  let body: ReactNode;
  if (kind === "failed") body = <LoadFailed error={got.error} onRetry={got.retry} />;
  else if (!rows) body = <Loading shape="rows" lines={3} label="Loading receipts" />;
  else if (!rows.length)
    body = (
      <Empty title="Nothing filed from words yet" waits>
        Type or say the work above. Each task it makes shows here.
      </Empty>
    );
  else
    body = (
      <div className="grid gap-6">
        <Leaves items={rows} keyOf={(r) => String(r.id)} className="grid gap-4">
          {(r) => <ReceiptCard r={r} />}
        </Leaves>
        {!end && rows.length >= INTAKE_PAGE && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="dense" tone="quiet" disabled={reading} onClick={showOlder}>
              {reading ? "Loading…" : olderFailed ? "Try again" : "Show older"}
            </Button>
            {olderFailed && (
              <span
                role="alert"
                className="text-[13px] text-(--ui-bad) [animation:ui-fade_.15s_both]"
              >
                Older receipts didn't load.
              </span>
            )}
          </div>
        )}
      </div>
    );

  return (
    <section aria-labelledby="aerie-intake" className="grid w-full max-w-[720px] min-w-0 gap-6">
      <h2 id="aerie-intake" className="sr-only">
        File work from words
      </h2>
      <Composer onFiled={(r) => setMine((m) => [r, ...m])} />
      {/* a new state (loading, failed, empty, list) fades in */}
      <div key={kind} className="[animation:ui-fade_.15s_both]">
        {body}
      </div>
    </section>
  );
}

/** the box, the kit's mic in it, and File; the pending receipt shows under it while it files */
function Composer({ onFiled }: { onFiled: (r: Receipt) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const status = useDictateStatus();
  const [words, setWords] = useState("");
  // the adapter that heard any of these words since the last File; null: typed only
  const [ear, setEar] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // a 5xx or a lost answer: the write queue keeps that press and sends it again under its id
  const [lost, setLost] = useState<string | null>(null);
  const queued = useQueued(lost);
  const can = words.trim().length > 0 && filing === null;

  // the queue settled it: landed (its receipt comes with the re-read) or refused
  useEffect(() => {
    if (!lost || queued.status === "open") return;
    setLost(null);
    if (queued.status === "sent") {
      setWords("");
      setEar(null);
      setFailed(null);
    } else if (queued.status === "failed") setFailed(notFiled(queued.error));
    else setFailed(null);
  }, [lost, queued]);

  const file = async () => {
    const w = words.trim();
    if (!w || filing !== null) return;
    setFiling(w);
    setFailed(null);
    try {
      // same words and ear: same body, so the queue reuses a lost press's id (never twice)
      onFiled(await fileWords(w, ear));
      setLost(null);
      setWords("");
      setEar(null);
    } catch (err) {
      const why = whyOf((err as ApiError).message);
      if (failureKind(err, () => false) === "transient") {
        setLost(lastIntake());
        setFailed(
          `Not filed yet${why ? `: ${why}` : ""}. It goes again on its own; File sends it now.`,
        );
      } else setFailed(notFiled(why));
    } finally {
      setFiling(null);
      box.current?.focus();
    }
  };

  return (
    <div className="grid gap-6">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void file();
        }}
      >
        <label htmlFor="aerie-intake-words" className="sr-only">
          The work, in your words
        </label>
        <DictateField
          target={box}
          label="Say the work"
          onHearing={(on) => {
            if (on && status.state === "ready") setEar(status.adapter);
          }}
        >
          <Textarea
            ref={box}
            id="aerie-intake-words"
            value={words}
            // locked while the queue holds it: changed words would file a second time
            readOnly={filing !== null || lost !== null}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void file();
              }
            }}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-describedby={failed ? "aerie-intake-failed" : undefined}
            rows={3}
            placeholder="Type or say the work"
            className="min-h-24 text-[14.5px] leading-[1.6]"
          />
        </DictateField>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            size="sm"
            tone="primary"
            type="submit"
            disabled={!can}
            className="transition-colors duration-150"
          >
            {filing !== null ? "Filing…" : "File"}
          </Button>
          <span className="text-[12.5px] text-(--ui-ink-2) max-sm:hidden">{FILE_KEY} files it</span>
          {failed && (
            <p
              id="aerie-intake-failed"
              role="alert"
              className="m-0 flex basis-full items-start gap-1.5 text-[13px] leading-[19px] wrap-anywhere text-(--ui-bad) [animation:ui-fade_.15s_both]"
            >
              <Icon name="warn" aria-hidden className="mt-[2px] size-3.5 shrink-0" />
              <span>{failed}</span>
            </p>
          )}
        </div>
      </form>
      {filing !== null && <Pending words={filing} />}
    </div>
  );
}

const whyOf = (message: string | null | undefined) =>
  (message || "").replace(/^not filed:\s*/i, "");
const notFiled = (why: string | null) =>
  `Not filed${why ? `: ${whyOf(why)}` : ""}. Your words are kept; press File again.`;

/** the newest intake press the queue holds open */
const lastIntake = () =>
  WRITES.snapshot().findLast(
    (w) =>
      (w.status === "unsure" || w.status === "sending") &&
      w.calls.some((c) => c.path === "aerie/intake"),
  )?.id ?? null;

type Queued = { status: "open" | "sent" | "failed" | "gone"; error: string | null };
const NONE: Queued = { status: "gone", error: null };

/** how the queue's press `id` stands; a stable value per status, for useSyncExternalStore */
function useQueued(id: string | null): Queued {
  const at = useSyncExternalStore(WRITES.subscribe, WRITES.snapshot, WRITES.snapshot);
  return useMemo(() => {
    const w = id ? at.find((x) => x.id === id) : undefined;
    if (!w) return NONE;
    if (w.status === "unsure" || w.status === "sending") return { status: "open", error: null };
    if (w.status === "sent" || w.status === "failed") return { status: w.status, error: w.error };
    return NONE;
  }, [at, id]);
}

/** the receipt before the server answers: the words and a row still loading */
function Pending({ words }: { words: string }) {
  return (
    <article
      aria-busy="true"
      aria-label="Filing"
      className="grid gap-3 rounded-(--ui-leaf-button) bg-(--ui-wash) p-4 [animation:ui-fade_.15s_both]"
    >
      <header className="flex items-center gap-x-2 text-[13.5px] leading-[20px]">
        <span className="font-semibold text-(--ui-ink)">You</span>
        <span className="text-(--ui-ink-2)">now</span>
      </header>
      <Words text={words} />
      <Skeleton className="h-5 w-2/3" />
    </article>
  );
}

function Words({ text }: { text: string }) {
  return (
    <blockquote className="m-0 text-[14px] leading-[1.6] whitespace-pre-wrap text-pretty wrap-anywhere text-(--ui-ink)">
      {text}
    </blockquote>
  );
}

/** what happened to it, in words; a state change crossfades */
function stateLine(r: Receipt): ReactNode {
  if (r.state === "held")
    return (
      <div className="grid gap-1.5 text-[13px] text-(--ui-ink)">
        <span>Kept. Task writes from the web are off, so a session files these:</span>
        <Copyable text={`aerie intake --into ${r.id} --split -`} />
      </div>
    );
  if (r.state === "waiting")
    return (
      <div className="grid gap-1 text-[13px] leading-[19px] text-(--ui-ink)">
        {r.error ? (
          <p className="m-0 flex items-start gap-1.5 font-medium wrap-anywhere text-(--ui-bad)">
            <Icon name="warn" aria-hidden className="mt-[2px] size-3.5 shrink-0" />
            <span>The model didn't split it: {r.error}</span>
          </p>
        ) : null}
        <p className="m-0">A session will split this.</p>
      </div>
    );
  return r.tasks.length ? null : (
    <p className="m-0 text-[13px] text-(--ui-ink)">No tasks came from this.</p>
  );
}

function ReceiptCard({ r }: { r: Receipt }) {
  const line = stateLine(r);
  return (
    <article className="grid gap-3 rounded-(--ui-leaf-button) bg-(--ui-wash) p-4 max-sm:p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] leading-[20px]">
        <Icon
          name={r.kind === "voice" ? "mic" : "edit"}
          aria-hidden
          className="size-3.5 text-(--ui-ink-2)"
        />
        <span className="text-(--ui-ink)">
          <span className="font-semibold">{who(r.by)}</span> {r.kind === "voice" ? "said" : "typed"}
        </span>
        <time dateTime={r.at} className="text-[12.5px] text-(--ui-ink-2) tabular-nums">
          {timeOf(r.at)}
        </time>
        {r.splitBy && (
          <span className="text-[12.5px] text-(--ui-ink-2)">
            Split by {r.splitBy === "session" ? "a session" : r.splitBy}
          </span>
        )}
      </header>
      <Words text={r.words} />
      {line && (
        <div key={r.state} className="[animation:ui-fade_.15s_both]">
          {line}
        </div>
      )}
      {r.tasks.length > 0 && (
        <Leaves items={r.tasks} keyOf={(t) => t.id} className="-mx-2 grid gap-2">
          {(t) => <TaskLine t={t} />}
        </Leaves>
      )}
      {r.missed.length > 0 && (
        <div className="grid gap-1">
          <p className="m-0 text-[12.5px] font-semibold text-(--ui-warn-ink)">Not filed</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {r.missed.map((m) => (
              <li key={m} className="text-[13px] wrap-anywhere text-(--ui-ink)">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** one task: id and title (its panel), then state, area, priority and people; titles share one edge */
function TaskLine({ t }: { t: TaskRow }) {
  const dup = t.labels.includes("maybe-dup");
  return (
    <div className="grid gap-1 rounded-(--ui-leaf-button) px-2 py-1.5 text-[13.5px] leading-[20px] hover:bg-(--ui-fill)">
      <a
        href={href(TASKS, { task: t.id })}
        className="font-medium wrap-anywhere text-(--ui-link) no-underline underline-offset-2 hover:underline focus-visible:underline"
      >
        <span className="text-(--ui-ink-2) tabular-nums">{t.id}</span> {t.title}
      </a>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
        <Pill color={statusColor(t.status)} className="whitespace-nowrap">
          {t.status}
        </Pill>
        <span className="wrap-anywhere text-(--ui-ink)">{t.area}</span>
        {t.priority && t.priority !== "low" && (
          <Pill color={priorityColor(t.priority)} className="whitespace-nowrap">
            {t.priority}
          </Pill>
        )}
        {dup && (
          <Pill color="var(--ui-warn)" className="whitespace-nowrap">
            maybe dup
          </Pill>
        )}
        <People task={t} />
      </div>
    </div>
  );
}
