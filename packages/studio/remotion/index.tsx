/**
 * Adapted from heygen-com/hyperframes `registry/components/caption-*` and
 * `skills/embedded-captions` @5c7f631 (Apache-2.0); changed: the caption styles and the words
 * behind the speaker drawn as React on Remotion's frame clock from `src/caption-styles.ts` (no
 * GSAP); the speaker's matte a VP9 alpha WebM per window over the big word
 * (`OffthreadVideo transparent`). See packages/studio/NOTICE.
 *
 * Remotion compositions (designs/2026-10-06-video-editor.md, Composition). One file: Remotion's
 * bundler resolves no `.js` specifiers, so the value imports (Wren's look, for Studio's
 * placeholder, the line breakers, the caption styles) name their `.ts` files; the rest is types.
 * Props come from `longProps`, `shortProps`, `framedProps` and `thumbnailProps` through
 * `--props`; the cut files are served from the edit's folder.
 */
import {
  type CSSProperties,
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  OffthreadVideo,
  registerRoot,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DEFAULT_LOOK } from "../../video/src/overlay.ts";
import { bigWordState, onScreen, wordState } from "../src/caption-styles.ts";
import { lineAt, pageLines, REEL, reelLines } from "../src/captions.ts";
import {
  captionWordLook,
  cornerCam,
  coverRect,
  longCaption,
  overlayAt,
  pillLook,
  reelCaption,
  reelY,
  type TextOverlay,
} from "../src/finish-look.ts";
import type { PromoProps, TimedScene } from "../src/promo.js";
import {
  cameraAt,
  countAt,
  type Entrance,
  easeOut,
  entranceAt,
  fitBox,
  framing,
  scatterAt,
  toastAt,
  wordsIn,
} from "../src/promo-clock.ts";
import type {
  BehindWord,
  TitleCard as Card,
  Face,
  FramedProps,
  LongProps,
  ShortProps,
  ThumbnailProps,
} from "../src/props.js";
import { verticalRect } from "../src/safe-zones.ts";

type Word = LongProps["words"][number];
type Look = LongProps["look"];

/**
 * One caption word in its style at `t` (`wordState`, drawn by `captionWordLook`, as the Finish
 * preview draws it). `until`: when the next word of its line starts. `size`: the line's font size.
 */
const CaptionWord: FC<{
  w: Word;
  t: number;
  until: number;
  first: boolean;
  style: string;
  stressed: boolean;
  look: Look;
  size: number;
}> = ({ w, t, until, first, style, stressed, look, size }) => {
  const st = wordState(style, w, t, until, { first });
  const { word, fill } = captionWordLook(style, st, { stressed, size, accent: look.accent });
  if (!fill) return <span style={word}>{w.w}</span>;
  return (
    <span style={word}>
      <span style={fill} />
      <span style={{ position: "relative" }}>{w.w}</span>
    </span>
  );
};

/** A line of caption words; pill wraps it in its dark pill. */
const CaptionLine: FC<{
  words: Word[];
  /** Index of each word in the composition's words, to know which are stressed. */
  at: number[];
  end: number;
  t: number;
  style: string;
  stress: ReadonlySet<number>;
  look: Look;
  size: number;
}> = ({ words, at, end, t, style, stress, look, size }) => {
  const line = words.map((w, i) => (
    <CaptionWord
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
      key={i}
      w={w}
      t={t}
      until={words[i + 1]?.s ?? end}
      first={i === 0}
      style={style}
      stressed={stress.has(at[i] as number)}
      look={look}
      size={size}
    />
  ));
  if (style !== "pill") return <div>{line}</div>;
  return <div style={pillLook(size, look.foreground)}>{line}</div>;
};

