/**
 * Captions and text drawn over the video as the render draws them, shared with the storyboard's
 * frames.
 */
import {
  CAPTION_LOOK,
  captionWordLook,
  type overlayAt,
  pillLook,
  type ShownLine,
  type TextOverlay,
  wordState,
} from "@wren/studio/finish";
import { cx } from "@wren/ui";
import type { PointerEvent as ReactPointerEvent } from "react";

/** A caption line in its style, word by word, as the render draws it (`captionWordLook`). */
export function ShownCaption({
  line,
  style,
  size,
}: {
  line: ShownLine;
  style: string;
  size: number;
}) {
  const words = line.words.map((x, i) => {
    const st = wordState(style, x, line.t, line.words[i + 1]?.s ?? line.end, { first: i === 0 });
    const { word, fill } = captionWordLook(style, st, {
      stressed: x.stressed,
      size,
      accent: CAPTION_LOOK.accent,
    });
    return fill ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
      <span key={i} style={word}>
        <span style={fill} />
        <span style={{ position: "relative" }}>{x.w}</span>
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity
      <span key={i} style={word}>
        {x.w}
      </span>
    );
  });
  // No spaces between words: each word's padding spaces them, as in the render.
  if (style !== "pill") return <div>{words}</div>;
  return <div style={pillLook(size, CAPTION_LOOK.foreground)}>{words}</div>;
}

/** Text on the video as the render draws it; without `onDown` it's a picture, not a handle. */
export function OverlayText({
  o,
  at,
  faint,
  selected,
  onDown,
}: {
  o: TextOverlay;
  at: NonNullable<ReturnType<typeof overlayAt>>;
  faint: boolean;
  selected: boolean;
  onDown?: (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onDown}
      className={cx(
        "absolute rounded-md text-center font-extrabold text-white select-none [text-shadow:0_2px_6px_rgb(0_0_0/0.55),0_8px_30px_rgb(0_0_0/0.35)] [text-wrap:balance]",
        onDown ? "cursor-move" : "pointer-events-none",
        selected && "outline-2 outline-offset-4 outline-white/80 outline-dashed",
      )}
      style={{
        left: at.x,
        top: at.y,
        maxWidth: at.width,
        transform: "translate(-50%, -50%)",
        fontSize: at.size,
        lineHeight: 1.12,
        letterSpacing: -at.size * 0.02,
        opacity: faint ? 0.45 : at.opacity,
      }}
    >
      {o.text}
    </div>
  );
}
