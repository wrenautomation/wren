/**
 * Write's Carousel box: slides typed as one block (a blank line between slides), a caption, and
 * where it goes: Instagram's swipe, LinkedIn's document post. The preview draws the renderer's own
 * page as he types. ContentDesk `carousel` makes a draft per platform on one slide set and draws
 * it; the slide editor on each draft changes it later.
 */

import { PLATFORM_SPECS } from "@wren/content/write";
import { SLIDES_MAX, SLIDES_MIN, slidesFromText, slidesUnfit } from "@wren/core/content/slides";
import { ACTIONS, Button, cx, PlatformMark, Section, TextAreaField, useEditForm } from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError } from "../../api.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";
import { contentDesk } from "./desk.js";
import { CarouselPreview } from "./slides.js";

type Go = "draft" | "slot" | "now";
const WHERE = ["instagram", "linkedin"] as const;
type Where = (typeof WHERE)[number];
const NAME: Record<Where, string> = { instagram: "Instagram", linkedin: "LinkedIn" };
interface Result {
  platform: Where;
  draftId: string | null;
  reason: string | null;
  at?: string | null;
  held?: string;
}

const START = `The hook: what they get from swiping

The first point
One short line on it
Another if it needs one

The second point
A line

The third point
A line

What to do next
Comment GUIDE and I'll send it`;

const desk = contentDesk;
const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

function said(results: Result[], go: Go): string[] {
  const made = results.filter((r) => r.draftId && !r.held);
  const lines = [
    made.length === 0
      ? "Nothing was made."
      : go === "draft"
        ? `${made.length} saved as drafts. They wait in Studio.`
        : go === "now"
          ? `${made.length} posting on the next pass, within a few minutes.`
          : `${made.length} scheduled at the next slots.`,
  ];
  for (const r of results)
    if (r.reason) lines.push(`${NAME[r.platform]}: ${r.reason}.`);
    else if (r.held) lines.push(`${NAME[r.platform]} waits as a draft: ${r.held}`);
  return lines;
}

export function CarouselBox(props: { demo?: boolean; only: string | null; made: () => void }) {
  // What he types stays on the device until it's sent: a reload or a closed tab gives it back.
  const form = useEditForm({
    key: props.demo ? null : "studio:carousel",
    defaults: { slides: "", caption: "" },
    base: "",
  });
  const { slides: typed, caption } = form.watch();
  const [where, setWhere] = useState<Where[]>(() =>
    props.only === "linkedin"
      ? ["linkedin"]
      : props.only === "instagram"
        ? ["instagram"]
        : [...WHERE],
  );
  const [look, setLook] = useState<Where>(where[0] ?? "instagram");
  const [busy, setBusy] = useState<Go | null>(null);
  const [sure, setSure] = useState(false);
  // Words changed after "Post now?": ask again.
  const { watch } = form;
  useEffect(() => {
    const sub = watch(() => setSure(false));
    return () => sub.unsubscribe();
  }, [watch]);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const slides = slidesFromText(typed);
  const long = where.find((p) => caption.trim().length > PLATFORM_SPECS[p].maxChars);
  const unfit = !typed.trim()
    ? null
    : (slidesUnfit(slides) ??
      (long
        ? `the caption is over ${PLATFORM_SPECS[long].maxChars} characters for ${NAME[long]}`
        : null));
  const ready =
    slides.length > 0 && !unfit && caption.trim() && where.length > 0 && !busy && !props.demo;
  const shown = where.includes(look) ? look : (where[0] ?? look);

  const send = async (go: Go) => {
    if (go === "now" && !sure) {
      setSure(true);
      return;
    }
    setSure(false);
    setBusy(go);
    setError(null);
    setLines([]);
    try {
      // One press, one carousel: a second while it's out gets the first's answer.
      const out = (await ACTIONS.run(`studio:carousel:${go}`, (requestId) =>
        desk<{ posts: { results: Result[] }[] }>("carousel", {
          slides,
          text: caption,
          platforms: where,
          go,
          requestId,
        }),
      )) as { posts: { results: Result[] }[] };
      setLines(
        said(
          out.posts.flatMap((p) => p.results),
          go,
        ),
      );
      form.forget();
      props.made();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Carousel"
      note={`${SLIDES_MIN} to ${SLIDES_MAX} slides. Instagram swipes them, LinkedIn shows them as a PDF.`}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_393px]">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <TextAreaField
              form={form}
              name="slides"
              label={<span className="font-medium">Slides</span>}
              className="gap-1.5"
              aria-label="Slides"
              rows={16}
              placeholder={START}
              disabled={props.demo}
            />
            <span className={cx("text-[12.5px]", QUIET)}>
              Leave a blank line between slides. A slide's first line is its title, then up to 4
              short lines.
              {typed.trim() ? null : (
                <>
                  {" "}
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] underline"
                    onClick={() => form.setValue("slides", START)}
                  >
                    Start from the example
                  </button>
                </>
              )}
            </span>
          </div>
          <TextAreaField
            form={form}
            name="caption"
            label={<span className="font-medium">Caption</span>}
            className="gap-1.5"
            aria-label="Caption"
            rows={4}
            placeholder="What goes under it"
            disabled={props.demo}
          />
          <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">Where it goes</legend>
            {WHERE.map((p) => {
              const on = where.includes(p);
              return (
                <Button
                  key={p}
                  size="dense"
                  tone={on ? "primary" : "secondary"}
                  aria-pressed={on}
                  onClick={() => setWhere((w) => (on ? w.filter((x) => x !== p) : [...w, p]))}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <PlatformMark mark={p} size={13} />
                    {NAME[p]}
                  </span>
                </Button>
              );
            })}
          </fieldset>
          <p className={cx("m-0 text-[13px]", unfit ? "text-(--ui-bad)" : QUIET)}>
            {unfit
              ? `Not yet: ${unfit}.`
              : slides.length
                ? `${slides.length} slides.${caption.trim() ? "" : " Add a caption."}`
                : "Type the slides to see them."}
          </p>
          <div className={TOOLS}>
            <Button
              size="dense"
              tone="secondary"
              disabled={!ready}
              onClick={() => void send("draft")}
            >
              {busy === "draft" ? "Saving…" : "Save as drafts"}
            </Button>
            <Button
              size="dense"
              tone="secondary"
              disabled={!ready}
              onClick={() => void send("slot")}
            >
              {busy === "slot" ? "Scheduling…" : "Schedule"}
            </Button>
            <Button tone="primary" size="dense" disabled={!ready} onClick={() => void send("now")}>
              {busy === "now" ? "Posting…" : sure ? `Post ${where.length} now?` : "Post now"}
            </Button>
            {sure ? (
              <Button size="dense" tone="quiet" onClick={() => setSure(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
          {lines.length ? (
            <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className={ERROR}>{error}</p> : null}
        </div>
        <div className="grid justify-items-start gap-2">
          {where.length > 1 ? (
            <div className="flex gap-1.5" role="tablist" aria-label="Preview">
              {where.map((p) => (
                <Button
                  key={p}
                  size="dense"
                  tone={shown === p ? "primary" : "quiet"}
                  role="tab"
                  aria-selected={shown === p}
                  onClick={() => setLook(p)}
                >
                  {NAME[p]}
                </Button>
              ))}
            </div>
          ) : null}
          <CarouselPreview platform={shown} slides={slides} text={caption} />
        </div>
      </div>
    </Section>
  );
}
