/**
 * A video edit's answer patches its page (`VideoDesk` set, line, cut, words and undo answer
 * `view`, the edit as the page draws it): no read of the video again after a save.
 */
import { type ActPatch, answerIn } from "@wren/ui";

type Video = Record<string, unknown> & { finish?: Record<string, unknown> | null };

/** The detail with `view` over its video; null when the answer has none (read again then). */
export const viewPatch: ActPatch = (detail, answer) => {
  const view = (answerIn(answer) as { view?: Record<string, unknown> } | null)?.view;
  const d = detail as { video?: Video } | null;
  if (!view || typeof view !== "object" || !d?.video) return null;
  const { finish, ...rest } = view as { finish?: Record<string, unknown> };
  const was = d.video.finish;
  const render = (view.render as { state?: string } | null | undefined)?.state ?? null;
  return {
    detail: { ...d, video: { ...d.video, ...rest, finish: was ? { ...was, ...finish } : was } },
    row: { render, ...(typeof view.title === "string" && view.title ? { title: view.title } : {}) },
  };
};

/** `act`'s options for an edit that answers its view. */
export const VIEWED = { patch: viewPatch };
