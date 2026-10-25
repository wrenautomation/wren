/**
 * Write's Carousel box: slides typed as one block (a blank line between slides), a caption, and
 * where it goes: Instagram's swipe, LinkedIn's document post. The preview draws the renderer's own
 * page as he types. ContentDesk `carousel` makes a draft per platform on one slide set and draws
 * it; the slide editor on each draft changes it later.
 */

import { PLATFORM_SPECS } from "@wren/content/write";
import { SLIDES_MAX, SLIDES_MIN, slidesFromText, slidesUnfit } from "@wren/core/content/slides";
import { ACTIONS, Button, cx, messageOf, Section, TextAreaField, useEditForm } from "@wren/ui";
import { useEffect, useState } from "react";
import { QUIET } from "../work/bits.js";
import { contentDesk } from "./desk.js";
import { type Go, type Result, SendTools, said, WherePicker } from "./send-box.js";
import { CarouselPreview } from "./slides.js";

const WHERE = ["instagram", "linkedin"] as const;
type Where = (typeof WHERE)[number];
const NAME: Record<Where, string> = { instagram: "Instagram", linkedin: "LinkedIn" };

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
    slides.length > 0 && !unfit && !!caption.trim() && where.length > 0 && !busy && !props.demo;
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
        desk<{ posts: { results: Result<Where>[] }[] }>("carousel", {
          slides,
          text: caption,
          platforms: where,
          go,
          requestId,
        }),
      )) as { posts: { results: Result<Where>[] }[] };
      setLines(
        said(
          out.posts.flatMap((p) => p.results),
          go,
          NAME,
        ),
      );
      form.forget();
      props.made();
    } catch (err) {
      setError(messageOf(err));
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
          <WherePicker all={WHERE} name={NAME} where={where} onChange={setWhere} />
          <p className={cx("m-0 text-[13px]", unfit ? "text-(--ui-bad)" : QUIET)}>
            {unfit
              ? `Not yet: ${unfit}.`
              : slides.length
                ? `${slides.length} slides.${caption.trim() ? "" : " Add a caption."}`
                : "Type the slides to see them."}
          </p>
          <SendTools
            ready={ready}
            busy={busy}
            sure={sure}
            count={where.length}
            send={(go) => void send(go)}
            cancel={() => setSure(false)}
            lines={lines}
            error={error}
          />
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
