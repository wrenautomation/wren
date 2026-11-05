/**
 * Cuts of one footage, played in step (designs/2026-11-05-variants.md, Sync). The video you touch
 * leads; the rest follow, muted. "Same moment" maps through each cut's footage spans, so a
 * follower that dropped the moment waits under "Cut here". "Same clock" matches seconds.
 * No library does leader/follower sync over native <video>, so this is small and ours.
 */
import { cx } from "@wren/ui";
import { type Span, toPlay, toSource } from "@wrenautomation/vireo/sync";
import { createContext, type RefObject, useContext, useEffect, useRef, useState } from "react";

export type SyncMode = "off" | "moment" | "clock";

interface Member {
  video: HTMLVideoElement;
  spans: readonly Span[] | null;
  setCut: (cut: boolean) => void;
  cut: boolean;
}
type Ev = "play" | "pause" | "seeked";

/** Drift we let ride before a seek: under it a seek costs more than it fixes. */
const DRIFT_S = 0.15;

export class Together {
  mode: SyncMode = "off";
  private members = new Map<number, Member>();
  private leader: number | null = null;
  /** Events our own play/pause/seek will fire: skipped, so a follower never takes the lead. */
  private ours = new Map<HTMLVideoElement, Record<Ev, number>>();
  private frame = 0;
  private heads = new Set<(src: number | null) => void>();

  setMode(mode: SyncMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "off") {
      cancelAnimationFrame(this.frame);
      for (const m of this.members.values()) {
        m.video.muted = false;
        this.markCut(m, false);
      }
      this.emit();
      return;
    }
    this.leader ??= this.members.keys().next().value ?? null;
    this.alignAll();
  }

  join(
    id: number,
    video: HTMLVideoElement,
    spans: readonly Span[] | null,
    setCut: Member["setCut"],
  ) {
    const m: Member = { video, spans, setCut, cut: false };
    this.members.set(id, m);
    const on = (ev: Ev) => () => {
      const mine = this.ours.get(video);
      if (mine && mine[ev] > 0) {
        mine[ev] -= 1;
        return;
      }
      if (this.mode === "off") return;
      this.leader = id;
      this.alignAll();
      if (ev === "play") this.run();
    };
    const handlers = { play: on("play"), pause: on("pause"), seeked: on("seeked") };
    for (const [ev, fn] of Object.entries(handlers)) video.addEventListener(ev, fn);
    if (this.mode !== "off") this.alignAll();
    return () => {
      for (const [ev, fn] of Object.entries(handlers)) video.removeEventListener(ev, fn);
      this.members.delete(id);
      this.ours.delete(video);
      if (this.leader === id) this.leader = null;
    };
  }

  /** Playhead on the footage: lanes draw it each frame without a React render. */
  onHead(fn: (src: number | null) => void) {
    this.heads.add(fn);
    fn(this.sourceNow());
    return () => void this.heads.delete(fn);
  }

  /** Lanes: jump the leader to a footage moment (or the next one it keeps). */
  seekSource(src: number) {
    const lead = this.lead();
    if (!lead?.spans) return;
    const t = toPlay(lead.spans, src) ?? firstAfter(lead.spans, src);
    if (t == null) return;
    lead.video.currentTime = t;
  }

  private lead() {
    return this.leader == null ? undefined : this.members.get(this.leader);
  }

  private sourceNow(): number | null {
    const lead = this.lead();
    if (!lead) return null;
    return lead.spans ? toSource(lead.spans, lead.video.currentTime) : lead.video.currentTime;
  }

  private emit() {
    const src = this.mode === "off" ? null : this.sourceNow();
    for (const fn of this.heads) fn(src);
  }

  private run() {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      if (this.mode === "off") return;
      this.alignAll();
      if (!this.lead()?.video.paused) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private alignAll() {
    const lead = this.lead();
    if (!lead) return;
    lead.video.muted = false;
    this.markCut(lead, false);
    for (const [id, m] of this.members) if (id !== this.leader) this.align(lead, m);
    this.emit();
  }

  private align(lead: Member, m: Member) {
    const v = m.video;
    v.muted = true;
    const t =
      this.mode === "moment" && lead.spans && m.spans
        ? toPlay(m.spans, toSource(lead.spans, lead.video.currentTime))
        : Number.isFinite(v.duration) && lead.video.currentTime >= v.duration
          ? null
          : lead.video.currentTime;
    if (t == null) {
      this.markCut(m, true);
      if (!v.paused) this.act(v, "pause");
      return;
    }
    this.markCut(m, false);
    if (Math.abs(v.currentTime - t) > DRIFT_S) {
      this.expect(v, "seeked");
      v.currentTime = t;
    }
    if (lead.video.paused && !v.paused) this.act(v, "pause");
    if (!lead.video.paused && v.paused) this.act(v, "play");
  }

  private act(v: HTMLVideoElement, ev: "play" | "pause") {
    this.expect(v, ev);
    if (ev === "pause") return v.pause();
    v.play().catch(() => {
      const mine = this.ours.get(v);
      if (mine && mine.play > 0) mine.play -= 1;
    });
  }

  private expect(v: HTMLVideoElement, ev: Ev) {
    const mine = this.ours.get(v) ?? { play: 0, pause: 0, seeked: 0 };
    mine[ev] += 1;
    this.ours.set(v, mine);
  }

  private markCut(m: Member, cut: boolean) {
    if (m.cut === cut) return;
    m.cut = cut;
    m.setCut(cut);
  }
}

