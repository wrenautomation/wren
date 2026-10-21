/**
 * Marketing → Studio (designs/2026-10-21-demo-studio-and-map.md): where content gets made. It
 * opens on what the plan still asks for this week (a card per piece), then New (a card per kind),
 * then every draft that waits as a table: approve one in place with an Undo, or open it to edit,
 * rewrite or post now. A New card, a due card for a post and Plan's links open compose
 * (`?make=`): a post in his own words (one or a batch, each platform's version checked as he types
 * by the server's own rules in `@wren/content/write`), an X thread, a carousel, a story, a blog
 * post, or a video (from a recording). Write's old address lands here (`WritePage`). Wren's own:
 * ContentDesk through the console.
 */

import { cx, Icon } from "@wren/ui";
import { useEffect } from "react";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { dueOf, goalsOf, usePlan } from "./plan.js";
import { chosen, makeOf, offeredFor, pick, studioHref } from "./studio-common.js";
import { Compose } from "./studio-compose.js";
import { DueCards, EYEBROW, NewRow } from "./studio-due.js";
import { LineMark, useOfferLines } from "./studio-lines.js";
import { WaitingBoard } from "./studio-waiting.js";
import { StudioVideo, VideoShelf } from "./video-shelf.js";

export { studioHref };

/** Marketing → Write folded into Studio: its links land in Studio's New. */
export function WritePage(props: PageProps) {
  // After this commit's effects: on a first load the router's listener mounts after this page's
  // effect, and a move sent before it would be missed (a blank page).
  useEffect(() => {
    const to = studioHref(props.params);
    queueMicrotask(() => navigate(to, true));
  }, [props.params]);
  return null;
}

export function StudioPage(props: PageProps) {
  // A video opened from the shelf: its editor takes the page, Studio is one link back.
  const video = props.params.get("video");
  if (video) return <StudioVideo key={video} {...props} id={video} />;
  // A kind asked for (New, Plan's links, a platform chip): compose takes the page.
  const asked = makeOf(props.params);
  if (asked) return <ComposePage {...props} asked={asked} />;
  return <StudioHome {...props} />;
}

function ComposePage(props: PageProps & { asked: NonNullable<ReturnType<typeof makeOf>> }) {
  const only = chosen(props.params);
  const { lines } = useOfferLines(props.client);
  return (
    <Compose {...props} only={only} make={pick(props.asked, offeredFor(only))} lines={lines} />
  );
}

/** "week of Oct 20": the Monday of this week, as the head's kicker says it. */
export function weekOf(now = new Date()): string {
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return `week of ${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** The board's trigger as a native select: paper, a hair ring, a leaf; the menu is the device's. */
const LINE_PICK =
  "h-8 cursor-pointer appearance-none bg-(--ui-paper) py-0 pr-8 pl-[30px] text-[13px] font-semibold text-(--ui-ink) [border-radius:6px_14px] shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-shadow duration-150 ease-(--ui-ease) hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-active)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ui-focus) max-sm:h-11";

function StudioHome(props: PageProps) {
  const plan = usePlan();
  const { lines, byId } = useOfferLines(props.client);
  const only = chosen(props.params);
  const goals = goalsOf(plan.data?.rows);
  const line = props.params.get("line") || null;
  const due = dueOf(goals).filter((d) => !line || d.line === line);
  const all = dueOf(goals);
  const n = all.length;
  const pieces = `${n} ${n === 1 ? "piece" : "pieces"}`;
  // A plan that names no line for its pieces has nothing to filter by.
  const filter = lines.length > 0 && all.some((d) => d.line);
  const shown = line ? byId.get(line) : undefined;
  return (
    <>
      <header className="mb-7 flex flex-wrap items-end gap-4 max-sm:mb-4">
        <div className="grid min-w-0 gap-1">
          <p className="m-0 text-[13px] font-medium text-(--ui-ink-3)">
            Studio · <span className="max-sm:hidden">{weekOf()}</span>
            <span className="sm:hidden">this week</span>
          </p>
          <h1 className="m-0 text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-balance max-sm:text-[24px] max-sm:leading-[30px]">
            {!plan.data || n === 0 ? (
              "Studio"
            ) : (
              <>
                <span className="max-sm:hidden">The plan still asks for {pieces}</span>
                <span className="sm:hidden">{pieces} still due</span>
              </>
            )}
          </h1>
          {plan.data && n === 0 ? (
            <p className="m-0 text-[13.5px] text-(--ui-ink-2)">
              Every goal is on track. Make something new, or finish what waits on you.
            </p>
          ) : null}
        </div>
        {filter ? (
          <label className="ml-auto flex items-center gap-2 text-[13px] text-(--ui-ink-3) max-sm:hidden">
            Line
            <span className="relative flex items-center">
              <LineMark line={shown} className="pointer-events-none absolute left-3" />
              <select
                aria-label="Line"
                className={LINE_PICK}
                value={line ?? ""}
                onChange={(e) =>
                  navigate(href("/content/studio", { line: e.target.value }, props.params), true)
                }
              >
                <option value="">All lines</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <Icon
                name="down"
                size={12}
                className="pointer-events-none absolute right-3 text-(--ui-ink-2)"
              />
            </span>
          </label>
        ) : null}
      </header>
      <div className="grid gap-7 max-sm:gap-[18px] max-sm:pb-32">
        {plan.data && n === 0 ? null : (
          <section aria-labelledby="studio-due" className="grid min-w-0 gap-2.5">
            {/* A phone's head already says what is due: the label stays for a screen reader. */}
            <div className="flex items-baseline gap-3 max-sm:contents">
              <h2 id="studio-due" className={cx(EYEBROW, "max-sm:sr-only")}>
                Still due this week
              </h2>
              <a
                href="/content/plan"
                className="text-[13px] font-medium text-(--ui-link) no-underline hover:underline max-sm:hidden"
              >
                Open the plan
              </a>
            </div>
            <DueCards
              due={due}
              lines={byId}
              error={plan.error}
              loading={!plan.data}
              retry={plan.retry}
            />
          </section>
        )}
        <section aria-label="New" className="grid min-w-0 gap-2.5 max-sm:hidden">
          <h2 className={EYEBROW}>New</h2>
          <NewRow params={props.params} only={only} />
        </section>
        <WaitingBoard {...props} lines={byId} line={line} />
        <VideoShelf params={props.params} />
      </div>
      <a
        href={href("/content/studio", { make: "post" }, props.params)}
        aria-label="New post"
        className="fixed right-5 bottom-[calc(104px+env(safe-area-inset-bottom))] z-20 grid size-14 place-items-center bg-(--ui-primary) text-(--ui-on-accent) [border-radius:14px_28px] shadow-[0_8px_20px_-8px_color-mix(in_srgb,var(--ui-umbra)_50%,transparent)] transition-transform duration-200 ease-(--ui-spring) active:scale-95 motion-reduce:transition-none sm:hidden"
      >
        <Icon name="plus" size={22} />
      </a>
    </>
  );
}