/** The long video's lower-third line, in the edit's caption style; its middle at `y` when he moved it. */
const Captions: FC<{
  words: Word[];
  look: Look;
  t: number;
  style: string;
  stress: ReadonlySet<number>;
  place?: number | undefined;
}> = ({ words, look, t, style, stress, place }) => {
  const { width, height } = useVideoConfig();
  const all = useMemo(() => {
    let n = 0;
    return pageLines(words).map((p) => {
      const at = p.words.map((_, i) => n + i);
      n += p.words.length;
      return { ...p, at };
    });
  }, [words]);
  const page = lineAt(all, t)?.line as (typeof all)[number] | undefined;
  if (!page) return null;
  const last = page.words.at(-1) as Word;
  const { box, text, size } = longCaption(width, height, place, look.font);
  return (
    <AbsoluteFill style={box}>
      <div style={text}>
        <CaptionLine
          words={page.words}
          at={page.at}
          end={last.e + 0.3}
          t={t}
          style={style}
          stress={stress}
          look={look}
          size={size}
        />
      </div>
    </AbsoluteFill>
  );
};

/**
 * Reels captions (vertical and Shorts): one line of 2-4 words, about 80 px bold, white with a dark
 * outline, the said word on the accent. Kept clear of the Reels/Shorts UI: the bottom 20% and the
 * right 15%; `y` is where the line's middle sits, from the top.
 */
const ReelCaptions: FC<{
  words: Word[];
  look: Look;
  t: number;
  y: number;
  style: string;
  stress: ReadonlySet<number>;
}> = ({ words, look, t, y, style, stress }) => {
  const { width } = useVideoConfig();
  const lines = useMemo(() => reelLines(words), [words]);
  const first = useMemo(() => {
    const index = new Map(words.map((w, i) => [w, i]));
    return lines.map((l) => index.get(l.words[0] as Word) ?? 0);
  }, [lines, words]);
  const at = lineAt(lines, t);
  if (!at) return null;
  const k = lines.indexOf(at.line);
  const len = at.line.words.reduce((n, w) => n + w.w.length, at.line.words.length - 1);
  // A line past what fits shrinks rather than wrapping.
  const { box, size } = reelCaption(width, y, len, REEL.maxChars, look.font);
  return (
    <div style={box}>
      <CaptionLine
        words={at.line.words}
        at={at.line.words.map((_, i) => (first[k] as number) + i)}
        end={at.line.e}
        t={t}
        style={style}
        stress={stress}
        look={look}
        size={size}
      />
    </div>
  );
};

/**
 * The words behind the speaker: the big word from its start to `to`, then the speaker's matte
 * over it, laid exactly where the picture it was cut from sits (`draw`: the matte's file and the
 * cut file it came from). Captions go on top, after this.
 */
const Behind: FC<{
  items: BehindWord[];
  t: number;
  look: Look;
  draw: (file: string, src: string) => ReactNode;
}> = ({ items, t, look, draw }) => {
  const mattes = [...new Map(items.map((b) => [b.matte.file, b.matte])).values()];
  const word = items.find((b) => t >= b.s && t < b.to);
  const st = word ? bigWordState(t, word.s, word.to) : null;
  // Placed by `placeWord` (props.ts) where 70% of it stays clear of him.
  const { text = "", x = 0, y = 0, size: fit = 0 } = word?.place ?? {};
  return (
    <>
      {word && st ? (
        <div
          style={{
            position: "absolute",
            left: x - 2000,
            width: 4000,
            top: y - fit * 0.6,
            textAlign: "center",
            whiteSpace: "nowrap",
            font: `800 ${fit}px/1.2 ${look.font}`,
            letterSpacing: -fit * 0.03,
            color: "#fff",
            textShadow: "0 8px 40px rgba(0,0,0,0.35)",
            opacity: st.opacity,
            transform: `scale(${st.scale})`,
          }}
        >
          {text}
        </div>
      ) : null}
      {mattes.map((m) => (
        <Sequence key={m.file} from={m.fromFrame} durationInFrames={m.frames} layout="none">
          {draw(m.file, m.src)}
        </Sequence>
      ))}
    </>
  );
};

/**
 * Text on the video (finish-look.ts): white, heavy, a soft shadow so it reads over anything,
 * centred on its spot, faded in and out.
 */
