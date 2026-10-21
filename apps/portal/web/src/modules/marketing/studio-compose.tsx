/**
 * Studio's compose view: one kind at a time, the kind tabs on top. A post (or a batch, or an X
 * thread) has its line and angle chips, the words, and each platform's version side by side with
 * how it fits, checked as he types by the server's own rules in `@wren/content/write`. A carousel,
 * a story and a blog post keep their own boxes. The words stay in the edits store until sent.
 * The line and the angle are his notes for now: the write call does not take them.
 */

import { ownDraftOf, ownThreadOf, PLATFORM_SPECS, splitPosts } from "@wren/content/write";
import type { Platform } from "@wren/core/content";
import { THREAD_MAX, THREAD_MIN, threadPosts, X_POST_MAX } from "@wren/core/content/thread";
import type { MetroLine } from "@wren/pipeline/metro";
import {
  Button,
  cx,
  EditConflict,
  Icon,
  PageHeader,
  PlatformMark,
  Section,
  Segmented,
  Tag,
  TextAreaField,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useEffect, useState } from "react";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { ERROR, QUIET } from "../work/bits.js";
import { BlogBox } from "./blog-box.js";
import { CarouselBox } from "./carousel-box.js";
import { StoryBox } from "./story-box.js";
import {
  desk,
  fromOf,
  type Make,
  makeKind,
  message,
  offeredFor,
  sentence,
  TEXT,
  targetOf,
  when,
} from "./studio-common.js";
import { EYEBROW } from "./studio-due.js";
import { LineMark } from "./studio-lines.js";

/** The angles a post can take: his note on how it argues. */
const ANGLES = ["Proof", "Contrarian", "How I do it", "Story"] as const;

type Go = "draft" | "slot" | "now";
interface WriteResult {
  platform: Platform;
  draftId: string | null;
  reason: string | null;
  at?: string | null;
  held?: string;
}

/** What the answer says, one line: saved, scheduled, posting, and what didn't go. */
function summary(posts: { results: WriteResult[] }[], go: Go): string[] {
  const all = posts.flatMap((p) => p.results);
  const made = all.filter((r) => r.draftId && !r.held);
  const lines = [
    made.length === 0
      ? "Nothing was made."
      : go === "draft"
        ? `${made.length} saved as drafts. They wait in Studio.`
        : go === "now"
          ? `${made.length} posting on the next pass, within a few minutes.`
          : `${made.length} scheduled: ${made
              .map((r) => `${targetOf(r.platform)} ${r.at ? when(r.at) : "next pass"}`)
              .join(", ")}.`,
  ];
  for (const r of all) {
    if (r.reason) lines.push(`${targetOf(r.platform)}: ${r.reason}.`);
    else if (r.held) lines.push(`${targetOf(r.platform)} waits as a draft: ${r.held}`);
  }
  return lines;
}

/** A pick-one chip: the line or the angle. Pressing the chosen one clears it. */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-7 cursor-pointer items-center gap-1.5 border px-2.5 text-[12.5px] [border-radius:var(--ui-leaf-chip)] transition-colors duration-150 pointer-coarse:min-h-11",
        on
          ? "border-(--ui-active) bg-(--ui-accent-tint) font-semibold text-(--ui-live)"
          : "border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink-2) hover:bg-(--ui-hover)",
      )}
    >
      {children}
    </button>
  );
}

