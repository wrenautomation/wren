/**
 * A subject's board (vireo designs/2026-11-16-board.md): links, pictures, samples, notes and frames
 * people and agents pin and move (B1, B2). A pin opens on the side in the same player as the refs;
 * Keep sends it to Canon (B4). Pins from Canon carry `canon` already (B6).
 */
import type { FeedPost } from "@wren/research/canon-console";
import {
  type BoardPin,
  Button,
  cx,
  Img,
  LoadFailed,
  PANEL,
  type PinAdd,
  type PinAt,
  PinBoard,
  type PinKind,
  type PinPlace,
  SidePanel,
  say,
} from "@wren/ui";
import { useState } from "react";
import { call, linkPreview, uploadMedia } from "../../api.js";
import { useCall } from "../../load.js";
import { Where } from "../canon/gallery.js";
import { PostPlayer } from "../canon/post-detail.js";
import { platformOf } from "../research/board.js";
import { host } from "../research/tree.js";

/** a sample pin's sample, its media signed */
interface PinSample {
  id: number;
  batchId: number;
  name: string | null;
  mediaUrl: string | null;
  posterUrl: string | null;
}

/** a pin as `variants/board` answers it: board position in `at`, files signed */
export interface PinView {
  id: number;
  subjectId: number;
  kind: PinKind;
  url: string | null;
  file: string | null;
  fileUrl: string | null;
  posterUrl: string | null;
  title: string | null;
  body: string | null;
  why: string | null;
  sampleId: number | null;
  frameId: number | null;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  z: number;
  by: string | null;
  keptAt: string | null;
  canon: string | null;
  at: { x: number; y: number };
  sample?: PinSample;
}

export interface BoardView {
  subject: { id: number; slug: string; name: string };
  pins: PinView[];
}

/** where a pin points: its link, else its own file */
const hrefOf = (p: PinView) => p.url ?? p.fileUrl ?? p.sample?.mediaUrl ?? null;
const pictureOf = (p: PinView) =>
  p.posterUrl ?? p.sample?.posterUrl ?? (p.kind === "image" ? p.fileUrl : null) ?? null;
const siteOf = (p: PinView) => {
  if (p.kind === "sample") return "vireo";
  return p.url ? platformOf(p.url) : p.kind;
};
const nameOf = (p: PinView) => p.title ?? p.sample?.name ?? (p.url ? host(p.url) : null);

/** A pin as a gallery post: the player plays its link's embed, its file or its sample's video. */
export function pinPost(p: PinView): FeedPost {
  const platform = siteOf(p);
  const pic = pictureOf(p);
  const video =
    p.kind === "video" && p.fileUrl
      ? p.fileUrl
      : p.kind === "sample"
        ? (p.sample?.mediaUrl ?? null)
        : null;
  const who = p.url ? host(p.url) : "board";
  return {
    platform,
    ref: String(p.id),
    url: hrefOf(p) ?? "",
    kind:
      p.url && /instagram\.com\/reels?\//.test(p.url)
        ? "reel"
        : p.kind === "image"
          ? "post"
          : "video",
    postedAt: null,
    title: nameOf(p),
    text: null,
    creatorId: 0,
    personId: 0,
    person: who,
    handle: who,
    name: null,
    niches: [],
    followers: null,
    counts: {},
    scoreCount: null,
    multiple: null,
    band: null,
    rank: null,
    likesMultiple: null,
    likesBand: null,
    likesRank: null,
    baselineN: null,
    baseline: null,
    likesBaseline: null,
    creatorPosts: null,
    record: null,
    picture: null,
    pictureSmall: null,
    pictureLink: pic,
    video: null,
    src: pic,
    full: pic,
    videoSrc: video,
  };
}

/** A pin's face (PT-6, Pinterest's pin): the picture fills the box; one title line and the site. */
function PinCard({ p }: { p: PinView }) {
  const [bad, setBad] = useState(false);
  const pic = pictureOf(p);
  const name = nameOf(p);
  return (
    <div className="relative flex size-full flex-col overflow-hidden rounded-[6px] bg-(--ui-paper)">
      <div className="relative min-h-0 flex-1 bg-(--ui-hover)">
        {pic && !bad ? (
          <Img
            src={pic}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setBad(true)}
            className="block size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Where platform={siteOf(p)} />
          </span>
        )}
        {p.canon ? (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-(--ui-ink) px-2 py-0.5 text-[11.5px] font-semibold text-(--ui-paper)">
            Canon
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
        <Where platform={siteOf(p)} />
        <span className="min-w-0 flex-1 text-[12.5px]/[1.3] font-medium wrap-anywhere text-(--ui-ink)">
          {name ?? "Untitled"}
        </span>
      </div>
    </div>
  );
}

/** The open pin: its player, words and the agent's why; Keep, Open, Remove. */
function PinFrom({ p }: { p: PinView }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-(--ui-ink-2)">
      <Where platform={siteOf(p)} />
      {p.url ? host(p.url) : p.kind}
      {p.canon ? " · In Canon" : ""}
    </span>
  );
}

