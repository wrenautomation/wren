/**
 * Marketing → Studio (designs/2026-10-14-saving-and-ui-audit.md): where content gets made. It
 * opens on what the plan still asks for this week, then New: a post in his own words (one or a
 * batch, on the platforms he picks, each platform's version checked as he types by the server's
 * own rules in `@wren/content/write`), an X thread, a carousel, a story, a blog post, or a video
 * (from a recording). Under it, every draft that waits, its platforms side by side: edit in place,
 * rewrite with a note, approve, post now, or open it in the draft's editor. Write's old address
 * lands here (`WritePage`). Wren's own: ContentDesk through the console.
 */

import { ownDraftOf, ownThreadOf, PLATFORM_SPECS, splitPosts } from "@wren/content/write";
import { PLATFORMS, type Platform } from "@wren/core/content";
import { THREAD_MAX, THREAD_MIN, threadPosts, X_POST_MAX } from "@wren/core/content/thread";
import {
  ACTIONS,
  Button,
  cx,
  DeviceFrame,
  EditConflict,
  Empty,
  FeedPost,
  Input,
  KeptConflict,
  LoadFailed,
  Loading,
  PageHeader,
  type Patch,
  PHONE_WIDTH,
  PlatformMark,
  patchRecord,
  SaveConflict,
  SaveStatus,
  Section,
  Tag,
  Textarea,
  useEdit,
  useKeptForm,
  useSaved,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api.js";
import { patchCalls, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { wrenRecords } from "../../records.js";
import { href, navigate } from "../../route.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";
import { DRAFT_SET } from "./ask.js";
import { BlogBox } from "./blog-box.js";
import { CarouselBox } from "./carousel-box.js";
import { contentDesk, deskCall } from "./desk.js";
import { goalsOf, MakeList, toMakeLine, usePlan } from "./plan.js";
import { StoryBox } from "./story-box.js";
import { StudioVideo, VideoShelf } from "./video-shelf.js";

/** The platforms that post words alone (YouTube as a community post); videos start from a recording. */
const TEXT = PLATFORMS.filter((p) => !PLATFORM_SPECS[p].needsMedia || PLATFORM_SPECS[p].words);
const nameOf = (p: Platform) => PLATFORM_SPECS[p].name;
/** What a words post is there: "YouTube post" for YouTube. */
const targetOf = (p: Platform) => PLATFORM_SPECS[p].words?.name ?? nameOf(p);
/**
 * What a post is about (`?from=video:<id>`, Studio's "Write a post about it"): it hangs under that
 * video in Pieces. `?about=` carries the title for the line that says so.
 */
const fromOf = (params: URLSearchParams): { from: string; id: string; title: string } | null => {
  const id = /^video:(\d+)$/.exec(params.get("from") ?? "")?.[1];
  return id ? { from: `video:${id}`, id, title: params.get("about") || `Video ${id}` } : null;
};
/** The platform chip on top (`?platform=`), when it's one Wren posts to. */
const chosen = (params: URLSearchParams): Platform | null => {
  const p = params.get("platform");
  return PLATFORMS.find((x) => x === p) ?? null;
};

type Make = "post" | "thread" | "carousel" | "story" | "blog" | "video";
interface MakeKind {
  id: Make;
  name: string;
  /** Where it goes, in a few words. */
  where: string;
  /** Whether it goes to this platform. */
  on: (p: Platform) => boolean;
}
/** What Studio makes, in the order he reaches for them. */
const MAKES: readonly MakeKind[] = [
  {
    id: "post",
    name: "Post",
    where: TEXT.map(targetOf).join(", "),
    on: (p) => TEXT.includes(p),
  },
  {
    id: "thread",
    name: "Thread",
    where: `X, ${THREAD_MIN} to ${THREAD_MAX} posts`,
    on: (p) => p === "x",
  },
  {
    id: "carousel",
    name: "Carousel",
    where: "Instagram, LinkedIn",
    on: (p) => p === "instagram" || p === "linkedin",
  },
  {
    id: "story",
    name: "Story",
    where: "Instagram, Facebook",
    on: (p) => p === "instagram" || p === "facebook",
  },
  { id: "blog", name: "Blog post", where: "The site, then email", on: () => false },
  {
    id: "video",
    name: "Video",
    where: "From a recording: YouTube, Shorts, Reels, TikTok",
    on: (p) => !!PLATFORM_SPECS[p].needsMedia,
  },
];
const offeredFor = (only: Platform | null) => MAKES.filter((m) => !only || m.on(only));
const makeOf = (params: URLSearchParams): Make | null => {
  const m = params.get("make");
  if (MAKES.some((k) => k.id === m)) return m as Make;
  if (params.has("blog")) return "blog";
  if (params.has("story")) return "story";
  return null;
};
/** The asked kind when it's offered, else the first offered. */
const pick = (asked: Make | null, offered: readonly MakeKind[]): Make =>
  offered.find((m) => m.id === asked)?.id ?? offered[0]?.id ?? "post";

/**
 * Write's old address in Studio's terms: `?blog=1` and `?story=1` become `?make=`; the rest
 * (`from`, `about`, `platform`, `idea`) rides along.
 */
export function studioHref(params: URLSearchParams): string {
  const q = new URLSearchParams(params);
  for (const kind of ["blog", "story"] as const)
    if (q.has(kind)) {
      q.delete(kind);
      if (!q.has("make")) q.set("make", kind);
    }
  const rest = q.toString();
  return `/marketing/studio${rest ? `?${rest}` : ""}`;
}

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

/** What he's making: a card each, the one picked outlined. */
function MakePicker({
  offered,
  make,
  pick: choose,
}: {
  offered: readonly MakeKind[];
  make: Make;
  pick: (m: Make) => void;
}) {
  const card =
    "grid min-w-0 content-start gap-0.5 rounded-(--ui-radius) border bg-(--ui-bg) px-3.5 py-2.5 text-left no-underline transition-colors duration-150 hover:bg-(--ui-hover)";
  return (
    <nav
      aria-label="What you're making"
      className="mb-5 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]"
    >
      {offered.map((m) => {
        const inner = (
          <>
            <span className="font-semibold text-[14.5px] text-(--ui-ink)">{m.name}</span>
            <span className={cx("text-[12.5px] leading-snug", QUIET)}>{m.where}</span>
          </>
        );
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={make === m.id}
            onClick={() => choose(m.id)}
            className={cx(
              card,
              "cursor-pointer",
              make === m.id
                ? "border-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-ink)]"
                : "border-(--ui-hair)",
            )}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

type Go = "draft" | "slot" | "now";
interface WriteResult {
  platform: Platform;
  draftId: string | null;
  reason: string | null;
  at?: string | null;
  held?: string;
}
interface Waiting {
  ideaId: string;
  idea: string;
  drafts: {
    id: string;
    platform: Platform;
    text: string;
    title: string | null;
    state: string;
    error: string | null;
    edited: boolean;
    own: boolean;
    story?: boolean;
    carousel?: boolean;
    thread?: boolean;
    missing?: string[];
  }[];
}

const desk = <T,>(handler: string, input: Record<string, unknown>, requestId?: string) =>
  contentDesk<T>(handler, requestId ? { ...input, requestId } : input);
const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** What the answer says, one line: saved, scheduled, posting, and what didn't go. */
function summary(posts: { results: WriteResult[] }[], go: Go): string[] {
  const all = posts.flatMap((p) => p.results);
  const made = all.filter((r) => r.draftId && !r.held);
  const lines = [
    made.length === 0
      ? "Nothing was made."
      : go === "draft"
        ? `${made.length} saved as drafts. They wait below.`
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

export function StudioPage(props: PageProps) {
  // A video opened from the shelf: its editor takes the page, Studio is one link back.
  const video = props.params.get("video");
  if (video) return <StudioVideo key={video} {...props} id={video} />;
  return <StudioHome {...props} />;
}

function StudioHome(props: PageProps) {
  // Feed's Use as idea opens here with the post it came from.
  // What he types stays on the device until it's sent: a reload or a closed tab gives it back.
  const idea = props.params.get("idea") ?? "";
  const kept = useKeptForm("studio:new", idea);
  const text = kept.values.text ?? idea;
  const title = kept.values.title ?? "";
  const setText = (t: string) => kept.set("text", t);
  const setTitle = (t: string) => kept.set("title", t);
  // A platform chip on top picks it alone; a video platform's posts start in Videos.
  const only = chosen(props.params);
  const [picked, setPicked] = useState<Platform[]>(["linkedin", "x"]);
  useEffect(() => {
    setPicked(only && TEXT.includes(only) ? [only] : ["linkedin", "x"]);
  }, [only]);
  const [adapt, setAdapt] = useState(false);
  const [busy, setBusy] = useState<Go | null>(null);
  const [sure, setSure] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const about = fromOf(props.params);

  // What he's making: the picker on top, or Plan's links (?make=, ?blog=1, ?story=1).
  const offered = offeredFor(only);
  const asked = makeOf(props.params);
  const [make, setMake] = useState<Make>(() => pick(asked, offered));
  useEffect(() => {
    setMake(pick(asked, offeredFor(only)));
  }, [asked, only]);
  const made = () => setNonce((n) => n + 1);

  const thread = make === "thread";
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
      kept.clear();
      // Sent: the idea it opened with is spent too.
      if (idea) navigate(href("/marketing/studio", { idea: "" }, props.params), true);
      setNonce((n) => n + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Studio" lede="Make something new, or finish what waits on you." />
      <ToMake />
      <VideoShelf params={props.params} />
      <Section title="New">
        <MakePicker offered={offered} make={make} pick={setMake} />
      </Section>
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
            A video starts from a recording. Record with OBS or Cap on the Mac. It shows in Videos
            above a minute after you stop, and the editor cuts it for you to review.
          </p>
        </Section>
      ) : (
        <>
          <Section>
            <div className="grid gap-3">
              {about ? (
                <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                  <span className={QUIET}>About:</span>
                  <a href={`/marketing/videos/${about.id}`}>{about.title}</a>
                  <Button
                    size="dense"
                    tone="quiet"
                    onClick={() =>
                      navigate(
                        href("/marketing/studio", { from: "", about: "" }, props.params),
                        true,
                      )
                    }
                  >
                    Clear
                  </Button>
                </p>
              ) : null}
              <KeptConflict kept={kept} field="text" what="The post" />
              <Textarea
                aria-label="Your post"
                data-edit={kept.key ?? ""}
                rows={batch ? 14 : 8}
                value={text}
                placeholder={
                  thread
                    ? `Your thread, ${THREAD_MIN} to ${THREAD_MAX} posts. Put a line of --- between posts.`
                    : "What do you want to say? For several posts, put a line of --- between them."
                }
                disabled={props.demo}
                onChange={(e) => {
                  setText(e.target.value);
                  setSure(false);
                }}
              />
              {thread ? null : (
                <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
                  <legend className="sr-only">Platforms</legend>
                  {TEXT.map((p) => {
                    const on = picked.includes(p);
                    return (
                      <Button
                        key={p}
                        size="dense"
                        tone={on ? "primary" : "secondary"}
                        aria-pressed={on}
                        onClick={() =>
                          setPicked((now) => (on ? now.filter((x) => x !== p) : [...now, p]))
                        }
                      >
                        {targetOf(p)}
                      </Button>
                    );
                  })}
                  <label className={cx("ml-2 flex items-center gap-2 text-[13.5px]", QUIET)}>
                    <input
                      type="checkbox"
                      checked={adapt}
                      onChange={(e) => setAdapt(e.target.checked)}
                    />
                    AI writes each platform's version
                  </label>
                </fieldset>
              )}
              {titled && !batch && !adapt && !thread ? (
                <Input
                  aria-label="Reddit title"
                  data-edit={kept.key ?? ""}
                  value={title}
                  placeholder="Reddit title (else your first line)"
                  onChange={(e) => setTitle(e.target.value)}
                />
              ) : null}
            </div>
          </Section>

          {thread && posts[0] ? (
            <Section title="How it reads">
              <ThreadPreview text={posts[0]} />
            </Section>
          ) : posts.length > 0 && picked.length > 0 && !adapt ? (
            <Section title={batch ? `${posts.length} posts` : "How it reads"}>
              <div className="grid gap-4">
                {versions.map((post, n) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: a post's place in the batch is its name.
                    key={n}
                    className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]"
                  >
                    {post.map(({ platform, v }) => (
                      <Version key={platform} platform={platform} v={v} />
                    ))}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section>
            <div className={TOOLS}>
              <Button
                size="dense"
                tone="secondary"
                disabled={!fits || !!busy || props.demo || where.length === 0}
                onClick={() => void send("draft")}
              >
                {busy === "draft" ? "Saving…" : "Save as drafts"}
              </Button>
              <Button
                size="dense"
                tone="secondary"
                disabled={!fits || !!busy || props.demo || where.length === 0}
                onClick={() => void send("slot")}
              >
                {busy === "slot" ? "Scheduling…" : "Schedule"}
              </Button>
              <Button
                tone="primary"
                size="dense"
                disabled={!fits || !!busy || props.demo || where.length === 0}
                onClick={() => void send("now")}
              >
                {busy === "now" ? "Posting…" : sure ? `Post ${count} now?` : "Post now"}
              </Button>
              {sure ? (
                <Button size="dense" tone="quiet" onClick={() => setSure(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
            {said.length ? (
              <ul className="mt-3 grid list-none gap-1 p-0 text-[14px]">
                {said.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : null}
            {error ? <p className={ERROR}>{error}</p> : null}
          </Section>
        </>
      )}
      <WaitingBoard {...props} nonce={nonce} />
    </>
  );
}

/** "a thread is 3 to 7 posts" as a sentence. */
const sentence = (s: string) =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
const listed = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** What the plan still asks for this week, each with where it gets made. */
function ToMake() {
  const load = usePlan();
  const goals = goalsOf(load.data?.rows);
  if (load.data && goals.length === 0) return null;
  return (
    <Section title="To make" note={load.data ? toMakeLine(goals) : undefined}>
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={3} />
      ) : (
        <MakeList goals={goals} reload={load.retry} />
      )}
    </Section>
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
            className="grid gap-1.5 rounded-(--ui-radius) bg-(--ui-paper) p-3 shadow-[inset_0_0_0_1px_var(--ui-hair)]"
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

/** One platform's version of what's typed: the words as they'll post, or why not. */
function Version({ platform, v }: { platform: Platform; v: ReturnType<typeof ownDraftOf> }) {
  const max = PLATFORM_SPECS[platform].maxChars;
  return (
    <div className="grid content-start gap-2 rounded-(--ui-radius) bg-(--ui-paper) p-3 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
      <div className="flex items-center justify-between gap-2">
        <Tag>{targetOf(platform)}</Tag>
        {"reason" in v ? null : (
          <span className={cx("text-[12px] [font-variant-numeric:tabular-nums]", QUIET)}>
            {v.text.length} / {max}
          </span>
        )}
      </div>
      {"reason" in v ? (
        <p className={ERROR}>{sentence(v.reason)}</p>
      ) : (
        <>
          {v.title ? <b className="text-[14px]">{v.title}</b> : null}
          <p className="m-0 line-clamp-[12] text-[14px] leading-[1.5] whitespace-pre-wrap">
            {v.text}
          </p>
        </>
      )}
    </div>
  );
}

/** Every draft that waits on a yes, an idea a row, its platforms side by side. */
function WaitingBoard(props: PageProps & { nonce: number }) {
  // One key for every read: a reload replaces the kept answer, never adds a new one.
  const load = useCall("studio-waiting", () => desk<{ ideas: Waiting[] }>("waiting", {}));
  const reload = load.retry;
  // Something made above: read the board again.
  const made = useRef(props.nonce);
  useEffect(() => {
    if (made.current === props.nonce) return;
    made.current = props.nonce;
    reload();
  }, [props.nonce, reload]);
  const only = chosen(props.params);
  const ideas = load.data?.ideas
    .map((i) => ({ ...i, drafts: i.drafts.filter((d) => !only || d.platform === only) }))
    .filter((i) => i.drafts.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = ideas?.flatMap((i) => i.drafts.map((d) => d.id)) ?? [];
  const [flushers] = useState<Flushers>(() => new Set());

  const all = async () => {
    setBusy(true);
    setError(null);
    try {
      // Every card's typing lands before the yes reads it.
      const saved = await Promise.all([...flushers].map((f) => f()));
      if (saved.includes(false)) throw new Error("A draft didn't save. Fix it, then try again.");
      await ACTIONS.run(`studio:all:${ids.join(",")}`, (requestId) =>
        desk("approve", { ids }, requestId),
      );
      reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Waiting on you"
      note={ids.length ? `${ids.length} drafts` : undefined}
      actions={
        ids.length > 1 ? (
          <Button
            size="dense"
            tone="secondary"
            disabled={busy || props.demo}
            onClick={() => void all()}
          >
            Schedule all
          </Button>
        ) : undefined
      }
    >
      {load.error && !ideas ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !ideas ? (
        <Loading lines={4} />
      ) : ideas.length === 0 ? (
        <Empty>{only ? `No ${nameOf(only)} draft waits on you.` : "No draft waits on you."}</Empty>
      ) : (
        <ul className="m-0 grid list-none gap-6 p-0">
          {ideas.map((idea) => (
            <li key={idea.ideaId} className="grid gap-2">
              <p className={cx("m-0 line-clamp-2 text-[13px]", QUIET)}>{idea.idea}</p>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                {idea.drafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    d={d}
                    at={load.at}
                    demo={props.demo}
                    flushers={flushers}
                    onDone={reload}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className={ERROR}>{error}</p> : null}
    </Section>
  );
}

type Act = "approve" | "now" | "rewrite" | "reject";
/** Each card's flush, so a yes on the whole board saves every card's typing first. */
type Flushers = Set<() => Promise<boolean>>;

/** The board's answer with one draft's words as the server now holds them. */
const wroteWords =
  (id: string, text: string): Patch =>
  (key, data) => {
    if (!key.startsWith("studio-waiting:") || !data || typeof data !== "object") return data;
    const ideas = (data as { ideas?: Waiting[] }).ideas;
    if (!ideas?.some((i) => i.drafts.some((x) => x.id === id))) return data;
    return {
      ...data,
      ideas: ideas.map((i) => ({
        ...i,
        drafts: i.drafts.map((x) => (x.id === id ? { ...x, text, edited: true } : x)),
      })),
    };
  };

/** One waiting draft: its words to edit in place, and what can be done with it. */
function DraftCard({
  d,
  at,
  demo,
  flushers,
  onDone,
}: {
  d: Waiting["drafts"][number];
  /** When the board's read left: an older read never lands over his typing. */
  at: number;
  demo: boolean;
  flushers: Flushers;
  onDone: () => void;
}) {
  // The same journal and save as the draft's own page (DraftBox): typing there or here is one
  // draft's words, saved a pause after the last key, never per key, and never read back.
  const savedKey = d.story ? null : `draft:${DRAFT_SET}:${d.id}`;
  const s = useSaved<string>({
    key: savedKey,
    server: d.text,
    at,
    same: (a, b) => a.trim() === b.trim(),
    save: async (words, { expect, request }) => {
      const text = words.trim();
      const from = String(expect ?? "");
      const out = await deskCall<{ version?: string | null } | null>("DraftAsk", "set", {
        record: "draft",
        id: d.id,
        text,
        expect: from.trim() ? from : null,
        requestId: request,
      });
      return { value: text, version: out?.version ?? null };
    },
    onSaved: (text, { version }) => {
      patchCalls(wroteWords(d.id, text));
      // Drafts and To approve hold the same words and version: a yes there names these.
      patchRecord(wrenRecords("marketing"), "marketing.draft", d.id, {
        text,
        ...(version ? { version } : {}),
      });
    },
    onConflict: onDone,
  });
  useEffect(() => {
    flushers.add(s.flush);
    return () => void flushers.delete(s.flush);
  }, [flushers, s.flush]);
  const text = s.value;
  // What to change, kept until the rewrite goes: another page and back gives it again.
  const note = useEdit(`draft:${d.id}:rewrite-note`, "");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<Act | null>(null);
  const [error, setError] = useState<string | null>(null);
  const max = PLATFORM_SPECS[d.platform].maxChars;
  // The same check the yes runs: a thread's posts, else the platform's length.
  const unfit = d.thread
    ? (() => {
        const v = ownThreadOf(text);
        return "reason" in v ? sentence(v.reason) : null;
      })()
    : null;
  const missing = d.missing ?? [];
  // The card leads with the post as a phone's feed shows it; the words open under it.
  const looks = !d.story && !d.carousel;
  const [editing, setEditing] = useState(false);
  const open = !looks || editing || s.dirty || !!s.conflict || !!unfit || text.length > max;

  const act = async (what: Act) => {
    setBusy(what);
    setError(null);
    const sent = note.value;
    try {
      // Every act reads the saved words: his typing lands first, or nothing goes on.
      if (!(await s.flush())) {
        setBusy(null);
        return;
      }
      // One press, one act: a second press while it's out gets the first's answer.
      await ACTIONS.run(`studio:${what}:${d.id}`, (requestId) =>
        what === "rewrite"
          ? desk("redraft", { draftId: d.id, note: note.value }, requestId)
          : what === "reject"
            ? desk("reject", { ids: [d.id] }, requestId)
            : desk("approve", { ids: [d.id], now: what === "now" }, requestId),
      );
      if (what === "rewrite") {
        note.saved(sent);
        setAsking(false);
      }
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(null);
    }
  };

  return (
    <div className="grid content-start gap-2 rounded-(--ui-radius) bg-(--ui-paper) p-3 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <PlatformMark mark={d.platform} size={16} />
          <span className="text-[13.5px] font-semibold">{nameOf(d.platform)}</span>
          {d.state === "failed" ? <Tag tone="warn">Failed</Tag> : null}
          {d.story ? (
            <Tag tone="accent">Story</Tag>
          ) : d.carousel ? (
            <Tag tone="accent">Carousel</Tag>
          ) : d.thread ? (
            <Tag tone="accent">Thread</Tag>
          ) : d.own ? (
            <Tag tone="accent">Yours</Tag>
          ) : d.edited ? (
            <Tag>Edited</Tag>
          ) : null}
        </span>
        {d.story ? null : d.thread ? (
          <span className={cx("text-[12px] [font-variant-numeric:tabular-nums]", QUIET)}>
            {threadPosts(text).length} posts
          </span>
        ) : (
          <span
            className={cx(
              "text-[12px] [font-variant-numeric:tabular-nums]",
              text.length > max ? "text-(--ui-bad)" : QUIET,
            )}
          >
            {text.length} / {max}
          </span>
        )}
      </div>
      {looks ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit the ${nameOf(d.platform)} draft`}
          className="block w-full cursor-text border-0 bg-transparent p-0 text-left"
        >
          <DeviceFrame width={PHONE_WIDTH}>
            <FeedPost
              from="Wren Automation"
              title={d.title}
              body={d.thread ? (threadPosts(text)[0] ?? text) : text}
              lines={PLATFORM_SPECS[d.platform].feed.phone}
              size={15}
            />
          </DeviceFrame>
        </button>
      ) : d.title ? (
        <b className="text-[14px]">{d.title}</b>
      ) : null}
      {d.story ? (
        <p className={cx("m-0 text-[13.5px]", QUIET)}>
          A story: the photo or clip goes as is, with no words.
        </p>
      ) : !open ? (
        <Button size="dense" tone="quiet" className="w-fit" onClick={() => setEditing(true)}>
          Edit the words
        </Button>
      ) : (
        <>
          <Textarea
            aria-label={`${nameOf(d.platform)} draft`}
            data-edit={savedKey ?? ""}
            rows={Math.min(14, Math.max(4, Math.ceil(text.length / 48)))}
            value={text}
            disabled={demo || !!busy}
            onChange={(e) => s.set(e.target.value)}
            onBlur={() => void s.flush()}
          />
          <SaveStatus state={s} onRetry={s.retry} />
          {s.conflict ? (
            <SaveConflict
              conflict={s.conflict}
              onKeepMine={s.keepMine}
              onTakeTheirs={s.takeTheirs}
            />
          ) : null}
        </>
      )}
      {unfit ? <p className={ERROR}>{unfit}</p> : null}
      {missing.length ? (
        <p className={ERROR}>
          Fill in {listed(missing)} before Approve.{" "}
          <a href={`/marketing/drafts/${d.id}`}>Open it</a> to pick.
        </p>
      ) : null}
      <a className="text-[13px]" href={`/marketing/drafts/${d.id}`}>
        {d.carousel
          ? "Open the slides, fields and versions"
          : "Open for fields, media and versions"}
      </a>
      {d.error ? <p className={ERROR}>{d.error}</p> : null}
      {asking || note.dirty ? (
        <div className="grid gap-2">
          <Input
            aria-label="What to change"
            {...note.field}
            placeholder="What to change: shorter, lead with the number…"
          />
          <EditConflict
            what="The note"
            conflict={note.conflict}
            onKeepMine={note.keepMine}
            onTakeTheirs={note.takeTheirs}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="dense"
              disabled={!note.value.trim() || !!busy}
              onClick={() => void act("rewrite")}
            >
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </Button>
            <Button
              size="dense"
              tone="quiet"
              onClick={() => {
                note.discard();
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            tone="primary"
            size="dense"
            disabled={!!busy || demo}
            onClick={() => void act("approve")}
          >
            {busy === "approve" ? "Scheduling…" : "Schedule"}
          </Button>
          <Button
            size="dense"
            tone="secondary"
            disabled={!!busy || demo}
            onClick={() => void act("now")}
          >
            {busy === "now" ? "Posting…" : "Post now"}
          </Button>
          {d.story || d.carousel ? null : (
            <Button
              size="dense"
              tone="quiet"
              disabled={!!busy || demo}
              onClick={() => setAsking(true)}
            >
              Rewrite with AI
            </Button>
          )}
          <Button
            size="dense"
            tone="quiet"
            disabled={!!busy || demo}
            onClick={() => void act("reject")}
          >
            {busy === "reject" ? "Dropping…" : "Drop"}
          </Button>
        </div>
      )}
      {error ? <p className={ERROR}>{error}</p> : null}
    </div>
  );
}
