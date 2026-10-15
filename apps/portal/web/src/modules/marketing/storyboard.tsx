/**
 * A video's storyboard (designs/2026-10-15-storyboard.md): the edit as frames, one per chapter
 * (or run of sentences) and one per Short, each drawn as the Finish preview draws that moment:
 * the picture, the corner camera, the captions, the text on it. Under the frames, and on each
 * one, a sentence changes it: the model proposes a patch (`VideoDesk.propose`), the board shows
 * what it would be with the changed frames marked, and Apply saves it through `VideoDesk.set`.
 * Nothing renders until Render. The timeline and the rest of the editor are one tab away.
 */
import type { Proposal } from "@wren/studio/change";
import {
  CAPTION_LOOK,
  type CroppedFormat,
  type Crops,
  captionShown,
  captionTrack,
  cornerCam,
  cropWindow,
  FPS,
  FRAME,
  longCaption,
  overlayAt,
  REEL,
  reelCaption,
  reelY,
  shortCrop,
  type TextOverlay,
} from "@wren/studio/finish";
import type { Cut } from "@wren/studio/schema";
import type { Beat, Storyboard as Board, Show } from "@wren/studio/storyboard";
import {
  ACTIONS,
  answerIn,
  Button,
  cx,
  Input,
  type RecordAct,
  Segmented,
  Tag,
  Textarea,
  UnsavedMark,
  useEdit,
} from "@wren/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { href } from "../../route.js";
import {
  type FinishData,
  OverlayText,
  ShownCaption,
  STRIP_ACROSS,
  STRIP_FRAMES,
  shownOn,
} from "./finish.js";
import type { LayoutRange, Short } from "./finish-parts.js";
import { VIEWED } from "./video-patch.js";

const PROPOSE = "marketing.videoPropose";
const SET = "marketing.videoSet";
const UNDO = "marketing.videoUndo";
/** A proposal changes nothing on the page until Apply: no read again. */
const KEPT = { patch: () => ({}) };

type Word = { w: string; s: number; e: number; stress?: boolean };
/** What a frame draws: the saved fields, or a proposal's over them. */
type Draw = {
  cuts: Cut[];
  overlays: TextOverlay[];
  captions: FinishData["saved"]["captions"];
  crops: Crops;
  layout: LayoutRange[];
  shorts: Short[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const length = (s: number) =>
  s < 10
    ? `${Math.round(s * 10) / 10}s`
    : s < 60
      ? `${Math.round(s)}s`
      : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
const SHOWS: Record<Show, string> = {
  corner: "Camera in the corner",
  cam: "Face only",
  screen: "Screen only",
};
const FORMAT_NAMES: Record<string, string> = {
  long: "Long",
  vertical: "Vertical",
  square: "Square",
  portrait: "Portrait",
};
const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const beatName = (b: Beat) =>
  `${b.kind === "short" ? "Short" : b.kind === "chapter" ? "Chapter" : "Part"} ${b.n}`;

/** The editor's two views, as links: the address holds which one is open. */
export function EditorTabs({ params, timeline }: { params: URLSearchParams; timeline: boolean }) {
  const here = typeof location === "undefined" ? "" : location.pathname;
  return (
    <Segmented
      label="Editor view"
      className="max-w-[360px]"
      items={[
        {
          id: "board",
          label: "Storyboard",
          href: href(here, { editor: null }, params),
          on: !timeline,
        },
        {
          id: "timeline",
          label: "Timeline",
          href: href(here, { editor: "timeline" }, params),
          on: timeline,
        },
      ]}
    />
  );
}

/** Seen yet: a frame's video loads once it scrolls near the screen. */
function useSeen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean, number] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    size.observe(el);
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return () => size.disconnect();
    }
    const near = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          near.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    near.observe(el);
    return () => {
      size.disconnect();
      near.disconnect();
    };
  }, []);
  return [ref, seen, w];
}

/** A still of the recording at `t`: the browser seeks a metadata load there (`#t=`). */
const Still = ({ src, t, style }: { src: string; t: number; style: CSSProperties }) => (
  <video
    src={`${src}#t=${(t + 0.5 / FPS).toFixed(3)}`}
    preload="metadata"
    muted
    playsInline
    className="pointer-events-none absolute max-w-none object-cover"
    style={style}
  />
);

