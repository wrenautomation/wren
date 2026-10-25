/**
 * Write's Story box: a photo from the phone or laptop, or a clip he already cut, as a story on
 * Instagram and the Facebook Page. Stories take no words, so the box is media and where. A photo
 * shrinks here to a JPEG of at most 1920px and 2 MB before it goes; a clip is a Reel's stored file.
 * ContentDesk `story` and `storyClips` through the console.
 */

import type { Platform } from "@wren/core/content";
import { ACTIONS, Button, cx, messageOf, Section } from "@wren/ui";
import { useState } from "react";
import { useCall } from "../../load.js";
import { QUIET } from "../work/bits.js";
import { contentDesk } from "./desk.js";
import { type Go, type Result, SendTools, said, WherePicker } from "./send-box.js";

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

const desk = contentDesk;
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
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  const ready = !!(photo || clip) && where.length > 0 && !busy && !props.demo;
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
      // One press, one story: a second while it's out gets the first's answer.
      const out = (await ACTIONS.run(`studio:story:${go}`, (requestId) =>
        desk<{ posts: { results: Result<Where>[] }[] }>("story", {
          platforms: where,
          ...(photo ? { photo: { name: photo.name, data: photo.data } } : { clip }),
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
      setPhoto(null);
      setClip(null);
      props.made();
    } catch (err) {
      setError(messageOf(err));
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
        <WherePicker all={WHERE} name={NAME} where={where} onChange={setWhere} />
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
    </Section>
  );
}
