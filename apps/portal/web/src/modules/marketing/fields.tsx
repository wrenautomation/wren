/**
 * A post's fields past its words (designs/2026-10-07-post-shapes.md): its funnel first
 * (designs/2026-10-07-content-funnel.md), then the form drawn from the platform's shape in three
 * groups (Basics, Media, Details), each field saved on its own, and the
 * post as its platform shows it beside them, live as he types. On a draft and in To approve it
 * edits; on a posted one it shows what went out. Drafts, To approve and Posts all draw it here.
 */
import type { FieldView } from "@wren/core/content/shapes";
import type { RecordAct, RecordExtras } from "@wren/ui";
import { Button, Input, Tag, Textarea } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListPage } from "../../module.js";
import { SELECT } from "../work/bits.js";
import { type Funnel, FunnelFields } from "./funnel.js";
import { postLooks } from "./posts.js";
import { PlatformPreview, type Typed } from "./shape-preview.js";

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
  /** When it posts, once approved with a time. */
  scheduled: string | null;
  published: { url: string | null; at: string | null; notes: string | null } | null;
  /** Its stage, target and link; absent on a row read before the funnel. */
  funnel?: Funnel;
};

export const FIELDS = "marketing.draftFields";
export const ATTACH = "marketing.draftAttach";

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const nameOf = (s: string) => s.slice(s.lastIndexOf("/") + 1);
const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";

/**
 * Each field as typed, saved or not, by draft and key: the preview beside the form reads it, so a
 * change shows as it's made.
 */
const typedNow = new Map<string, unknown>();
let typedRev = 0;
const typedSubs = new Set<() => void>();
function typeIn(draftId: string, key: string, value: unknown) {
  const k = `${draftId}:${key}`;
  if (typedNow.has(k) && Object.is(typedNow.get(k), value)) return;
  typedNow.set(k, value);
  typedRev++;
  for (const f of typedSubs) f();
}
const subscribe = (f: () => void) => {
  typedSubs.add(f);
  return () => typedSubs.delete(f);
};
function useTyped(draftId: string): Typed {
  useSyncExternalStore(subscribe, () => typedRev);
  return (key) => {
    const k = `${draftId}:${key}`;
    return { has: typedNow.has(k), value: typedNow.get(k) };
  };
}

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

/** What a line, list or number reads as once typed. */
const typedValue = (f: FieldView, t: string) => {
  const v = t.trim();
  if (v === "") return undefined;
  if (f.input === "list") return listOf(v);
  if (f.input === "number") return Number.isNaN(Number(v)) ? undefined : Number(v);
  return v;
};

type FieldProps = { f: FieldView; act: RecordAct; draftId: string };