/** A frame's picture at its first moment that plays, drawn as the Finish preview draws it. */
function Poster({
  beat,
  data,
  draw,
  words,
}: {
  beat: Beat;
  data: FinishData | undefined;
  draw: Draw | null;
  words: readonly Word[];
}) {
  const reel = beat.kind === "short";
  const view = reel ? "vertical" : "long";
  const [fw, fh] = FRAME[view];
  const [box, seen, w] = useSeen<HTMLDivElement>();
  const h = (w * fh) / fw;
  const t = beat.at;
  const which = reel ? "short" : "long";
  const track = useMemo(
    () => (data && draw ? captionTrack(words, draw.cuts, data.durationS, which) : null),
    [words, draw, data, which],
  );
  if (!data || !draw)
    return (
      <div
        ref={box}
        className={cx(
          "w-full rounded-lg bg-black",
          reel ? "mx-auto aspect-[9/16] max-h-80" : "aspect-video",
        )}
      />
    );

  const cap = draw.captions ?? { style: "word" };
  const line = track && shownOn(cap, which) ? captionShown(track, t) : null;
  const chars = line ? line.words.reduce((n, x) => n + x.w.length, line.words.length - 1) : 16;
  const capLook = !w
    ? null
    : reel
      ? (() => {
          const r = reelCaption(w, reelY(h, cap.place), chars, REEL.maxChars, CAPTION_LOOK.font);
          return { box: r.box, text: {}, size: r.size };
        })()
      : longCaption(w, h, cap.place?.long, CAPTION_LOOK.font);
  const show: Show = reel
    ? "screen"
    : (draw.layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner");

  // The picture: whole in 16:9; a Short's 9:16 window on the main picture or the camera.
  const useCam = reel && data.picture.source === "cam" && !!data.sourceCam && !!data.camSize;
  const src = show === "cam" ? data.sourceCam : useCam ? data.sourceCam : data.source;
  const pic: [number, number] = useCam ? (data.camSize as [number, number]) : data.size;
  let picStyle: CSSProperties = { inset: 0, width: "100%", height: "100%" };
  if (reel && w) {
    const centre =
      shortCrop(draw.crops, beat.n) ?? (useCam ? { x: 0.5, y: 0.5 } : data.picture.centre);
    const [x, y, cw, ch] = cropWindow(pic[0], pic[1], FRAME[view as CroppedFormat], centre);
    picStyle = {
      left: (-x * w) / cw,
      top: (-y * h) / ch,
      width: (pic[0] * w) / cw,
      height: (pic[1] * h) / ch,
    };
  }
  // The filmstrip's nearest frame shows until the still loads.
  const rows = Math.ceil(STRIP_FRAMES / STRIP_ACROSS);
  const k = Math.min(STRIP_FRAMES - 1, Math.floor((t / data.durationS) * STRIP_FRAMES));
  const strip =
    data.strip && !reel && show !== "cam"
      ? {
          backgroundImage: `url(${data.strip})`,
          backgroundSize: `${STRIP_ACROSS * 100}% ${rows * 100}%`,
          backgroundPosition: `${((k % STRIP_ACROSS) / (STRIP_ACROSS - 1)) * 100}% ${(Math.floor(k / STRIP_ACROSS) / (rows - 1)) * 100}%`,
        }
      : {};
  const card = reel
    ? beat.onScreen[0] && draw.shorts[beat.n - 1]?.card !== false
      ? beat.onScreen[0]
      : null
    : null;
  const overlays = draw.overlays.filter((o) => o.from < beat.to && o.to > beat.from);

  return (
    <div
      ref={box}
      className={cx(
        "relative w-full overflow-hidden rounded-lg bg-black",
        reel ? "mx-auto aspect-[9/16] max-w-[180px]" : "aspect-video",
      )}
      style={strip}
    >
      {seen && src && w ? <Still src={src} t={t} style={picStyle} /> : null}
      {!src ? (
        <p className="absolute inset-0 m-0 grid place-items-center p-3 text-center text-[12px] text-white/70">
          Pictures show after the next render.
        </p>
      ) : null}
      {seen && w && !reel && show === "corner" && data.sourceCam ? (
        <div className="pointer-events-none" style={cornerCam(w, h)}>
          <Still src={data.sourceCam} t={t} style={{ inset: 0, width: "100%", height: "100%" }} />
        </div>
      ) : null}
      {line && capLook ? (
        <div className="pointer-events-none" style={capLook.box}>
          <div style={capLook.text}>
            <ShownCaption line={line} style={cap.style} size={capLook.size} />
          </div>
        </div>
      ) : null}
      {w && card ? (
        <OverlayText
          o={{ text: card, from: t, to: t + 1, x: 0.5, y: 0.2, size: "m" }}
          at={
            overlayAt(
              { text: card, from: t, to: t + 1, x: 0.5, y: 0.2, size: "m" },
              t + 0.5,
              w,
              h,
            ) as NonNullable<ReturnType<typeof overlayAt>>
          }
          faint={false}
          selected={false}
        />
      ) : null}
      {w
        ? overlays.map((o, i) => {
            // Text on in this part shows on its frame, even when it comes on after the still.
            const at =
              overlayAt(o, t, w, h) ?? overlayAt({ ...o, from: t, to: t + 1 }, t + 0.5, w, h);
            return at ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
              <OverlayText key={i} o={o} at={at} faint={false} selected={false} />
            ) : null;
          })
        : null}
    </div>
  );
}

