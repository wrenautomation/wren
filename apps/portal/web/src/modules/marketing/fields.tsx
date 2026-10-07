/**
 * A post's fields past its words (designs/2026-10-07-post-shapes.md): the form drawn from the
 * platform's shape, each field saved on its own, and the post as its platform shows it. On a
 * draft and in To approve it edits; on a posted one it shows what went out.
 */
import type { FieldView } from "@wren/core/content/shapes";
import type { RecordAct, RecordExtras } from "@wren/ui";
import { Button, Input, Tag, Textarea } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ListPage } from "../../module.js";
import { SELECT } from "../work/bits.js";

/** `@wren/content`'s `shapeView`: a draft's fields, words and file links. */
export type Shape = {
  draftId: string;
  platform: string;
  site: string;
  kind: string;
  status: string;
  editable: boolean;
  title: string | null;
  text: string;
  max: number;
  fields: FieldView[];
  links: Record<string, string>;
  media: { kind: "image" | "video"; name: string } | null;
  published: { url: string | null; at: string | null; notes: string | null } | null;
};

export const FIELDS = "marketing.draftFields";
export const ATTACH = "marketing.draftAttach";

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const nameOf = (s: string) => s.slice(s.lastIndexOf("/") + 1);
const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";

/** A list as one line: "ops, growth". */
const listText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
const listOf = (t: string) =>
  t
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
/** YouTube's count: each tag, quotes round one with a space, a comma between. */
const tagChars = (tags: string[]) =>
  tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);

function textOf(f: FieldView): string {
  if (f.input === "list") return listText(f.value);
  if (f.value === undefined || f.value === null) return "";
  return String(f.value);
}

/** What a field reads as, set or not. */
function shown(f: FieldView): string {
  if (f.input === "switch") {
    const on = typeof f.value === "boolean" ? f.value : f.default;
    return on === undefined ? "Not set" : on ? "On" : "Off";
  }
  if (f.input === "pick") {
    const v = (f.value ?? f.default) as string | undefined;
    return f.options?.find((o) => o.value === v)?.label ?? (v ? String(v) : "Not set");
  }
  if (f.input === "image" || f.input === "captions")
    return typeof f.value === "string" ? nameOf(f.value) : "None";
  const t = textOf(f);
  return t || (f.default !== undefined ? `${String(f.default)} (default)` : "Not set");
}

/** The field's state line: saving, saved, or why not. */
function useSave(act: RecordAct) {
  const [said, setSaid] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const run = async (action: string, input: Record<string, unknown>) => {
    setSaid("Saving…");
    setBad(false);
    try {
      await act(action, input);
      setSaid("Saved");
      return true;
    } catch (err) {
      setSaid(errorOf(err));
      setBad(true);
      return false;
    }
  };
  const fail = (why: string) => {
    setSaid(why);
    setBad(true);
  };
  return { said, bad, run, fail, clear: () => setSaid(null) };
}

function Head({
  f,
  id,
  said,
  bad,
  count,
}: {
  f: FieldView;
  id: string;
  said: string | null;
  bad: boolean;
  count?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <label htmlFor={id} className={LABEL}>
        {f.label}
        {f.required ? <span className="text-(--ui-bad)"> *</span> : null}
      </label>
      <span
        aria-live="polite"
        className={bad ? "text-[12px] text-(--ui-bad)" : "text-[12px] text-(--ui-ink-2)"}
      >
        {said ?? count ?? ""}
      </span>
    </div>
  );
}

