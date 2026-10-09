/**
 * A carousel's slides (designs/2026-10-07-content-funnel.md): edited in the draft, a strip of each
 * slide as it renders, and the drawn files to download. The strip and the previews draw
 * `slidesHtml`, the page the renderer draws, so what shows is what goes out. One set feeds the
 * LinkedIn PDF and the Instagram images: a save writes both drafts.
 */
import {
  SLIDE_LINE_MAX,
  SLIDE_LINES_MAX,
  SLIDE_PX,
  SLIDE_TITLE_MAX,
  SLIDES_MAX,
  SLIDES_MIN,
  type Slide,
  slidesHtml,
  slidesUnfit,
} from "@wren/core/content/slides";
import { Button, DeviceFrame, Input, type RecordAct, Textarea } from "@wren/ui";
import { useState } from "react";

export const SLIDES = "marketing.draftSlides";

/** `@wren/content`'s `CarouselView`. */
export type CarouselShape = {
  slides: Slide[];
  images: string[];
  pdf: string | null;
  fresh: boolean;
  drawn: string | null;
  shares: { id: string; platform: string; kind: string; status: string }[];
  unfit: string | null;
};

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const GROUP_HEAD =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";
const SITE: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram" };
const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The slides as typed, by draft: the preview beside the editor reads them. */
const typedSlides = new Map<string, Slide[]>();
const subs = new Set<() => void>();
const typeSlides = (draftId: string, slides: Slide[]) => {
  typedSlides.set(draftId, slides);
  for (const f of subs) f();
};
export const slidesTyped = (draftId: string) => typedSlides.get(draftId);
export const onSlidesTyped = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** One slide drawn by the renderer's own page, scaled to `size` pixels square. */
export function SlideFrame({
  slides,
  i,
  size,
  by,
}: {
  slides: readonly Slide[];
  i: number;
  size: number;
  by?: string;
}) {
  return (
    <div
      style={{ width: size, height: size }}
      className="relative shrink-0 overflow-hidden bg-[#f3f1ec]"
    >
      <iframe
        title={`Slide ${i + 1}`}
        srcDoc={slidesHtml(slides, { only: i, ...(by ? { by } : {}) })}
        sandbox=""
        tabIndex={-1}
        style={{
          width: SLIDE_PX,
          height: SLIDE_PX,
          transform: `scale(${size / SLIDE_PX})`,
          transformOrigin: "0 0",
        }}
        className="pointer-events-none absolute top-0 left-0 border-0"
      />
    </div>
  );
}

/** Every slide in a row, as it renders. */
function Strip({ slides, pick }: { slides: Slide[]; pick?: (i: number) => void }) {
  return (
    <section className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" aria-label="Slides as drawn">
      {slides.map((_, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: a slide is its place in the set.
          key={i}
          type="button"
          onClick={() => pick?.(i)}
          className="grid shrink-0 cursor-pointer justify-items-center gap-1 border-0 bg-transparent p-0"
        >
          <span className="block border border-(--ui-hair)">
            <SlideFrame slides={slides} i={i} size={128} />
          </span>
          <span className={HINT}>{i + 1}</span>
        </button>
      ))}
    </section>
  );
}

const blank = (): Slide => ({ title: "", lines: [] });
const linesOf = (t: string) => t.split("\n");

/**
 * The slide set: each slide's title and lines, moved, added and taken out, then saved on every
 * draft that shares it and drawn to images and a PDF.
 */
