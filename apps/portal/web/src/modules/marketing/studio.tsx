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

import { Icon, PageHeader, SELECT_CLASS } from "@wren/ui";
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

function StudioHome(props: PageProps) {
  const plan = usePlan();
  const { lines, byId } = useOfferLines(props.client);
  const only = chosen(props.params);
  const goals = goalsOf(plan.data?.rows);
  const line = props.params.get("line") || null;
  const due = dueOf(goals).filter((d) => !line || d.line === line);
  const all = dueOf(goals);
  const n = all.length;
  // A plan that names no line for its pieces has nothing to filter by.
  const filter = lines.length > 0 && all.some((d) => d.line);
  return (
    <>
      <PageHeader
        title={
          plan.data && n > 0
            ? `The plan still asks for ${n} ${n === 1 ? "piece" : "pieces"}`
            : "Studio"
        }
        lede={
          plan.data && n === 0
            ? "Every goal is on track. Make something new, or finish what waits on you."
            : "Make something new, or finish what waits on you."
        }
        actions={
          filter ? (
            <label className="flex items-center gap-2 text-[13px] text-(--ui-ink-2)">
              Line
              <span className="flex items-center gap-2">
                {line && byId.get(line) ? <LineMark line={byId.get(line)} /> : null}
                <select
                  aria-label="Line"
                  className={SELECT_CLASS}
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
              </span>
            </label>
          ) : undefined
        }
      />
      <div className="grid gap-7">
        {plan.data && n === 0 ? null : (
          <section aria-labelledby="studio-due" className="grid min-w-0 gap-3">
            <div className="flex items-baseline gap-3">
              <h2 id="studio-due" className={EYEBROW}>
                Still due this week
              </h2>
              <a href="/content/plan" className="text-[13px]">
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
        <section aria-label="New" className="grid min-w-0 gap-3 max-sm:hidden">
          <h2 className={EYEBROW}>New</h2>
          <NewRow params={props.params} only={only} />
        </section>
        <WaitingBoard {...props} lines={byId} line={line} />
        <VideoShelf params={props.params} />
      </div>
      <a
        href={href("/content/studio", { make: "post" }, props.params)}
        aria-label="New post"
        className="fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 grid size-14 place-items-center rounded-full bg-(--ui-primary) text-(--ui-on-accent) shadow-(--ui-shadow) sm:hidden"
      >
        <Icon name="plus" size={22} />
      </a>
    </>
  );
}