/** Compose: the kind tabs, then that kind's box. */
export function Compose(
  props: PageProps & {
    make: Make;
    only: Platform | null;
    lines: readonly MetroLine[];
  },
) {
  const { make, only } = props;
  const kind = makeKind(make);
  const [sent, setSent] = useState(false);
  const back = href("/content/studio", { make: "", idea: "", from: "", about: "" }, props.params);
  const about = fromOf(props.params);
  const made = () => setSent(true);
  return (
    <>
      <PageHeader
        title={`New ${kind.name.toLowerCase()}`}
        lede={
          <a href={back} className="inline-flex items-center gap-1 no-underline">
            <Icon name="left" size={14} /> Studio
          </a>
        }
        actions={
          <Segmented
            label="What you're making"
            className="max-w-full"
            items={offeredFor(only).map((m) => ({
              id: m.id,
              label: m.id === "blog" ? "Blog" : m.name,
              href: href("/content/studio", { make: m.id }, props.params),
              on: m.id === make,
            }))}
          />
        }
      />
      {make === "carousel" ? (
        <CarouselBox demo={props.demo} only={only} made={made} />
      ) : make === "story" ? (
        <StoryBox demo={props.demo} only={only} made={made} />
      ) : make === "blog" ? (
        <BlogBox
          demo={props.demo}
          from={about?.from ?? null}
          {...(about ? { fromTitle: about.title } : {})}
        />
      ) : make === "video" ? (
        <Section>
          <p className={cx("m-0 max-w-[70ch] text-[13.5px]", QUIET)}>
            A video starts from a recording. Record with OBS or Cap on the Mac. It shows in Studio's
            videos a minute after you stop, and the editor cuts it for you to review.
          </p>
        </Section>
      ) : (
        <PostBox {...props} thread={make === "thread"} onSent={made} />
      )}
      {sent && make !== "post" && make !== "thread" ? (
        <p className="mt-4 text-[13.5px]">
          <a href={back}>Back to Studio</a>
        </p>
      ) : null}
    </>
  );
}

