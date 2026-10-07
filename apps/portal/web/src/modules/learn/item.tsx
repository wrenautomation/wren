/**
 * One item, in place: a YouTube video plays here (youtube-nocookie, driven by postMessage, so no
 * outside script loads) with its key moments above and its transcript beside, each line a seek;
 * an episode plays through `/media`; an Instagram, TikTok or X post shows its own embed; an
 * article reads clean. Where you stopped is kept, and the next visit starts there.
 */
import { Alert, Button, cx, Loading, relative, StateMark } from "@wren/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Clock,
  ExternalLink,
  Folder,
  FolderInput,
  Hash,
  Pin,
  Play,
  RotateCw,
  Sparkles,
  Star,
  Tag,
} from "@wren/ui/lib/lucide";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { changed, type ItemPage, learn, type Moment, onChanged } from "./api.js";
import { useRail } from "./frame.js";
import {
  Avatar,
  clock,
  lengthOf,
  mediaSrc,
  Picture,
  Progress,
  ScoreBadge,
  TYPES,
  TypeMark,
  useGrant,
} from "./kinds.js";
import { act, KeysDialog, MoveDialog, markItems, SopDialog, TagDialog } from "./menus.js";

/** A player both the moments and the transcript can drive. */
interface Player {
  seek: (t: number) => void;
}

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
  show: "Worth changing how Wren works",
  hold: "Worth knowing",
  drop: "Low value for Wren",
} as const;

