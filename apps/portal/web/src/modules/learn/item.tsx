/**
 * One item, in place: a YouTube video plays here (youtube-nocookie, driven by postMessage, so no
 * outside script loads) with its key moments above and its transcript beside, each line a seek;
 * an episode plays through `/media`; an Instagram, TikTok or X post shows its own embed; an
 * article reads clean. Where you stopped is kept, and the next visit starts there.
 *
 * Nothing plays in this file: a `PlayerSlot` marks where, and the shell's player (`../../player`)
 * plays over it, keeps playing when you leave, and takes seeks from the moments and transcript.
 */
import {
  Alert,
  Button,
  cx,
  GROUP_LABEL,
  Icon,
  LATEST,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  relative,
  StateMark,
  say,
  Textarea,
  useEdit,
  usePageKeys,
} from "@wren/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { embedOf, youtubeId } from "../../embeds.js";
import { useCall } from "../../load.js";
import { PlayerSlot, usePlayer, usePlayerStore } from "../../player/index.js";
import { href, navigate } from "../../route.js";
import {
  type Breakdown,
  changed,
  clientOf,
  type FactCall,
  type FactRow,
  ITEM_PATH,
  type ItemPage,
  keyOf,
  learn,
  type Moment,
  onChanged,
  type Shot,
} from "./api.js";
import { useRail } from "./frame.js";
import {
  Avatar,
  clock,
  lengthOf,
  mediaSrc,
  PickBadge,
  Picture,
  Progress,
  ScoreBadge,
  TYPES,
  TypeMark,
  useGrant,
} from "./kinds.js";
import { act, LEARN_KEYS, MoveDialog, markItems, SopDialog, TagDialog } from "./menus.js";

/** Seconds into a played item worth keeping: past the first few, short of the last half minute. */
const resumeAt = (p: number | null, d: number | null) =>
  p && p > 5 && (!d || p < d - 30) ? Math.floor(p) : 0;

const secondsOf = (s: string): number | null => {
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

interface Line {
  t: number | null;
  text: string;
  head: boolean;
}

/** A transcript's lines: `[m:ss] words` is a line at a time, `## [m:ss] Name` a chapter. */
export function linesOf(md: string): Line[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n+/, "");
  const out: Line[] = [];
  for (const raw of body.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const head = /^#{1,6}\s+/.test(l);
    const rest = l.replace(/^#{1,6}\s+/, "");
    const m = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.*)$/.exec(rest);
    if (m) out.push({ t: secondsOf(m[1] ?? ""), text: m[2] ?? "", head });
    else out.push({ t: null, text: rest, head });
  }
  return out;
}

const VERDICTS = {
  show: "Worth changing how you work",
  hold: "Worth knowing",
  drop: "Low value for you",
} as const;