const Overlays: FC<{ items: TextOverlay[]; t: number; look: Look }> = ({ items, t, look }) => {
  const { width, height } = useVideoConfig();
  return (
    <>
      {items.map((o, i) => {
        const at = overlayAt(o, t, width, height);
        if (!at) return null;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; position is the identity
            key={i}
            style={{
              position: "absolute",
              left: at.x,
              top: at.y,
              width: at.width,
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              font: `800 ${at.size}px/1.12 ${look.font}`,
              letterSpacing: -at.size * 0.02,
              color: "#fff",
              textWrap: "balance",
              textShadow: "0 2px 6px rgba(0,0,0,0.55), 0 8px 30px rgba(0,0,0,0.35)",
              opacity: at.opacity,
            }}
          >
            {o.text}
          </div>
        );
      })}
    </>
  );
};

export const Long: FC<LongProps> = ({
  main,
  cam,
  words,
  layout,
  captions,
  stress,
  behind,
  overlays,
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const show = layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner";
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const stressed = useMemo(() => new Set(stress), [stress]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* The recording carries the sound, so it plays under every layout. */}
      <OffthreadVideo src={staticFile(main)} style={{ ...fill, objectFit: "contain" }} />
      {cam && show !== "screen" ? (
        <div style={show === "cam" ? { position: "absolute", inset: 0 } : cornerCam(width, height)}>
          <OffthreadVideo src={staticFile(cam)} muted style={fill} />
        </div>
      ) : null}
      <Behind
        items={behind}
        t={t}
        look={look}
        draw={(file, src) => (
          <AbsoluteFill>
            <OffthreadVideo
              src={staticFile(file)}
              transparent
              muted
              style={{ ...fill, objectFit: src === main ? "contain" : "cover" }}
            />
          </AbsoluteFill>
        )}
      />
      {onScreen(captions, "long") ? (
        <Captions
          words={words}
          look={look}
          t={t}
          style={captions.style}
          stress={stressed}
          place={captions.place?.long}
        />
      ) : null}
      <Overlays items={overlays ?? []} t={t} look={look} />
    </AbsoluteFill>
  );
};

/** His face in a w x h box: the camera file, or the cam box cropped out of the recording. */
const FaceBox: FC<{
  face: Face;
  main: string;
  w: number;
  h: number;
  from: number;
  /** A matte cut out of the face's file, drawn in its place. */
  matte?: string;
  /** Where the box centres on his picture (0..1); unset = the face box's middle. */
  crop?: { x: number; y: number } | null;
}> = ({ face, main, w, h, from, matte, crop }) => {
  const file = matte ?? face.file ?? main;
  const [left, top, width, height] = coverRect(face.size, face.box, w, h, crop);
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(file)}
        muted
        transparent={!!matte}
        trimBefore={from}
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          maxWidth: "none",
        }}
      />
    </div>
  );
};

/**
 * A Short's opening title, Reels style: a small white label at the top, just below the
 * platforms' top bar and above his eyes, there from the first frame (the cover), then lifted
 * away by `holdS + fadeS`.
 */
const TitleCard: FC<{ card: Card; t: number; look: Look }> = ({ card, t, look }) => {
  if (t >= card.holdS + card.fadeS) return null;
  const k = Math.min(1, Math.max(0, (t - card.holdS) / card.fadeS));
  // Leaving accelerates (ease-in): it holds still, then goes.
  const out = k * k;
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        top: 170,
        display: "flex",
        justifyContent: "center",
        opacity: 1 - out,
        transform: `translateY(${-16 * out}px)`,
      }}
    >
      <div
        style={{
          maxWidth: 820,
          padding: "16px 30px 18px",
          borderRadius: 22,
          background: "rgba(255,255,255,0.96)",
          color: look.foreground,
          font: `650 44px/1.2 ${look.font}`,
          letterSpacing: "-0.01em",
          textAlign: "center",
          textWrap: "balance",
          boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
        }}
      >
        {card.text}
      </div>
    </div>
  );
};

/**
 * 9:16: his face on top and the screen below (corner layout), his face alone (cam), or the screen
 * alone (screen, or no face). The recording plays under every layout: it carries the sound.
 */
