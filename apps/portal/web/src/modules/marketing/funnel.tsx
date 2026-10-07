/**
 * A post's place in the funnel (designs/2026-10-07-content-funnel.md): its stage, where it points
 * and the link it carries. The link is derived, never typed: the video's YouTube URL, or the
 * lander's `/go/<channel>/<stage>/<post>`. Each choice saves on its own, like a field.
 */
import type { RecordAct } from "@wren/ui";
import { Tag } from "@wren/ui";
import { useState } from "react";
import { SELECT } from "../work/bits.js";

export const FUNNEL = "marketing.draftFunnel";

export type FunnelVideo = { id: string; title: string | null; url: string | null; status: string };
/** `@wren/content`'s `FunnelView` with the videos it may point at. */
export type Funnel = {
  stage: "reach" | "trust" | "convert";
  to: "video" | "site" | "booking";
  video: FunnelVideo | null;
  linked: boolean;
  chosen: boolean;
  allowed: boolean;
  link: string | null;
  posts: string | null;
  note: string | null;
  videos: FunnelVideo[];
};

const STAGES = [
  { value: "reach", label: "Reach", hint: "New people. Shorts, Reels, promos." },
  { value: "trust", label: "Trust", hint: "People who know us. Long videos, lessons." },
  { value: "convert", label: "Convert", hint: "Ready to talk. Sends them to book." },
] as const;
const TARGETS = [
  { value: "video", label: "The video" },
  { value: "site", label: "The site" },
  { value: "booking", label: "Booking" },
] as const;

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const GROUP_HEAD =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";
const GRID = "grid grid-cols-[minmax(0,1fr)] gap-5 @min-[440px]/fields:grid-cols-2";

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const labelOf = (list: readonly { value: string; label: string }[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;
const videoState = (v: FunnelVideo) =>
  v.url ? "on YouTube" : v.status === "published" ? "posted" : "waiting to upload";
const videoName = (v: FunnelVideo) => `${v.title?.trim() || "Untitled video"} · ${videoState(v)}`;

/** A choice's state line: saving, saved, or why not. */
function useSave(act: RecordAct) {
  const [said, setSaid] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const run = async (input: Record<string, unknown>) => {
    setSaid("Saving…");
    setBad(false);
    try {
      await act(FUNNEL, input);
      setSaid("Saved");
    } catch (err) {
      setSaid(errorOf(err));
      setBad(true);
    }
  };
  return { said, bad, run };
}

function Said({ said, bad }: { said: string | null; bad: boolean }) {
  return (
    <span
      aria-live="polite"
      className={bad ? "text-[12px] text-(--ui-bad)" : "text-[12px] text-(--ui-ink-2)"}
    >
      {said ?? ""}
    </span>
  );
}

function Pick({
  id,
  label,
  value,
  options,
  hint,
  act,
  field,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  hint?: string | undefined;
  act: RecordAct;
  field: "stage" | "to" | "video";
}) {
  const { said, bad, run } = useSave(act);
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <Said said={said} bad={bad} />
      </div>
      <select
        id={id}
        className={`${SELECT} w-full min-w-0`}
        value={value}
        onChange={(e) => void run({ [field]: e.target.value })}
      >
        {field === "video" ? <option value="">Pick a video</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className={HINT}>{hint}</span> : null}
    </div>
  );
}

/** The link as it will post, his switch, and why there's none when there's none. */
function LinkLine({
  funnel,
  act,
  editable,
}: {
  funnel: Funnel;
  act: RecordAct;
  editable: boolean;
}) {
  const { said, bad, run } = useSave(act);
  const shown = funnel.posts ?? funnel.link;
  return (
    <div className="grid min-w-0 gap-1.5 @min-[440px]/fields:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={LABEL}>Link</span>
        <Said said={said} bad={bad} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {shown ? (
          <a
            href={shown}
            target="_blank"
            rel="noreferrer"
            className={`min-w-0 max-w-full truncate text-[14px] underline-offset-2 hover:underline ${funnel.posts ? "" : "text-(--ui-ink-3) line-through"}`}
          >
            {shown.replace(/^https:\/\//, "")}
          </a>
        ) : (
          <span className="text-[14px] text-(--ui-ink-3)">None yet</span>
        )}
        {funnel.posts ? <Tag tone="green">In the post</Tag> : null}
      </div>
      {funnel.note ? <span className={HINT}>{funnel.note}</span> : null}
      {editable && funnel.allowed ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={funnel.linked}
              onChange={(e) => void run({ linked: e.target.checked ? "on" : "off" })}
              className="size-4 accent-(--ui-accent)"
            />
            <span className="text-[14px]">Link in the post</span>
          </label>
          {funnel.chosen ? (
            <button
              type="button"
              className="text-[12px] text-(--ui-ink-2) underline underline-offset-2"
              onClick={() => void run({ linked: "auto" })}
            >
              Back to the default
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The Funnel group: first in the form, since it decides where the post sends people. */
export function FunnelFields({
  draftId,
  funnel,
  act,
  editable,
}: {
  draftId: string;
  funnel: Funnel;
  act: RecordAct;
  editable: boolean;
}) {
  const stage = STAGES.find((s) => s.value === funnel.stage);
  const summary = `${labelOf(STAGES, funnel.stage)} → ${labelOf(TARGETS, funnel.to)}`;
  const videos = funnel.videos.map((v) => ({ value: v.id, label: videoName(v) }));
  return (
    <section aria-label="Funnel" className="grid gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className={GROUP_HEAD}>Funnel</h3>
        <span className="text-[12px] text-(--ui-ink-3)">{summary}</span>
      </div>
      <div className={GRID}>
        {editable ? (
          <>
            <Pick
              id={`funnel-stage-${draftId}`}
              label="Stage"
              value={funnel.stage}
              options={STAGES}
              hint={stage?.hint}
              act={act}
              field="stage"
            />
            <Pick
              id={`funnel-to-${draftId}`}
              label="Points to"
              value={funnel.to}
              options={TARGETS}
              act={act}
              field="to"
            />
            {funnel.to === "video" ? (
              <div className="min-w-0 @min-[440px]/fields:col-span-2">
                <Pick
                  id={`funnel-video-${draftId}`}
                  label="Video"
                  value={funnel.video?.id ?? ""}
                  options={videos}
                  hint={
                    videos.length
                      ? "A YouTube video. Its link fills in once it's up."
                      : "No YouTube video yet. Approve one in Videos."
                  }
                  act={act}
                  field="video"
                />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Shown label="Stage" value={labelOf(STAGES, funnel.stage)} />
            <Shown
              label="Points to"
              value={
                funnel.to === "video" && funnel.video
                  ? `${labelOf(TARGETS, funnel.to)}: ${funnel.video.title ?? "Untitled"}`
                  : labelOf(TARGETS, funnel.to)
              }
            />
          </>
        )}
        <LinkLine funnel={funnel} act={act} editable={editable} />
      </div>
    </section>
  );
}

function Shown({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className={LABEL}>{label}</span>
      <span className="text-[14px] break-words">{value}</span>
    </div>
  );
}