export function SlidesEditor({
  draftId,
  carousel,
  editable,
  act,
}: {
  draftId: string;
  carousel: CarouselShape;
  editable: boolean;
  act: RecordAct;
}) {
  const [slides, setSlides] = useState<Slide[]>(carousel.slides);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = JSON.stringify(carousel.slides);
  const [base, setBase] = useState(saved);
  if (saved !== base) {
    setBase(saved);
    setSlides(carousel.slides);
  }
  const changed = JSON.stringify(slides) !== saved;
  const set = (next: Slide[]) => {
    setSlides(next);
    typeSlides(draftId, next);
  };
  const edit = (i: number, s: Partial<Slide>) =>
    set(slides.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...slides];
    const j = i + by;
    [next[i], next[j]] = [next[j] ?? blank(), next[i] ?? blank()];
    set(next);
  };
  const clean = slides.map((s) => ({
    title: s.title.trim(),
    lines: s.lines.map((l) => l.trim()).filter(Boolean),
  }));
  const unfit = slidesUnfit(clean);
  const run = async (draw: boolean) => {
    if (unfit) return setSaid({ text: unfit, bad: true });
    setBusy(true);
    setSaid({ text: draw ? "Saving and drawing…" : "Saving…", bad: false });
    try {
      await act(SLIDES, { slides: clean, ...(draw ? { draw: true } : {}) });
      setSaid({ text: draw ? "Saved and drawn" : "Saved", bad: false });
    } catch (err) {
      setSaid({ text: errorOf(err), bad: true });
    } finally {
      setBusy(false);
    }
  };
  const others = carousel.shares.slice(1);
  return (
    <section aria-label="Slides" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={GROUP_HEAD}>Slides</h3>
        <span className={HINT}>
          {slides.length} of {SLIDES_MIN} to {SLIDES_MAX}
          {others.length
            ? `. Shared with the ${others.map((o) => SITE[o.platform] ?? o.platform).join(" and ")} draft`
            : ""}
        </span>
      </div>
      <Strip slides={clean} />
      <ol className="grid gap-5">
        {slides.map((s, i) => {
          const lines = s.lines.join("\n");
          const longLine = s.lines.some((l) => l.trim().length > SLIDE_LINE_MAX);
          const many = s.lines.filter((l) => l.trim()).length > SLIDE_LINES_MAX;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a slide is its place in the set.
              key={i}
              className="grid gap-2 border-t border-(--ui-hair) pt-4 first:border-0 first:pt-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`slide-${i}-title`} className={LABEL}>
                  Slide {i + 1}
                  {i === 0 ? <span className="font-normal text-(--ui-ink-3)"> · cover</span> : null}
                </label>
                <span
                  className={`text-[12px] tabular-nums ${s.title.trim().length > SLIDE_TITLE_MAX ? "font-semibold text-(--ui-bad)" : "text-(--ui-ink-3)"}`}
                >
                  {s.title.trim().length} / {SLIDE_TITLE_MAX}
                </span>
              </div>
              <Input
                id={`slide-${i}-title`}
                value={s.title}
                readOnly={!editable}
                placeholder="Title"
                onChange={(e) => edit(i, { title: e.target.value })}
              />
              <Textarea
                aria-label={`Slide ${i + 1} lines`}
                value={lines}
                readOnly={!editable}
                rows={Math.max(2, Math.min(SLIDE_LINES_MAX, s.lines.length))}
                placeholder="A short line each"
                onChange={(e) => edit(i, { lines: linesOf(e.target.value) })}
              />
              <span className={`text-[12px] ${many || longLine ? "text-(--ui-bad)" : HINT}`}>
                Up to {SLIDE_LINES_MAX} lines, {SLIDE_LINE_MAX} characters each.
              </span>
              {editable ? (
                <div className="flex flex-wrap gap-1">
                  {i > 0 ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      aria-label={`Move slide ${i + 1} up`}
                      onClick={() => move(i, -1)}
                    >
                      Up
                    </Button>
                  ) : null}
                  {i < slides.length - 1 ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      aria-label={`Move slide ${i + 1} down`}
                      onClick={() => move(i, 1)}
                    >
                      Down
                    </Button>
                  ) : null}
                  <Button
                    size="dense"
                    tone="quiet"
                    disabled={slides.length >= SLIDES_MAX}
                    onClick={() =>
                      set([...slides.slice(0, i + 1), blank(), ...slides.slice(i + 1)])
                    }
                  >
                    Add after
                  </Button>
                  <Button
                    size="dense"
                    tone="quiet"
                    disabled={slides.length <= SLIDES_MIN}
                    onClick={() => set(slides.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="dense"
            tone="secondary"
            busy={busy}
            disabled={!changed}
            onClick={() => void run(false)}
          >
            Save slides
          </Button>
          <Button
            size="dense"
            tone="secondary"
            busy={busy}
            disabled={!changed && carousel.fresh}
            onClick={() => void run(true)}
          >
            {changed ? "Save and draw" : "Draw"}
          </Button>
          {said ? (
            <span className={`text-[12px] ${said.bad ? "text-(--ui-bad)" : "text-(--ui-ink-2)"}`}>
              {said.text}
            </span>
          ) : changed ? (
            <span className={HINT}>Not saved</span>
          ) : null}
        </div>
      ) : null}
      <Files carousel={carousel} changed={changed} />
    </section>
  );
}

/** The drawn images and PDF, and what can't happen yet. */
function Files({ carousel, changed }: { carousel: CarouselShape; changed: boolean }) {
  const stale = changed || !carousel.fresh;
  return (
    <div className="grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3 text-[13px]">
      {carousel.images.length && !stale ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-(--ui-ink-2)">Download</span>
          {carousel.pdf ? (
            <a href={carousel.pdf} download className="underline underline-offset-4">
              PDF for LinkedIn
            </a>
          ) : null}
          {carousel.images.map((u, i) => (
            <a key={u} href={u} download className="underline underline-offset-4">
              Image {i + 1}
            </a>
          ))}
        </p>
      ) : (
        <p className="text-(--ui-ink-2)">
          {stale && carousel.drawn
            ? "The slides changed since they were drawn. Draw them again."
            : stale
              ? "Not drawn yet. Draw makes a square image per slide and a PDF."
              : "Drawn. The downloads show where the media store is set up."}
        </p>
      )}
      <p className="text-(--ui-ink-2)">
        {carousel.unfit
          ? `Can't post yet: ${carousel.unfit}.`
          : "Ready to post. Approve uploads the PDF to LinkedIn and each image to Instagram."}
      </p>
    </div>
  );
}

const PHONE = 393;
const GRAY = "text-[#6b6b70]";

/** The carousel where it goes: Instagram's swipe, or LinkedIn's document post. */
export function CarouselPreview({
  platform,
  slides,
  text,
}: {
  platform: string;
  slides: Slide[];
  text: string;
}) {
  const [at, setAt] = useState(0);
  const i = Math.min(at, Math.max(0, slides.length - 1));
  if (!slides.length)
    return (
      <p className="text-[13px] text-(--ui-ink-2)">The preview shows once there are slides.</p>
    );
  const pager = (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
      <button
        type="button"
        disabled={i === 0}
        onClick={() => setAt(i - 1)}
        className="cursor-pointer border-0 bg-transparent p-0 disabled:opacity-40"
      >
        ← Back
      </button>
      <span className="flex gap-1">
        {slides.map((_, j) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot a slide.
            key={j}
            className={`size-1.5 rounded-full ${j === i ? "bg-[#0b84fe]" : "bg-[#c9c9ce]"}`}
          />
        ))}
      </span>
      <button
        type="button"
        disabled={i === slides.length - 1}
        onClick={() => setAt(i + 1)}
        className="cursor-pointer border-0 bg-transparent p-0 disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
  if (platform === "linkedin")
    return (
      <DeviceFrame label="Document post, phone" width={PHONE}>
        <div className="grid gap-3 p-4 pb-0 text-[14px] leading-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-12 place-items-center rounded-full bg-[#d9d9de] font-semibold">
              W
            </span>
            <span className="grid">
              <span className="font-semibold">Wren Automation</span>
              <span className={`text-[12px] ${GRAY}`}>Now · Anyone</span>
            </span>
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">{text.trim() || "No text"}</p>
        </div>
        <div className="mt-3 border-y border-[#d9d9de]">
          <p className={`px-3 py-1.5 text-[12px] ${GRAY}`}>
            {slides[0]?.title} · {slides.length} pages
          </p>
          <SlideFrame slides={slides} i={i} size={PHONE} />
          {pager}
        </div>
      </DeviceFrame>
    );
  return (
    <DeviceFrame label="Carousel, phone" width={PHONE}>
      <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-semibold">
        <span className="grid size-8 place-items-center rounded-full bg-[#d9d9de]">W</span>
        wrenautomation
      </p>
      <div className="relative">
        <SlideFrame slides={slides} i={i} size={PHONE} />
        <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] text-white">
          {i + 1}/{slides.length}
        </span>
      </div>
      {pager}
      <p className="line-clamp-3 px-3 pb-3 text-[13px] leading-[18px] whitespace-pre-wrap break-words">
        <span className="font-semibold">wrenautomation</span> {text.trim() || "No caption"}
      </p>
    </DeviceFrame>
  );
}
