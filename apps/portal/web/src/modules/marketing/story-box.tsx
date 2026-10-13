/**
 * Write's Story box: a photo from the phone or laptop, or a clip he already cut, as a story on
 * Instagram and the Facebook Page. Stories take no words, so the box is media and where. A photo
 * shrinks here to a JPEG of at most 1920px and 2 MB before it goes; a clip is a Reel's stored file.
 * ContentDesk `story` and `storyClips` through the console.
 */

import type { Platform } from "@wren/core/content";
import { Button, cx, PlatformMark, Section } from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";

type Go = "draft" | "slot" | "now";
const WHERE = ["instagram", "facebook"] as const satisfies readonly Platform[];
type Where = (typeof WHERE)[number];
const NAME: Record<Where, string> = { instagram: "Instagram story", facebook: "Facebook story" };
const MAX = 2 * 1024 * 1024;
const EDGE = 1920;

interface Clip {
  draftId: string;
  title: string;
  at: string;
}
interface Result {
  platform: Where;
  draftId: string | null;
  reason: string | null;
  at?: string | null;
  held?: string;
}

const desk = <T,>(handler: string, input: Record<string, unknown>) =>
  call<T>("console/call", { service: "ContentDesk", handler, key: "default", input });
const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const day = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The photo as a JPEG that fits: longest side 1920px, quality stepped down until it's 2 MB. */
async function shrink(file: File): Promise<{ name: string; data: string; url: string }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Can't read that photo here. Try a JPG or PNG.");
  });
  const scale = Math.min(1, EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= MAX) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const name = `${file.name.replace(/\.[^.]*$/, "") || "story"}.jpg`;
      return { name, data: btoa(bin), url: URL.createObjectURL(blob) };
    }
  }
  throw new Error("That photo won't fit in 2 MB");
}

function said(results: Result[], go: Go): string[] {
  const made = results.filter((r) => r.draftId && !r.held);
  const lines = [
    made.length === 0
      ? "Nothing was made."
      : go === "draft"
        ? `${made.length} saved as drafts. They wait below.`
        : go === "now"
          ? `${made.length} posting on the next pass, within a few minutes.`
          : `${made.length} scheduled at the next slots.`,
  ];
  for (const r of results)
    if (r.reason) lines.push(`${NAME[r.platform]}: ${r.reason}.`);
    else if (r.held) lines.push(`${NAME[r.platform]} waits as a draft: ${r.held}`);
  return lines;
}

export function StoryBox(props: { demo?: boolean; only: Platform | null; made: () => void }) {
  const [where, setWhere] = useState<Where[]>(() =>
    props.only === "instagram" || props.only === "facebook" ? [props.only] : [...WHERE],
  );
  const [photo, setPhoto] = useState<{ name: string; data: string; url: string } | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const [busy, setBusy] = useState<Go | "shrink" | null>(null);
  const [sure, setSure] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clips = useCall("story-clips", () => desk<{ clips: Clip[] }>("storyClips", {}));

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("shrink");
    try {
      setPhoto(await shrink(file));
      setClip(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const ready = (photo || clip) && where.length > 0 && !busy && !props.demo;
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
      const out = await desk<{ posts: { results: Result[] }[] }>("story", {
        platforms: where,
        ...(photo ? { photo: { name: photo.name, data: photo.data } } : { clip }),
        go,
      });
      setLines(
        said(
          out.posts.flatMap((p) => p.results),
          go,
        ),
      );
      setPhoto(null);
      setClip(null);
      props.made();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const list = clips.data?.clips ?? [];
  return (
    <Section title="Story" note="A photo or a clip. Stories carry no words.">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={cx(
              "inline-flex h-8 cursor-pointer items-center rounded-(--ui-radius) border border-(--ui-hair) px-3 text-[13px]",
              props.demo && "pointer-events-none opacity-50",
            )}
          >
            {busy === "shrink" ? "Reading…" : photo ? "Another photo" : "Add a photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/heic,image/webp"
              className="sr-only"
              disabled={props.demo}
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {list.length ? (
            <select
              aria-label="Or share a clip"
              className="h-8 max-w-full rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-bg) px-2 text-[13px]"
              value={clip ?? ""}
              disabled={props.demo}
              onChange={(e) => {
                setClip(e.target.value || null);
                if (e.target.value) setPhoto(null);
              }}
            >
              <option value="">Or share a clip…</option>
              {list.map((c) => (
                <option key={c.draftId} value={c.draftId}>
                  {c.title} ({day(c.at)})
                </option>
              ))}
            </select>
          ) : clips.data ? (
            <span className={cx("text-[13px]", QUIET)}>No clip to share yet.</span>
          ) : null}
        </div>
        {photo ? (
          <div className="flex items-end gap-3">
            <img
              src={photo.url}
              alt="Your story, as it will post"
              className="h-40 w-auto rounded-(--ui-radius) border border-(--ui-hair) object-cover"
            />
            <Button size="dense" tone="quiet" onClick={() => setPhoto(null)}>
              Remove
            </Button>
          </div>
        ) : null}
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
        <div className={TOOLS}>
          <Button
            size="dense"
            tone="secondary"
            disabled={!ready}
            onClick={() => void send("draft")}
          >
            {busy === "draft" ? "Saving…" : "Save as drafts"}
          </Button>
          <Button size="dense" tone="secondary" disabled={!ready} onClick={() => void send("slot")}>
            {busy === "slot" ? "Scheduling…" : "Schedule"}
          </Button>
          <Button size="dense" disabled={!ready} onClick={() => void send("now")}>
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
    </Section>
  );
}
