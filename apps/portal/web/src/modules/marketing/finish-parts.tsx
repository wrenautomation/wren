/**
 * The Shorts and the layout in the finishing view (designs/2026-10-15-studio-editor.md, parity):
 * what `wren video set shorts`, `layout` and `camBox` change, as rows he edits and saves. Each
 * save is one `VideoDesk.set` with what it replaced (`expect`), so a change made elsewhere
 * refuses instead of being overwritten; the server snaps a Short to whole sentences. Every time
 * is raw seconds on the recording.
 */
import { Button, cx, Input, type RecordAct } from "@wren/ui";
import { type ReactNode, useEffect, useState } from "react";
import { VIEWED } from "./video-patch.js";

export type Short = {
  from: number;
  to: number;
  title: string;
  card?: boolean | undefined;
  cardText?: string | undefined;
};
export type LayoutShow = "corner" | "cam" | "screen";
export type LayoutRange = { from: number; to: number; show: LayoutShow };
export type CamBox = [number, number, number, number];

const SET = "marketing.videoSet";
/** A new Short with nothing picked runs this long from the playhead. */
const NEW_SHORT_S = 30;
/** The on-screen title's limit (`CARD.maxChars` in @wren/studio/props). */
const CARD_MAX = 60;

export const LAYOUT_NAMES: Record<LayoutShow, string> = {
  corner: "Face in the corner",
  cam: "Face only",
  screen: "Screen only",
};

