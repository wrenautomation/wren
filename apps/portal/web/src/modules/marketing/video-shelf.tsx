/**
 * Studio's Videos (designs/2026-10-15-studio-editor.md): the newest recordings and rendered videos
 * as cards (first frame, length, state, where each went), and the editor opened right there in
 * Studio (`?video=<id>`), the Recordings page's own record body at full width. `/marketing/videos`
 * stays: its links still open the same editor.
 */
import type { Thumb } from "@wren/core/records";
import { cx, Empty, Icon, LoadFailed, Loading, PlatformMark, Section, Tag } from "@wren/ui";
import { useCall } from "../../load.js";
import type { ListPage, PageProps } from "../../module.js";
import { TemplatePage, wrenRecords } from "../../records.js";
import { href } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { usePieces } from "./pieces.js";
import { type ShelfRow, shelfState, wentTo } from "./video-shelf-state.js";

/** The cards Studio shows; All recordings lists the rest. */
export const SHELF_MAX = 12;
const STUDIO = "/marketing/studio";

/** The Recordings page, as the module defines it: Studio opens its records in place. */
let videos: ListPage | null = null;
export const studioVideos = <T extends ListPage>(page: T): T => {
  videos = page;
  return page;
};

/** Studio's link to a video's editor. */
export const studioVideoHref = (id: string | number, keep?: URLSearchParams) =>
  href(STUDIO, { video: String(id), make: null }, keep);

const shelf = () =>
  wrenRecords("marketing").list({
    record: "marketing.video",
    sort: "-updated",
    limit: SHELF_MAX + 4,
    thumbs: true,
  });

/** The first frame: a still, or the video's own first frame where none was rendered. */
function Poster({ thumb, title }: { thumb: Thumb | undefined; title: string }) {
  if (!thumb)
    return (
      <span className="flex size-full items-center justify-center text-white/60">
        <Icon name="play" size={22} />
      </span>
    );
  return thumb.kind === "image" ? (
    <img src={thumb.url} alt="" className="size-full object-cover" loading="lazy" />
  ) : (
    <video
      src={`${thumb.url}#t=1`}
      preload="metadata"
      muted
      playsInline
      aria-label={title}
      className="size-full object-cover"
    />
  );
}

export function VideoShelf({ params }: { params: URLSearchParams }) {
  const load = useCall("studio:shelf", shelf);
  const pieces = usePieces();
  const byVideo = new Map(
    (pieces.data?.pieces ?? []).filter((p) => p.video).map((p) => [String(p.video), p]),
  );
  const rows = ((load.data?.rows ?? []) as unknown as ShelfRow[])
    .filter((r) => r.state !== "rejected")
    .slice(0, SHELF_MAX);
  const thumbs = load.data?.thumbs ?? {};
  return (
    <Section
      title="Videos"
      note="Newest first. Open one to edit it here."
      actions={
        <a className={cx("text-[13px] underline", QUIET)} href="/marketing/videos">
          All recordings
        </a>
      }
    >
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={3} />
      ) : rows.length === 0 ? (
        <Empty>
          No recording yet. Record with OBS or Cap on the Mac; it shows here a minute after you
          stop.
        </Empty>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] max-[640px]:-mx-4 max-[640px]:flex max-[640px]:snap-x max-[640px]:snap-mandatory max-[640px]:overflow-x-auto max-[640px]:px-4 max-[640px]:pb-2 max-[640px]:[scrollbar-width:none]">
          {rows.map((r) => {
            const went = wentTo(byVideo.get(String(r.id)));
            const s = shelfState(r, went.length > 0);
            return (
              <li
                key={r.id}
                className="min-w-0 max-[640px]:w-[72%] max-[640px]:shrink-0 max-[640px]:snap-start"
              >
                <a
                  href={studioVideoHref(r.id, params)}
                  className="group grid overflow-hidden rounded-xl border border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink) no-underline transition-[border-color,box-shadow] duration-150 ease-(--ui-ease) hover:border-(--ui-ink-3) hover:shadow-[0_2px_8px_rgb(0_0_0/0.06)] focus-visible:outline-2 focus-visible:outline-(--ui-active)"
                >
                  <span className="relative block aspect-video overflow-hidden bg-black">
                    <Poster thumb={thumbs[String(r.id)]} title={r.title} />
                    <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11.5px] font-medium text-white [font-variant-numeric:tabular-nums]">
                      {r.cut}
                    </span>
                  </span>
                  <span className="grid gap-2 p-3">
                    <span className="line-clamp-2 min-h-[2.6em] text-[14px] leading-[1.3] font-medium">
                      {r.title}
                    </span>
                    <span className="flex min-h-5 flex-wrap items-center gap-2">
                      <Tag tone={s.tone}>{s.label}</Tag>
                      {r.shorts ? (
                        <span className={cx("text-[12.5px]", QUIET)}>
                          {r.shorts} {r.shorts === 1 ? "Short" : "Shorts"}
                        </span>
                      ) : null}
                      {went.length ? (
                        <span className="ml-auto flex items-center gap-1.5">
                          {went.map((p) => (
                            <PlatformMark key={p} mark={p} size={14} />
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** A video's editor inside Studio: the Recordings page's record, full width, back to Studio. */
export function StudioVideo({ id, ...props }: PageProps & { id: string }) {
  if (!videos) return null;
  return (
    <TemplatePage
      {...props}
      page={videos}
      path="/marketing/videos"
      id={id}
      app="marketing"
      at={STUDIO}
      back={{ href: href(STUDIO, { video: null }, props.params), label: "Studio" }}
      wide
    />
  );
}
