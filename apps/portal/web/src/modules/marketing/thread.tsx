/**
 * An X thread in one draft (designs/2026-10-07-content-funnel.md): its posts edited one box each,
 * counted as X counts them (the funnel link rides on the last), split, merged and moved; and the
 * chain as X shows it. The words stay one text with a `---` line between posts, so the draft box
 * keeps saving, asking Claude and undoing.
 */
import {
  THREAD_BREAK,
  threadPosts,
  withLink,
  X_POST_MAX,
  xLength,
} from "@wren/core/content/thread";
import { Button, DeviceFrame, type DraftEditor, type DraftEditorProps, Textarea } from "@wren/ui";
import { useRef, useState } from "react";

/** `@wren/content`'s `ThreadView`: the limits, and each saved post's count and flags. */
export type ThreadShape = {
  min: number;
  max: number;
  each: number;
  posts: { text: string; count: number; flags: string[] }[];
};

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const GRAY = "text-[#6b6b70]";

/** The posts of a text as typed: an empty post stays while he fills it. */
const postsOf = (text: string) => {
  const posts = threadPosts(text);
  return posts.length ? posts : [""];
};
const joined = (posts: string[]) => posts.join(THREAD_BREAK);

/** A post's count against X's cap: the last with its link. */
const countOf = (posts: string[], i: number, link: string | null) =>
  xLength(withLink(posts, link)[i] ?? "");

function ThreadEditor({
  text,
  setText,
  flush,
  editable,
  thread,
  link,
}: DraftEditorProps & { thread: ThreadShape; link: string | null }) {
  // Kept here so an emptied post keeps its box; read again when the words change elsewhere.
  const [posts, setPosts] = useState(() => postsOf(text));
  const mine = useRef(joined(posts));
  if (text !== mine.current && text.trim() !== mine.current.trim()) {
    const next = postsOf(text);
    mine.current = joined(next);
    setPosts(next);
  }
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const type = (next: string[]) => {
    setPosts(next);
    mine.current = joined(next);
    setText(mine.current);
  };
  const reshape = (next: string[], focus: number) => {
    type(next);
    void flush(mine.current);
    requestAnimationFrame(() => boxes.current[focus]?.focus());
  };
  const split = (i: number) => {
    const box = boxes.current[i];
    const p = posts[i] ?? "";
    const at = box?.selectionStart ?? p.length;
    const head = p.slice(0, at).trim();
    const tail = p.slice(at).trim();
    reshape([...posts.slice(0, i), head, tail, ...posts.slice(i + 1)], i + 1);
  };
  const merge = (i: number) =>
    reshape(
      [
        ...posts.slice(0, i),
        `${(posts[i] ?? "").trim()}\n\n${(posts[i + 1] ?? "").trim()}`.trim(),
        ...posts.slice(i + 2),
      ],
      i,
    );
  const move = (i: number, by: -1 | 1) => {
    const next = [...posts];
    const j = i + by;
    [next[i], next[j]] = [next[j] ?? "", next[i] ?? ""];
    reshape(next, j);
  };
  const n = posts.length;
  const sizeOk = n >= thread.min && n <= thread.max;
  return (
    <div className="grid gap-3">
      <p className={`text-[12px] ${sizeOk ? "text-(--ui-ink-3)" : "text-(--ui-bad)"}`}>
        {n} {n === 1 ? "post" : "posts"}. A thread is {thread.min} to {thread.max}. The first
        carries no link; the last carries the video's.
      </p>
      <ol className="grid gap-4">
        {posts.map((p, i) => {
          const count = countOf(posts, i, link);
          const over = count > thread.each;
          const saved = thread.posts[i];
          const flags = saved && saved.text === p.trim() ? saved.flags : [];
          const linked = i === 0 && /https?:\/\//i.test(p);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: posts are their place in the chain.
            <li key={i} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`thread-post-${i}`} className={LABEL}>
                  Post {i + 1}
                  {i === n - 1 && link ? (
                    <span className="font-normal text-(--ui-ink-3)"> · plus the link</span>
                  ) : null}
                </label>
                <span
                  className={`text-[12px] tabular-nums ${over ? "font-semibold text-(--ui-bad)" : "text-(--ui-ink-3)"}`}
                >
                  {count} / {thread.each}
                </span>
              </div>
              <Textarea
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                id={`thread-post-${i}`}
                value={p}
                readOnly={!editable}
                rows={Math.min(8, Math.max(3, Math.ceil(p.length / 60)))}
                onChange={(e) => type(posts.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={() => void flush()}
              />
              {linked ? (
                <p className="text-[12px] text-(--ui-bad)">
                  Take the link out. The first post carries none.
                </p>
              ) : null}
              {flags.length ? (
                <p className="text-[12px] text-(--ui-ink-2)">
                  Check these against the facts: {flags.join(", ")}
                </p>
              ) : null}
              {editable ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="dense"
                    tone="quiet"
                    disabled={n >= thread.max}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => split(i)}
                  >
                    Split here
                  </Button>
                  {i < n - 1 ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      disabled={n <= thread.min}
                      onClick={() => merge(i)}
                    >
                      Merge with next
                    </Button>
                  ) : null}
                  {i > 0 ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      aria-label={`Move post ${i + 1} up`}
                      onClick={() => move(i, -1)}
                    >
                      Up
                    </Button>
                  ) : null}
                  {i < n - 1 ? (
                    <Button
                      size="dense"
                      tone="quiet"
                      aria-label={`Move post ${i + 1} down`}
                      onClick={() => move(i, 1)}
                    >
                      Down
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The draft box's editor for a thread, from the record's detail; null for any other post. */
export const threadEditorOf = (detail: unknown): DraftEditor | null => {
  const shape = (
    detail as {
      shape?: { thread?: ThreadShape | null; funnel?: { posts?: string | null } } | null;
    } | null
  )?.shape;
  const thread = shape?.thread;
  if (!thread) return null;
  const link = shape?.funnel?.posts ?? null;
  return (p) => <ThreadEditor {...p} thread={thread} link={link} />;
};

/** The chain on X: each post under the last, a line joining the avatars. */
export function XThread({ text, link }: { text: string; link: string | null }) {
  const posts = threadPosts(text);
  const out = withLink(posts, link);
  return (
    <DeviceFrame label="Thread, phone" width={393}>
      {out.length ? (
        <ol className="grid py-2">
          {out.map((p, i) => {
            const count = xLength(p);
            const last = i === out.length - 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: posts are their place in the chain.
              <li key={i} className="flex gap-3 px-4 pt-2 text-[15px] leading-5">
                <div className="flex flex-col items-center">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#d9d9de] text-[17px] font-semibold text-black">
                    W
                  </span>
                  {last ? null : <span className="w-0.5 flex-1 bg-[#d9d9de]" />}
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5 pb-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-bold">Wren Automation</span>{" "}
                      <span className={GRAY}>@wrenautomation · now</span>
                    </span>
                    <span
                      className={`shrink-0 text-[12px] tabular-nums ${count > X_POST_MAX ? "font-semibold text-[#d0312d]" : GRAY}`}
                    >
                      {i + 1}/{out.length} · {count}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p}</p>
                  <p className={`flex justify-between pt-1 text-[13px] ${GRAY}`}>
                    <span>Reply</span>
                    <span>Repost</span>
                    <span>Like</span>
                    <span>Views</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={`p-4 text-[14px] ${GRAY}`}>No posts</p>
      )}
    </DeviceFrame>
  );
}