/** A post: one, a batch split on `---`, or an X thread. */
function PostBox(
  props: PageProps & {
    only: Platform | null;
    lines: readonly MetroLine[];
    thread: boolean;
    onSent: () => void;
  },
) {
  const { thread, only } = props;
  // Feed's Use as idea opens here with the post it came from.
  // What he types stays on the device until it's sent: a reload or a closed tab gives it back.
  const idea = props.params.get("idea") ?? "";
  const form = useEditForm({
    key: "studio:new",
    defaults: { text: idea, title: "", line: "", angle: "" },
    base: idea,
  });
  const { text, title, line, angle } = form.watch();
  // A platform chip on top picks it alone; a video platform's posts start in Videos.
  const [picked, setPicked] = useState<Platform[]>(["linkedin", "x"]);
  useEffect(() => {
    setPicked(only && TEXT.includes(only) ? [only] : ["linkedin", "x"]);
  }, [only]);
  const [adapt, setAdapt] = useState(false);
  const [busy, setBusy] = useState<Go | null>(null);
  const [sure, setSure] = useState(false);
  // Words changed after "Post now?": ask again.
  const { watch } = form;
  useEffect(() => {
    const sub = watch((_, { name }) => {
      if (name === "text") setSure(false);
    });
    return () => sub.unsubscribe();
  }, [watch]);
  const [said, setSaid] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const about = fromOf(props.params);

  const posts = thread ? (text.trim() ? [text] : []) : splitPosts(text);
  const batch = !thread && posts.length > 1;
  const titled = picked.some((p) => PLATFORM_SPECS[p].title && !PLATFORM_SPECS[p].words);
  const where: Platform[] = thread ? ["x"] : picked;
  const versions = posts.map((p) =>
    where.map((platform) => ({
      platform,
      v: thread ? ownThreadOf(p) : ownDraftOf(platform, p, batch ? null : title),
    })),
  );
  const ai = adapt && !thread;
  const fits = ai || versions.some((post) => post.some(({ v }) => !("reason" in v)));
  const count = ai
    ? posts.length * where.length
    : versions.flat().filter(({ v }) => !("reason" in v)).length;
  const unfit = where.filter((p) =>
    versions.some((post) => post.some((x) => x.platform === p && "reason" in x.v)),
  );

  const send = async (go: Go) => {
    if (go === "now" && !sure) {
      setSure(true);
      return;
    }
    setSure(false);
    setBusy(go);
    setError(null);
    setSaid([]);
    try {
      const out = await desk<{ posts: { results: WriteResult[] }[] }>("write", {
        text,
        platforms: where,
        ...(title && !batch && !thread ? { title } : {}),
        ...(ai ? { adapt: true } : {}),
        ...(thread ? { thread: true } : {}),
        ...(about ? { from: about.from } : {}),
        go,
      });
      setSaid(summary(out.posts, go));
      form.forget();
      props.onSent();
      // Sent: the idea it opened with is spent too.
      if (idea) navigate(href("/content/studio", { idea: "" }, props.params), true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };
  const off = !fits || !!busy || props.demo || where.length === 0;
  const pick = (name: "line" | "angle", value: string, now: string) =>
    form.setValue(name, now === value ? "" : value, { shouldDirty: true });
  const back = href("/content/studio", { make: "", idea: "", from: "", about: "" }, props.params);

  return (
    <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-4">
        {props.lines.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cx(EYEBROW, "mr-1")}>Line</h2>
            {props.lines.map((l) => (
              <Chip key={l.id} on={line === l.id} onClick={() => pick("line", l.id, line)}>
                <LineMark line={l} />
                {l.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {about ? (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13.5px]">
            <span className={QUIET}>About:</span>
            <a href={`/content/videos/${about.id}`}>{about.title}</a>
            <Button
              size="dense"
              tone="quiet"
              onClick={() =>
                navigate(href("/content/studio", { from: "", about: "" }, props.params), true)
              }
            >
              Clear
            </Button>
          </p>
        ) : null}
        <EditConflict
          what="The post"
          conflict={form.conflict ? { mine: form.conflict.mine.text ?? "", theirs: idea } : null}
          onKeepMine={form.keepMine}
          onTakeTheirs={form.takeTheirs}
        />
        <div className="overflow-hidden border border-(--ui-hair) bg-(--ui-paper) [border-radius:var(--ui-leaf-panel)]">
          {thread ? null : (
            <div className="flex flex-wrap items-center gap-2 border-(--ui-hair) border-b px-4 py-2.5">
              <span className={cx("mr-1 text-[12.5px]", QUIET)}>Angle</span>
              {ANGLES.map((a) => (
                <Chip key={a} on={angle === a} onClick={() => pick("angle", a, angle)}>
                  {a}
                </Chip>
              ))}
            </div>
          )}
          <TextAreaField
            form={form}
            name="text"
            aria-label="Your post"
            rows={batch ? 14 : 10}
            box="min-h-[220px] rounded-none border-0 px-4 py-3 text-[15px] leading-[1.55] shadow-none focus-visible:ring-0"
            placeholder={
              thread
                ? `Your thread, ${THREAD_MIN} to ${THREAD_MAX} posts. Put a line of --- between posts.`
                : "What do you want to say? For several posts, put a line of --- between them."
            }
            disabled={props.demo}
          />
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-(--ui-hair) border-t px-4 py-2.5 text-[12.5px] text-(--ui-ink-2)">
            <span className="tabular-nums">
              <b className="font-semibold text-(--ui-ink)">{text.length}</b> chars
            </span>
            {batch ? <span>{posts.length} posts</span> : null}
            {posts.length && !ai ? (
              <span
                className={cx(
                  "inline-flex items-center gap-1.5",
                  unfit.length ? "text-(--ui-bad)" : "",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "size-1.5 rounded-full",
                    unfit.length ? "bg-(--ui-bad)" : "bg-(--ui-good)",
                  )}
                />
                {unfit.length
                  ? `Doesn't fit ${unfit.map(targetOf).join(", ")}`
                  : thread
                    ? "Fits as a thread"
                    : "Fits every picked platform"}
              </span>
            ) : null}
          </p>
        </div>
        {titled && !batch && !adapt && !thread ? (
          <TextField
            form={form}
            name="title"
            aria-label="Reddit title"
            placeholder="Reddit title (else your first line)"
          />
        ) : null}
        {thread ? null : (
          <label className={cx("flex items-center gap-2 text-[13.5px]", QUIET)}>
            <input type="checkbox" checked={adapt} onChange={(e) => setAdapt(e.target.checked)} />
            AI writes each platform's version
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="primary" size="dense" disabled={off} onClick={() => void send("slot")}>
            {busy === "slot" ? "Scheduling…" : "Approve and slot"}
          </Button>
          <Button size="dense" tone="secondary" disabled={off} onClick={() => void send("now")}>
            {busy === "now" ? "Posting…" : sure ? `Post ${count} now?` : "Post now"}
          </Button>
          {sure ? (
            <Button size="dense" tone="quiet" onClick={() => setSure(false)}>
              Cancel
            </Button>
          ) : null}
          <Button size="dense" tone="quiet" disabled={off} onClick={() => void send("draft")}>
            {busy === "draft" ? "Saving…" : "Save draft"}
          </Button>
        </div>
        {said.length ? (
          <div className="grid gap-1 text-[14px]">
            <ul className="m-0 grid list-none gap-1 p-0">
              {said.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <a href={back}>Back to Studio</a>
          </div>
        ) : null}
        {error ? <p className={ERROR}>{error}</p> : null}
      </div>

      <aside aria-label="Side by side" className="grid min-w-0 gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={EYEBROW}>Side by side</h2>
          {thread ? null : (
            <span className={cx("text-[12.5px]", QUIET)}>
              {picked.length} of {TEXT.length} platforms
            </span>
          )}
        </div>
        {thread ? (
          posts[0] ? (
            <ThreadPreview text={posts[0]} />
          ) : (
            <p className={cx("m-0 text-[13.5px]", QUIET)}>The thread shows here as it will post.</p>
          )
        ) : (
          TEXT.map((p) => (
            <PlatformCard
              key={p}
              platform={p}
              on={picked.includes(p)}
              toggle={() =>
                setPicked((now) => (now.includes(p) ? now.filter((x) => x !== p) : [...now, p]))
              }
              ai={adapt}
              versions={
                posts.length ? versions.map((post) => post.find((x) => x.platform === p)?.v) : []
              }
            />
          ))
        )}
      </aside>
    </div>
  );
}

/** One platform's version of what's typed: pick it, see how it fits, read it as it will post. */
function PlatformCard({
  platform,
  on,
  toggle,
  ai,
  versions,
}: {
  platform: Platform;
  on: boolean;
  toggle: () => void;
  ai: boolean;
  versions: (ReturnType<typeof ownDraftOf> | undefined)[];
}) {
  const max = PLATFORM_SPECS[platform].maxChars;
  const shown = versions.filter((v): v is NonNullable<typeof v> => !!v);
  const bad = shown.filter((v) => "reason" in v);
  const first = shown[0];
  return (
    <div
      className={cx(
        "grid content-start gap-2 border border-(--ui-hair) bg-(--ui-paper) p-3 [border-radius:var(--ui-leaf-panel)]",
        !on && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-[13.5px]">
          <input type="checkbox" checked={on} onChange={toggle} />
          <PlatformMark mark={platform} size={16} />
          <b className="truncate font-semibold">{targetOf(platform)}</b>
        </label>
        {on && shown.length && !ai ? (
          <span
            className={cx(
              "text-[12px] [font-variant-numeric:tabular-nums]",
              bad.length ? "text-(--ui-bad)" : "text-(--ui-good-ink)",
            )}
          >
            {bad.length
              ? "Doesn't fit"
              : first && !("reason" in first)
                ? `Fits · ${first.text.length} / ${max}`
                : "Fits"}
          </span>
        ) : null}
      </div>
      {!on ? null : ai ? (
        <p className={cx("m-0 text-[13px]", QUIET)}>Wren writes this version when you send.</p>
      ) : shown.length === 0 ? (
        <p className={cx("m-0 text-[13px]", QUIET)}>Your words show here as they will post.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {shown.map((v, n) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a post's place in the batch is its name.
              key={n}
              className="grid gap-1"
            >
              {"reason" in v ? (
                <p className={cx(ERROR, "m-0")}>{sentence(v.reason)}</p>
              ) : (
                <>
                  {v.title ? <b className="text-[14px]">{v.title}</b> : null}
                  <p className="m-0 line-clamp-6 text-[13.5px] leading-[1.5] whitespace-pre-wrap">
                    {v.text}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An X thread as it will post: each post with its count, or why it can't go yet. */
function ThreadPreview({ text }: { text: string }) {
  const posts = threadPosts(text);
  const v = ownThreadOf(text);
  return (
    <div className="grid gap-2">
      {"reason" in v ? <p className={ERROR}>{sentence(v.reason)}</p> : null}
      <ol className="m-0 grid list-none gap-2 p-0">
        {posts.map((post, n) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a post's place in the thread is its name.
            key={n}
            className="grid gap-1.5 border border-(--ui-hair) bg-(--ui-paper) p-3 [border-radius:var(--ui-leaf-panel)]"
          >
            <div className="flex items-center justify-between gap-2">
              <Tag>
                {n + 1} of {posts.length}
              </Tag>
              <span
                className={cx(
                  "text-[12px] [font-variant-numeric:tabular-nums]",
                  post.length > X_POST_MAX ? "text-(--ui-bad)" : QUIET,
                )}
              >
                {post.length} / {X_POST_MAX}
              </span>
            </div>
            <p className="m-0 text-[14px] leading-[1.5] whitespace-pre-wrap">{post}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