/** One frame: the picture, when, what's said, what's on screen, what it shows, what's cut. */
function Frame({
  id,
  beat,
  data,
  draw,
  words,
  changed,
  editable,
  asking,
  onAsk,
}: {
  /** The video's id: where a half-written change is kept. */
  id: string;
  beat: Beat;
  data: FinishData | undefined;
  draw: Draw | null;
  words: readonly Word[];
  changed: boolean;
  editable: boolean;
  asking: boolean;
  onAsk: (sentence: string) => Promise<boolean>;
}) {
  // The sentence stays until it is sent: another page and back gives it again.
  const change = useEdit(`video:${id}:change:${beat.key}`, "");
  const said = change.value;
  const send = async () => {
    const sent = said;
    if (sent.trim() && (await onAsk(sent.trim()))) change.saved(sent);
  };
  return (
    <article
      aria-label={beatName(beat)}
      className={cx(
        "grid min-w-0 content-start gap-2.5 rounded-xl border bg-(--ui-paper) p-3",
        changed
          ? "animate-ui-changed border-(--ui-live) shadow-[0_0_0_1px_var(--ui-live)]"
          : "border-(--ui-hair)",
        beat.cut === "all" && !changed && "opacity-70",
      )}
    >
      <Poster beat={beat} data={data} draw={draw} words={words} />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="m-0 min-w-0 text-[14px] font-semibold text-(--ui-ink)">
          {beatName(beat)}
          {beat.title ? (
            <span className="font-normal text-(--ui-ink-2)"> · {beat.title}</span>
          ) : null}
        </h4>
        <span className="text-[12.5px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
          {clock(beat.from)}–{clock(beat.to)}
        </span>
        {changed ? <Tag tone="accent">Changes</Tag> : null}
        {beat.cut === "all" ? (
          <Tag tone="warn">All cut</Tag>
        ) : beat.cut === "some" ? (
          <Tag>Cut {length(beat.cutS)}</Tag>
        ) : null}
      </div>
      <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
        {beat.kind === "short"
          ? "Vertical, 9:16"
          : beat.layout.map((s) => SHOWS[s]).join(", then ")}
        {beat.onCut ? ` · plays at ${clock(beat.onCut.from)}` : ""}
      </p>
      {beat.said ? (
        <p className="m-0 line-clamp-4 text-[13.5px]/[1.45] text-(--ui-ink)">{beat.said}</p>
      ) : (
        <p className="m-0 text-[13px] text-(--ui-ink-3)">Nothing said plays here.</p>
      )}
      {beat.struck ? (
        <p className="m-0 line-clamp-2 text-[12.5px] text-(--ui-ink-3)">
          Cut: <s>{beat.struck}</s>
        </p>
      ) : null}
      {beat.onScreen.length ? (
        <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
          On screen: {beat.onScreen.map((x) => `“${x}”`).join(", ")}
        </p>
      ) : null}
      {editable ? (
        <Input
          {...change.field}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={asking}
          placeholder={beat.kind === "short" ? "Change this Short" : "Change this part"}
          aria-label={`Change ${beatName(beat)}`}
          maxLength={1000}
          className={cx(asking && "animate-pulse")}
        />
      ) : null}
    </article>
  );
}

