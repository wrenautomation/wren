/**
 * Write's Blog box (designs/2026-10-13-blog-box.md): a post for wrenautomation.com/blog in
 * Markdown. Save as draft or Publish commits it to the lander repo; a published post goes up a
 * few minutes later. Then Email sends it to everyone signed up, once each, after a test if he
 * wants one. `Blog/wren` through the console.
 */

import {
  ACTIONS,
  Button,
  cx,
  EditConflict,
  Input,
  Section,
  SelectField,
  Tag,
  TextAreaField,
  TextField,
  useEdit,
  useEditForm,
} from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError } from "../../api.js";
import { patchCalls, useCall } from "../../load.js";
import { ERROR, QUIET, SELECT, TOOLS } from "../work/bits.js";
import { deskCall } from "./desk.js";
import { usePieces } from "./pieces.js";

interface Post {
  slug: string;
  title: string;
  description: string;
  body: string;
  date: string;
  draft: boolean;
  publishedAt: string | null;
  emailedAt: string | null;
  updatedAt: string;
  /** What it was written from, `video:<id>`. */
  fromRef: string | null;
}
interface Audience {
  live: boolean;
  tally: Record<string, number>;
  sent: number;
}

const blog = <T,>(handler: string, input: Record<string, unknown> = {}) =>
  deskCall<T>("Blog", handler, input, "wren");
const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const SNIPPET = 155;

/** How many recent long videos the From pick offers. */
const FROM_SHOWN = 20;

/**
 * `from`: Write's `?from=video:<id>`, so a new post starts written from that video; `fromTitle`
 * names it until the pieces load.
 */
