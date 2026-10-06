/**
 * A video's detail (`marketing.video`): the preview, the transcript with its cuts struck through
 * (proposals in yellow), the Shorts, the thumbnails, and the title and description that go up.
 */
import { Empty, type RecordExtras, Tag } from "@wren/ui";
import type { ListPage } from "../../module.js";

type Word = { w: string; s: number; cut: "cut" | "proposed" | null };
type Video = {
  title: string;
  description: string;
  preview: string | null;
  words: Word[];
  shorts: {
    title: string;
    from: number;
    to: number;
    preview: string | null;
    upload: { status: string; url: string | null } | null;
  }[];
  thumbnails: { url: string | null; picked: boolean }[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const Player = ({ src }: { src: string | null }) =>
  src ? (
    // biome-ignore lint/a11y/useMediaCaption: captions are burned into the render.
    <video controls preload="metadata" src={src} className="w-full rounded bg-black" />
  ) : (
    <Empty>In development: the preview shows here once the video is rendered.</Empty>
  );

/** Cut words struck through; proposals (fillers, retakes) struck through in yellow. */
const Transcript = ({ words }: { words: Word[] }) => (
  <p className="text-sm leading-7">
    {words.map((w) => (
      <span
        key={w.s}
        title={clock(w.s)}
        className={
          w.cut === "cut"
            ? "text-gray-400 line-through"
            : w.cut === "proposed"
              ? "bg-yellow-100 line-through"
              : undefined
        }
      >
        {w.w}{" "}
      </span>
    ))}
  </p>
);

const Shorts = ({ shorts }: { shorts: Video["shorts"] }) => (
  <ol className="space-y-4">
    {shorts.map((s, i) => (
      <li key={`${s.from}-${s.to}`} className="space-y-2">
        <p className="text-sm">
          <span className="font-semibold">
            {i + 1}. {s.title}
          </span>{" "}
          <span className="text-gray-500">
            {clock(s.from)}–{clock(s.to)}
          </span>{" "}
          {s.upload ? <Tag tone="green">{s.upload.status}</Tag> : null}
        </p>
        {s.preview ? (
          // biome-ignore lint/a11y/useMediaCaption: captions are burned into the render.
          <video controls preload="metadata" src={s.preview} className="h-80 rounded bg-black" />
        ) : null}
      </li>
    ))}
  </ol>
);

const Thumbnails = ({ thumbnails }: { thumbnails: Video["thumbnails"] }) => (
  <div className="grid grid-cols-3 gap-3">
    {thumbnails.map((t, i) => (
      <figure key={t.url ?? i} className="space-y-1">
        {t.url ? <img src={t.url} alt={`Thumbnail ${i + 1}`} className="w-full rounded" /> : null}
        <figcaption className="text-sm">
          {i + 1} {t.picked ? <Tag tone="accent">Picked</Tag> : null}
        </figcaption>
      </figure>
    ))}
  </div>
);

export const videoExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const v = (detail as { video?: Video | null } | null)?.video;
  const sections: RecordExtras["sections"] = [];
  if (!v) return { sections };
  sections.push(
    ["Preview", <Player key="preview" src={v.preview} />],
    [
      "Title and description",
      <div key="words" className="space-y-2 text-sm">
        <p className="font-semibold">{v.title || "No title yet"}</p>
        <p className="whitespace-pre-wrap">{v.description || "No description yet"}</p>
      </div>,
    ],
  );
  if (v.shorts.length) sections.push(["Shorts", <Shorts key="shorts" shorts={v.shorts} />]);
  if (v.thumbnails.length)
    sections.push(["Thumbnails", <Thumbnails key="thumbs" thumbnails={v.thumbnails} />]);
  sections.push(["Transcript", <Transcript key="transcript" words={v.words} />]);
  return { sections };
};