export const Short: FC<ShortProps> = ({
  main,
  face,
  crop,
  startFrame,
  segments,
  durationInFrames,
  words,
  layout,
  captions,
  stress,
  behind,
  overlays,
  look,
  card,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const stressed = useMemo(() => new Set(stress), [stress]);
  const want = layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner";
  const show = face.file || face.box ? want : "screen";
  const half = show === "corner";
  // Each stretch of the cut file it plays, one after another (`shortSegments`).
  const parts = segments?.length ? segments : [{ from: startFrame, frames: durationInFrames }];
  const played = (draw: (from: number) => ReactNode) => {
    let at = 0;
    return parts.map((g) => {
      const at0 = at;
      at += g.frames;
      return (
        <Sequence key={g.from} from={at0} durationInFrames={g.frames} layout="none">
          {draw(g.from)}
        </Sequence>
      );
    });
  };
  return (
    <AbsoluteFill style={{ background: look.foreground }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: half ? 960 : 0, bottom: 0 }}>
        {played((from) => (
          <OffthreadVideo
            src={staticFile(main)}
            trimBefore={from}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ))}
      </div>
      {show !== "screen" ? (
        <div style={{ position: "absolute", left: 0, top: 0 }}>
          {played((from) => (
            <FaceBox
              face={face}
              main={main}
              w={1080}
              h={half ? 960 : 1920}
              from={from}
              crop={crop}
            />
          ))}
        </div>
      ) : null}
      {/* A matte lines up with his face full frame, or the whole recording when there's no face. */}
      <Behind
        items={behind}
        t={t}
        look={look}
        draw={(file, src) =>
          show === "cam" && (face.file === src || (face.box && src === main)) ? (
            <div style={{ position: "absolute", left: 0, top: 0 }}>
              <FaceBox
                face={face}
                main={main}
                w={1080}
                h={1920}
                from={0}
                matte={file}
                crop={crop}
              />
            </div>
          ) : show === "screen" && !face.file && !face.box && src === main ? (
            <AbsoluteFill>
              <OffthreadVideo
                src={staticFile(file)}
                transparent
                muted
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </AbsoluteFill>
          ) : null
        }
      />
      {/* Split: on the seam between face and screen; full frame: two thirds down. */}
      {onScreen(captions, "short") ? (
        <ReelCaptions
          words={words}
          look={look}
          t={t}
          y={half ? 960 : reelY(1920, captions.place)}
          style={captions.style}
          stress={stressed}
        />
      ) : null}
      <Overlays items={overlays ?? []} t={t} look={look} />
      {card ? <TitleCard card={card} t={t} look={look} /> : null}
    </AbsoluteFill>
  );
};

/**
 * The whole cut cropped to 9:16, 1:1 or 4:5 (`framedProps`): the picture's window fills the frame
 * (on his face unless he moved it). The recording carries the sound, under the camera file when
 * that is the picture.
 */
