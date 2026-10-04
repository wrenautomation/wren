/**
 * A workspace's look, edited: a preset, typed colors, or one brand color (palette-brand.ts),
 * with a live preview on the kit's own parts and, for a brand, its contrast report. It edits
 * what `readTheme` reads and hands it to `onSave`; who may save is the caller's business.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "./components/ui/input.js";
import { Button, Tag } from "./controls.js";
import {
  type BrandInput,
  brandColorsOf,
  brandTheme,
  CONTRASTS,
  type ContrastLine,
  type Ground,
  HARMONIES,
  readBrand,
  VARIANTS,
} from "./palette-brand.js";
import { PRESETS, type PresetName, readTheme, type Token, themeVars } from "./theme.js";

/** What `readTheme` reads: a preset's name, an object of tokens, or null for Wren's. */
export type Look = string | Record<string, unknown> | null;
type Mode = "preset" | "manual" | "brand";

/** Wren's colors as tailwind.css ships them, so a typed look starts from real values. */
export const WREN_COLORS: Partial<Record<Token, string>> = {
  canvas: "#f3f1ec",
  paper: "#ffffff",
  ink: "#0e0e0e",
  "ink-2": "#56564f",
  accent: "#a83b12",
  "on-accent": "#faf7f2",
  good: "#17803d",
  bad: "#d2281e",
};
const TYPED = Object.keys(WREN_COLORS) as Token[];

const NAMES: Partial<Record<Token | Ground, string>> = {
  canvas: "Ground",
  paper: "Cards",
  tile: "Tiles",
  ink: "Text",
  "ink-2": "Second text",
  "ink-3": "Marks",
  accent: "Accent",
  "on-accent": "Text on accent",
  good: "Good",
  "good-ink": "Good text",
  bad: "Bad",
  "accent-tint": "accent tint",
  "good-tint": "good tint",
  "bad-tint": "bad tint",
};
const nameOf = (t: Token | Ground) => NAMES[t] ?? t;

const MODES: [Mode, string][] = [
  ["preset", "Preset"],
  ["brand", "From a brand color"],
  ["manual", "Typed colors"],
];
const CONTRAST_NAMES = ["Standard", "Medium", "High"];
const words = (id: string) => (id.charAt(0).toUpperCase() + id.slice(1)).replace("_", " ");

const LABEL = "flex flex-col gap-1.5 text-[13px] text-(--ui-ink-2)";
const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base text-(--ui-ink) outline-none focus-visible:border-ring md:text-sm";
const ROW = "flex flex-wrap items-center gap-2";

