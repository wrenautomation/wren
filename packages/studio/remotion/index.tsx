/**
 * Remotion compositions (designs/2026-10-06-video-editor.md, Composition). One file: Remotion's
 * bundler resolves no `.js` specifiers, and nothing here imports @wren/* code, only types.
 * Props come from `longProps` through `--props`; the cut files are served from the edit's folder.
 * Shorts and Thumbnail are step 2.
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
import type { LongProps } from "../src/props.js";

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

const Captions: FC<{ words: Word[]; look: LongProps["look"]; t: number }> = ({
  words,
  look,
  t,
}) => {
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
        {page.map((w, i) => {
          const on = t >= w.s && t < (page[i + 1]?.s ?? w.e + 0.3);
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
              key={i}
              style={{
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

const PLACEHOLDER: LongProps = {
  main: "cut-main.mp4",
  cam: null,
  fps: 30,
  durationInFrames: 300,
  words: [],
  layout: [],
  captions: { on: true, style: "word" },
  look: {
    background: "#f3f1ec",
    foreground: "#0e0e0e",
    muted: "#56564f",
    accent: "#a83b12",
    font: "system-ui",
  },
};

const Root: FC = () => (
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
);

registerRoot(Root);