export const Framed: FC<FramedProps> = ({
  main,
  picture,
  frame: size,
  words,
  captions,
  stress,
  behind,
  overlays,
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const stressed = useMemo(() => new Set(stress), [stress]);
  const own = picture.file === main;
  const [left, top, width, height] = verticalRect(picture, size);
  const place: CSSProperties = { position: "absolute", left, top, width, height, maxWidth: "none" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <OffthreadVideo src={staticFile(picture.file)} muted={!own} style={place} />
      {own ? null : <Audio src={staticFile(main)} />}
      {/* framedProps keeps only mattes cut from the picture, so each lines up with it. */}
      <Behind
        items={behind}
        t={t}
        look={look}
        draw={(file) => <OffthreadVideo src={staticFile(file)} transparent muted style={place} />}
      />
      {onScreen(captions, "short") ? (
        <ReelCaptions
          words={words}
          look={look}
          t={t}
          y={reelY(size[1], captions.place)}
          style={captions.style}
          stress={stressed}
        />
      ) : null}
      <Overlays items={overlays ?? []} t={t} look={look} />
    </AbsoluteFill>
  );
};

/** 1280x720, three looks: text beside his face, text on a bar over the frame, text over his face. */
export const Thumbnail: FC<ThumbnailProps> = ({ main, face, frame, text, variant, look }) => {
  const size = text.length <= 20 ? 116 : text.length <= 40 ? 92 : 70;
  const words = text.split(/\s+/);
  const title = (color: string, last?: string) => (
    <div style={{ font: `800 ${size}px/1.04 ${look.font}`, color, letterSpacing: -1 }}>
      {words.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
        <span key={i} style={{ color: last && i === words.length - 1 ? last : color }}>
          {i ? " " : ""}
          {w}
        </span>
      ))}
    </div>
  );
  if (variant === 1)
    return (
      <AbsoluteFill style={{ background: look.background, flexDirection: "row" }}>
        <div style={{ width: 720, padding: "0 56px", display: "flex", alignItems: "center" }}>
          <div style={{ borderLeft: `14px solid ${look.accent}`, paddingLeft: 32 }}>
            {title(look.foreground)}
          </div>
        </div>
        <FaceBox face={face} main={main} w={560} h={720} from={frame} />
      </AbsoluteFill>
    );
  if (variant === 2)
    return (
      <AbsoluteFill style={{ background: look.foreground }}>
        <OffthreadVideo
          src={staticFile(main)}
          muted
          trimBefore={frame}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "28px 48px",
            background: look.accent,
          }}
        >
          {title(look.background)}
        </div>
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill style={{ background: look.foreground }}>
      <FaceBox face={face} main={main} w={1280} h={720} from={frame} />
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${look.foreground} 0%, ${look.foreground}cc 45%, transparent 75%)`,
          justifyContent: "center",
          padding: "0 64px",
        }}
      >
        <div style={{ maxWidth: 760 }}>{title(look.background, look.accent)}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A promo scene of one kind, on the clock (`../src/promo.ts`). */
type Scene<K extends TimedScene["kind"]> = Extract<TimedScene, { kind: K }>;

/** A scene's frame size, the short side: type scales with it so wide and tall read the same. */
const useUnit = () => {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
};

/** The script's `finish.glow`: accent words and the highlight bloom. */
const Glow = createContext(false);
/** An accent word's bloom when the promo glows: a tight halo, then a wide one. */
const useGlow = (color: string) =>
  useContext(Glow) ? `0 0 0.12em ${color}, 0 0 0.5em ${color}aa` : undefined;

/** A 4x4 Bayer matrix: each cell's threshold, in the order an ordered dither visits them. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Tones a channel keeps under the dither. */
const DITHER_TONES = 4;

/**
 * The script's `finish.dither`: an SVG filter that adds a tiled Bayer threshold to each pixel,
 * then rounds every channel to a few tones. `cell` is one threshold's size in px.
 */
const DitherFilter: FC<{ cell: number }> = ({ cell }) => {
  const tile = cell * 4;
  const rects = BAYER.map((v, i) => {
    const g = Math.round(((v + 0.5) / 16) * 255);
    return `<rect x='${(i % 4) * cell}' y='${Math.floor(i / 4) * cell}' width='${cell}' height='${cell}' fill='rgb(${g},${g},${g})'/>`;
  }).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}' shape-rendering='crispEdges'>${rects}</svg>`;
  const n = DITHER_TONES;
  const table = Array.from({ length: n }, (_, k) => (k / (n - 1)).toFixed(3)).join(" ");
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <filter
        id="promo-dither"
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          x={0}
          y={0}
          width={tile}
          height={tile}
          preserveAspectRatio="none"
          result="cell"
        />
        <feTile in="cell" result="bayer" />
        <feComposite
          in="SourceGraphic"
          in2="bayer"
          operator="arithmetic"
          k1={0}
          k2={1}
          k3={1 / n}
          k4={-0.5 / n}
          result="biased"
        />
        <feComponentTransfer in="biased">
          <feFuncR type="discrete" tableValues={table} />
          <feFuncG type="discrete" tableValues={table} />
          <feFuncB type="discrete" tableValues={table} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
};

/**
 * Every scene comes in its way (`entranceAt`) and fades out over its last frames, or rushes into
 * a flow cut when the next comes in by one; a wiped one sits on the accent, so the matte shows.
 */