const SOP_STATES = {
  asked: { label: "Waiting", tone: "warn" },
  added: { label: "Added", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
} as const;

/** A YouTube video: the slot is its 16:9 box (9:16 for a Short); the shell's player fills it. */
function YouTube({
  item,
  vid,
  self,
  onTime,
}: {
  item: ItemPage;
  vid: string;
  self: string;
  onTime: (t: number, duration: number | null, playing: boolean) => void;
}) {
  const tall = item.type === "shorts";
  return (
    <PlayerSlot
      eager
      replace
      className={
        tall ? "mx-auto aspect-[9/16] w-[min(100%,calc(78vh*9/16))]" : "aspect-video w-full"
      }
      item={{
        id: `learn:${item.id}`,
        kind: "youtube",
        src: vid,
        title: item.title,
        startAt: resumeAt(item.position, item.duration),
        ratio: tall ? 9 / 16 : 16 / 9,
        back: self,
        onTime,
      }}
    />
  );
}

/** An episode, through our origin so the CSP stays at 'self'. */
function Episode({
  item,
  self,
  onTime,
}: {
  item: ItemPage;
  self: string;
  onTime: (t: number, duration: number | null, playing: boolean) => void;
}) {
  const grant = useGrant(item.mediaUrl);
  const src = mediaSrc(item.mediaUrl, grant);
  return (
    <div className="flex flex-col gap-4 border border-(--ui-hair) bg-(--ui-paper) p-4 sm:flex-row sm:items-center">
      <div className="w-full shrink-0 sm:w-40">
        <Picture
          url={item.thumbnail ?? item.source?.avatar ?? null}
          alt=""
          className="aspect-square w-full object-cover"
          fallback={
            <div className="flex aspect-square w-full items-center justify-center bg-(--ui-tile)">
              <TypeMark type="podcast" size={40} />
            </div>
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          {item.source?.name ?? item.creator ?? "Episode"}
          {item.duration ? ` · ${clock(item.duration)}` : ""}
        </p>
        {src ? (
          <PlayerSlot
            eager
            replace
            className="h-[54px] w-full"
            item={{
              id: `learn:${item.id}`,
              kind: "media",
              media: "audio",
              src,
              title: item.title,
              startAt: resumeAt(item.position, item.duration),
              back: self,
              onTime,
            }}
          />
        ) : grant === undefined ? (
          <div className="h-10 bg-(--ui-tile)" />
        ) : (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">
            {item.mediaUrl
              ? "This episode can't play here."
              : "This episode has no audio file in its feed."}{" "}
            <a href={item.url} target="_blank" rel="noreferrer">
              Open the episode
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

/** An Instagram, TikTok or X post: its own embed, or its picture and a way out. */
function Embed({ item, self }: { item: ItemPage; self: string }) {
  const e = embedOf(item.type, item.url);
  const site = TYPES[item.type]?.site ?? "the page";
  if (!e)
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group relative block max-w-xl no-underline"
      >
        <Picture
          url={item.thumbnail}
          alt=""
          className="aspect-video w-full object-cover"
          fallback={
            <div className="flex aspect-video w-full items-center justify-center bg-(--ui-tile)">
              <TypeMark type={item.type} size={44} />
            </div>
          }
        />
        <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 bg-(--ui-paper) px-3 py-2 text-[13px] text-(--ui-ink) shadow">
          Open on {site} <Icon name="external" size={13} />
        </span>
      </a>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      <PlayerSlot
        eager
        replace
        className={cx("mx-auto w-full border border-(--ui-hair) bg-(--ui-paper)", e.box)}
        item={{
          id: `learn:${item.id}`,
          kind: "embed",
          src: e.src,
          title: `${TYPES[item.type]?.label} post`,
          back: self,
        }}
      />
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[13px]"
      >
        Open on {site} <Icon name="external" size={12} />
      </a>
    </div>
  );
}

/** Key moments: chips that seek. */
function Moments({
  moments,
  now,
  seek,
}: {
  moments: Moment[];
  now: number;
  seek: ((t: number) => void) | null;
}) {
  if (!moments.length) return null;
  const at = moments.reduce((i, m, j) => (m.t <= now ? j : i), -1);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={cx("m-0", GROUP_LABEL)}>Key moments</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {moments.map((m, i) => (
          <button
            key={`${m.t}-${m.label}`}
            type="button"
            disabled={!seek}
            onClick={() => seek?.(m.t)}
            className={cx(
              "flex w-44 shrink-0 flex-col gap-1 border px-3 py-2 text-left transition-colors duration-200",
              i === at
                ? "border-(--ui-active) bg-(--ui-accent-wash)"
                : "border-(--ui-hair) bg-(--ui-paper) hover:bg-(--ui-wash)",
            )}
          >
            <span className="font-semibold text-(--ui-ink-2) text-[12px] tabular-nums">
              {clock(m.t)}
            </span>
            <span className="text-[13px] text-(--ui-ink) leading-snug">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The transcript: timed lines seek and follow the player; plain words read as paragraphs. */
function Transcript({
  md,
  now,
  seek,
  className,
}: {
  md: string;
  now: number;
  seek: ((t: number) => void) | null;
  className?: string;
}) {
  const lines = useMemo(() => linesOf(md), [md]);
  const timed = lines.some((l) => l.t !== null);
  const box = useRef<HTMLDivElement>(null);
  const at = timed ? lines.reduce((i, l, j) => (l.t !== null && l.t <= now ? j : i), -1) : -1;
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (!follow || at < 0) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${at}"]`);
    const b = box.current;
    if (!el || !b) return;
    const top = el.offsetTop - b.clientHeight / 3;
    if (Math.abs(b.scrollTop - top) > 40) b.scrollTo({ top, behavior: "smooth" });
  }, [at, follow]);
  return (
    <div
      className={cx("flex min-h-0 flex-col border border-(--ui-hair) bg-(--ui-paper)", className)}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-(--ui-hair) border-b px-3">
        <h2 className="m-0 font-semibold text-[13px]">Transcript</h2>
        {timed && seek ? (
          <label className="inline-flex items-center gap-1.5 text-[12px] text-(--ui-ink-2)">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="accent-(--ui-active)"
            />
            Follow along
          </label>
        ) : null}
      </div>
      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2"
      >
        {lines.map((l, i) =>
          l.t !== null && seek ? (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed text.
              key={i}
              type="button"
              data-line={i}
              onClick={() => seek(l.t ?? 0)}
              className={cx(
                "flex w-full gap-3 border-0 px-2 py-1.5 text-left transition-colors duration-200",
                i === at ? "bg-(--ui-accent-wash)" : "bg-transparent hover:bg-(--ui-hover)",
                l.head && "mt-3",
              )}
            >
              <span className="w-12 shrink-0 pt-px text-(--ui-link) text-[12px] tabular-nums">
                {clock(l.t ?? 0)}
              </span>
              <span
                className={cx(
                  "text-[13.5px] leading-relaxed",
                  l.head
                    ? "font-semibold text-(--ui-ink)"
                    : i === at
                      ? "text-(--ui-ink)"
                      : "text-(--ui-ink-2)",
                )}
              >
                {l.text}
              </span>
            </button>
          ) : (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed text.
              key={i}
              data-line={i}
              className={cx(
                "m-0 px-2 py-1.5 text-[13.5px] leading-relaxed",
                l.head ? "mt-3 font-semibold text-(--ui-ink)" : "text-(--ui-ink-2)",
              )}
            >
              {l.t !== null ? (
                <span className="mr-2 text-(--ui-ink-2) text-[12px] tabular-nums">
                  {clock(l.t)}
                </span>
              ) : null}
              {l.text}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

/** An article's stored text, set for reading: headings, lists and paragraphs. */
function Reader({ text }: { text: string }) {
  // Keyed by place: the text is fixed, so a block never moves.
  const blocks = useMemo(
    () =>
      text
        .replace(/^---\n[\s\S]*?\n---\n+/, "")
        .split(/\n{2,}/)
        .map((b, n) => ({ k: `b${n}`, t: b.trim() }))
        .filter((b) => b.t),
    [text],
  );
  return (
    <div className="max-w-[68ch] text-[16.5px] text-(--ui-ink) leading-[1.75]">
      {blocks.map(({ k, t }) => {
        const h = /^(#{1,6})\s+(.*)$/s.exec(t);
        if (h)
          return (
            <h3
              key={k}
              className={cx(
                "mt-8 mb-2 font-semibold leading-snug",
                (h[1]?.length ?? 2) <= 2 ? "text-[21px]" : "text-[18px]",
              )}
            >
              {h[2]}
            </h3>
          );
        const rows = t.split("\n").filter((l) => l.trim());
        if (rows.every((l) => l.startsWith("- ")))
          return (
            <ul key={k} className="my-4 list-disc pl-6">
              {rows
                .map((l, n) => ({ k: `${k}.${n}`, l }))
                .map((r) => (
                  <li key={r.k} className="my-1">
                    {r.l.slice(2)}
                  </li>
                ))}
            </ul>
          );
        return (
          <p key={k} className="my-4 whitespace-pre-line">
            {t}
          </p>
        );
      })}
    </div>
  );
}

function Act({
  on,
  onClick,
  children,
  label,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      // The word hides on a phone, the name stays.
      aria-label={label}
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[13px] transition-colors duration-150",
        on
          ? "border-(--ui-active) bg-(--ui-accent-wash) text-(--ui-active)"
          : "border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink) hover:bg-(--ui-hover)",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

const CALLS: { call: FactCall; label: string; icon: "check" | "edit" | "close" }[] = [
  { call: "keep", label: "Keep", icon: "check" },
  { call: "tune", label: "Tune", icon: "edit" },
  { call: "drop", label: "Drop", icon: "close" },
];
const CALL_TONE: Record<FactCall, string> = {
  keep: "text-(--ui-good)",
  tune: "text-(--ui-warn)",
  drop: "text-(--ui-bad)",
};

const SHOT_PATH = "facts/shots/";
const clockOf = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const CALL_BAR: Record<FactCall, string> = {
  keep: "bg-(--ui-good)",
  tune: "bg-(--ui-warn)",
  drop: "bg-(--ui-bad)",
};

/**
 * A film's shots as one strip, each as wide as it runs: the pace at a glance. A press picks a
 * shot, and its row opens below to call; his call marks the shot's foot.
 */
function ShotStrip({
  shots,
  picked,
  called,
  onPick,
}: {
  shots: Shot[];
  picked: number | null;
  called: (i: number) => FactCall | null;
  onPick: (i: number) => void;
}) {
  const end = shots.reduce((m, s) => Math.max(m, s.t + s.len), 0);
  return (
    <div className="mb-3 flex flex-col gap-1">
      <fieldset
        aria-label="Shots"
        className="m-0 flex h-10 min-w-0 overflow-hidden border border-(--ui-hair) p-0"
      >
        {shots.map((s, i) => {
          const c = called(i);
          const label = [s.type, s.move].filter(Boolean).join(", ");
          return (
            <button
              key={`${s.t}-${s.len}`}
              type="button"
              aria-pressed={picked === i}
              aria-label={`Shot ${i + 1}, ${s.len.toFixed(1)} s at ${clockOf(s.t)}${label ? `, ${label}` : ""}`}
              title={`Shot ${i + 1} · ${s.len.toFixed(1)} s${label ? ` · ${label}` : ""}`}
              onClick={() => onPick(i)}
              style={{ flexGrow: Math.max(s.len, 0.1), flexBasis: 0 }}
              className={cx(
                "relative min-w-[3px] border-0 border-(--ui-hair) border-r p-0 transition-colors duration-150 last:border-r-0",
                picked === i ? "bg-(--ui-accent-wash)" : "bg-(--ui-paper) hover:bg-(--ui-hover)",
              )}
            >
              {c ? <span className={cx("absolute inset-x-0 bottom-0 h-1", CALL_BAR[c])} /> : null}
            </button>
          );
        })}
      </fieldset>
      <div className="flex justify-between text-[12px] text-(--ui-ink-3)">
        <span>{shots.length} shots</span>
        <span>{clockOf(end)}</span>
      </div>
    </div>
  );
}

/**
 * How the piece is made and what he says of it (design 2026-10-25-competitor-analyzer, Decide):
 * each fact whole, his standing call pressed, his words under it. A press opens the words box
 * for that fact; Save writes call and words as one. Wren's workspace only: a client's items carry
 * no calls.
 */
function Facts({ id, b }: { id: number; b: Breakdown }) {
  const [open, setOpen] = useState<{ path: string; call: FactCall } | null>(null);
  const [busy, setBusy] = useState(false);
  const standing = useMemo(() => new Map(b.calls.map((c) => [c.path, c])), [b.calls]);
  // His words on the open fact: unsaved words keep per fact, over the standing comment.
  const words = useEdit(
    open ? `learn:call:${id}:${open.path}` : null,
    open ? (standing.get(open.path)?.comment ?? "") : "",
  );
  const shots = b.shots ?? [];
  // A film's shots live in the strip: only the picked one shows as a row to call.
  const [shot, setShot] = useState<number | null>(null);
  const rows: FactRow[] = [
    { path: ITEM_PATH, label: "Whole piece", value: "" },
    ...b.facts.filter((f) => !f.path.startsWith(SHOT_PATH) || f.path === `${SHOT_PATH}${shot}`),
  ];
  const start = (path: string, call: FactCall) => setOpen({ path, call });
  const save = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const sent = words.value;
      await learn.call(id, open.path, open.call, sent.trim() || null);
      words.saved(sent);
      setOpen(null);
      changed();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2 className={cx("m-0 mb-1.5 flex items-center gap-2", GROUP_LABEL)}>
        How it's made
        <span className="font-normal text-(--ui-ink-3)">
          {b.by === "hand" ? "by hand" : "read"}
        </span>
      </h2>
      {shots.length ? (
        <ShotStrip
          shots={shots}
          picked={shot}
          called={(i) => standing.get(`${SHOT_PATH}${i}`)?.call ?? null}
          onPick={(i) => setShot(i === shot ? null : i)}
        />
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => {
          const c = standing.get(r.path);
          const editing = open?.path === r.path;
          return (
            <li key={r.path} className="flex flex-col gap-1.5 text-[14px]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12px] text-(--ui-ink-2)">{r.label}</span>
                {r.value ? (
                  <span className="text-(--ui-ink) leading-relaxed">{r.value}</span>
                ) : null}
              </div>
              <fieldset
                className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
                aria-label={r.label}
              >
                {CALLS.map((k) => (
                  <Act
                    key={k.call}
                    label={k.label}
                    on={c?.call === k.call}
                    onClick={() => start(r.path, k.call)}
                  >
                    <Icon name={k.icon} size={14} />
                  </Act>
                ))}
              </fieldset>
              {editing ? (
                <div className="flex flex-col gap-1.5">
                  <Textarea
                    aria-label={`Your words on ${r.label}`}
                    {...words.field}
                    placeholder={open.call === "tune" ? "What to change" : "Why (optional)"}
                    rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="dense"
                      tone="secondary"
                      onClick={() => {
                        words.discard();
                        setOpen(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="dense" tone="primary" busy={busy} onClick={() => void save()}>
                      Save {open.call}
                    </Button>
                  </div>
                </div>
              ) : c ? (
                <p className="m-0 text-[13px] leading-relaxed">
                  <span className={cx("font-medium", CALL_TONE[c.call])}>
                    {CALLS.find((k) => k.call === c.call)?.label}
                  </span>
                  {c.comment ? <span className="text-(--ui-ink-2)"> · {c.comment}</span> : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Side({ item }: { item: ItemPage }) {
  return (
    <div className="flex flex-col gap-6">
      {item.breakdown && !clientOf() ? <Facts id={item.id} b={item.breakdown} /> : null}
      {item.summary ? (
        <section>
          <h2 className={cx("m-0 mb-1.5", GROUP_LABEL)}>Summary</h2>
          <p className="m-0 text-[14.5px] text-(--ui-ink) leading-relaxed">{item.summary}</p>
        </section>
      ) : null}
      {item.why ? (
        <section>
          <h2 className={cx("m-0 mb-1.5", GROUP_LABEL)}>Why it scored {item.score ?? ""}</h2>
          <p className="m-0 text-[14px] text-(--ui-ink-2) leading-relaxed">{item.why}</p>
        </section>
      ) : null}
      {item.changes.length ? (
        <section>
          <h2 className={cx("m-0 mb-1.5", GROUP_LABEL)}>What it would change</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {item.changes.map((c) => (
              <li key={c} className="flex gap-2 text-[14px] text-(--ui-ink) leading-relaxed">
                <span className="mt-[0.6em] size-1.5 shrink-0 bg-(--ui-ink-3)" />
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {item.sops.length ? (
        <section>
          <h2 className={cx("m-0 mb-1.5", GROUP_LABEL)}>In SOPs</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {item.sops.map((a) => (
              <li key={a.sop} className="flex flex-col gap-0.5 text-[13.5px]">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{a.sop}</span>
                  <StateMark state={SOP_STATES[a.state]} />
                </span>
                {a.error ? <span className="text-[12px] text-(--ui-bad)">{a.error}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** One item's page. `back` is the place it was opened from. */
export function ItemView({ id, back }: { id: string; back: string }) {
  const load = useCall(keyOf(`learn.item:${id}`), () => learn.item(id));
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  const { rail } = useRail();
  const item = load.data;
  const pid = `learn:${id}`;
  const store = usePlayerStore();
  // The shell's player keeps the clock; the moments and the transcript follow it.
  const now = usePlayer((s) => (s.item?.id === pid ? s.time : 0));
  const ready = usePlayer((s) => s.item?.id === pid && s.heard);
  const held = usePlayer((s) => s.item?.id === pid);
  const [dialog, setDialog] = useState<"move" | "tag" | "sop" | null>(null);
  usePageKeys(LEARN_KEYS);

  // Opened: out of the Inbox. Once per visit.
  const opened = useRef<string | null>(null);
  // read-ok: a write (marks it opened), once per visit.
  useEffect(() => {
    if (!item || opened.current === id) return;
    opened.current = id;
    if (item.status === "unread") void learn.open(item.id).then(changed, () => {});
  }, [item, id]);

  // Where you are, kept every 15 seconds of play and on pause. The shell's player calls this
  // after the page is gone too, so it holds nothing of the page but the item's id.
  const saved = useRef({ at: 0, t: 0 });
  const itemId = item?.id;
  const keepPlace = useCallback(
    (t: number, duration: number | null, playing: boolean) => {
      if (itemId === undefined) return;
      const due = !playing || Date.now() - saved.current.at > 15_000;
      if (due && Math.abs(t - saved.current.t) >= 3) {
        saved.current = { at: Date.now(), t };
        // One at a time, the newest last: a slow write can't move the place back.
        void LATEST.write(`learn.progress:${itemId}`, Math.floor(t), (at) =>
          learn.progress(itemId, at, duration ? Math.round(duration) : null),
        );
      }
    },
    [itemId],
  );

  // The keys an item page answers.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || dialog) return;
      if (
        (e.target as HTMLElement | null)?.closest(
          "input, textarea, select, [contenteditable=true], [role=dialog]",
        )
      )
        return;
      const k = e.key;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === "s") run(() => void markItems([item.id], item.starred ? "unstar" : "star"));
      else if (k === "l") run(() => void markItems([item.id], item.later ? "unlater" : "later"));
      else if (k === "e")
        run(() => {
          void markItems([item.id], item.status === "archived" ? "unarchive" : "archive");
          if (item.status !== "archived") navigate(back);
        });
      else if (k === "m") run(() => setDialog("move"));
      else if (k === "t") run(() => setDialog("tag"));
      else if (k === "Escape" || k === "u") run(() => navigate(back));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [item, dialog, back]);

  if (load.error && !item)
    return <LoadFailed error={load.error} onRetry={load.retry} what="item" />;
  if (!item) return <Loading lines={6} heading />;

  const t = TYPES[item.type] ?? TYPES.link;
  const vid = item.type === "youtube" || item.type === "shorts" ? youtubeId(item.url) : null;
  const plays = !!vid || (item.type === "podcast" && !!item.mediaUrl);
  const words = item.transcript ?? (item.text || null);
  const seek = plays && held ? (s: number) => store.seek(s) : null;
  // This item's own address: Expand in the dock opens it.
  const self = href(`/learn/items/${item.id}`, {}, new URLSearchParams(back.split("?")[1] ?? ""));
  const len = lengthOf(item);
  const placeName = new URLSearchParams(back.split("?")[1] ?? "").get("in");
  const backLabel =
    placeName && /^c\d+$/.test(placeName)
      ? (rail.collections.find((c) => `c${c.id}` === placeName)?.name ?? "Items")
      : placeName && /^s\d+$/.test(placeName)
        ? (rail.sources.flatMap((g) => g.sources).find((s) => `s${s.id}` === placeName)?.name ??
          "Items")
        : ((
            {
              later: "Watch later",
              starred: "Starred",
              saved: "Saved by you",
              all: "All items",
              archived: "Archived",
            } as Record<string, string>
          )[placeName ?? ""] ?? "Inbox");
  const progress = item.position && item.duration ? item.position / item.duration : 0;

  const media = vid ? (
    <YouTube item={item} vid={vid} self={self} onTime={keepPlace} />
  ) : item.type === "podcast" ? (
    <Episode item={item} self={self} onTime={keepPlace} />
  ) : item.type === "instagram" || item.type === "tiktok" || item.type === "x" ? (
    <Embed item={item} self={self} />
  ) : null;

  return (
    <article className="pb-16">
      <a
        href={back}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
      >
        <Icon name="back" size={14} /> {backLabel}
      </a>
      <header className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-(--ui-ink-2)">
          <span className="inline-flex items-center gap-1.5 font-medium text-(--ui-ink)">
            <TypeMark type={item.type} size={15} />
            {t.label}
          </span>
          {item.source ? (
            <a
              href={`/learn/items?in=s${item.source.id}`}
              className="inline-flex items-center gap-1.5 text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
            >
              <span aria-hidden>·</span>
              <Avatar url={item.source.avatar} name={item.source.name} size={16} />
              {item.source.name}
            </a>
          ) : item.creator ? (
            <span>· {item.creator}</span>
          ) : null}
          {len ? <span>· {len}</span> : null}
          <span>· {relative(new Date(item.at))}</span>
          {item.collection ? (
            <a
              href={`/learn/items?in=c${item.collection.id}`}
              className="inline-flex items-center gap-1 text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
            >
              <span aria-hidden>·</span>
              <Icon name="folder" size={13} /> {item.collection.name}
            </a>
          ) : null}
        </div>
        <div className="flex items-start gap-3">
          <h1 className={cx("m-0 min-w-0 flex-1", PAGE_TITLE)}>{item.title}</h1>
          {item.score !== null ? (
            <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
              <ScoreBadge score={item.score} className="h-7 min-w-7 text-[14px]" />
              <PickBadge pick={item.pick} />
              {item.verdict ? (
                <span className="hidden text-right text-[11.5px] text-(--ui-ink-2) sm:block">
                  {VERDICTS[item.verdict]}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Act
            label={item.starred ? "Starred" : "Star"}
            on={item.starred}
            onClick={() => void markItems([item.id], item.starred ? "unstar" : "star")}
          >
            <Icon name="star" size={14} fill={item.starred ? "currentColor" : "none"} />
          </Act>
          <Act
            label="Watch later"
            on={item.later}
            onClick={() => void markItems([item.id], item.later ? "unlater" : "later")}
          >
            <Icon name="clock" size={14} />
          </Act>
          <Act
            label={item.pinned ? "Pinned" : "Pin"}
            on={item.pinned}
            onClick={() => void markItems([item.id], item.pinned ? "unpin" : "pin")}
          >
            <Icon name="pin" size={14} />
          </Act>
          <Act label="Move to" onClick={() => setDialog("move")}>
            <Icon name="moveTo" size={14} />
          </Act>
          <Act label="Tag" onClick={() => setDialog("tag")}>
            <Icon name="tag" size={14} />
          </Act>
          <Act label="Add to SOP" onClick={() => setDialog("sop")}>
            <Icon name="sparkle" size={14} />
          </Act>
          <Act
            label={item.status === "archived" ? "Unarchive" : "Archive"}
            onClick={() => {
              void markItems([item.id], item.status === "archived" ? "unarchive" : "archive");
              if (item.status !== "archived") navigate(back);
            }}
          >
            {item.status === "archived" ? (
              <Icon name="restore" size={14} />
            ) : (
              <Icon name="archive" size={14} />
            )}
          </Act>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-8 items-center gap-1.5 px-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
          >
            Open on {t.site} <Icon name="external" size={13} />
          </a>
        </div>
        {item.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <a
                key={tag}
                href={`/learn/items?in=all&tag=${encodeURIComponent(tag)}`}
                className="inline-flex h-6 items-center gap-0.5 bg-(--ui-tile) px-1.5 text-[12px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
              >
                <Icon name="hash" size={11} />
                {tag}
              </a>
            ))}
          </div>
        ) : null}
      </header>

      {item.state === "failed" ? (
        <div className="mb-5">
          <Alert>
            <span className="flex flex-wrap items-center gap-3">
              Couldn't read this one{item.failure ? `: ${item.failure}` : "."}
              <Button
                size="dense"
                tone="secondary"
                onClick={() => void act(learn.readAgain([item.id]), "Reading again")}
              >
                <Icon name="retry" size={14} /> Read again
              </Button>
            </span>
          </Alert>
        </div>
      ) : item.state === "mac" ? (
        <p className="mb-5 border-(--ui-warn) border-l-2 bg-(--ui-wash) px-3 py-2 text-[13.5px] text-(--ui-ink-2)">
          Waits to be transcribed. The summary and score follow.
        </p>
      ) : item.state === "reading" || item.state === "scoring" ? (
        <p className="mb-5 border-(--ui-live) border-l-2 bg-(--ui-wash) px-3 py-2 text-[13.5px] text-(--ui-ink-2)">
          {item.state === "reading" ? "Reading it now." : "Scoring it against your SOPs."} This page
          fills in when it's done.
        </p>
      ) : null}

      {media ? (
        <div className={cx("grid gap-6", words && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
          <div className="flex min-w-0 flex-col gap-4">
            <Moments moments={item.moments} now={now} seek={seek} />
            {media}
            {progress > 0 && !ready ? (
              <p className="m-0 inline-flex items-center gap-2 text-[13px] text-(--ui-ink-2)">
                <Icon name="play" size={13} /> Picks up at {clock(item.position ?? 0)}
                <span className="h-1 w-24 bg-(--ui-tile)">
                  <Progress value={progress} />
                </span>
              </p>
            ) : null}
            <div className="mt-2">
              <Side item={item} />
            </div>
          </div>
          {words ? (
            <Transcript md={words} now={now} seek={seek} className="h-[70vh] xl:sticky xl:top-4" />
          ) : null}
        </div>
      ) : (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {item.thumbnail ? (
              <Picture
                url={item.thumbnail}
                alt=""
                className="mb-6 aspect-[2/1] w-full max-w-[68ch] object-cover"
                fallback={null}
              />
            ) : null}
            {item.text ? (
              <Reader text={item.text} />
            ) : (
              <p className="text-[14px] text-(--ui-ink-2)">
                The text isn't here yet.{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  Read it on {t.site}
                </a>
              </p>
            )}
          </div>
          <div className="xl:sticky xl:top-4 xl:self-start">
            <Side item={item} />
          </div>
        </div>
      )}

      {dialog === "move" ? (
        <MoveDialog
          ids={[item.id]}
          collections={rail.collections}
          current={item.collectionId}
          onClose={() => setDialog(null)}
        />
      ) : dialog === "tag" ? (
        <TagDialog
          ids={[item.id]}
          have={item.tags}
          known={rail.tags.map((x) => x.tag)}
          onClose={() => setDialog(null)}
        />
      ) : dialog === "sop" ? (
        <SopDialog ids={[item.id]} onClose={() => setDialog(null)} />
      ) : null}
    </article>
  );
}
