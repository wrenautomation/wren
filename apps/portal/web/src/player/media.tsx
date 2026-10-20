/**
 * What the host actually plays, one component per kind. They live in the host's element for as
 * long as the item plays, so a page change never reloads them. Each tells the store the time
 * and gives it a way to seek.
 */
import { useEffect, useMemo, useRef } from "react";
import type { PlayerItem } from "./store.js";
import { usePlayerStore } from "./use.js";

const YOUTUBE = "https://www.youtube-nocookie.com";

/**
 * The YouTube player, spoken to over postMessage: the IFrame API without its script. It starts at
 * the store's time, so a remount (Picture-in-Picture opens or closes) picks up where it was; a
 * moved iframe reloads, and this is how that reload resumes. `resume`: it was playing.
 */
export function YouTube({ item }: { item: PlayerItem }) {
  const store = usePlayerStore();
  const frame = useRef<HTMLIFrameElement>(null);
  const first = useMemo(() => {
    const s = store.getState();
    return { start: Math.floor(s.time), resume: s.heard && s.playing };
  }, [store]);
  const src = useMemo(() => {
    const q = new URLSearchParams({
      enablejsapi: "1",
      origin: location.origin,
      rel: "0",
      playsinline: "1",
      ...(first.start ? { start: String(first.start) } : {}),
      ...(first.resume ? { autoplay: "1" } : {}),
    });
    return `${YOUTUBE}/embed/${item.src}?${q}`;
  }, [item.src, first]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // In a Picture-in-Picture window the iframe's parent, and so its messages, is that window.
    const win = el.ownerDocument.defaultView ?? window;
    const post = (msg: object) =>
      el.contentWindow?.postMessage(JSON.stringify({ ...msg, id: 1, channel: "widget" }), YOUTUBE);
    let heard = false;
    let duration: number | null = null;
    let playing = false;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YOUTUBE || e.source !== el.contentWindow) return;
      let d: { info?: { currentTime?: number; duration?: number; playerState?: number } };
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
      if (typeof info.currentTime === "number") store.report(info.currentTime, duration, playing);
    };
    win.addEventListener("message", onMsg);
    // Until the player answers, say we're listening; it starts sending its time after.
    const hello = setInterval(() => {
      if (heard) return clearInterval(hello);
      post({ event: "listening" });
    }, 400);
    const detach = store.attach({
      seek: (t) => {
        post({ event: "command", func: "seekTo", args: [t, true] });
        post({ event: "command", func: "playVideo", args: [] });
      },
    });
    return () => {
      win.removeEventListener("message", onMsg);
      clearInterval(hello);
      detach();
    };
  }, [store]);
  return (
    <iframe
      ref={frame}
      src={src}
      title={item.title}
      className="size-full border-0"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

/** An Instagram, TikTok or X post's own embed. It has no clock to read. */
export function Embed({ item }: { item: PlayerItem }) {
  return (
    <iframe
      src={item.src}
      title={item.title}
      className="size-full border-0 bg-(--ui-paper)"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
    />
  );
}

/** A file through our origin (so the CSP stays at 'self'): a video, or sound alone. */
export function FileMedia({ item }: { item: PlayerItem }) {
  const store = usePlayerStore();
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(
    () =>
      store.attach({
        seek: (t) => {
          const m = media.current;
          if (!m) return;
          m.currentTime = t;
          void m.play().catch(() => {});
        },
      }),
    [store],
  );
  const tell = () => {
    const m = media.current;
    if (m) store.report(m.currentTime, Number.isFinite(m.duration) ? m.duration : null, !m.paused);
  };
  const common = {
    ref: (el: HTMLMediaElement | null) => {
      media.current = el;
    },
    src: item.src,
    controls: true,
    preload: "metadata" as const,
    title: item.title,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      const at = store.getState().time;
      if (at > 0) e.currentTarget.currentTime = at;
    },
    onTimeUpdate: tell,
    onPause: tell,
    onPlay: tell,
  };
  return item.media === "audio" ? (
    <audio {...common} className="w-full" />
  ) : (
    <video {...common} playsInline className="size-full bg-black object-contain" />
  );
}