const Enter: FC<{
  kind: Entrance;
  next: Entrance | undefined;
  frames: number;
  look: Look;
  children: ReactNode;
}> = ({ kind, next, frames, look, children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        ...entranceAt(kind, f, frames, next),
        background: kind === "wipe" ? look.accent : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** A text scene's words spread over a quiet frame, one at a time (`scatterAt`). */
const Scattered: FC<{ s: Scene<"text">; look: Look }> = ({ s, look }) => {
  const f = useCurrentFrame();
  const u = useUnit();
  const words = s.lines.flatMap((l) => l.split(/\s+/));
  const accent = new Set(s.accent.map((a) => a.toLowerCase()));
  // Fewer words read bigger; a line of eight still fits the frame.
  const size = (words.length > 8 ? 54 : 72) * u;
  const glow = useGlow(look.accent);
  return (
    <AbsoluteFill>
      {words.map((w, i) => {
        const at = scatterAt(i, words.length);
        // Out of a flow cut the words are all there: the rush is how they arrive.
        const p = s.enter === "flow" ? 1 : easeOut((f - (i * 6 + 2)) / 5);
        const hit = accent.has(w.toLowerCase().replace(/[^\p{L}\p{N}$%]/gu, ""));
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a word's place is its index
            key={i}
            style={{
              position: "absolute",
              left: `${at.x * 100}%`,
              top: `${at.y * 100}%`,
              fontSize: size,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: hit ? look.accent : look.foreground,
              textShadow: hit ? glow : undefined,
              opacity: p,
              transform: `translateY(calc(-50% + ${(1 - p) * 0.25}em))`,
            }}
          >
            {w}
          </span>
        );
      })}
    </AbsoluteFill>
  );
};

const PromoText: FC<{ s: Scene<"text">; look: Look }> = ({ s, look }) => {
  const f = useCurrentFrame();
  const u = useUnit();
  const all = s.lines
    .flatMap((l, li) => l.split(/\s+/).map((w) => ({ w, li })))
    .map((x, at) => ({ ...x, at }));
  // Out of a flow cut the words are all there: the rush is how they arrive.
  const whole = s.enter === "flow";
  const shown = whole ? all.length : wordsIn(f, all.length);
  const accent = new Set(s.accent.map((a) => a.toLowerCase()));
  const glow = useGlow(look.accent);
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${110 * u}px` }}>
      {s.lines.map((line, li) => (
        <div
          key={line}
          style={{
            fontSize: 92 * u,
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            fontWeight: 650,
            color: look.foreground,
          }}
        >
          {all
            .filter((x) => x.li === li)
            .map((x) => {
              const i = x.at;
              const p = whole ? 1 : easeOut((f - (i * 4 + 2)) / 6);
              const hit = accent.has(x.w.toLowerCase().replace(/[^\p{L}\p{N}$%]/gu, ""));
              return (
                <span
                  key={x.at}
                  style={{
                    display: "inline-block",
                    marginRight: "0.24em",
                    opacity: i < shown ? p : 0,
                    transform: `translateY(${(1 - p) * 0.35}em)`,
                    color: hit ? look.accent : undefined,
                    textShadow: hit ? glow : undefined,
                  }}
                >
                  {x.w}
                </span>
              );
            })}
        </div>
      ))}
    </AbsoluteFill>
  );
};

const PromoToasts: FC<{ s: Scene<"toasts">; look: Look }> = ({ s, look }) => {
  const f = useCurrentFrame();
  const u = useUnit();
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", gap: 18 * u, padding: 60 * u }}
    >
      {s.title ? (
        <div
          style={{
            fontSize: 54 * u,
            fontWeight: 650,
            letterSpacing: "-0.02em",
            color: look.foreground,
            marginBottom: 18 * u,
            textAlign: "center",
          }}
        >
          {s.title}
        </div>
      ) : null}
      {s.items.map((t, i) => {
        const p = easeOut((f - toastAt(i, !!s.title)) / 10);
        return (
          <div
            key={`${t.title}|${t.body ?? ""}`}
            style={{
              width: 760 * u,
              display: "flex",
              gap: 20 * u,
              alignItems: "center",
              padding: `${20 * u}px ${26 * u}px`,
              borderRadius: 22 * u,
              background: "rgba(255,255,255,.86)",
              border: "1px solid rgba(0,0,0,.08)",
              boxShadow: "0 18px 50px rgba(0,0,0,.12)",
              opacity: p,
              transform: `translateY(${(1 - p) * -30}px) scale(${0.94 + 0.06 * p})`,
            }}
          >
            <div
              style={{
                width: 54 * u,
                height: 54 * u,
                borderRadius: 14 * u,
                background: look.accent,
                flex: "none",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 30 * u, fontWeight: 600, color: look.foreground }}>
                {t.title}
              </div>
              {t.body ? (
                <div style={{ fontSize: 26 * u, color: look.muted, marginTop: 4 * u }}>
                  {t.body}
                </div>
              ) : null}
            </div>
            <div style={{ fontSize: 22 * u, color: look.muted, alignSelf: "flex-start" }}>
              {t.when}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const PromoScreen: FC<{ s: Scene<"screen">; look: Look }> = ({ s, look }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = useUnit();
  const p = f / Math.max(1, s.frames - 1);
  const cam = cameraAt(s.moves, p);
  const pad = 70 * u;
  const capH = s.caption ? 120 * u : 0;
  const { w, h } = fitBox(s.size, width - pad * 2, height - pad * 2 - capH);
  const { scale, tx, ty } = framing(cam, w, h);
  const hl = s.highlight;
  const hp = hl ? easeOut((p - hl.from) / 0.08) : 0;
  const glow = useContext(Glow);
  return (
    <AbsoluteFill
      style={{ padding: pad, gap: 24 * u, alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          position: "relative",
          flex: "none",
          width: w,
          height: h,
          overflow: "hidden",
          borderRadius: 24 * u,
          boxShadow: "0 30px 80px rgba(0,0,0,.18)",
          background: "#fff",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "0 0",
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          }}
        >
          <Img
            src={staticFile(s.image ?? "")}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
          />
          {hl ? (
            <div
              style={{
                position: "absolute",
                left: `${hl.x * 100}%`,
                top: `${hl.y * 100}%`,
                width: `${hl.w * 100}%`,
                height: `${hl.h * 100}%`,
                borderRadius: 12,
                border: `${4 / scale}px solid ${look.accent}`,
                boxShadow: [
                  glow ? `0 0 ${24 / scale}px ${look.accent}` : null,
                  `0 0 0 ${9999}px rgba(0,0,0,${0.28 * hp})`,
                ]
                  .filter(Boolean)
                  .join(", "),
                opacity: hp,
              }}
            />
          ) : null}
        </div>
      </div>
      {s.caption ? (
        <div
          style={{
            width: w,
            height: capH - 24 * u,
            display: "flex",
            alignItems: "center",
            fontSize: 44 * u,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: look.foreground,
          }}
        >
          {s.caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const PromoStat: FC<{ s: Scene<"stat">; look: Look }> = ({ s, look }) => {
  const f = useCurrentFrame();
  const u = useUnit();
  const { width, height } = useVideoConfig();
  const tall = height > width;
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${100 * u}px`, gap: 50 * u }}>
      {s.title ? (
        <div style={{ fontSize: 50 * u, fontWeight: 600, color: look.muted }}>{s.title}</div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: tall ? "column" : "row",
          gap: 60 * u,
          flexWrap: "wrap",
        }}
      >
        {s.items.map((it, i) => (
          <div key={it.label} style={{ minWidth: 260 * u }}>
            <div
              style={{
                fontSize: 120 * u,
                fontWeight: 650,
                letterSpacing: "-0.04em",
                color: look.foreground,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {countAt(it, (f - 4 - i * 5) / 36)}
            </div>
            <div style={{ fontSize: 34 * u, color: look.muted }}>{it.label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const PromoEnd: FC<{ s: Scene<"end">; look: Look }> = ({ s, look }) => {
  const u = useUnit();
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", textAlign: "center", gap: 24 * u }}
    >
      <div style={{ fontSize: 110 * u, fontWeight: 650, letterSpacing: "-0.03em" }}>{s.title}</div>
      {s.sub ? <div style={{ fontSize: 40 * u, color: look.muted }}>{s.sub}</div> : null}
      {s.url ? (
        <div
          style={{
            marginTop: 20 * u,
            padding: `${16 * u}px ${30 * u}px`,
            background: look.foreground,
            color: look.background,
            fontSize: 34 * u,
            fontWeight: 600,
          }}
        >
          {s.url}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const PromoScene: FC<{ s: TimedScene; look: Look }> = ({ s, look }) => {
  switch (s.kind) {
    case "text":
      return s.layout === "scatter" ? (
        <Scattered s={s} look={look} />
      ) : (
        <PromoText s={s} look={look} />
      );
    case "toasts":
      return <PromoToasts s={s} look={look} />;
    case "screen":
      return <PromoScreen s={s} look={look} />;
    case "stat":
      return <PromoStat s={s} look={look} />;
    case "end":
      return <PromoEnd s={s} look={look} />;
  }
};

/** A product promo from a script (`promoProps`): scenes back to back on Wren's canvas. */
const Promo: FC<PromoProps> = ({ scenes, look, music, finish }) => {
  const u = useUnit();
  return (
    <Glow.Provider value={finish.glow}>
      {/* Beside the frame, not in it: the filter the frame uses. */}
      {finish.dither ? <DitherFilter cell={Math.max(2, Math.round(3 * u))} /> : null}
      <AbsoluteFill
        style={{
          background: look.background,
          color: look.foreground,
          fontFamily: look.font,
          filter: finish.dither ? "url(#promo-dither)" : undefined,
        }}
      >
        {music ? <Audio src={staticFile(music)} /> : null}
        {scenes.map((s) => (
          <Sequence key={s.from} from={s.from} durationInFrames={s.frames}>
            <Enter kind={s.enter} next={s.next} frames={s.frames} look={look}>
              <PromoScene s={s} look={look} />
            </Enter>
          </Sequence>
        ))}
      </AbsoluteFill>
    </Glow.Provider>
  );
};

const PROMO_PLACEHOLDER: PromoProps = {
  fps: 30,
  durationInFrames: 90,
  width: 1920,
  height: 1080,
  look: DEFAULT_LOOK,
  music: null,
  finish: { glow: false, dither: false },
  scenes: [
    {
      kind: "text",
      lines: ["A promo", "from a script"],
      accent: ["script"],
      layout: "stack",
      enter: "rise",
      from: 0,
      frames: 90,
    },
  ],
};

const PLACEHOLDER: LongProps = {
  main: "cut-main.mp4",
  cam: null,
  fps: 30,
  durationInFrames: 300,
  words: [],
  layout: [],
  captions: { style: "word", long: "screen" },
  stress: [],
  behind: [],
  overlays: [],
  look: DEFAULT_LOOK,
};

const NO_FACE: Face = { file: null, box: null, size: [1920, 1080] };

const Root: FC = () => (
  <>
    <Composition
      id="Long"
      component={Long}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      defaultProps={PLACEHOLDER}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
      })}
    />
    <Composition
      id="Short"
      component={Short}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        ...PLACEHOLDER,
        face: NO_FACE,
        crop: null,
        startFrame: 0,
        segments: [],
        title: "",
        card: null,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
      })}
    />
    <Composition
      id="Framed"
      component={Framed}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        ...PLACEHOLDER,
        format: "vertical" as const,
        frame: [1080, 1920] as [number, number],
        picture: { file: PLACEHOLDER.main, size: [1920, 1080], window: [656, 0, 608, 1080] },
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
        width: props.frame[0],
        height: props.frame[1],
      })}
    />
    <Composition
      id="Thumbnail"
      component={Thumbnail}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={1}
      defaultProps={{
        main: PLACEHOLDER.main,
        face: NO_FACE,
        frame: 0,
        text: "Title",
        variant: 1 as const,
        look: PLACEHOLDER.look,
      }}
    />
    <Composition
      id="Promo"
      component={Promo}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={90}
      defaultProps={PROMO_PLACEHOLDER}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  </>
);

registerRoot(Root);