/** A stored look as the editor holds it; anything `readTheme` can't read is Wren's. */
export function lookOf(raw: unknown): Look {
  if (typeof raw === "string") return raw;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

const modeOf = (l: Look): Mode =>
  l === null || typeof l === "string" ? "preset" : l.brand ? "brand" : "manual";
const baseOf = (l: Look): PresetName | undefined => {
  const p = typeof l === "string" ? l : l?.preset;
  return typeof p === "string" && Object.hasOwn(PRESETS, p) ? (p as PresetName) : undefined;
};
/** `#abc` and `#aabbcc` as the color box takes them; anything else isn't one. */
function hex6(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const h = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(h);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : null;
}

/** Up to four colors that stand out in an image, read in the browser. Nothing is uploaded. */
async function colorsOfImage(file: File): Promise<string[]> {
  const url = await new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = url;
  await img.decode();
  const [w0, h0] = [img.naturalWidth || 128, img.naturalHeight || 128];
  const scale = Math.min(1, 128 / Math.max(w0, h0));
  const [w, h] = [Math.max(1, Math.round(w0 * scale)), Math.max(1, Math.round(h0 * scale))];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return [];
  g.drawImage(img, 0, 0, w, h);
  return brandColorsOf(g.getImageData(0, 0, w, h).data);
}

export function LookEditor({
  look,
  onSave,
}: {
  look: unknown;
  /** Stores it; a throw shows its message. Null is Wren's look. */
  onSave: (look: Look) => Promise<unknown>;
}) {
  const [saved, setSaved] = useState(() => lookOf(look));
  const [draft, setDraft] = useState<Look>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[] | null>(null);
  const theme = useMemo(() => readTheme(draft), [draft]);
  const mode = modeOf(draft);
  const base = baseOf(draft);
  const brand =
    mode === "brand" && draft && typeof draft === "object" ? readBrand(draft.brand) : null;
  const report = useMemo(() => {
    const b = draft && typeof draft === "object" && draft.brand ? readBrand(draft.brand) : null;
    return b ? brandTheme(b).report : null;
  }, [draft]);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  const obj = () => (draft && typeof draft === "object" ? draft : {});
  const withBase = (p: PresetName | undefined) => (p && p !== "wren" ? { preset: p } : {});
  const toMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "preset") return setDraft(base && base !== "wren" ? base : null);
    const color = (t: Token) => theme[t] ?? WREN_COLORS[t];
    if (m === "manual")
      return setDraft({
        ...withBase(base),
        ...Object.fromEntries(TYPED.map((t) => [t, color(t)])),
      });
    setDraft({ ...withBase(base), brand: { color: hex6(color("accent")) ?? "#a83b12" } });
  };
  const setBase = (p: PresetName) => {
    const { preset: _, ...rest } = obj();
    setDraft({ ...withBase(p), ...rest });
  };
  const setBrand = (patch: Partial<BrandInput>) =>
    setDraft({ ...obj(), brand: { ...(brand ?? {}), ...patch } });
  const setToken = (t: Token, v: string) => setDraft({ ...obj(), [t]: v });

  const save = async (next: Look) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setSaved(next);
      setDraft(next);
      toast.success(next === null ? "Back to Wren's look" : "Look saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const fromImage = async (file: File | undefined) => {
    if (!file) return;
    setPicks(null);
    try {
      setPicks(await colorsOfImage(file));
    } catch {
      setPicks([]);
    }
  };

  return (
    <div className="@container">
      <div className="grid gap-6 @min-[760px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-4">
          <fieldset className={`${ROW} border-0`} aria-label="How the look is made">
            {MODES.map(([m, label]) => (
              <Button
                key={m}
                size="dense"
                tone={mode === m ? "primary" : "secondary"}
                aria-pressed={mode === m}
                onClick={() => toMode(m)}
              >
                {label}
              </Button>
            ))}
          </fieldset>

          {mode === "preset" ? (
            <div className={ROW}>
              {(Object.keys(PRESETS) as PresetName[]).map((p) => (
                <Button
                  key={p}
                  size="dense"
                  tone={(base ?? "wren") === p ? "primary" : "secondary"}
                  aria-pressed={(base ?? "wren") === p}
                  onClick={() => setDraft(p === "wren" ? null : p)}
                >
                  {words(p)}
                </Button>
              ))}
            </div>
          ) : (
            <label className={LABEL}>
              Start from
              <select
                className={SELECT}
                value={base ?? "wren"}
                onChange={(e) => setBase(e.target.value as PresetName)}
              >
                {(Object.keys(PRESETS) as PresetName[]).map((p) => (
                  <option key={p} value={p}>
                    {words(p)}
                  </option>
                ))}
              </select>
              <span className="text-[12.5px]">Type, corners and spacing come from here.</span>
            </label>
          )}

          {mode === "brand" && brand ? (
            <>
              <ColorBox
                label="Brand color"
                value={brand.color}
                onChange={(color) => setBrand({ color })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Pick
                  label="Variant"
                  value={brand.variant}
                  options={VARIANTS.map((v) => [v, words(v)])}
                  onChange={(variant) => setBrand({ variant })}
                />
                <Pick
                  label="Chart colors"
                  value={brand.harmony}
                  options={HARMONIES.map((h) => [h, words(h)])}
                  onChange={(harmony) => setBrand({ harmony })}
                />
                <Pick
                  label="Contrast"
                  value={String(brand.contrast)}
                  options={CONTRASTS.map((c, i) => [String(c), CONTRAST_NAMES[i] ?? String(c)])}
                  onChange={(c) => setBrand({ contrast: Number(c) })}
                />
                <Pick
                  label="Scheme"
                  value={brand.scheme}
                  options={[
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ]}
                  onChange={(scheme) => setBrand({ scheme })}
                />
              </div>
              <label className={LABEL}>
                From a logo
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => void fromImage(e.target.files?.[0])}
                />
                <span className="text-[12.5px]">
                  Read here in your browser. Nothing is uploaded.
                </span>
              </label>
              {picks === null ? null : picks.length ? (
                <fieldset className={`${ROW} border-0`} aria-label="Colors from the logo">
                  {picks.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBrand({ color: c })}
                      aria-pressed={brand.color === c}
                      className="flex items-center gap-2 rounded-(--ui-radius) px-2 py-1 text-[13px] shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:bg-(--ui-hover) aria-pressed:shadow-[inset_0_0_0_2px_var(--ui-ink)]"
                    >
                      <Swatch color={c} />
                      {c}
                    </button>
                  ))}
                </fieldset>
              ) : (
                <p className="text-[13px] text-(--ui-ink-2)">
                  No color stands out in that image. Pick one by hand.
                </p>
              )}
            </>
          ) : null}

          {mode === "manual" ? (
            <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
              {TYPED.map((t) => (
                <ColorBox
                  key={t}
                  label={nameOf(t)}
                  value={String(obj()[t] ?? theme[t] ?? WREN_COLORS[t] ?? "")}
                  onChange={(v) => setToken(t, v)}
                />
              ))}
            </div>
          ) : null}

          <div className={ROW}>
            <Button size="sm" disabled={busy || !changed} onClick={() => void save(draft)}>
              Save
            </Button>
            <Button
              size="sm"
              tone="secondary"
              disabled={busy || saved === null}
              onClick={() => void save(null)}
            >
              Reset to Wren's
            </Button>
            {changed ? <span className="text-[13px] text-(--ui-ink-2)">Not saved yet</span> : null}
          </div>
          {error ? <p className="text-[13.5px] text-(--ui-bad)">{error}</p> : null}
        </div>

        <div className="grid content-start gap-4">
          <Preview vars={themeVars(theme)} />
          {report ? <Report lines={report} /> : null}
        </div>
      </div>
    </div>
  );
}

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <label className={LABEL}>
      {label}
      <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The native color box beside its hex, either one sets it. */
function ColorBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={LABEL}>
      {label}
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}, picker`}
          value={hex6(value) ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer border border-(--ui-hair) bg-transparent p-0.5"
        />
        <Input
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
      </span>
    </label>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 shadow-[inset_0_0_0_1px_var(--ui-hair)]"
      style={{ background: color }}
    />
  );
}

const SERIES = [
  ["bg-(--ui-chart-1)", 34],
  ["bg-(--ui-chart-2)", 24],
  ["bg-(--ui-chart-3)", 18],
  ["bg-(--ui-chart-4)", 14],
  ["bg-(--ui-chart-5)", 10],
] as const;
const SPARK = [6, 9, 7, 12, 10, 15, 13, 18, 16, 22, 20, 25];

/** The kit's own parts under the look: tokens set on the box, the rest made again inside it. */
function Preview({ vars }: { vars: Record<string, string> }) {
  const max = Math.max(...SPARK);
  const points = SPARK.map((v, i) => `${(i / (SPARK.length - 1)) * 100},${28 - (v / max) * 26}`);
  return (
    <div
      data-ui-theme=""
      style={vars}
      className="bg-(--ui-canvas) p-3 font-(family-name:--ui-font) text-[14px] text-(--ui-ink) [color-scheme:var(--ui-scheme)]"
    >
      <div className="grid gap-4 rounded-(--ui-radius) bg-(--ui-paper) p-4 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-heading text-[18px] font-(--ui-display-weight)">
            Your workspace
          </span>
          <div className={ROW}>
            <Button size="dense" tone="secondary">
              Later
            </Button>
            <Button size="dense">Approve</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
          <div className="rounded-(--ui-radius) bg-(--ui-tile) p-3">
            <div className="text-[12px] text-(--ui-ink-2)">Replies, 30 days</div>
            <div className="font-heading text-[28px] leading-tight font-(--ui-display-weight)">
              42
            </div>
            <svg
              viewBox="0 0 100 28"
              preserveAspectRatio="none"
              className="mt-1 h-7 w-full"
              aria-hidden="true"
            >
              <polyline
                points={points.join(" ")}
                fill="none"
                stroke="var(--ui-chart-1)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="rounded-(--ui-radius) bg-(--ui-tile) p-3">
            <div className="text-[12px] text-(--ui-ink-2)">Where replies came from</div>
            <div className="mt-3 flex h-3 w-full overflow-hidden" aria-hidden="true">
              {SERIES.map(([bg, w]) => (
                <span key={bg} className={bg} style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-0 text-[13.5px]">
          {(
            [
              ["Dana Ruiz", "Booked", "green", "2h ago"],
              ["Sam Patel", "Needs you", "rust", "4h ago"],
              ["Lee Chen", "Bounced", "bad", "1d ago"],
            ] as const
          ).map(([name, state, tone, when]) => (
            <div
              key={name}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-(--ui-hair) py-2 hover:bg-(--ui-wash)"
            >
              <span>{name}</span>
              {tone === "bad" ? (
                <Tag className="bg-(--ui-bad-tint) text-(--ui-bad)">{state}</Tag>
              ) : (
                <Tag tone={tone}>{state}</Tag>
              )}
              <span className="text-(--ui-ink-2)">{when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Report({ lines }: { lines: ContrastLine[] }) {
  return (
    <div>
      <h3 className="mb-1 text-[13px] font-semibold">Contrast</h3>
      <table className="w-full text-[13px]">
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.text}/${l.on}`} className="border-b border-(--ui-hair)">
              <td className="w-full py-1.5 pr-3">
                {/* "Text on accent" already names its ground. */}
                {l.text === "on-accent" && l.on === "accent"
                  ? nameOf(l.text)
                  : `${nameOf(l.text)} on ${nameOf(l.on).toLowerCase()}`}
              </td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{l.ratio.toFixed(1)}:1</td>
              <td className="py-1.5 whitespace-nowrap text-(--ui-ink-2)">
                {l.was ? (
                  <span className="inline-flex items-center gap-1.5">
                    Stepped from <Swatch color={l.was} /> {l.was}
                  </span>
                ) : (
                  `Passes ${l.need}:1`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