/** What a proposal changes, in his words, with Apply and Discard. */
function ProposalPanel({
  p,
  applying,
  onApply,
  onDiscard,
}: {
  p: Proposal;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const can = !!p.patch && !p.issues.length;
  return (
    <section
      aria-live="polite"
      aria-label="Proposed change"
      className="sticky bottom-3 z-10 grid max-h-[45vh] gap-2.5 overflow-y-auto rounded-xl border border-(--ui-hair) bg-(--ui-paper) p-3.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)]"
    >
      <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
        “{p.sentence}”{p.beat ? ` on ${p.beat.replace("-", " ")}` : ""}
      </p>
      <ul className="m-0 grid gap-1 pl-5 text-[14px] text-(--ui-ink)">
        {p.changes.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat; order is the identity.
          <li key={i}>{c}</li>
        ))}
      </ul>
      {p.snapped.map((m) => (
        <p key={m.n} className="m-0 text-[12.5px] text-(--ui-ink-2)">
          Short {m.n} moved to whole sentences.
        </p>
      ))}
      {p.issues.length ? (
        <p className="m-0 text-[13px] text-(--ui-bad)">Can't apply: {p.issues.join("; ")}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="dense"
          tone="primary"
          busy={applying}
          disabled={!can || applying}
          onClick={onApply}
        >
          Apply
        </Button>
        <Button size="dense" tone="secondary" disabled={applying} onClick={onDiscard}>
          Discard
        </Button>
        {p.patch ? (
          <span className="text-[12.5px] text-(--ui-ink-2)">
            {p.changed.beats.length
              ? `${p.changed.beats.length} ${p.changed.beats.length === 1 ? "frame changes" : "frames change"}, marked.`
              : "No frame changes; the details do."}{" "}
            Nothing renders until Render.
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function StoryboardView({
  id,
  board,
  data,
  words,
  editable,
  act,
}: {
  id: string;
  board: Board;
  data: FinishData | undefined;
  words: readonly Word[];
  editable: boolean;
  act: RecordAct;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<"apply" | "undo" | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sentence stays until it is sent: another page and back gives it again.
  const change = useEdit(`video:${id}:change`, "");
  const said = change.value;
  const sendAll = () => {
    const sent = said;
    if (sent.trim()) void ask(sent.trim(), null).then((ok) => ok && change.saved(sent));
  };

  const ask = async (sentence: string, beat: string | null) => {
    setAsking(beat ?? "all");
    setError(null);
    try {
      const input = { sentence, beat };
      const out = await ACTIONS.run(
        `video:${PROPOSE}:${id}:${JSON.stringify(input)}`,
        (requestId) => act(PROPOSE, { ...input, requestId }, KEPT),
      );
      setProposal(answerIn(out) as Proposal);
      return true;
    } catch (err) {
      setError(errorOf(err));
      return false;
    } finally {
      setAsking(null);
    }
  };
  const apply = async () => {
    if (!proposal?.patch) return;
    setBusy("apply");
    setError(null);
    try {
      const input = { patch: proposal.patch, expect: proposal.expect, proposal: proposal.run };
      await ACTIONS.run(`video:${SET}:${proposal.run}`, (requestId) =>
        act(SET, { ...input, requestId }, VIEWED),
      );
      setProposal(null);
      setApplied(true);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(null);
    }
  };
  const undo = async () => {
    setBusy("undo");
    setError(null);
    try {
      await ACTIONS.run(`video:${UNDO}:${id}:${Date.now()}`, (requestId) =>
        act(UNDO, { requestId }, VIEWED),
      );
      setApplied(false);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(null);
    }
  };

  // The frames as they'd be after the proposal, drawn with its fields over the saved ones.
  const shown = proposal?.after ?? board;
  const changed = new Set(proposal?.changed.beats ?? []);
  const head = new Set(proposal?.changed.header ?? []);
  const draw = useMemo((): Draw | null => {
    if (!data) return null;
    const p = (proposal?.patch ?? {}) as Partial<Draw>;
    return {
      cuts: p.cuts ?? data.saved.cuts,
      overlays: p.overlays ?? data.saved.overlays ?? [],
      captions: p.captions ?? data.saved.captions ?? { style: "word" },
      crops: p.crops ?? data.saved.crops ?? {},
      layout: p.layout ?? data.layout ?? [],
      shorts: p.shorts ?? data.shorts,
    };
  }, [data, proposal]);

  const mark = (k: string) => (head.has(k) ? "font-semibold text-(--ui-live)" : undefined);
  const shorts = shown.shorts.length;
  return (
    <div className="grid min-w-0 gap-4">
      <header className="grid min-w-0 gap-1">
        <h3 className={cx("m-0 text-[17px] font-semibold text-(--ui-ink)", mark("title"))}>
          {shown.title || "Untitled"}
        </h3>
        <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
          <span className={mark("cutS")}>
            {length(shown.cutS)} after cuts, of {length(shown.rawS)}
          </span>
          <span className={mark("formats")}>
            {shown.formats.map((f) => FORMAT_NAMES[f] ?? f).join(", ")}
          </span>
          <span className={mark("shorts")}>
            {shorts} {shorts === 1 ? "Short" : "Shorts"}
          </span>
          {shown.chapters ? (
            <span className={mark("chapters")}>{shown.chapters} chapters</span>
          ) : null}
          <span className={mark("captions")}>Captions: {shown.captions}</span>
        </p>
      </header>

      <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
        {shown.beats.map((b) => (
          <Frame
            key={b.key}
            id={id}
            beat={b}
            data={data}
            draw={draw}
            words={words}
            changed={changed.has(b.key)}
            editable={editable && !proposal}
            asking={asking === b.key}
            onAsk={(s) => ask(s, b.key)}
          />
        ))}
      </div>

      {shorts ? (
        <section className="grid min-w-0 gap-3">
          <h4 className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">Shorts</h4>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3">
            {shown.shorts.map((b) => (
              <Frame
                key={b.key}
                id={id}
                beat={b}
                data={data}
                draw={draw}
                words={words}
                changed={changed.has(b.key)}
                editable={editable && !proposal}
                asking={asking === b.key}
                onAsk={(s) => ask(s, b.key)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {proposal?.changed.gone.length ? (
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          Gone after this change: {proposal.changed.gone.map((k) => k.replace("-", " ")).join(", ")}
          .
        </p>
      ) : null}

      {proposal ? (
        <ProposalPanel
          p={proposal}
          applying={busy === "apply"}
          onApply={() => void apply()}
          onDiscard={() => setProposal(null)}
        />
      ) : editable ? (
        <div className="grid min-w-0 gap-2">
          <Textarea
            {...change.field}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendAll();
              }
            }}
            disabled={!!asking}
            rows={2}
            maxLength={1000}
            placeholder="Change the video in a sentence: tighter cut, face only in the intro, a Short on the pricing part"
            aria-label="Change the video"
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="dense"
              tone="primary"
              busy={asking === "all"}
              disabled={!said.trim() || !!asking}
              onClick={sendAll}
            >
              Propose
            </Button>
            {applied ? (
              <Button size="dense" tone="quiet" busy={busy === "undo"} onClick={() => void undo()}>
                Undo
              </Button>
            ) : null}
            <span className="text-[12.5px] text-(--ui-ink-3)">
              You see it before anything saves.
            </span>
            <UnsavedMark edit={change} />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-(--ui-bad)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
