/**
 * A Canon reference whole (designs/2026-11-12-canon-references.md): the player, his note, the
 * breakdown. Explorer's preview and the topic pages draw it; the poster is their still.
 */
import type { Reference, ReferenceWhole } from "@wren/research/canon-console";
import { cx, Icon, Img, num, Tag, Video, type VideoMark } from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { href } from "../../route.js";
import { dayLabel } from "../work/bits.js";
import { Section, VIDEO_KINDS } from "./parts.js";

const PLATFORMS: Record<string, string> = { instagram: "Instagram", youtube: "YouTube" };

/** m:ss */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const platformName = (p: string) => PLATFORMS[p] ?? p;

/** Who saved it: his own, or an agent's. */
function Saver({ r }: { r: Reference }) {
  if (!r.provider) return null;
  return r.provider.kind === "human" ? (
    <Tag tone="accent">{r.provider.who === "william" ? "William" : r.provider.who}</Tag>
  ) : (
    <Tag>{r.provider.kind}</Tag>
  );
}

/** A reference's still: its poster, else a video or link mark; length bottom right unless `small`. */
export function Poster({
  r,
  className,
  small,
}: {
  r: Pick<Reference, "poster" | "length" | "kind">;
  className?: string;
  small?: boolean;
}) {
  return (
    <span
      className={cx(
        "relative block aspect-[4/5] overflow-hidden bg-(--ui-band) [border-radius:4px_10px_4px_10px]",
        className,
      )}
    >
      {r.poster ? (
        <Img src={r.poster} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="grid size-full place-items-center text-(--ui-ink-3)">
          <Icon
            name={VIDEO_KINDS.has(r.kind) ? "video" : "link"}
            className={small ? "size-3.5" : "size-6"}
          />
        </span>
      )}
      {r.length != null && !small && (
        <span className="absolute right-1.5 bottom-1.5 bg-black/70 px-1.5 py-0.5 text-[11.5px] font-medium text-white tabular-nums [border-radius:3px]">
          {clock(r.length)}
        </span>
      )}
    </span>
  );
}

/** His note: whole, never clamped. */
function NoteText({ note }: { note: NonNullable<Reference["note"]> }) {
  return (
    <p className="m-0 bg-(--ui-accent-tint) px-2.5 py-2 text-[13.5px] leading-normal whitespace-pre-line text-(--ui-ink) wrap-anywhere [border-radius:4px_10px_4px_10px]">
      {note.text}
    </p>
  );
}

/** The player: the stored file with the beats as marks; the embed when the file is missing. */
function Player({ r }: { r: ReferenceWhole }) {
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const bad = () => setFailed(true);
    el.addEventListener("error", bad);
    return () => el.removeEventListener("error", bad);
  }, []);
  const tall = r.platform !== "youtube";
  if (r.video && !failed) {
    const marks: VideoMark[] = r.beats.map((b, i) => ({ id: i, start: b.t }));
    return (
      <Video
        ref={video}
        src={r.video}
        poster={r.poster}
        marks={marks}
        className={cx("w-full", tall && "mx-auto max-h-[70vh] max-w-[400px]")}
      />
    );
  }
  if (r.embed)
    return (
      <iframe
        src={r.embed}
        title={r.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        className={cx(
          "block w-full border-0 bg-(--ui-band)",
          tall ? "mx-auto aspect-[9/16] max-h-[70vh] max-w-[400px]" : "aspect-video",
        )}
      />
    );
  // nothing to play here: a strip, not a tall empty frame
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 bg-(--ui-band) px-3 py-4 text-[13.5px] text-(--ui-ink-2) [border-radius:4px_10px_4px_10px]"
    >
      <Icon name="video" className="size-4 flex-none" />
      No file saved. Watch it on {platformName(r.platform)}.
      <Icon name="external" className="size-3.5 flex-none" />
    </a>
  );
}

/** A reference: player, note, breakdown. `bare`: its frame shows the title and the lines it backs. */
export function ReferenceBody({ r, bare }: { r: ReferenceWhole; bare?: boolean }) {
  const stats = [
    r.stats?.views != null ? `${num(r.stats.views)} views` : null,
    r.stats?.likes != null ? `${num(r.stats.likes)} likes` : null,
    r.stats?.comments != null ? `${num(r.stats.comments)} comments` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-5">
      <Player r={r} />
      <div className="flex flex-col gap-1.5">
        {!bare && (
          <h2 className="m-0 text-[18px] leading-snug font-semibold text-pretty wrap-anywhere">
            {r.title}
          </h2>
        )}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-(--ui-ink-3)">
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
          >
            {platformName(r.platform)}
            {r.handle ? ` @${r.handle}` : ""}
            <Icon name="external" className="size-3.5" />
          </a>
          {r.posted && <span>Posted {dayLabel(r.posted)}</span>}
          <span>Saved {dayLabel(r.saved)}</span>
          <Saver r={r} />
        </span>
        {stats.length > 0 && (
          <span className="text-[13px] text-(--ui-ink-3) tabular-nums">{stats.join(" · ")}</span>
        )}
      </div>
      {r.note && (
        <Section title="His note">
          <NoteText note={r.note} />
        </Section>
      )}
      {r.useFor && (
        <Section title={`Useful for ${r.useFor.area}`}>
          {r.useFor.text && (
            <p className="m-0 text-[14px] leading-normal whitespace-pre-line wrap-anywhere">
              {r.useFor.text}
            </p>
          )}
        </Section>
      )}
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => (
            <a key={t} href={href("/canon/library", { tag: t })} className="no-underline">
              <Tag>{t}</Tag>
            </a>
          ))}
        </div>
      )}
      {!bare && (
        <Section title="Backs">
          {r.backs.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {r.backs.map((b) => (
                <li key={`${b.set}:${b.line}`} className="flex flex-col gap-0.5">
                  <span className="text-[12.5px] text-(--ui-ink-3)">
                    <code>{b.line}</code> in {b.setTitle}
                  </span>
                  <span className="text-[14px] leading-normal text-pretty">{b.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-(--ui-ink-3)">No rule line cites it yet.</p>
          )}
        </Section>
      )}
      {(r.hook || r.cta) && (
        <Section title="Breakdown">
          {r.hook && (
            <p className="m-0 text-[14px] leading-normal">
              <span className="text-(--ui-ink-3)">
                Hook{r.hookStyle ? ` (${r.hookStyle})` : ""}:{" "}
              </span>
              {r.hook}
            </p>
          )}
          {r.cta && (
            <p className="m-0 text-[14px] leading-normal">
              <span className="text-(--ui-ink-3)">Call to action: </span>
              {r.cta}
            </p>
          )}
          {r.beats.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {r.beats.map((b) => (
                <li key={`${b.t}:${b.beat}`} className="flex gap-2 text-[13.5px] leading-normal">
                  <span className="flex-none text-(--ui-ink-3) tabular-nums">{clock(b.t)}</span>
                  <span>{b.beat}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}
      {(r.caption || r.transcript) && (
        <details className="group">
          <summary className="cursor-pointer text-[13.5px] text-(--ui-ink-2)">
            Caption and transcript
          </summary>
          <div className="mt-2 flex flex-col gap-3 text-[13.5px] leading-normal whitespace-pre-line wrap-anywhere">
            {r.caption && <p className="m-0">{r.caption}</p>}
            {r.transcript && <p className="m-0 text-(--ui-ink-2)">{r.transcript}</p>}
          </div>
        </details>
      )}
    </div>
  );
}