export function BlogBox(props: { demo?: boolean; from?: string | null; fromTitle?: string }) {
  const list = useCall("blog-posts", () =>
    blog<{ on: boolean; site: string; posts: Post[] }>("posts"),
  );
  const work = usePieces();
  const [slug, setSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<"publish" | "email" | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  // The test address stays between visits: he sends tests to the same one.
  const testEdit = useEdit(props.demo ? null : "studio:blog:test-address", "");
  const test = testEdit.value;

  const posts = list.data?.posts ?? [];
  const site = list.data?.site ?? "";
  const open = posts.find((p) => p.slug === slug) ?? null;
  const off = list.data ? !list.data.on : false;
  // What he types stays on the device until it's saved, per post; it comes back only over the
  // same saved post. Saving commits to the site, so it never saves on its own.
  const form = useEditForm({
    key: props.demo ? null : `studio:blog:${slug ?? "new"}`,
    defaults: {
      title: open?.title ?? "",
      description: open?.description ?? "",
      body: open?.body ?? "",
      from: open ? (open.fromRef ?? "") : (props.from ?? ""),
    },
    base: open ? JSON.stringify([open.title, open.description, open.body]) : "",
  });
  const { title, description, body, from } = form.watch();
  // Words changed after "Put it on the site?": ask again.
  const { watch } = form;
  useEffect(() => {
    const sub = watch((_, { name }) => {
      if (name === "body") setSure(null);
    });
    return () => sub.unsubscribe();
  }, [watch]);
  // The post moved under his words: all three fields show as one, he picks.
  const moved = form.conflict
    ? {
        mine: [
          form.conflict.mine.title ?? "",
          form.conflict.mine.description ?? "",
          form.conflict.mine.body ?? "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        theirs: open ? [open.title, open.description, open.body].filter(Boolean).join("\n\n") : "",
      }
    : null;

  const load = (p: Post | null) => {
    setSlug(p?.slug ?? null);
    setSure(null);
    setLines([]);
    setError(null);
    setAudience(null);
  };

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const save = (publish: boolean) => {
    if (publish && !sure) return setSure("publish");
    setSure(null);
    void run(publish ? "publish" : "draft", async () => {
      const out = (await ACTIONS.run(`studio:blog:${slug ?? "new"}:${publish}`, (requestId) =>
        blog<{ post: Post; url: string }>("save", {
          ...(slug ? { slug } : {}),
          title,
          description,
          body,
          publish,
          from: from || null,
          requestId,
        }),
      )) as { post: Post; url: string };
      form.forget();
      // The list shows the saved post at once: patched in place, never read again.
      patchCalls((key, data) => {
        if (key !== "blog-posts" || !data || typeof data !== "object") return data;
        const d = data as { posts?: Post[] };
        const rest = (d.posts ?? []).filter((p) => p.slug !== out.post.slug);
        return { ...d, posts: [out.post, ...rest] };
      });
      setSlug(out.post.slug);
      setLines([
        publish
          ? `Published. It's up at ${out.url} in a few minutes.`
          : "Saved as a draft. It stays off the site.",
      ]);
    });
  };

  const check = () =>
    run("check", async () => {
      if (!slug) return;
      setAudience(await blog<Audience>("audience", { slug }));
    });

  const email = (to?: string) => {
    if (!to && !sure) return setSure("email");
    setSure(null);
    void run(to ? "test" : "email", async () => {
      if (!slug) return;
      await blog("email", { slug, ...(to ? { test: to } : {}) });
      setLines([
        to ? `Test on its way to ${to}.` : "Sending now, one a second. Each person gets it once.",
      ]);
      if (!to) list.retry();
    });
  };

  // Long videos, newest first; the post's own pick stays even when it's older than the rest.
  const videos = (work.data?.pieces ?? [])
    .filter((p) => p.kind === "long" && p.video != null)
    .slice(0, FROM_SHOWN)
    .map((p) => ({ value: `video:${p.video}`, label: p.title || `Video ${p.video}` }));
  if (from && !videos.some((v) => v.value === from))
    videos.unshift({
      value: from,
      label: (from === props.from && props.fromTitle) || `Video ${from.slice("video:".length)}`,
    });

  const ready = title.trim() && description.trim() && body.trim() && !busy && !props.demo && !off;
  const gets = audience?.tally["gets it"] ?? 0;
  const skipped = Object.entries(audience?.tally ?? {}).filter(([k]) => k !== "gets it");

  return (
    <Section
      title="Blog post"
      note="Goes on wrenautomation.com/blog, then out by email to everyone signed up."
    >
      <div className="grid gap-3">
        {off ? (
          <p className={ERROR}>
            The blog can't save yet: the worker has no GitHub token for the site.
          </p>
        ) : null}
        {posts.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="dense" tone={slug ? "secondary" : "primary"} onClick={() => load(null)}>
              New post
            </Button>
            {posts.map((p) => (
              <Button
                key={p.slug}
                size="dense"
                tone={p.slug === slug ? "primary" : "secondary"}
                onClick={() => load(p)}
              >
                <span className="inline-flex items-center gap-1.5">
                  {p.title}
                  <Tag tone={p.draft ? "neutral" : p.emailedAt ? "green" : "accent"}>
                    {p.draft ? "Draft" : p.emailedAt ? "Emailed" : "Live"}
                  </Tag>
                </span>
              </Button>
            ))}
          </div>
        ) : null}
        <SelectField
          form={form}
          name="from"
          label="From"
          aria-label="From"
          options={[
            ["", "Nothing, it stands alone"],
            ...videos.map((v) => [v.value, v.label] as const),
          ]}
          disabled={props.demo}
          className={cx("flex-row flex-wrap items-center gap-2 text-[13.5px]", QUIET)}
          box={cx(SELECT, "min-w-0 max-w-full flex-1 basis-60")}
        />
        <EditConflict
          what="This post"
          conflict={moved}
          onKeepMine={form.keepMine}
          onTakeTheirs={form.takeTheirs}
        />
        <TextField
          form={form}
          name="title"
          aria-label="Title"
          placeholder="Title"
          disabled={props.demo}
        />
        <div className="grid gap-1">
          <TextField
            form={form}
            name="description"
            aria-label="One line under the title"
            placeholder="One line under the title. Search shows it too."
            disabled={props.demo}
          />
          <span
            className={cx(
              "text-[12.5px]",
              description.length > SNIPPET ? "text-(--ui-bad)" : QUIET,
            )}
          >
            {description.length} of {SNIPPET}
          </span>
        </div>
        <TextAreaField
          form={form}
          name="body"
          aria-label="The post, in Markdown"
          rows={18}
          placeholder={
            "Write in Markdown. ## for a heading, **bold**, [words](https://link), - for a list.\nImages: put them in the lander's public/blog/ and link /blog/name.png."
          }
          disabled={props.demo}
        />
        {slug ? (
          <p className={cx("m-0 text-[13px]", QUIET)}>
            Address: {site.replace(/^https?:\/\//, "")}/blog/{slug}
            {open?.publishedAt ? ` · up since ${open.date}` : ""}
          </p>
        ) : null}
        <div className={TOOLS}>
          <Button size="dense" tone="secondary" disabled={!ready} onClick={() => save(false)}>
            {busy === "draft"
              ? "Saving…"
              : open && !open.draft
                ? "Take it down to a draft"
                : "Save as draft"}
          </Button>
          <Button tone="primary" size="dense" disabled={!ready} onClick={() => save(true)}>
            {busy === "publish"
              ? "Publishing…"
              : sure === "publish"
                ? "Put it on the site?"
                : open && !open.draft
                  ? "Update the live post"
                  : "Publish"}
          </Button>
          {sure === "publish" ? (
            <Button size="dense" tone="quiet" onClick={() => setSure(null)}>
              Cancel
            </Button>
          ) : null}
        </div>

        {open && !open.draft ? (
          <div className="grid gap-2 border-t border-(--ui-hair) pt-3">
            <div className={TOOLS}>
              <Button size="dense" tone="secondary" disabled={!!busy} onClick={() => void check()}>
                {busy === "check"
                  ? "Checking…"
                  : open.emailedAt
                    ? "Who got it"
                    : "Who would get it"}
              </Button>
              {audience?.live && !open.emailedAt ? (
                <Button
                  tone="primary"
                  size="dense"
                  disabled={!!busy || gets === 0}
                  onClick={() => email()}
                >
                  {busy === "email"
                    ? "Sending…"
                    : sure === "email"
                      ? `Email ${gets} now?`
                      : `Email ${gets}`}
                </Button>
              ) : null}
              {sure === "email" ? (
                <Button size="dense" tone="quiet" onClick={() => setSure(null)}>
                  Cancel
                </Button>
              ) : null}
            </div>
            {audience ? (
              <p className="m-0 text-[13.5px]">
                {!audience.live
                  ? "Not live yet. Give it a few minutes after Publish, then check again."
                  : `${gets} would get it${skipped.length ? `; ${skipped.map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}. Already sent to ${audience.sent}.`}
              </p>
            ) : null}
            {audience?.live ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Test address"
                  {...testEdit.field}
                  placeholder="you@wrenautomation.com"
                  className="max-w-[260px]"
                />
                <Button
                  size="dense"
                  tone="secondary"
                  disabled={!!busy || !test.includes("@")}
                  onClick={() => email(test.trim())}
                >
                  {busy === "test" ? "Sending…" : "Send a test"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {lines.length ? (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className={ERROR}>{error}</p> : null}
      </div>
    </Section>
  );
}