function PinDetail({
  p,
  onKeep,
  onRemove,
}: {
  p: PinView;
  onKeep: (on: boolean) => void;
  onRemove: () => void;
}) {
  const href = hrefOf(p);
  const kept = !!p.keptAt;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <PostPlayer key={p.id} r={pinPost(p)} />
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[16px]/[1.3] font-semibold wrap-anywhere text-(--ui-ink)">
          {nameOf(p) ?? "Untitled"}
        </h3>
      </div>
      {p.body ? (
        <p className="m-0 text-[13px] whitespace-pre-wrap text-(--ui-ink-2)">{p.body}</p>
      ) : null}
      {p.why ? (
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          <span className="font-semibold text-(--ui-ink)">Why: </span>
          {p.why}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="dense" tone={kept ? "quiet" : undefined} onClick={() => onKeep(!kept)}>
          {kept ? "Kept" : "Keep"}
        </Button>
        {href ? (
          <Button
            size="dense"
            tone="quiet"
            icon="external"
            onClick={() => window.open(href, "_blank", "noopener")}
          >
            Open
          </Button>
        ) : null}
        <Button size="dense" tone="quiet" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

/** A subject's board with its open pin on the side. */
export function SubjectBoard({ subject, height = 640 }: { subject: number; height?: number }) {
  const got = useCall(
    `variants-board:${subject}`,
    () => call<BoardView>("variants/board", { subject }),
    {
      live: "variants",
    },
  );
  const [open, setOpen] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(PANEL.width);
  const pins = got.data?.pins ?? [];
  const byId = new Map(pins.map((p) => [p.id, p]));
  const shown = open != null ? byId.get(open) : undefined;
  const { retry } = got;

  const write = (fn: () => Promise<unknown>) =>
    fn()
      .then(retry)
      .catch((e: unknown) => {
        say.failed(e);
        retry();
      });

  const add = (a: PinAdd, at: PinAt) =>
    write(async () => {
      const place = { x: at.x, y: at.y, frameId: at.frameId };
      if (a.kind === "note")
        return call("variants/pin", { subject, pins: [{ kind: "note", ...place }] });
      if (a.kind === "frame")
        return call("variants/pin", {
          subject,
          pins: [{ kind: "frame", title: "Frame", ...place }],
        });
      if (a.kind === "link") {
        const pre = await linkPreview(a.url).catch(
          () => ({}) as Awaited<ReturnType<typeof linkPreview>>,
        );
        return call("variants/pin", {
          subject,
          pins: [{ url: a.url, title: pre.title ?? null, poster: pre.imageUrl ?? null, ...place }],
        });
      }
      // pictures only: Canon's store takes a picture or a PDF
      const files = await Promise.all(
        a.files.map(async (f) => ({
          file: await uploadMedia(f, f.name, (meta) => call("canon/upload", meta)),
          title: f.name,
        })),
      );
      return call("variants/pin", {
        subject,
        pins: files.map((f, i) => ({
          kind: "image",
          ...f,
          ...place,
          x: at.x + i * 24,
          y: at.y + i * 24,
        })),
      });
    });

  const board: BoardPin[] = pins.map((p) => ({
    id: p.id,
    kind: p.kind,
    x: p.x,
    y: p.y,
    w: p.w ?? 240,
    h: p.h ?? 280,
    z: p.z,
    frameId: p.frameId,
    title: p.title,
    body: p.body,
  }));

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={retry} />;
  if (!got.data)
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading the board"
        className="w-full border border-(--ui-hair) bg-(--ui-graph)"
        style={{ height }}
      />
    );
  return (
    <div className="flex min-h-0 w-full">
      <div className={cx("min-w-0 flex-1", got.placeholder && "opacity-60")}>
        <PinBoard
          label={got.data ? `${got.data.subject.name} board` : "Board"}
          pins={board}
          face={(b) => {
            const p = byId.get(b.id);
            return p ? <PinCard p={p} /> : null;
          }}
          open={open}
          onOpen={setOpen}
          height={height}
          onPlace={(moves: PinPlace[]) => void write(() => call("variants/pinMove", { moves }))}
          onAdd={(a, at) => void add(a, at)}
          onRemove={(ids) => {
            if (open != null && ids.includes(open)) setOpen(null);
            void write(() => call("variants/unpin", { ids }));
          }}
          onText={(id, t) => void write(() => call("variants/pinEdit", { id, ...t }))}
        />
      </div>
      <SidePanel
        open={!!shown}
        label="Pin"
        width={width}
        onWidth={setWidth}
        onClose={() => setOpen(null)}
        // the head names where it is from; the name shows once, under the player
        title={shown ? <PinFrom p={shown} /> : null}
      >
        {shown ? (
          <PinDetail
            p={shown}
            onKeep={(on) => void write(() => call("variants/pinKeep", { id: shown.id, on }))}
            onRemove={() => {
              setOpen(null);
              void write(() => call("variants/unpin", { ids: [shown.id] }));
            }}
          />
        ) : null}
      </SidePanel>
    </div>
  );
}