const SOP_STATES = {
  asked: { label: "Waits for the Mac", tone: "warn" },
  added: { label: "Added", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
} as const;

/** The YouTube id in a watch, short, Shorts or embed address. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** An Instagram, TikTok or X post's own embed address, or null when the link isn't one. */
export function embedOf(type: string, url: string): { src: string; box: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (type === "instagram") {
    const m = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/.exec(u.pathname);
    if (!m) return null;
    const kind = m[1] === "p" ? "p" : "reel";
    return {
      src: `https://www.instagram.com/${kind}/${m[2]}/embed`,
      box: "h-[720px] max-w-[400px]",
    };
  }
  if (type === "tiktok") {
    const m = /\/video\/(\d+)/.exec(u.pathname);
    if (!m) return null;
    return { src: `https://www.tiktok.com/embed/v2/${m[1]}`, box: "h-[740px] max-w-[340px]" };
  }
  if (type === "x") {
    const m = /\/status(?:es)?\/(\d+)/.exec(u.pathname);
    if (!m) return null;
    return {
      src: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true`,
      box: "h-[620px] max-w-[550px]",
    };
  }
  return null;
}

/** The YouTube player, spoken to over postMessage: the IFrame API without its script. */
function YouTube({
  vid,
  start,
  tall,
  onTime,
  playerRef,
}: {
  vid: string;
  start: number;
  tall: boolean;
  onTime: (t: number, duration: number | null, playing: boolean) => void;
  playerRef: React.MutableRefObject<Player | null>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ORIGIN = "https://www.youtube-nocookie.com";
  const timeRef = useRef(onTime);
  timeRef.current = onTime;
  const src = useMemo(() => {
    const q = new URLSearchParams({
      enablejsapi: "1",
      origin: location.origin,
      rel: "0",
      playsinline: "1",
      ...(start ? { start: String(start) } : {}),
    });
    return `${ORIGIN}/embed/${vid}?${q}`;
  }, [vid, start]);
  useEffect(() => {
    const post = (msg: object) =>
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ ...msg, id: 1, channel: "widget" }),
        ORIGIN,
      );
    let heard = false;
    let duration: number | null = null;
    let playing = false;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      let d: {
        event?: string;
        info?: { currentTime?: number; duration?: number; playerState?: number };
      };
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      heard = true;
      const info = d.info;
      if (!info) return;
      if (typeof info.duration === "number" && info.duration > 0) duration = info.duration;
      if (typeof info.playerState === "number") playing = info.playerState === 1;
      if (typeof info.currentTime === "number")
        timeRef.current(info.currentTime, duration, playing);
    };
    addEventListener("message", onMsg);
    // Until the player answers, say we're listening; it starts sending its time after.
    const hello = setInterval(() => {
      if (heard) return clearInterval(hello);
      post({ event: "listening" });
    }, 400);
    playerRef.current = {
      seek: (t) => {
        post({ event: "command", func: "seekTo", args: [t, true] });
        post({ event: "command", func: "playVideo", args: [] });
      },
    };
    return () => {
      removeEventListener("message", onMsg);
      clearInterval(hello);
      playerRef.current = null;
    };
  }, [playerRef]);
  return (
    <div
      className={cx(
        "overflow-hidden bg-black",
        tall ? "mx-auto aspect-[9/16] max-h-[78vh]" : "aspect-video w-full",
      )}
    >
      <iframe
        ref={frame}
        src={src}
        title="YouTube video"
        className="size-full border-0"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

/** An episode, through our origin so the CSP stays at 'self'. */
function Episode({
  item,
  onTime,
  playerRef,
}: {
  item: ItemPage;
  onTime: (t: number, duration: number | null, playing: boolean) => void;
  playerRef: React.MutableRefObject<Player | null>;
}) {
  const grant = useGrant();
  const audio = useRef<HTMLAudioElement>(null);
  const src = mediaSrc(item.mediaUrl, grant);
  useEffect(() => {
    playerRef.current = {
      seek: (t) => {
        const a = audio.current;
        if (!a) return;
        a.currentTime = t;
        void a.play().catch(() => {});
      },
    };
    return () => {
      playerRef.current = null;
    };
  }, [playerRef]);
  const tell = () => {
    const a = audio.current;
    if (a) onTime(a.currentTime, Number.isFinite(a.duration) ? a.duration : null, !a.paused);
  };
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
          // biome-ignore lint/a11y/useMediaCaption: the transcript sits beside it.
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={src}
            className="w-full"
            onLoadedMetadata={(e) => {
              const at = resumeAt(item.position, item.duration);
              if (at) e.currentTarget.currentTime = at;
            }}
            onTimeUpdate={tell}
            onPause={tell}
            onPlay={tell}
          />
        ) : grant === undefined ? (
          <div className="h-10 bg-(--ui-tile)" />
        ) : (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">
            {item.mediaUrl
              ? "This episode plays for Wren's team only."
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
function Embed({ item }: { item: ItemPage }) {
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
          Open on {site} <ExternalLink size={13} />
        </span>
      </a>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      <iframe
        src={e.src}
        title={`${TYPES[item.type]?.label} post`}
        className={cx("w-full border border-(--ui-hair) bg-(--ui-paper)", e.box)}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      />
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[13px]"
      >
        Open on {site} <ExternalLink size={12} />
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
      <h2 className="m-0 font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
        Key moments
      </h2>
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
                ? "border-(--ui-accent) bg-(--ui-accent-wash)"
                : "border-(--ui-hair) bg-(--ui-paper) hover:border-(--ui-ink-3)",
            )}
          >
            <span className="font-semibold text-(--ui-accent) text-[12px] tabular-nums">
              {clock(m.t)}
            </span>
            <span className="line-clamp-2 text-[13px] text-(--ui-ink) leading-snug">{m.label}</span>
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
              className="accent-(--ui-accent)"
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
              <span className="w-12 shrink-0 pt-px text-(--ui-accent) text-[12px] tabular-nums">
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
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[13px] transition-colors duration-150",
        on
          ? "border-(--ui-accent) bg-(--ui-accent-wash) text-(--ui-accent)"
          : "border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink) hover:bg-(--ui-hover)",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Side({ item }: { item: ItemPage }) {
  return (
    <div className="flex flex-col gap-6">
      {item.summary ? (
        <section>
          <h2 className="m-0 mb-1.5 font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
            Summary
          </h2>
          <p className="m-0 text-[14.5px] text-(--ui-ink) leading-relaxed">{item.summary}</p>
        </section>
      ) : null}
      {item.why ? (
        <section>
          <h2 className="m-0 mb-1.5 font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
            Why it scored {item.score ?? ""}
          </h2>
          <p className="m-0 text-[14px] text-(--ui-ink-2) leading-relaxed">{item.why}</p>
        </section>
      ) : null}
      {item.changes.length ? (
        <section>
          <h2 className="m-0 mb-1.5 font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
            What it would change
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {item.changes.map((c) => (
              <li key={c} className="flex gap-2 text-[14px] text-(--ui-ink) leading-relaxed">
                <span className="mt-[0.6em] size-1.5 shrink-0 bg-(--ui-accent)" />
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {item.sops.length ? (
        <section>
          <h2 className="m-0 mb-1.5 font-semibold text-(--ui-ink-2) text-[11.5px] uppercase tracking-[0.06em]">
            In SOPs
          </h2>
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
  const load = useCall(`learn.item:${id}`, () => learn.item(id));
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  const { rail } = useRail();
  const item = load.data;
  const [now, setNow] = useState(0);
  const [dialog, setDialog] = useState<"move" | "tag" | "sop" | "keys" | null>(null);
  const player = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);

  // Opened: out of the Inbox. Once per visit.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!item || opened.current === id) return;
    opened.current = id;
    if (item.status === "unread") void learn.open(item.id).then(changed, () => {});
  }, [item, id]);

  // Where you are, kept every 15 seconds of play and on pause.
  const saved = useRef({ at: 0, t: 0 });
  const keepPlace = useCallback(
    (t: number, duration: number | null, playing: boolean) => {
      setNow(t);
      setReady(true);
      if (!item) return;
      const due = !playing || Date.now() - saved.current.at > 15_000;
      if (due && Math.abs(t - saved.current.t) >= 3) {
        saved.current = { at: Date.now(), t };
        void learn
          .progress(item.id, Math.floor(t), duration ? Math.round(duration) : null)
          .catch(() => {});
      }
    },
    [item],
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
      else if (k === "?") run(() => setDialog("keys"));
      else if (k === "Escape" || k === "u") run(() => navigate(back));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [item, dialog, back]);

  if (load.error && !item) return <Alert onRetry={load.retry}>{load.error.message}</Alert>;
  if (!item) return <Loading lines={6} heading />;

  const t = TYPES[item.type] ?? TYPES.link;
  const vid = item.type === "youtube" || item.type === "shorts" ? youtubeId(item.url) : null;
  const plays = !!vid || (item.type === "podcast" && !!item.mediaUrl);
  const words = item.transcript ?? (item.text || null);
  const seek = plays ? (s: number) => player.current?.seek(s) : null;
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
    <YouTube
      vid={vid}
      start={resumeAt(item.position, item.duration)}
      tall={item.type === "shorts"}
      onTime={keepPlace}
      playerRef={player}
    />
  ) : item.type === "podcast" ? (
    <Episode item={item} onTime={keepPlace} playerRef={player} />
  ) : item.type === "instagram" || item.type === "tiktok" || item.type === "x" ? (
    <Embed item={item} />
  ) : null;

  return (
    <article className="pb-16">
      <a
        href={back}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
      >
        <ArrowLeft size={14} /> {backLabel}
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
              <Folder size={13} /> {item.collection.name}
            </a>
          ) : null}
        </div>
        <div className="flex items-start gap-3">
          <h1 className="m-0 min-w-0 flex-1 text-balance font-semibold text-[24px] leading-tight tracking-[-0.015em]">
            {item.title}
          </h1>
          {item.score !== null ? (
            <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
              <ScoreBadge score={item.score} className="h-7 min-w-7 text-[14px]" />
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
            <Star size={14} fill={item.starred ? "currentColor" : "none"} />
          </Act>
          <Act
            label="Watch later"
            on={item.later}
            onClick={() => void markItems([item.id], item.later ? "unlater" : "later")}
          >
            <Clock size={14} />
          </Act>
          <Act
            label={item.pinned ? "Pinned" : "Pin"}
            on={item.pinned}
            onClick={() => void markItems([item.id], item.pinned ? "unpin" : "pin")}
          >
            <Pin size={14} />
          </Act>
          <Act label="Move to" onClick={() => setDialog("move")}>
            <FolderInput size={14} />
          </Act>
          <Act label="Tag" onClick={() => setDialog("tag")}>
            <Tag size={14} />
          </Act>
          <Act label="Add to SOP" onClick={() => setDialog("sop")}>
            <Sparkles size={14} />
          </Act>
          <Act
            label={item.status === "archived" ? "Unarchive" : "Archive"}
            onClick={() => {
              void markItems([item.id], item.status === "archived" ? "unarchive" : "archive");
              if (item.status !== "archived") navigate(back);
            }}
          >
            {item.status === "archived" ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </Act>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-8 items-center gap-1.5 px-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
          >
            Open on {t.site} <ExternalLink size={13} />
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
                <Hash size={11} />
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
                <RotateCw size={14} /> Read again
              </Button>
            </span>
          </Alert>
        </div>
      ) : item.state === "mac" ? (
        <p className="mb-5 border-(--ui-warn) border-l-2 bg-(--ui-wash) px-3 py-2 text-[13.5px] text-(--ui-ink-2)">
          Waits for the Mac to transcribe it. The summary and score follow.
        </p>
      ) : item.state === "reading" || item.state === "scoring" ? (
        <p className="mb-5 border-(--ui-accent) border-l-2 bg-(--ui-wash) px-3 py-2 text-[13.5px] text-(--ui-ink-2)">
          {item.state === "reading" ? "Reading it now." : "Scoring it against Wren's SOPs."} This
          page fills in when it's done.
        </p>
      ) : null}

      {media ? (
        <div className={cx("grid gap-6", words && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
          <div className="flex min-w-0 flex-col gap-4">
            <Moments moments={item.moments} now={now} seek={seek} />
            {media}
            {progress > 0 && !ready ? (
              <p className="m-0 inline-flex items-center gap-2 text-[13px] text-(--ui-ink-2)">
                <Play size={13} /> Picks up at {clock(item.position ?? 0)}
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
          <aside className="xl:sticky xl:top-4 xl:self-start">
            <Side item={item} />
          </aside>
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
      ) : dialog === "keys" ? (
        <KeysDialog onClose={() => setDialog(null)} />
      ) : null}
    </article>
  );
}
