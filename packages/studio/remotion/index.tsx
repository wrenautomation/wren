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
 * Props come from `longProps`, `shortProps`, `verticalProps` and `thumbnailProps` through
 * `--props`; the cut files are served from the edit's folder.
 */
import { type CSSProperties, type FC, type ReactNode, useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  OffthreadVideo,
  registerRoot,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DEFAULT_LOOK } from "../../video/src/overlay.ts";
import { bigWordState, onScreen, wordState } from "../src/caption-styles.ts";
import { lineAt, pages, REEL, reelLines } from "../src/captions.ts";
import type {
  BehindWord,
  Face,
  LongProps,
  ShortProps,
  ThumbnailProps,
  VerticalProps,
} from "../src/props.js";
import { verticalRect } from "../src/safe-zones.ts";

type Word = LongProps["words"][number];
type Look = LongProps["look"];

/** The second, heavier face of the `stress` style: a system serif, so renders stay offline. */
const STRESS_FONT = 'Georgia, "Times New Roman", serif';

/**
 * One caption word in its style at `t` (`wordState`). `until`: when the next word of its line
 * starts. `size`: the line's font size, for the `stress` face and the pads.
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
  const pad = Math.round(size * 0.15);
  const base: CSSProperties = {
    display: "inline-block",
    position: "relative",
    padding: `0 ${pad}px`,
    borderRadius: Math.round(size * 0.16),
  };
  switch (style) {
    case "pill":
      return (
        <span style={{ ...base, color: `rgba(255,255,255,${0.42 + 0.58 * st.lit})` }}>{w.w}</span>
      );
    case "sweep":
      return (
        <span style={base}>
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: base.borderRadius,
              background: look.accent,
              opacity: st.fill,
              transform: `scaleX(${st.fillScaleX})`,
              transformOrigin: "0% 50%",
            }}
          />
          <span style={{ position: "relative" }}>{w.w}</span>
        </span>
      );
    case "pop":
      return (
        <span style={{ ...base, opacity: st.opacity, transform: `scaleX(${st.scaleX})` }}>
          {w.w}
        </span>
      );
    case "wipe":
      return (
        <span
          style={{ ...base, opacity: st.opacity, clipPath: `inset(-20% ${st.clip * 100}% -20% 0)` }}
        >
          {w.w}
        </span>
      );
    case "stress":
      return (
        <span
          style={{
            ...base,
            opacity: st.opacity,
            transform: `scale(${st.scale})`,
            transformOrigin: "0% 100%",
            ...(stressed
              ? {
                  font: `italic 800 ${Math.round(size * 1.4)}px/1 ${STRESS_FONT}`,
                  verticalAlign: "baseline",
                }
              : {}),
          }}
        >
          {w.w}
        </span>
      );
    default:
      return (
        <span style={{ ...base, background: st.fill ? look.accent : "transparent" }}>{w.w}</span>
      );
  }
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
  return (
    <div
      style={{
        display: "inline-block",
        padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.5)}px`,
        borderRadius: Math.round(size * 0.36),
        background: `${look.foreground}d9`,
        boxShadow: "0 4px 18px rgba(0,0,0,0.25)",
        textShadow: "none",
        WebkitTextStroke: "0",
      }}
    >
      {line}
    </div>
  );
};

/** The long video's lower-third line, in the edit's caption style. */
const Captions: FC<{
  words: Word[];
  look: Look;
  t: number;
  style: string;
  stress: ReadonlySet<number>;
}> = ({ words, look, t, style, stress }) => {
  const all = useMemo(() => {
    let n = 0;
    return pages(words).map((p) => {
      const at = p.map((_, i) => n + i);
      n += p.length;
      return { words: p, at };
    });
  }, [words]);
  const i = all.findIndex((p, k) => {
    const first = p.words[0] as Word;
    const next = all[k + 1]?.words[0];
    return (
      t >= first.s &&
      t < Math.min(next?.s ?? Number.POSITIVE_INFINITY, (p.words.at(-1) as Word).e + 0.8)
    );
  });
  const page = all[i];
  if (!page) return null;
  const last = page.words.at(-1) as Word;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 90 }}>
      <div
        style={{
          maxWidth: 1180,
          textAlign: "center",
          font: `700 54px/1.25 ${look.font}`,
          color: "#fff",
          textShadow: "0 2px 12px rgba(0,0,0,0.7)",
        }}
      >
        <CaptionLine
          words={page.words}
          at={page.at}
          end={Math.max(last.e + 0.3, last.e)}
          t={t}
          style={style}
          stress={stress}
          look={look}
          size={54}
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
  const size = Math.round(80 * Math.max(0.6, Math.min(1, REEL.maxChars / len)));
  return (
    <div
      style={{
        position: "absolute",
        left: 108,
        right: 162,
        top: y - 120,
        height: 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        font: `800 ${size}px/1.15 ${look.font}`,
        color: "#fff",
        WebkitTextStroke: "10px rgba(0,0,0,0.85)",
        paintOrder: "stroke fill",
        textShadow: "0 4px 18px rgba(0,0,0,0.55)",
      }}
    >
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

/** Where a full-frame caption line's middle sits: 66% down. */
const REEL_Y = Math.round(1920 * 0.66);

const CORNER: CSSProperties = {
  position: "absolute",
  right: 40,
  bottom: 40,
  width: 340,
  height: 340,
  borderRadius: 28,
  overflow: "hidden",
  boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
};

export const Long: FC<LongProps> = ({
  main,
  cam,
  words,
  layout,
  captions,
  stress,
  behind,
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const show = layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner";
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const stressed = useMemo(() => new Set(stress), [stress]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* The recording carries the sound, so it plays under every layout. */}
      <OffthreadVideo src={staticFile(main)} style={{ ...fill, objectFit: "contain" }} />
      {cam && show !== "screen" ? (
        <div style={show === "cam" ? { position: "absolute", inset: 0 } : CORNER}>
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
        <Captions words={words} look={look} t={t} style={captions.style} stress={stressed} />
      ) : null}
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
}> = ({ face, main, w, h, from, matte }) => {
  const file = matte ?? face.file ?? main;
  const [fw, fh] = face.size;
  const [bx, by, bw, bh] = face.box ?? [0, 0, fw, fh];
  const k = Math.max(w / bw, h / bh);
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(file)}
        muted
        transparent={!!matte}
        trimBefore={from}
        style={{
          position: "absolute",
          left: (w - bw * k) / 2 - bx * k,
          top: (h - bh * k) / 2 - by * k,
          width: fw * k,
          height: fh * k,
          maxWidth: "none",
        }}
      />
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
  startFrame,
  words,
  layout,
  captions,
  stress,
  behind,
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const stressed = useMemo(() => new Set(stress), [stress]);
  const want = layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner";
  const show = face.file || face.box ? want : "screen";
  const half = show === "corner";
  return (
    <AbsoluteFill style={{ background: look.foreground }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: half ? 960 : 0, bottom: 0 }}>
        <OffthreadVideo
          src={staticFile(main)}
          trimBefore={startFrame}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
      {show !== "screen" ? (
        <div style={{ position: "absolute", left: 0, top: 0 }}>
          <FaceBox face={face} main={main} w={1080} h={half ? 960 : 1920} from={startFrame} />
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
              <FaceBox face={face} main={main} w={1080} h={1920} from={0} matte={file} />
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
          y={half ? 960 : REEL_Y}
          style={captions.style}
          stress={stressed}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * The whole cut, 9:16 (step 5): the picture's window fills the frame (a portrait recording all of
 * it; a landscape one cropped on his face). The recording carries the sound, under the camera file
 * when that is the picture.
 */
export const Vertical: FC<VerticalProps> = ({
  main,
  picture,
  words,
  captions,
  stress,
  behind,
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const stressed = useMemo(() => new Set(stress), [stress]);
  const own = picture.file === main;
  const [left, top, width, height] = verticalRect(picture);
  const place: CSSProperties = { position: "absolute", left, top, width, height, maxWidth: "none" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <OffthreadVideo src={staticFile(picture.file)} muted={!own} style={place} />
      {own ? null : <Audio src={staticFile(main)} />}
      {/* verticalProps keeps only mattes cut from the picture, so each lines up with it. */}
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
          y={REEL_Y}
          style={captions.style}
          stress={stressed}
        />
      ) : null}
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
      defaultProps={{ ...PLACEHOLDER, face: NO_FACE, startFrame: 0, title: "" }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
      })}
    />
    <Composition
      id="Vertical"
      component={Vertical}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        ...PLACEHOLDER,
        picture: { file: PLACEHOLDER.main, size: [1920, 1080], window: [656, 0, 608, 1080] },
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
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
  </>
);

registerRoot(Root);