/** Play time of the first kept moment after `src`; null when none is left. */
function firstAfter(spans: readonly Span[], src: number): number | null {
  let best: { s: number; t: number } | null = null;
  let at = 0;
  for (const p of spans) {
    if (p.s >= src && (!best || p.s < best.s)) best = { s: p.s, t: at };
    at += p.e - p.s;
  }
  return best?.t ?? null;
}

const TogetherCtx = createContext<Together | null>(null);
export const TogetherProvider = TogetherCtx.Provider;

/** Joins a video to the batch's group; true while its cut dropped the leader's moment. */
export function useTogether(
  id: number,
  ref: RefObject<HTMLVideoElement | null>,
  spans: readonly Span[] | null,
): boolean {
  const group = useContext(TogetherCtx);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!group || !v) return;
    return group.join(id, v, spans, setCut);
  }, [group, id, ref, spans]);
  return cut;
}

/**
 * What each cut keeps of the footage, one lane per cut, with the leader's playhead. Tap a lane to
 * send every cut to that moment.
 */
export function FootageLanes({
  group,
  cuts,
  length,
}: {
  group: Together;
  cuts: { n: number; spans: readonly Span[] }[];
  length: number;
}) {
  const head = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      group.onHead((src) => {
        const el = head.current;
        if (!el) return;
        el.style.opacity = src == null ? "0" : "1";
        el.style.left = `${((src ?? 0) / length) * 100}%`;
      }),
    [group, length],
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="w-7 shrink-0" />
        <div className="flex flex-1 justify-between text-[11px] text-(--ui-ink-3)">
          <span>Footage 0:00</span>
          <span>{fmt(length)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex w-7 shrink-0 flex-col gap-1.5">
          {cuts.map((c) => (
            <span key={c.n} className="h-3 text-[11px] leading-3 font-semibold text-(--ui-ink-3)">
              #{c.n}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-label="Go to this moment in every cut"
          className="relative flex flex-1 cursor-pointer flex-col gap-1.5"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            group.seekSource(((e.clientX - r.left) / r.width) * length);
          }}
        >
          {cuts.map((c) => (
            <span key={c.n} className="relative block h-3 w-full rounded-full bg-(--ui-tile)">
              {c.spans.map((p) => (
                <span
                  key={`${p.s}-${p.e}`}
                  className={cx("absolute top-0 block h-3 rounded-full bg-(--ui-accent)")}
                  style={{
                    left: `${(p.s / length) * 100}%`,
                    width: `${((p.e - p.s) / length) * 100}%`,
                  }}
                />
              ))}
            </span>
          ))}
          <span
            ref={head}
            className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-(--ui-ink) opacity-0"
          />
        </button>
      </div>
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