/** "1:05.5": minutes, seconds, a tenth. */
export const timeText = (t: number) => {
  const d = Math.round(t * 10);
  const s = Math.floor(d / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${d % 10}`;
};

/** "1:05.5", "1:05" or "65.5" as seconds; NaN when it's none of them. */
export const parseTime = (text: string) => {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return Number.NaN;
  if (m[1] !== undefined && Number(m[2]) >= 60) return Number.NaN;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
};

/** Why these rows can't be saved, or null. */
export function spanProblem(rows: readonly { from: number; to: number }[], dur: number) {
  for (const [i, r] of rows.entries()) {
    if (!Number.isFinite(r.from) || !Number.isFinite(r.to))
      return `Row ${i + 1}: write times like 1:05.`;
    if (r.from < 0 || r.to > dur + 0.05) return `Row ${i + 1}: inside 0:00 and ${timeText(dur)}.`;
    if (r.to <= r.from) return `Row ${i + 1}: the end is before the start.`;
  }
  return null;
}

/** A new Short: the picked part, else from the playhead. */
export const newShort = (t: number, range: [number, number] | null, dur: number): Short =>
  range
    ? { from: range[0], to: range[1], title: "" }
    : { from: t, to: Math.min(dur, t + NEW_SHORT_S), title: "" };

/**
 * A layout range over the rows: it takes its part from the ones it overlaps (each cut back or
 * split), in time order.
 */
export function addLayout(rows: readonly LayoutRange[], add: LayoutRange): LayoutRange[] {
  const out: LayoutRange[] = [];
  for (const r of rows) {
    if (r.to <= add.from || r.from >= add.to) out.push(r);
    else {
      if (r.from < add.from) out.push({ ...r, to: add.from });
      if (r.to > add.to) out.push({ ...r, from: add.to });
    }
  }
  out.push(add);
  return out.sort((a, b) => a.from - b.from);
}

/** Times as the boxes hold them, while he types. */
type Draft<T> = T & { fromText: string; toText: string };
const drafted = <T extends { from: number; to: number }>(rows: readonly T[]): Draft<T>[] =>
  rows.map((r) => ({ ...r, fromText: timeText(r.from), toText: timeText(r.to) }));
const undrafted = <T extends { from: number; to: number }>(rows: readonly Draft<T>[]): T[] =>
  rows.map(({ fromText, toText, ...r }) => ({
    ...(r as unknown as T),
    from: parseTime(fromText),
    to: parseTime(toText),
  }));

/** One save: the field whole, with what it was, through the page's act. */
function useSave(act: RecordAct) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const save = async (patch: Record<string, unknown>, expect: Record<string, unknown>) => {
    setBusy(true);
    setSaid(null);
    try {
      await act(SET, { patch, expect }, VIEWED);
      setSaid({ text: "Saved. Render to see it.", bad: false });
      return true;
    } catch (err) {
      setSaid({ text: err instanceof Error ? err.message : String(err), bad: true });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, said, setSaid, save };
}

const Said = ({ said }: { said: { text: string; bad: boolean } | null }) =>
  said ? (
    <span
      aria-live="polite"
      className={cx("text-[12.5px]", said.bad ? "text-(--ui-bad)" : "text-(--ui-ink-2)")}
    >
      {said.text}
    </span>
  ) : null;

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[12.5px] text-(--ui-ink-2)">{children}</p>
);

const TimeBox = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <Input
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    inputMode="decimal"
    className={cx(
      "w-[5.5rem] text-[13px] [font-variant-numeric:tabular-nums]",
      Number.isNaN(parseTime(value)) && "border-(--ui-bad)",
    )}
  />
);

/** Rows that follow the server until he edits; Save or Undo changes then. */
function useRows<T extends { from: number; to: number }>(server: readonly T[]) {
  const key = JSON.stringify(server);
  const [rows, setRows] = useState<Draft<T>[]>(() => drafted(server));
  const [dirty, setDirty] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the server rows by value.
  useEffect(() => {
    if (!dirty) setRows(drafted(server));
  }, [key]);
  const change = (next: Draft<T>[]) => {
    setRows(next);
    setDirty(true);
  };
  const reset = () => {
    setRows(drafted(server));
    setDirty(false);
  };
  return { rows, dirty, change, reset, done: () => setDirty(false) };
}

export function ShortsPanel({
  shorts,
  dur,
  t,
  range,
  onSeek,
  act,
}: {
  shorts: readonly Short[];
  dur: number;
  t: number;
  range: [number, number] | null;
  onSeek: (t: number) => void;
  act: RecordAct;
}) {
  const r = useRows(shorts);
  const s = useSave(act);
  const set = (i: number, part: Partial<Draft<Short>>) =>
    r.change(r.rows.map((x, j) => (j === i ? { ...x, ...part } : x)));
  const out = undrafted(r.rows).map(({ card, cardText, ...x }) => ({
    ...x,
    title: x.title.trim(),
    ...(card === false ? { card: false } : {}),
    ...(cardText?.trim() ? { cardText: cardText.trim() } : {}),
  }));
  const bad = spanProblem(out, dur);
  const submit = async () => {
    if (bad) return s.setSaid({ text: bad, bad: true });
    if (await s.save({ shorts: out }, { shorts })) r.done();
  };
  return (
    <div className="grid gap-3">
      <Hint>
        Each Short is a part of the recording, made 9:16. The ends snap to whole sentences when you
        save.
      </Hint>
      {r.rows.length ? (
        <ol className="m-0 grid list-none gap-2 p-0">
          {r.rows.map((x, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a Short's number is its place.
              key={i}
              className="grid gap-2 rounded-lg border border-(--ui-hair) p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-[13px] font-semibold">Short {i + 1}</span>
                <TimeBox
                  label={`Short ${i + 1} start`}
                  value={x.fromText}
                  onChange={(v) => set(i, { fromText: v })}
                />
                <span className="text-[12.5px] text-(--ui-ink-3)">to</span>
                <TimeBox
                  label={`Short ${i + 1} end`}
                  value={x.toText}
                  onChange={(v) => set(i, { toText: v })}
                />
                <span className="ml-auto flex gap-1">
                  <Button
                    size="dense"
                    tone="quiet"
                    onClick={() => {
                      const at = parseTime(x.fromText);
                      if (Number.isFinite(at)) onSeek(at);
                    }}
                  >
                    Go to
                  </Button>
                  {range ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      onClick={() =>
                        set(i, { fromText: timeText(range[0]), toText: timeText(range[1]) })
                      }
                    >
                      Use picked part
                    </Button>
                  ) : null}
                  <Button
                    size="dense"
                    tone="quiet"
                    onClick={() => r.change(r.rows.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </span>
              </div>
              <Input
                aria-label={`Short ${i + 1} title`}
                placeholder="Title"
                value={x.title}
                maxLength={100}
                onChange={(e) => set(i, { title: e.target.value })}
                className="text-[13.5px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
                  <input
                    type="checkbox"
                    checked={x.card !== false}
                    onChange={(e) => set(i, { card: e.target.checked ? undefined : false })}
                  />
                  Title on screen at the start
                </label>
                {x.card !== false ? (
                  <Input
                    aria-label={`Short ${i + 1} on-screen title`}
                    placeholder="Same as the title"
                    value={x.cardText ?? ""}
                    maxLength={CARD_MAX}
                    onChange={(e) => set(i, { cardText: e.target.value })}
                    className="min-w-0 flex-1 text-[13px]"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Hint>No Shorts yet.</Hint>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          tone="quiet"
          onClick={() => r.change([...r.rows, ...drafted([newShort(t, range, dur)])])}
        >
          {range ? "Add the picked part" : "Add a Short here"}
        </Button>
        <Button size="sm" disabled={!r.dirty} busy={s.busy} onClick={() => void submit()}>
          Save Shorts
        </Button>
        {r.dirty ? (
          <Button size="sm" tone="quiet" onClick={r.reset}>
            Undo changes
          </Button>
        ) : null}
        <Said said={s.said} />
      </div>
    </div>
  );
}

export function LayoutPanel({
  layout,
  camBox,
  size,
  dur,
  t,
  range,
  act,
}: {
  layout: readonly LayoutRange[];
  camBox: CamBox | null;
  size: [number, number];
  dur: number;
  t: number;
  range: [number, number] | null;
  act: RecordAct;
}) {
  const r = useRows(layout);
  const s = useSave(act);
  const set = (i: number, part: Partial<Draft<LayoutRange>>) =>
    r.change(r.rows.map((x, j) => (j === i ? { ...x, ...part } : x)));
  const out = undrafted(r.rows);
  const bad = spanProblem(out, dur);
  const submit = async () => {
    if (bad) return s.setSaid({ text: bad, bad: true });
    if (await s.save({ layout: out }, { layout })) r.done();
  };
  const add = (show: LayoutShow) => {
    const span = range ?? [t, Math.min(dur, t + 10)];
    r.change(drafted(addLayout(out, { from: span[0], to: span[1], show })));
  };
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Hint>
          The long video shows your face in the corner unless a range here says otherwise.
        </Hint>
        {r.rows.length ? (
          <ol className="m-0 grid list-none gap-2 p-0">
            {r.rows.map((x, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: ranges are in time order.
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-(--ui-hair) p-2"
              >
                <TimeBox
                  label={`Range ${i + 1} start`}
                  value={x.fromText}
                  onChange={(v) => set(i, { fromText: v })}
                />
                <span className="text-[12.5px] text-(--ui-ink-3)">to</span>
                <TimeBox
                  label={`Range ${i + 1} end`}
                  value={x.toText}
                  onChange={(v) => set(i, { toText: v })}
                />
                <select
                  aria-label={`Range ${i + 1} shows`}
                  value={x.show}
                  onChange={(e) => set(i, { show: e.target.value as LayoutShow })}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px]"
                >
                  {(Object.keys(LAYOUT_NAMES) as LayoutShow[]).map((k) => (
                    <option key={k} value={k}>
                      {LAYOUT_NAMES[k]}
                    </option>
                  ))}
                </select>
                <Button
                  size="dense"
                  tone="quiet"
                  className="ml-auto"
                  onClick={() => r.change(r.rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <Hint>Face in the corner all the way through.</Hint>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-(--ui-ink-2)">
            {range ? "The picked part:" : "Ten seconds from here:"}
          </span>
          <Button size="sm" tone="quiet" onClick={() => add("cam")}>
            Face only
          </Button>
          <Button size="sm" tone="quiet" onClick={() => add("screen")}>
            Screen only
          </Button>
          <Button size="sm" tone="quiet" onClick={() => add("corner")}>
            Corner
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!r.dirty} busy={s.busy} onClick={() => void submit()}>
            Save layout
          </Button>
          {r.dirty ? (
            <Button size="sm" tone="quiet" onClick={r.reset}>
              Undo changes
            </Button>
          ) : null}
          <Said said={s.said} />
        </div>
      </div>
      <FaceBox camBox={camBox} size={size} act={act} />
    </div>
  );
}

const BOX_PARTS = ["Left", "Top", "Width", "Height"] as const;

/** Why a face box can't be saved, or null. */
export function boxProblem(box: readonly number[], size: [number, number]) {
  if (box.length !== 4 || box.some((n) => !Number.isInteger(n) || n < 0))
    return "Four whole numbers, in pixels.";
  const [x, y, w, h] = box as CamBox;
  if (w < 16 || h < 16) return "The box is too small.";
  if (x + w > size[0] || y + h > size[1])
    return `The box goes past the recording (${size[0]} by ${size[1]}).`;
  return null;
}

/** Where his face is in a recording with the camera in it: what the Shorts crop on. */
function FaceBox({
  camBox,
  size,
  act,
}: {
  camBox: CamBox | null;
  size: [number, number];
  act: RecordAct;
}) {
  const server = camBox ? camBox.map(String) : ["", "", "", ""];
  const [box, setBox] = useState<string[]>(server);
  const s = useSave(act);
  const key = JSON.stringify(camBox);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the saved box by value.
  useEffect(() => setBox(camBox ? camBox.map(String) : ["", "", "", ""]), [key]);
  const nums = box.map((v) => Number(v.trim()));
  const dirty = box.some((v, i) => v.trim() !== server[i]);
  const submit = async () => {
    const bad = boxProblem(nums, size);
    if (bad) return s.setSaid({ text: bad, bad: true });
    await s.save({ camBox: nums }, { camBox });
  };
  return (
    <div className="grid gap-2 border-t border-(--ui-hair) pt-3">
      <h5 className="m-0 text-[13px] font-semibold">Face box</h5>
      <Hint>
        The box around your face, in the recording&apos;s pixels ({size[0]} by {size[1]}). The
        Shorts crop on it. Set it only when the camera is in the recording.
      </Hint>
      <div className="flex flex-wrap items-end gap-2">
        {BOX_PARTS.map((label, i) => (
          <label key={label} className="grid gap-0.5 text-[11.5px] text-(--ui-ink-2)">
            {label}
            <Input
              placeholder={label}
              inputMode="numeric"
              value={box[i] ?? ""}
              onChange={(e) => setBox(box.map((v, j) => (j === i ? e.target.value : v)))}
              className="w-20 text-[13px] [font-variant-numeric:tabular-nums]"
            />
          </label>
        ))}
        <Button size="sm" disabled={!dirty} busy={s.busy} onClick={() => void submit()}>
          Save box
        </Button>
        {camBox ? (
          <Button
            size="sm"
            tone="quiet"
            busy={s.busy}
            onClick={() => void s.save({ camBox: null }, { camBox })}
          >
            Clear
          </Button>
        ) : null}
        <Said said={s.said} />
      </div>
    </div>
  );
}

/** The Shorts and layout under the filmstrip: where each one sits. */
export function PartsLane({
  shorts,
  layout,
  x,
  onShort,
}: {
  shorts: readonly { from: number; to: number; title: string }[];
  layout: readonly LayoutRange[];
  x: (s: number) => number;
  onShort: (i: number) => void;
}) {
  if (!shorts.length && !layout.length) return null;
  return (
    <div className={cx("relative border-t border-(--ui-hair)", layout.length ? "h-11" : "h-7")}>
      {layout.map((l) => (
        <span
          key={`l-${l.from}-${l.to}`}
          {...{ title: `${LAYOUT_NAMES[l.show]}, ${timeText(l.from)} to ${timeText(l.to)}` }}
          className="pointer-events-none absolute bottom-1 h-3.5 overflow-hidden rounded-[4px] border border-dashed border-(--ui-ink-3) px-1 text-[9.5px] leading-[12px] whitespace-nowrap text-(--ui-ink-2)"
          style={{ left: x(l.from), width: Math.max(4, x(l.to) - x(l.from)) }}
        >
          {LAYOUT_NAMES[l.show]}
        </span>
      ))}
      {shorts.map((s, i) => (
        <button
          key={`s-${s.from}-${s.to}`}
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onShort(i)}
          {...{ title: s.title || `Short ${i + 1}` }}
          className="absolute top-1 h-[18px] cursor-pointer overflow-hidden rounded-[5px] border border-(--ui-active) bg-(--ui-paper) px-1.5 text-left text-[10.5px] font-medium whitespace-nowrap text-(--ui-ink) hover:bg-(--ui-hover)"
          style={{ left: x(s.from), width: Math.max(8, x(s.to) - x(s.from)) }}
        >
          Short {i + 1}
          {s.title ? <span className="text-(--ui-ink-2)"> {s.title}</span> : null}
        </button>
      ))}
    </div>
  );
}
