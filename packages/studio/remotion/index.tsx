/**
 * Remotion compositions (designs/2026-10-06-video-editor.md, Composition). One file: Remotion's
 * bundler resolves no `.js` specifiers, so the one value import (Wren's look, for Studio's
 * placeholder) names its `.ts` file; the rest is types. Props come from `longProps`, `shortProps`
 * and `thumbnailProps` through `--props`; the cut files are served from `<edit dir>/public`.
 */
import type { CSSProperties, FC } from "react";
import {
  AbsoluteFill,
  Composition,
  OffthreadVideo,
  registerRoot,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DEFAULT_LOOK } from "../../video/src/overlay.ts";
import type { Face, LongProps, ShortProps, ThumbnailProps } from "../src/props.js";

type Word = LongProps["words"][number];

/** Caption pages: up to 7 words, broken at a sentence end or a pause over 0.6 s. */
export function pages(words: readonly Word[]): Word[][] {
  const out: Word[][] = [];
  let page: Word[] = [];
  for (const w of words) {
    const prev = page.at(-1);
    if (page.length && (page.length >= 7 || (prev && w.s - prev.e > 0.6))) {
      out.push(page);
      page = [];
    }
    page.push(w);
    if (/[.?!]$/.test(w.w)) {
      out.push(page);
      page = [];
    }
  }
  if (page.length) out.push(page);
  return out;
}

const Captions: FC<{
  words: Word[];
  look: LongProps["look"];
  t: number;
  /** Shorts: bigger type, narrower, placed by the layout. */
  size?: number;
  width?: number;
  place?: CSSProperties;
}> = ({ words, look, t, size = 54, width = 1180, place }) => {
  const all = pages(words);
  const page = all.find((p, i) => {
    const first = p[0] as Word;
    const next = all[i + 1]?.[0];
    return (
      t >= first.s && t < Math.min(next?.s ?? Number.POSITIVE_INFINITY, (p.at(-1) as Word).e + 0.8)
    );
  });
  if (!page) return null;
  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 90, ...place }}
    >
      <div
        style={{
          maxWidth: width,
          textAlign: "center",
          font: `700 ${size}px/1.25 ${look.font}`,
          color: "#fff",
          textShadow: "0 2px 12px rgba(0,0,0,0.7)",
        }}
      >
        {page.map((w, i) => {
          const on = t >= w.s && t < (page[i + 1]?.s ?? w.e + 0.3);
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
              key={i}
              style={{
                // inline-block: the words carry no spaces, so this is where a line may break.
                display: "inline-block",
                padding: "0 8px",
                borderRadius: 8,
                background: on ? look.accent : "transparent",
              }}
            >
              {w.w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

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

export const Long: FC<LongProps> = ({ main, cam, words, layout, captions, look }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const show = layout.find((r) => t >= r.from && t < r.to)?.show ?? "corner";
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* The recording carries the sound, so it plays under every layout. */}
      <OffthreadVideo src={staticFile(main)} style={{ ...fill, objectFit: "contain" }} />
      {cam && show !== "screen" ? (
        <div style={show === "cam" ? { position: "absolute", inset: 0 } : CORNER}>
          <OffthreadVideo src={staticFile(cam)} muted style={fill} />
        </div>
      ) : null}
      {captions.on ? <Captions words={words} look={look} t={t} /> : null}
    </AbsoluteFill>
  );
};

/** His face in a w x h box: the camera file, or the cam box cropped out of the recording. */
const FaceBox: FC<{ face: Face; main: string; w: number; h: number; from: number }> = ({
  face,
  main,
  w,
  h,
  from,
}) => {
  const file = face.file ?? main;
  const [fw, fh] = face.size;
  const [bx, by, bw, bh] = face.box ?? [0, 0, fw, fh];
  const k = Math.max(w / bw, h / bh);
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(file)}
        muted
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
  look,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
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
      {captions.on ? (
        <Captions
          words={words}
          look={look}
          t={t}
          size={76}
          width={960}
          place={half ? { justifyContent: "center", paddingBottom: 0 } : { paddingBottom: 380 }}
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
  captions: { on: true, style: "word" },
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
