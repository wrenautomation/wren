/** The Finish panels: Text, Captions, Cover and Shapes, and the Short crops picker. */
import {
  type CaptionLine,
  type CroppedFormat,
  captionY,
  isCropped,
  newOverlay,
  OVERLAY,
  OVERLAY_SIZES,
  type OverlaySize,
  snapFrame,
  type TextOverlay,
} from "@wren/studio/finish";
import { ACTIONS, Button, cx, EditConflict, type RecordAct, useEdit } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type FinishData,
  type FinishEdit,
  type Format,
  LINE,
  PLACE,
  SHAPES,
  STYLES,
  short,
  shownOn,
  stamp,
  VIEWS,
} from "./finish-data.js";
import { VIEWED } from "./video-patch.js";

// --- the panels -----------------------------------------------------------------------------

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[12.5px] text-(--ui-ink-2)">{children}</p>
);

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-(--ui-fill) p-0.5">
      {options.map(([v, text]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control, drawn as buttons.
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "min-h-7 cursor-pointer rounded-md border-0 px-2.5 text-[12.5px] font-medium transition-[background-color,color] duration-150 ease-(--ui-ease)",
            value === v
              ? "bg-(--ui-paper) text-(--ui-ink) shadow-[0_0_0_0.5px_var(--ui-hair)]"
              : "bg-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const SIZE_NAMES: Record<OverlaySize, string> = { s: "Small", m: "Medium", l: "Large" };

export function TextPanel({
  editKey,
  draw,
  t,
  dur,
  picked,
  onPick,
  commit,
}: {
  /** The finishing save's key: the words ride on its kept edits. */
  editKey: string;
  draw: FinishEdit;
  t: number;
  dur: number;
  picked: number | null;
  onPick: (i: number | null) => void;
  commit: (v: FinishEdit) => void;
}) {
  const put = (i: number, o: Partial<TextOverlay>) =>
    commit({ ...draw, overlays: draw.overlays.map((p, j) => (j === i ? { ...p, ...o } : p)) });
  const full = draw.overlays.length >= OVERLAY.max;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={full}
          onClick={() => {
            commit({ ...draw, overlays: [...draw.overlays, newOverlay(t, dur)] });
            onPick(draw.overlays.length);
          }}
        >
          Add text here
        </Button>
        <Hint>
          {full
            ? `${OVERLAY.max} is the most.`
            : "Drag it on the picture to move it. Drag its bar to time it."}
        </Hint>
      </div>
      {draw.overlays.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {draw.overlays.map((o, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
              key={i}
              className={cx(
                "grid gap-2 rounded-lg border p-2 transition-colors duration-150",
                picked === i ? "border-(--ui-active) bg-(--ui-wash)" : "border-(--ui-hair)",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
                >
                  {stamp(o.from)} to {stamp(o.to)}
                </button>
                <input
                  value={o.text}
                  data-edit={editKey}
                  maxLength={OVERLAY.maxChars}
                  aria-label="Text"
                  onFocus={() => onPick(i)}
                  onChange={(e) => put(i, { text: e.target.value })}
                  className={cx(
                    "h-8 min-w-0 flex-1 rounded-md border bg-(--ui-paper) px-2 text-[13.5px] outline-none focus-visible:border-(--ui-focus)",
                    o.text.trim() ? "border-(--ui-hair)" : "border-(--ui-bad)",
                  )}
                />
              </div>
              {picked === i ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Choice
                    label="Size"
                    value={o.size}
                    options={OVERLAY_SIZES.map((z) => [z, SIZE_NAMES[z]] as const)}
                    onChange={(size) => put(i, { size })}
                  />
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={t > o.to - OVERLAY.minS}
                    onClick={() => put(i, { from: snapFrame(t) })}
                  >
                    Show from here
                  </Button>
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={t < o.from + OVERLAY.minS}
                    onClick={() => put(i, { to: snapFrame(Math.min(dur, t)) })}
                  >
                    Hide from here
                  </Button>
                  <Button
                    size="sm"
                    tone="quiet"
                    className="ml-auto"
                    onClick={() => {
                      commit({ ...draw, overlays: draw.overlays.filter((_, j) => j !== i) });
                      onPick(null);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Hint>No text on the video yet.</Hint>
      )}
    </div>
  );
}

export function CaptionsPanel({
  id,
  draw,
  lines,
  t,
  which,
  picked,
  onSeek,
  commit,
  act,
}: {
  id: string;
  draw: FinishEdit;
  lines: readonly CaptionLine[];
  t: number;
  which: "long" | "short";
  picked: number | null;
  onSeek: (t: number) => void;
  commit: (v: FinishEdit) => void;
  act: RecordAct;
}) {
  const cap = draw.captions;
  const list = useRef<HTMLOListElement | null>(null);
  const now = lines.findIndex((l) => t >= l.s && t < l.e + 0.15);
  const lit = picked ?? now;
  // The line playing (or picked) stays in view in the list.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${lit}"]`);
    const box = list.current;
    if (!el || !box) return;
    if (el.offsetTop < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight - 40)
      box.scrollTop = el.offsetTop - box.clientHeight / 3;
  }, [lit]);
  const [lo, hi] = PLACE[which];
  const y = captionY(cap.place, which);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Choice
          label="Style"
          value={cap.style}
          options={STYLES}
          onChange={(style) => commit({ ...draw, captions: { ...cap, style } })}
        />
        {(
          [
            ["long", "On the long video"],
            ["short", "On the vertical and Shorts"],
          ] as const
        ).map(([f, label]) => (
          <label key={f} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={shownOn(cap, f)}
              onChange={(e) =>
                commit({
                  ...draw,
                  captions: { ...cap, [f]: e.target.checked ? "screen" : "track" },
                })
              }
              className="size-4 accent-(--ui-active)"
            />
            {label}
          </label>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="text-(--ui-ink-2)">
          Height {which === "long" ? "on the long video" : "on the vertical and Shorts"}
        </span>
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.005}
          value={y}
          onChange={(e) =>
            commit({
              ...draw,
              captions: { ...cap, place: { ...cap.place, [which]: Number(e.target.value) } },
            })
          }
          className="w-48 accent-(--ui-active)"
        />
        <span className="text-(--ui-ink-3)">Or drag the line on the picture.</span>
      </label>
      {lines.length ? (
        <>
          <Hint>Fix a line and press Enter. Its timing stays.</Hint>
          <ol
            ref={list}
            className="relative m-0 grid max-h-64 list-none gap-0.5 overflow-y-auto rounded-lg border border-(--ui-hair) p-1"
          >
            {lines.map((l, i) => (
              <LineRow
                key={`${l.at.join()}:${l.text}`}
                id={id}
                line={l}
                i={i}
                lit={i === lit}
                onSeek={onSeek}
                act={act}
              />
            ))}
          </ol>
        </>
      ) : (
        <Hint>No captions yet. They come from the transcript.</Hint>
      )}
    </div>
  );
}

/** One caption line: its start, and its words, fixed in place. */
function LineRow({
  id,
  line,
  i,
  lit,
  onSeek,
  act,
}: {
  id: string;
  line: CaptionLine;
  i: number;
  lit: boolean;
  onSeek: (t: number) => void;
  act: RecordAct;
}) {
  // The words stay until they are saved: another page and back gives them again.
  const edit = useEdit(`video:${id}:line:${line.at.join()}`, line.text);
  const text = edit.value;
  const [said, setSaid] = useState<{ bad: boolean; words: string } | null>(null);
  const send = async () => {
    const next = text.trim().replace(/\s+/g, " ");
    if (next === line.text || !next) return edit.discard();
    if (edit.conflict) return;
    setSaid({ bad: false, words: "Saving…" });
    try {
      await ACTIONS.run(`video-line:${id}:${line.at.join()}:${next}`, (requestId) =>
        act(LINE, { at: line.at, text: next, was: line.text, requestId }, VIEWED),
      );
      edit.saved(text);
      setSaid(null);
    } catch (err) {
      setSaid({ bad: true, words: err instanceof Error ? err.message : String(err) });
    }
  };
  return (
    <li
      data-line={i}
      className={cx(
        "flex flex-wrap items-center gap-2 rounded-md px-1.5 transition-colors duration-150",
        lit ? "bg-(--ui-fill)" : "",
      )}
    >
      <button
        type="button"
        onClick={() => onSeek(line.s)}
        className="w-14 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-left text-[11.5px] text-(--ui-ink-3) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
      >
        {short(line.s)}
      </button>
      <input
        {...edit.field}
        aria-label={`Caption at ${short(line.s)}`}
        onFocus={() => onSeek(line.s)}
        onBlur={() => void send()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") edit.discard();
        }}
        className="h-7 min-w-0 flex-1 rounded-[5px] border border-transparent bg-transparent px-1.5 text-[13px] outline-none hover:bg-(--ui-wash) focus-visible:border-(--ui-focus) focus:bg-(--ui-paper)"
      />
      {said ? (
        <span
          className={cx(
            "shrink-0 text-[11.5px]",
            said.bad ? "text-(--ui-bad)" : "text-(--ui-ink-3)",
          )}
        >
          {said.words}
        </span>
      ) : null}
      {edit.conflict ? (
        <div className="w-full">
          <EditConflict
            what="This caption"
            conflict={edit.conflict}
            onKeepMine={edit.keepMine}
            onTakeTheirs={edit.takeTheirs}
          />
        </div>
      ) : null}
    </li>
  );
}

export function CoverPanel({
  draw,
  t,
  covers,
  onSeek,
  commit,
}: {
  draw: FinishEdit;
  t: number;
  covers: FinishData["covers"];
  onSeek: (t: number) => void;
  commit: (v: FinishEdit) => void;
}) {
  const at = draw.thumbnail?.at;
  const shots = (Object.entries(covers) as [CroppedFormat, string][]).filter(([, u]) => u);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() =>
            commit({ ...draw, thumbnail: { at: snapFrame(t), text: draw.thumbnail?.text ?? "" } })
          }
        >
          Use this frame
        </Button>
        {at !== undefined ? (
          <button
            type="button"
            onClick={() => onSeek(at)}
            className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
          >
            Cover at {stamp(at)}
          </button>
        ) : (
          <Hint>No cover yet. Posts use the first frame.</Hint>
        )}
      </div>
      <Hint>The cover on Reels and TikTok, and the frame under the YouTube thumbnail.</Hint>
      {shots.length ? (
        <div className="flex flex-wrap gap-3">
          {shots.map(([f, url]) => (
            <figure key={f} className="m-0 grid gap-1">
              <img
                src={url}
                alt={`Cover, ${f}`}
                className="h-32 rounded-lg bg-black object-contain"
              />
              <figcaption className="text-[11.5px] text-(--ui-ink-3)">
                {VIEWS.find(([v]) => v === f)?.[1]}, last render
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ShapesPanel({
  draw,
  rendered,
  stale,
  shorts,
  shortNo,
  onShort,
  view,
  onView,
  commit,
}: {
  draw: FinishEdit;
  rendered: readonly Format[];
  stale: readonly string[] | null;
  shorts: FinishData["shorts"];
  shortNo: number | null;
  onShort: (n: number | null) => void;
  view: Format;
  onView: (f: Format) => void;
  commit: (v: FinishEdit) => void;
}) {
  const flip = (f: Format, on: boolean) => {
    const next = SHAPES.map(([x]) => x).filter((x) => (x === f ? on : draw.formats.includes(x)));
    if (next.length) commit({ ...draw, formats: next });
  };
  return (
    <div className="grid gap-3">
      <Hint>Each platform gets the shape it shows best. Render again to make new ones.</Hint>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {SHAPES.map(([f, label, where]) => {
          const on = draw.formats.includes(f);
          const moved = isCropped(f) && !!draw.crops[f];
          return (
            <li
              key={f}
              className={cx(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150",
                view === f ? "border-(--ui-active)" : "border-(--ui-hair)",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={on && draw.formats.length === 1}
                aria-label={`Make ${label}`}
                onChange={(e) => flip(f, e.target.checked)}
                className="size-4 accent-(--ui-active)"
              />
              <button
                type="button"
                onClick={() => onView(f)}
                className="grid cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <span className="text-[13.5px] font-medium">{label}</span>
                <span className="text-[12.5px] text-(--ui-ink-2)">{where}</span>
              </button>
              <span className="ml-auto flex items-center gap-2">
                {rendered.includes(f) ? (
                  stale?.includes(f) ? (
                    <span className="text-[12px] text-(--ui-warn-ink)">
                      Changed since it rendered
                    </span>
                  ) : (
                    <span className="text-[12px] text-(--ui-good-ink)">Rendered</span>
                  )
                ) : null}
                {moved ? (
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() => {
                      const crops = { ...draw.crops };
                      delete crops[f as CroppedFormat];
                      commit({ ...draw, crops });
                    }}
                  >
                    Reset the crop
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {shorts.length ? (
        <ShortCrops
          draw={draw}
          shorts={shorts}
          shortNo={shortNo}
          onShort={onShort}
          commit={commit}
        />
      ) : null}
    </div>
  );
}

/** Pick a Short to place its own crop: drag the 9:16 picture. Unmoved, it follows the 9:16 crop. */
function ShortCrops({
  draw,
  shorts,
  shortNo,
  onShort,
  commit,
}: {
  draw: FinishEdit;
  shorts: FinishData["shorts"];
  shortNo: number | null;
  onShort: (n: number | null) => void;
  commit: (v: FinishEdit) => void;
}) {
  const own = (n: number) => !!draw.crops.shorts?.[String(n)];
  return (
    <div className="grid gap-2">
      <Hint>
        Place a Short on its own. Pick one, then drag the picture. One you leave follows the 9:16
        crop.
      </Hint>
      <div className="flex flex-wrap items-center gap-1.5">
        {shorts.map((x) => (
          <button
            key={x.n}
            type="button"
            aria-pressed={shortNo === x.n}
            title={x.title}
            onClick={() => onShort(shortNo === x.n ? null : x.n)}
            className={cx(
              "min-h-8 cursor-pointer rounded-md border px-3 text-[13px] font-medium transition-colors duration-150",
              shortNo === x.n
                ? "border-(--ui-active) bg-(--ui-paper) text-(--ui-ink)"
                : "border-(--ui-hair) bg-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
            )}
          >
            Short {x.n}
            {own(x.n) ? <span className="text-(--ui-ink-3)"> · moved</span> : null}
          </button>
        ))}
        {shortNo && own(shortNo) ? (
          <Button
            size="sm"
            tone="quiet"
            onClick={() => {
              const rest = { ...draw.crops.shorts };
              delete rest[String(shortNo)];
              const { shorts: _gone, ...crops } = draw.crops;
              commit({
                ...draw,
                crops: Object.keys(rest).length ? { ...crops, shorts: rest } : crops,
              });
            }}
          >
            Reset the crop
          </Button>
        ) : null}
      </div>
    </div>
  );
}
