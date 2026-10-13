/**
 * Marketing → Write: posts in his own words, one or a batch, on the platforms he picks. Each
 * platform's version shows as he types, checked by the server's own rules (`@wren/content/write`).
 * Save as drafts, schedule at the next slots, or post on the next pass. Under it, every draft that
 * waits, its platforms side by side: edit in place, rewrite with a note, approve or post now.
 * Wren's own: ContentDesk through the console.
 */

import { ownDraftOf, PLATFORM_SPECS, splitPosts } from "@wren/content/write";
import { PLATFORMS, type Platform } from "@wren/core/content";
import {
  Button,
  cx,
  Empty,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  Tag,
  Textarea,
} from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";

/** The platforms that post words alone; video and images go through Videos. */
const TEXT = PLATFORMS.filter((p) => !PLATFORM_SPECS[p].needsMedia);
const nameOf = (p: Platform) => PLATFORM_SPECS[p].name;
/** The platform chip on top (`?platform=`), when it's one Wren posts to. */
const chosen = (params: URLSearchParams): Platform | null => {
  const p = params.get("platform");
  return PLATFORMS.find((x) => x === p) ?? null;
};

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
  }[];
}

const desk = <T,>(handler: string, input: Record<string, unknown>) =>
  call<T>("console/call", { service: "ContentDesk", handler, key: "default", input });
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
              .map((r) => `${nameOf(r.platform)} ${r.at ? when(r.at) : "next pass"}`)
              .join(", ")}.`,
  ];
  for (const r of all) {
    if (r.reason) lines.push(`${nameOf(r.platform)}: ${r.reason}.`);
    else if (r.held) lines.push(`${nameOf(r.platform)} waits as a draft: ${r.held}`);
  }
  return lines;
}

export function WritePage(props: PageProps) {
  // Feed's Use as idea opens here with the post it came from.
  const [text, setText] = useState(() => props.params.get("idea") ?? "");
  const [title, setTitle] = useState("");
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

  const posts = splitPosts(text);
  const batch = posts.length > 1;
  const titled = picked.some((p) => PLATFORM_SPECS[p].title);
  const versions = posts.map((p) =>
    picked.map((platform) => ({
      platform,
      v: ownDraftOf(platform, p, batch ? null : title),
    })),
  );
  const fits = adapt || versions.some((post) => post.some(({ v }) => !("reason" in v)));
  const count = adapt
    ? posts.length * picked.length
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
        platforms: picked,
        ...(title && !batch ? { title } : {}),
        ...(adapt ? { adapt: true } : {}),
        go,
      });
      setSaid(summary(out.posts, go));
      setText("");
      setTitle("");
      setNonce((n) => n + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Write"
        lede="Write it once and pick where it goes. For several posts, put a line of --- between them."
      />
      {only && !TEXT.includes(only) ? (
        <p className={cx("m-0 text-[13.5px]", QUIET)}>
          {nameOf(only)} posts start from a video.{" "}
          <a href={`/marketing/videos?platform=${only}`}>Open Videos</a>
        </p>
      ) : null}
      <Section>
        <div className="grid gap-3">
          <Textarea
            aria-label="Your post"
            rows={batch ? 14 : 8}
            value={text}
            placeholder="What do you want to say?"
            disabled={props.demo}
            onChange={(e) => {
              setText(e.target.value);
              setSure(false);
            }}
          />
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
                  {nameOf(p)}
                </Button>
              );
            })}
            <label className={cx("ml-2 flex items-center gap-2 text-[13.5px]", QUIET)}>
              <input type="checkbox" checked={adapt} onChange={(e) => setAdapt(e.target.checked)} />
              AI writes each platform's version
            </label>
          </fieldset>
          {titled && !batch && !adapt ? (
            <Input
              aria-label="Reddit title"
              value={title}
              placeholder="Reddit title (else your first line)"
              onChange={(e) => setTitle(e.target.value)}
            />
          ) : null}
        </div>
      </Section>

      {posts.length > 0 && picked.length > 0 && !adapt ? (
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
            disabled={!fits || !!busy || props.demo || picked.length === 0}
            onClick={() => void send("draft")}
          >
            {busy === "draft" ? "Saving…" : "Save as drafts"}
          </Button>
          <Button
            size="dense"
            tone="secondary"
            disabled={!fits || !!busy || props.demo || picked.length === 0}
            onClick={() => void send("slot")}
          >
            {busy === "slot" ? "Scheduling…" : "Schedule"}
          </Button>
          <Button
            size="dense"
            disabled={!fits || !!busy || props.demo || picked.length === 0}
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

      <WaitingBoard {...props} nonce={nonce} />
    </>
  );
}

/** One platform's version of what's typed: the words as they'll post, or why not. */
function Version({ platform, v }: { platform: Platform; v: ReturnType<typeof ownDraftOf> }) {
  const max = PLATFORM_SPECS[platform].maxChars;
  return (
    <div className="grid content-start gap-2 rounded-(--ui-radius) bg-(--ui-paper) p-3 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
      <div className="flex items-center justify-between gap-2">
        <Tag>{nameOf(platform)}</Tag>
        {"reason" in v ? null : (
          <span className={cx("text-[12px] [font-variant-numeric:tabular-nums]", QUIET)}>
            {v.text.length} / {max}
          </span>
        )}
      </div>
      {"reason" in v ? (
        <p className={ERROR}>{v.reason}</p>
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
  const [again, setAgain] = useState(0);
  const load = useCall(`write-waiting:${props.nonce}:${again}`, () =>
    desk<{ ideas: Waiting[] }>("waiting", {}),
  );
  const reload = () => setAgain((n) => n + 1);
  const only = chosen(props.params);
  const ideas = load.data?.ideas
    .map((i) => ({ ...i, drafts: i.drafts.filter((d) => !only || d.platform === only) }))
    .filter((i) => i.drafts.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = ideas?.flatMap((i) => i.drafts.map((d) => d.id)) ?? [];

  const all = async () => {
    setBusy(true);
    setError(null);
    try {
      await desk("approve", { ids });
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
                  <DraftCard key={d.id} d={d} demo={props.demo} onDone={reload} />
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

type Act = "save" | "approve" | "now" | "rewrite" | "reject";

/** One waiting draft: its words to edit in place, and what can be done with it. */
function DraftCard({
  d,
  demo,
  onDone,
}: {
  d: Waiting["drafts"][number];
  demo: boolean;
  onDone: () => void;
}) {
  const [text, setText] = useState(d.text);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<Act | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = text.trim() !== d.text.trim();
  const max = PLATFORM_SPECS[d.platform].maxChars;

  const act = async (what: Act) => {
    setBusy(what);
    setError(null);
    try {
      if (what === "rewrite") {
        await desk("redraft", { draftId: d.id, note: note ?? "" });
      } else if (what === "reject") {
        await desk("reject", { ids: [d.id] });
      } else {
        // Approving what he changed saves it first: the yes is on the words he sees.
        if (changed) await desk("edit", { draftId: d.id, text });
        if (what !== "save") await desk("approve", { ids: [d.id], now: what === "now" });
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
          <Tag>{nameOf(d.platform)}</Tag>
          {d.state === "failed" ? <Tag tone="warn">Failed</Tag> : null}
          {d.own ? <Tag tone="accent">Yours</Tag> : d.edited ? <Tag>Edited</Tag> : null}
        </span>
        <span
          className={cx(
            "text-[12px] [font-variant-numeric:tabular-nums]",
            text.length > max ? "text-(--ui-bad)" : QUIET,
          )}
        >
          {text.length} / {max}
        </span>
      </div>
      {d.title ? <b className="text-[14px]">{d.title}</b> : null}
      <Textarea
        aria-label={`${nameOf(d.platform)} draft`}
        rows={Math.min(14, Math.max(4, Math.ceil(text.length / 48)))}
        value={text}
        disabled={demo || !!busy}
        onChange={(e) => setText(e.target.value)}
      />
      {d.error ? <p className={ERROR}>{d.error}</p> : null}
      {note !== null ? (
        <div className="grid gap-2">
          <Input
            aria-label="What to change"
            value={note}
            placeholder="What to change: shorter, lead with the number…"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="dense"
              disabled={!note.trim() || !!busy}
              onClick={() => void act("rewrite")}
            >
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </Button>
            <Button size="dense" tone="quiet" onClick={() => setNote(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {changed ? (
            <Button
              size="dense"
              tone="secondary"
              disabled={!!busy || demo}
              onClick={() => void act("save")}
            >
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          ) : null}
          <Button size="dense" disabled={!!busy || demo} onClick={() => void act("approve")}>
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
          <Button size="dense" tone="quiet" disabled={!!busy || demo} onClick={() => setNote("")}>
            Rewrite with AI
          </Button>
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