/** A line, a long text, a number or a list: saved on blur and Enter. */
function TextField({ f, act }: { f: FieldView; act: RecordAct }) {
  const value = textOf(f);
  const [text, setText] = useState(value);
  const { said, bad, run, clear } = useSave(act);
  const dirty = text !== value;
  const live = useRef(dirty);
  live.current = dirty;
  useEffect(() => {
    if (!live.current) setText(value);
  }, [value]);
  const save = async () => {
    if (text.trim() === value.trim()) return;
    const t = text.trim();
    const v =
      t === "" ? null : f.input === "list" ? listOf(t) : f.input === "number" ? Number(t) : t;
    if (f.input === "number" && typeof v === "number" && Number.isNaN(v)) return;
    await run(FIELDS, { patch: { [f.key]: v } });
  };
  const id = `field-${f.key}`;
  const n = f.input === "list" ? listOf(text) : null;
  const count =
    f.input === "list"
      ? f.maxTotal
        ? `${tagChars(n ?? [])} of ${f.maxTotal}`
        : f.max
          ? `${n?.length ?? 0} of ${f.max}`
          : null
      : f.max
        ? `${[...text].length} of ${f.max}`
        : null;
  const over = f.max && f.input !== "list" && [...text].length > f.max;
  const common = {
    id,
    value: text,
    placeholder: f.default !== undefined ? String(f.default) : "",
    onBlur: () => void save(),
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      clear();
    },
    "aria-invalid": over || bad ? true : undefined,
    className: "text-[14px]",
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} said={said} bad={bad || !!over} count={count} />
      {f.input === "long" ? (
        <Textarea {...common} rows={3} />
      ) : (
        <Input
          {...common}
          inputMode={f.input === "number" ? "numeric" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
      )}
      {f.hint ? (
        <span className={HINT}>{f.input === "list" ? `Commas between. ${f.hint}` : f.hint}</span>
      ) : f.input === "list" ? (
        <span className={HINT}>Commas between.</span>
      ) : null}
    </div>
  );
}

/** One of a list: saved when picked. */
function PickField({ f, act }: { f: FieldView; act: RecordAct }) {
  const { said, bad, run } = useSave(act);
  const id = `field-${f.key}`;
  const value = typeof f.value === "string" ? f.value : "";
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} said={said} bad={bad} />
      <select
        id={id}
        className={SELECT}
        value={value}
        onChange={(e) => void run(FIELDS, { patch: { [f.key]: e.target.value || null } })}
      >
        <option value="">
          {f.default !== undefined
            ? `${f.options?.find((o) => o.value === f.default)?.label ?? String(f.default)} (default)`
            : "Not set"}
        </option>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {f.hint ? <span className={HINT}>{f.hint}</span> : null}
    </div>
  );
}

/** On or off: saved when clicked. */
function SwitchField({ f, act }: { f: FieldView; act: RecordAct }) {
  const { said, bad, run } = useSave(act);
  const id = `field-${f.key}`;
  const on = typeof f.value === "boolean" ? f.value : f.default === true;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
          <input
            id={id}
            type="checkbox"
            checked={on}
            onChange={(e) => void run(FIELDS, { patch: { [f.key]: e.target.checked } })}
            className="size-4 accent-(--ui-accent)"
          />
          <span className="text-[14px]">
            {f.label}
            {f.required ? <span className="text-(--ui-bad)"> *</span> : null}
          </span>
        </label>
        <span
          aria-live="polite"
          className={bad ? "text-[12px] text-(--ui-bad)" : "text-[12px] text-(--ui-ink-2)"}
        >
          {said ?? ""}
        </span>
      </div>
      {f.hint ? <span className={`${HINT} pl-6.5`}>{f.hint}</span> : null}
    </div>
  );
}

/** The file's bytes as base64, for the desk's attach (2 MB at most). */
const base64Of = (file: File) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => fail(r.error ?? new Error("Couldn't read the file."));
    r.readAsDataURL(file);
  });