/** A line, a long text, a number or a list: saved on blur and Enter. */
function TextField({ f, act, draftId }: FieldProps) {
  const value = textOf(f);
  const [text, setText] = useState(value);
  const { said, bad, run, clear } = useSave(act);
  const dirty = text !== value;
  const live = useRef(dirty);
  live.current = dirty;
  useEffect(() => {
    if (!live.current) setText(value);
  }, [value]);
  useEffect(() => typeIn(draftId, f.key, typedValue(f, text)), [draftId, f, text]);
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

/** A pick or a switch shows in the preview at once; a refused one goes back to what's saved. */
function useChoice(f: FieldView, act: RecordAct, draftId: string) {
  const save = useSave(act);
  useEffect(() => typeIn(draftId, f.key, f.value), [draftId, f.key, f.value]);
  const choose = async (v: unknown) => {
    typeIn(draftId, f.key, v ?? undefined);
    if (!(await save.run(FIELDS, { patch: { [f.key]: v } }))) typeIn(draftId, f.key, f.value);
  };
  return { ...save, choose };
}

/** One of a list: saved when picked. */
function PickField({ f, act, draftId }: FieldProps) {
  const { said, bad, choose } = useChoice(f, act, draftId);
  const id = `field-${f.key}`;
  const value = typeof f.value === "string" ? f.value : "";
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} said={said} bad={bad} />
      <select
        id={id}
        className={SELECT}
        value={value}
        onChange={(e) => void choose(e.target.value || null)}
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
function SwitchField({ f, act, draftId }: FieldProps) {
  const { said, bad, choose } = useChoice(f, act, draftId);
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
            onChange={(e) => void choose(e.target.checked)}
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
function FileField({ f, act, link }: FieldProps & { link: string | null }) {
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

/** Who sees it, where it goes and what it's called: Basics; files and frames: Media. */
const BASICS = new Set([
  "kind",
  "title",
  "subreddit",
  "url",
  "link",
  "privacyStatus",
  "visibility",
  "privacy",
  "madeForKids",
  "shareToFeed",
]);
const MEDIA = new Set(["thumbOffset", "coverMs", "captionsLanguage"]);
type Group = "basics" | "media" | "details";
const groupOf = (f: FieldView): Group =>
  f.input === "image" || f.input === "captions" || MEDIA.has(f.key)
    ? "media"
    : BASICS.has(f.key) || f.required
      ? "basics"
      : "details";
const isSet = (f: FieldView) =>
  f.value !== undefined &&
  f.value !== null &&
  f.value !== "" &&
  !(Array.isArray(f.value) && !f.value.length);

const GROUP_HEAD =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";
const GRID = "grid gap-5 @min-[440px]/fields:grid-cols-2";
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** When it posts: a line in Basics, set by Approve. */
function Schedule({ shape }: { shape: Shape }) {
  const at = shape.published?.at ?? shape.scheduled ?? null;
  return (
    <div className="grid min-w-0 gap-1">
      <span className={LABEL}>{shape.published ? "Posted" : "Posts at"}</span>
      <span className="text-[14px]">
        {at ? when(at) : shape.editable ? "Its next slot, once approved" : "Not scheduled"}
      </span>
    </div>
  );
}

/** Every field of the post, grouped: editable while it waits, as it went out once posted. */
export function PostFields({ shape, act }: { shape: Shape; act: RecordAct }) {
  const cells = (fields: FieldView[]) =>
    fields.map((f) => {
      const link = shape.links[f.key] ?? null;
      const wide =
        f.input === "long" || f.input === "image" || f.input === "captions" || f.key === "title";
      const props = { f, act, draftId: shape.draftId };
      const node =
        !shape.editable || f.status !== "sent" || f.readOnly ? (
          <Fixed f={f} link={link} />
        ) : f.input === "pick" ? (
          <PickField {...props} />
        ) : f.input === "switch" ? (
          <SwitchField {...props} />
        ) : f.input === "image" || f.input === "captions" ? (
          <FileField {...props} link={link} />
        ) : (
          <TextField {...props} />
        );
      return (
        <div key={f.key} className={wide ? "@min-[440px]/fields:col-span-2" : ""}>
          {node}
        </div>
      );
    });
  const of = (g: Group) => shape.fields.filter((f) => groupOf(f) === g);
  const media = of("media");
  const details = of("details");
  return (
    <div className="@container/fields mt-2 mb-3 grid gap-6 border-t border-(--ui-hair) pt-5">
      {shape.funnel ? (
        <FunnelFields
          draftId={shape.draftId}
          funnel={shape.funnel}
          act={act}
          editable={shape.editable}
        />
      ) : null}
      <section
        aria-label="Basics"
        className={`grid gap-4 ${shape.funnel ? "border-t border-(--ui-hair) pt-5" : ""}`}
      >
        <h3 className={GROUP_HEAD}>Basics</h3>
        <div className={GRID}>
          {cells(of("basics"))}
          <Schedule shape={shape} />
        </div>
      </section>
      {media.length || shape.media ? (
        <section aria-label="Media" className="grid gap-4 border-t border-(--ui-hair) pt-5">
          <h3 className={GROUP_HEAD}>Media</h3>
          <div className={GRID}>
            {shape.media ? (
              <div className="grid min-w-0 gap-1 @min-[440px]/fields:col-span-2">
                <span className={LABEL}>{shape.media.kind === "video" ? "Video" : "Image"}</span>
                <span className="truncate text-[14px]">{shape.media.name}</span>
              </div>
            ) : null}
            {cells(media)}
          </div>
        </section>
      ) : null}
      {details.length ? <Details fields={details} cells={cells} /> : null}
    </div>
  );
}

/** Tags, category, languages and toggles: folded while none is set. */
function Details({
  fields,
  cells,
}: {
  fields: FieldView[];
  cells: (fields: FieldView[]) => ReactNode;
}) {
  const set = fields.filter(isSet).length;
  const [open, setOpen] = useState(set > 0);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group/details border-t border-(--ui-hair) pt-5"
    >
      <summary className="flex w-fit cursor-pointer items-baseline gap-2 marker:text-(--ui-ink-3)">
        <span className={GROUP_HEAD}>Details</span>
        <span className="text-[12px] text-(--ui-ink-3)">
          {set ? `${set} of ${fields.length} set` : `${fields.length} not set`}
        </span>
      </summary>
      <div className={`${GRID} mt-4`}>{cells(fields)}</div>
    </details>
  );
}

/** The post on its platform, reading the fields as typed. */
function Preview({ shape, detail }: { shape: Shape; detail: unknown }) {
  return (
    <PlatformPreview
      shape={shape}
      typed={useTyped(shape.draftId)}
      look={postLooks(detail)}
      link={shape.published ? null : (shape.funnel?.posts ?? null)}
    />
  );
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
 * A page's extras for a post: its fields as the record's form (under the words, above Ask Claude)
 * and its platform's preview beside them. `extras` draws a row with no shape (a DM in To approve,
 * a post with no draft behind it).
 */
export const withShape =
  (extras?: ListPage["extras"]): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const shape = (detail as { shape?: Shape | null } | null)?.shape;
    if (!shape) return extras ? extras(detail, at) : {};
    const notes = shape.published?.notes;
    return {
      form: <PostFields key={shape.draftId} shape={shape} act={at.act} />,
      aside: <Preview shape={shape} detail={detail} />,
      ...(notes
        ? { sections: [["Not set after posting", <Notes key="notes" notes={notes} />]] }
        : {}),
    } satisfies RecordExtras;
  };