/** A thumbnail, cover or subtitles file: picked and uploaded, or removed. */
function FileField({ f, act, link }: { f: FieldView; act: RecordAct; link: string | null }) {
  const { said, bad, run, fail } = useSave(act);
  const [busy, setBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const id = `field-${f.key}`;
  const set = typeof f.value === "string" && f.value !== "";
  const upload = async (file: File) => {
    if (f.maxBytes && file.size > f.maxBytes) {
      fail(`${f.label}: up to ${Math.round(f.maxBytes / 1024 / 1024)} MB`);
      return;
    }
    setBusy(true);
    try {
      await run(ATTACH, { field: f.key, name: file.name, data: await base64Of(file) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} said={said} bad={bad} />
      {f.input === "image" && link ? (
        <img
          src={link}
          alt={f.label}
          className="max-h-40 w-fit max-w-full rounded-(--ui-radius) shadow-[0_0_0_1px_var(--ui-hair)]"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[14px]">
          {set ? nameOf(String(f.value)) : "None"}
        </span>
        <input
          ref={pickRef}
          id={id}
          type="file"
          className="sr-only"
          accept={[...(f.accept ?? []), ...(f.input === "captions" ? [".srt", ".vtt"] : [])].join(
            ",",
          )}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button size="dense" tone="secondary" busy={busy} onClick={() => pickRef.current?.click()}>
          {set ? "Replace" : "Upload"}
        </Button>
        {set ? (
          <Button
            size="dense"
            tone="quiet"
            onClick={() => void run(FIELDS, { patch: { [f.key]: null } })}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {f.hint ? <span className={HINT}>{f.hint}</span> : null}
    </div>
  );
}

/** A field the post can't send: its value and why, never an input. */
function Fixed({ f, link }: { f: FieldView; link?: string | null }) {
  const tag =
    f.status === "dev" ? (
      <Tag tone="warn">In development</Tag>
    ) : f.status === "none" ? (
      <Tag>Not in the API</Tag>
    ) : null;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>
          {f.label}
          {f.required ? <span className="text-(--ui-bad)"> *</span> : null}
        </span>
        {tag}
      </div>
      {f.input === "image" && link ? (
        <img
          src={link}
          alt={f.label}
          className="max-h-40 w-fit max-w-full rounded-(--ui-radius) shadow-[0_0_0_1px_var(--ui-hair)]"
        />
      ) : null}
      {f.status === "sent" ? <span className="text-[14px] break-words">{shown(f)}</span> : null}
      {f.hint && f.status !== "sent" ? <span className={HINT}>{f.hint}</span> : null}
    </div>
  );
}

/** Every field of the post: editable while it waits, as it went out once posted. */
export function PostFields({ shape, act }: { shape: Shape; act: RecordAct }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {shape.fields.map((f) => {
        const link = shape.links[f.key] ?? null;
        const wide =
          f.input === "long" || f.input === "image" || f.input === "captions" || f.key === "title";
        const cell = (node: ReactNode) => (
          <div key={f.key} className={wide ? "sm:col-span-2" : ""}>
            {node}
          </div>
        );
        if (!shape.editable || f.status !== "sent" || f.readOnly)
          return cell(<Fixed f={f} link={link} />);
        if (f.input === "pick") return cell(<PickField f={f} act={act} />);
        if (f.input === "switch") return cell(<SwitchField f={f} act={act} />);
        if (f.input === "image" || f.input === "captions")
          return cell(<FileField f={f} act={act} link={link} />);
        return cell(<TextField f={f} act={act} />);
      })}
    </div>
  );
}

const val = (s: Shape, key: string) => s.fields.find((f) => f.key === key)?.value;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const FRAME =
  "overflow-hidden rounded-(--ui-radius) bg-(--ui-paper) shadow-[0_0_0_1px_var(--ui-hair)]";
const EMPTY_ART =
  "grid place-items-center bg-(--ui-hair) text-center text-[13px] text-(--ui-ink-2)";
const pickLabel = (s: Shape, key: string) => {
  const f = s.fields.find((x) => x.key === key);
  const v = (f?.value ?? f?.default) as string | undefined;
  return f?.options?.find((o) => o.value === v)?.label ?? v ?? null;
};

/** YouTube's watch card: the thumbnail, the title, the channel; a Short stands tall. */
function YouTubeCard({ s }: { s: Shape }) {
  const short = s.kind === "short";
  const thumb = s.links.thumbnail ?? null;
  return (
    <div className={`${FRAME} ${short ? "w-56" : "w-full max-w-[420px]"}`}>
      {thumb && !short ? (
        <img src={thumb} alt="Thumbnail" className="aspect-video w-full object-cover" />
      ) : (
        <div className={`${EMPTY_ART} ${short ? "aspect-[9/16]" : "aspect-video"}`}>
          {short ? "A frame YouTube picks" : "No thumbnail: YouTube picks a frame"}
        </div>
      )}
      <div className="grid gap-1 p-3">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug">
          {s.title || "No title"}
        </p>
        <p className="text-[13px] text-(--ui-ink-2)">
          Wren Automation · {pickLabel(s, "privacyStatus") ?? "Private"}
          {short ? " · Short" : ""}
        </p>
        {s.text ? <p className="line-clamp-2 text-[13px] text-(--ui-ink-2)">{s.text}</p> : null}
      </div>
    </div>
  );
}

/** Reddit's card: the subreddit, the title, the body or the link. */
function RedditCard({ s }: { s: Shape }) {
  const sub = str(val(s, "subreddit"));
  const link = str(val(s, "url"));
  return (
    <div className={`${FRAME} grid w-full max-w-[560px] gap-1.5 p-3`}>
      <p className="text-[12px] text-(--ui-ink-2)">
        <span className="font-semibold text-(--ui-ink)">{sub ? `r/${sub}` : "No subreddit"}</span> ·
        Posted by you
      </p>
      <p className="text-[16px] font-semibold leading-snug">{s.title || "No title"}</p>
      {link ? (
        <p className="truncate text-[13px] text-(--ui-accent)">{link}</p>
      ) : (
        <p className="line-clamp-4 whitespace-pre-wrap text-[14px]">{s.text}</p>
      )}
    </div>
  );
}

/** LinkedIn's feed card: who, who sees it, the text cut where the feed cuts it. */
function LinkedInCard({ s }: { s: Shape }) {
  const who = pickLabel(s, "visibility") ?? "Anyone";
  return (
    <div className={`${FRAME} grid w-full max-w-[555px] gap-2 p-3`}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-full bg-(--ui-hair) text-[14px] font-semibold">
          W
        </span>
        <span className="grid">
          <span className="text-[14px] font-semibold">Wren Automation</span>
          <span className="text-[12px] text-(--ui-ink-2)">Now · {who}</span>
        </span>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-[14px]">{s.text}</p>
      {val(s, "noReshare") === true ? (
        <p className="text-[12px] text-(--ui-ink-2)">Reshares off</p>
      ) : null}
    </div>
  );
}

/** An Instagram Reel: the cover, the caption over it, the audio and who's on it. */
function ReelCard({ s }: { s: Shape }) {
  const cover = s.links.cover ?? null;
  const at = val(s, "thumbOffset");
  const collab = Array.isArray(val(s, "collaborators"))
    ? (val(s, "collaborators") as string[])
    : [];
  const audio = str(val(s, "audioName"));
  return (
    <div className={`${FRAME} relative w-56`}>
      {cover ? (
        <img src={cover} alt="Cover" className="aspect-[9/16] w-full object-cover" />
      ) : (
        <div className={`${EMPTY_ART} aspect-[9/16] px-4`}>
          {typeof at === "number" ? `The frame at ${at} ms` : "The first frame"}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 grid gap-1 bg-black/55 p-3 text-white">
        <p className="text-[13px] font-semibold">
          wrenautomation{collab.length ? ` and ${collab.join(", ")}` : ""}
        </p>
        <p className="line-clamp-2 text-[12px]">{s.text}</p>
        <p className="truncate text-[12px] opacity-80">Audio: {audio ?? "original"}</p>
      </div>
    </div>
  );
}

const CARDS: Record<string, (p: { s: Shape }) => ReactNode> = {
  youtube: YouTubeCard,
  reddit: RedditCard,
  linkedin: LinkedInCard,
  instagram: ReelCard,
};

/** The post as its platform shows it; null where the feed preview is all there is. */
export function ShapePreview({ shape }: { shape: Shape }) {
  const Card = CARDS[shape.platform];
  return Card ? <Card s={shape} /> : null;
}

/** What the platform refused after the post went up: the post stays, these didn't take. */
function Notes({ notes }: { notes: string }) {
  return (
    <ul className="grid gap-1 text-[14px]">
      {notes.split("\n").map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

/**
 * A page's extras with the post's fields and its platform's card, from the detail's `shape`.
 * The card leads; the fields follow, editable while the draft waits.
 */
export const withShape =
  (extras?: ListPage["extras"]): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const base: RecordExtras = extras ? extras(detail, at) : {};
    const shape = (detail as { shape?: Shape | null } | null)?.shape;
    if (!shape) return base;
    const sections: [string, ReactNode][] = [];
    if (CARDS[shape.platform])
      sections.push([`On ${shape.site}`, <ShapePreview key="card" shape={shape} />]);
    sections.push([
      shape.published ? "What went out" : `${shape.site} fields`,
      <PostFields key={shape.draftId} shape={shape} act={at.act} />,
    ]);
    if (shape.published?.notes)
      sections.push(["Not set after posting", <Notes key="notes" notes={shape.published.notes} />]);
    return { ...base, sections: [...sections, ...(base.sections ?? [])] };
  };
