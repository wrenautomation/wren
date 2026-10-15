/**
 * A post's fields past its words (designs/2026-10-07-post-shapes.md): its funnel first
 * (designs/2026-10-07-content-funnel.md), then the form drawn from the platform's shape in three
 * groups (Basics, Media, Details), each field saved on its own, and the
 * post as its platform shows it beside them, live as he types. On a draft and in To approve it
 * edits; on a posted one it shows what went out. Drafts, To approve and Posts all draw it here.
 */
import type { FieldView } from "@wren/core/content/shapes";
import type { TikTokCreator } from "@wren/core/content/tiktok";
import type { RecordAct, RecordExtras } from "@wren/ui";
import {
  ACTIONS,
  Button,
  Input,
  SaveConflict,
  type Saved,
  SaveStatus,
  statusWords,
  Tag,
  Textarea,
  useSaved,
} from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListPage } from "../../module.js";
import { SELECT } from "../work/bits.js";
import { type Funnel, FunnelFields } from "./funnel.js";
import { postLooks } from "./posts.js";
import { PlatformPreview, type Typed } from "./shape-preview.js";
import { type CarouselShape, SlidesEditor } from "./slides.js";
import type { ThreadShape } from "./thread.js";
import { TIKTOK_PANEL_KEYS, TikTokPanel, type TikTokValues } from "./tiktok.js";

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
  /** The required fields still unset, by label; absent on a row read before it. */
  missing?: string[];
  /** Reddit: the watched subreddits that take posts, best first. */
  places?: string[];
  links: Record<string, string>;
  media: { kind: "image" | "video"; name: string } | null;
  /** When it posts, once approved with a time. */
  scheduled: string | null;
  published: { url: string | null; at: string | null; notes: string | null } | null;
  /** Its stage, target and link; absent on a row read before the funnel. */
  funnel?: Funnel;
  /** An X thread's posts as saved; null on any other post. */
  thread?: ThreadShape | null;
  /** A carousel's slides and drawn files; null on any other post. */
  carousel?: CarouselShape | null;
  /** TikTok: the client's account as TikTok answered when the post opened; absent for Wren's own. */
  tiktok?: { creator: TikTokCreator | null; note: string | null };
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
  if (f.input === "files")
    return Array.isArray(f.value) && f.value.length
      ? f.value.map(String).map(nameOf).join(", ")
      : "None";
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
      // One press, one call: a second while it's out gets the first's answer.
      const key = `${action}:${String(input.field ?? "")}:${String(input.name ?? "")}:${JSON.stringify(input.patch ?? null)}`;
      await ACTIONS.run(key, (requestId) => act(action, { ...input, requestId }));
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
  said = null,
  bad = false,
  saved,
  count,
  over = false,
}: {
  f: FieldView;
  id: string;
  said?: string | null;
  bad?: boolean;
  /** The field's save, when it saves through the engine: its status line shows here. */
  saved?: Saved<unknown> | Saved<string> | undefined;
  count?: string | null;
  over?: boolean;
}) {
  const status = saved ? statusWords(saved.status, saved.error) : null;
  const needed = !said && !status && f.required && f.default === undefined && !isSet(f);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <label htmlFor={id} className={LABEL}>
        {f.label}
        {f.required ? <span className="text-(--ui-bad)"> *</span> : null}
      </label>
      {saved && status ? (
        <SaveStatus state={saved} onRetry={saved.retry} />
      ) : (
        <span
          aria-live="polite"
          className={
            bad || needed || over ? "text-[12px] text-(--ui-bad)" : "text-[12px] text-(--ui-ink-2)"
          }
        >
          {said ?? (needed ? "Needed before Approve" : (count ?? ""))}
        </span>
      )}
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

/** The field's value from what's typed: null clears it. Throws the words when it can't be one. */
const fieldValue = (f: FieldView, text: string): unknown => {
  const t = text.trim();
  if (t === "") return null;
  if (f.input === "list") return listOf(t);
  if (f.input === "number") {
    if (Number.isNaN(Number(t))) throw new Error(`${f.label}: type a number.`);
    return Number(t);
  }
  return t;
};

/**
 * One field's save through the engine: journaled as he types, sent on blur, Enter or a pick (a
 * field has no autosave, so a half-typed value never lands), patched in place after.
 */
function useFieldSaved<T>(
  f: FieldView,
  draftId: string,
  server: T,
  act: RecordAct,
  value: (v: T) => unknown,
) {
  return useSaved<T>({
    key: `field:${draftId}:${f.key}`,
    server,
    delay: null,
    ...(typeof server === "string"
      ? { same: (a: T, b: T) => String(a).trim() === String(b).trim() }
      : {}),
    save: async (v, { request }) => {
      await act(FIELDS, { patch: { [f.key]: value(v) }, requestId: request });
      return { value: v };
    },
  });
}

/** A line, a long text, a number or a list: saved on blur and Enter. `picks` offers values to click. */
function TextField({ f, act, draftId, picks }: FieldProps & { picks?: Picks | undefined }) {
  const value = textOf(f);
  const s = useFieldSaved(f, draftId, value, act, (t) => fieldValue(f, t));
  const text = s.value;
  useEffect(() => typeIn(draftId, f.key, typedValue(f, text)), [draftId, f, text]);
  const save = () => void s.flush();
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
  const bad = s.status === "failed";
  const common = {
    id,
    value: text,
    placeholder: f.default !== undefined ? String(f.default) : "",
    onBlur: save,
    onChange: (e: { target: { value: string } }) => s.set(e.target.value),
    "aria-invalid": over || bad ? true : undefined,
    className: "text-[14px]",
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} saved={s} count={count} over={!!over} />
      {f.input === "long" ? (
        <Textarea {...common} rows={3} />
      ) : (
        <Input
          {...common}
          inputMode={f.input === "number" ? "numeric" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
        />
      )}
      {s.conflict ? (
        <SaveConflict conflict={s.conflict} onKeepMine={s.keepMine} onTakeTheirs={s.takeTheirs} />
      ) : null}
      {picks ? (
        picks.values.length ? (
          <PickRow
            picks={picks}
            on={(v) => (n ? n.some((x) => x.toLowerCase() === v.toLowerCase()) : v === text.trim())}
            choose={(v) => {
              // A list toggles the pick in or out; a line takes it.
              s.set(
                n
                  ? (n.some((x) => x.toLowerCase() === v.toLowerCase())
                      ? n.filter((x) => x.toLowerCase() !== v.toLowerCase())
                      : [...n, v]
                    ).join(", ")
                  : v,
              );
              save();
            }}
          />
        ) : (
          <span className={HINT}>{picks.none}</span>
        )
      ) : null}
      {f.hint ? (
        <span className={HINT}>{f.input === "list" ? `Commas between. ${f.hint}` : f.hint}</span>
      ) : f.input === "list" ? (
        <span className={HINT}>Commas between.</span>
      ) : null}
    </div>
  );
}

/** Past this many picks, a search box finds the rest. */
const PICKS_SHOWN = 8;

/** The picks as buttons: the first few, or what the search matches, chosen ones always shown. */
function PickRow(props: { picks: Picks; on: (v: string) => boolean; choose: (v: string) => void }) {
  const { picks, on, choose } = props;
  const [q, setQ] = useState("");
  const find = q.trim().toLowerCase().replace(/^r\//, "");
  const many = picks.values.length > PICKS_SHOWN;
  const shown = find
    ? picks.values.filter((v) => v.toLowerCase().includes(find))
    : picks.values.filter((v, i) => i < PICKS_SHOWN || on(v));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={HINT}>{picks.label}</span>
      {many ? (
        <Input
          aria-label={`Search ${picks.values.length} ${picks.label.replace(/:$/, "").toLowerCase()}`}
          placeholder={`Search ${picks.values.length}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-7 w-36 text-[13px]"
        />
      ) : null}
      {shown.slice(0, find ? 24 : undefined).map((v) => (
        <Button
          key={v}
          size="dense"
          tone={on(v) ? "primary" : "secondary"}
          onClick={() => choose(v)}
        >
          {picks.show(v)}
        </Button>
      ))}
      {find && shown.length === 0 ? (
        <span className={HINT}>None we watch. Type it in the box above.</span>
      ) : null}
    </div>
  );
}

/** Values a line offers to click, and what to say when there are none. */
type Picks = {
  label: string;
  values: readonly string[];
  show: (v: string) => string;
  none: string;
};

/** Reddit's subreddit: the watched ones that take posts. */
const placePicks = (places: readonly string[]): Picks => ({
  label: "Watched:",
  values: places,
  show: (v) => `r/${v}`,
  none: "No subreddit we watch takes posts yet. Type one, or watch one under Places.",
});

/** A pick or a switch: shows in the preview at once, saved through the engine as it's made. */
function useChoice(f: FieldView, act: RecordAct, draftId: string) {
  const s = useFieldSaved<unknown>(f, draftId, f.value ?? null, act, (v) => v);
  useEffect(() => typeIn(draftId, f.key, s.value ?? undefined), [draftId, f.key, s.value]);
  const choose = (v: unknown) => {
    s.set(v);
    void s.flush();
  };
  return { s, value: s.value, choose };
}

/** One of a list: saved when picked. */
function PickField({ f, act, draftId }: FieldProps) {
  const { s, value: v, choose } = useChoice(f, act, draftId);
  const id = `field-${f.key}`;
  const value = typeof v === "string" ? v : "";
  return (
    <div className="grid min-w-0 gap-1.5">
      <Head f={f} id={id} saved={s} />
      <select
        id={id}
        className={SELECT}
        value={value}
        onChange={(e) => choose(e.target.value || null)}
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
  const { s, value, choose } = useChoice(f, act, draftId);
  const id = `field-${f.key}`;
  const on = typeof value === "boolean" ? value : f.default === true;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
          <input
            id={id}
            type="checkbox"
            checked={on}
            onChange={(e) => choose(e.target.checked)}
            className="size-4 accent-(--ui-active)"
          />
          <span className="text-[14px]">
            {f.label}
            {f.required ? <span className="text-(--ui-bad)"> *</span> : null}
          </span>
        </label>
        <SaveStatus state={s} onRetry={s.retry} />
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
      {f.input === "image" && link && !String(f.value).toLowerCase().endsWith(".pdf") ? (
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

/** Several images on one field (X's): each shown with Remove, Add while under the cap. */
function FilesField({ f, act, links }: FieldProps & { links: Record<string, string> }) {
  const { said, bad, run, fail } = useSave(act);
  const [busy, setBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const id = `field-${f.key}`;
  const list = Array.isArray(f.value) ? f.value.map(String) : [];
  const full = f.max !== undefined && list.length >= f.max;
  const upload = async (file: File) => {
    if (f.maxBytes && file.size > f.maxBytes) {
      fail(`${f.label}: up to ${Math.round(f.maxBytes / 1024 / 1024)} MB each`);
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
      {list.length ? (
        <ul className="flex flex-wrap gap-3">
          {list.map((v, i) => (
            <li key={v} className="grid w-28 gap-1">
              {links[`${f.key}.${i}`] ? (
                <img
                  src={links[`${f.key}.${i}`]}
                  alt={`${f.label} ${i + 1}`}
                  className="aspect-square w-28 rounded-(--ui-radius) object-cover shadow-[0_0_0_1px_var(--ui-hair)]"
                />
              ) : (
                <span className="truncate text-[13px]">{nameOf(v)}</span>
              )}
              <Button
                size="dense"
                tone="quiet"
                onClick={() =>
                  void run(FIELDS, { patch: { [f.key]: list.filter((_, j) => j !== i) } })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[14px]">None</span>
      )}
      <input
        ref={pickRef}
        id={id}
        type="file"
        className="sr-only"
        accept={(f.accept ?? []).join(",")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {full ? null : (
        <Button
          size="dense"
          tone="secondary"
          busy={busy}
          className="w-fit"
          onClick={() => pickRef.current?.click()}
        >
          Add
        </Button>
      )}
      {f.hint ? <span className={HINT}>{f.hint}</span> : null}
    </div>
  );
}

/** A field the post can't send: its value and why, never an input. */
function Fixed({ f, link }: { f: FieldView; link?: string | null }) {
  const tag =
    f.status === "dev" ? (
      <Tag tone="accent">In development</Tag>
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
  f.input === "image" || f.input === "files" || f.input === "captions" || MEDIA.has(f.key)
    ? "media"
    : BASICS.has(f.key) || f.required
      ? "basics"
      : "details";
const isSet = (f: FieldView) =>
  f.value !== undefined &&
  f.value !== null &&
  f.value !== "" &&
  !(Array.isArray(f.value) && !f.value.length);

/** "Title", "Title and Subreddit", "Title, Flair and Subreddit". */
const listed = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

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

/** TikTok's settings in their own panel (`./tiktok.tsx`), each choice saved as it's made. */
function TikTokFields({ shape, act }: { shape: Shape; act: RecordAct }) {
  const server: TikTokValues = {};
  for (const f of shape.fields)
    if (TIKTOK_PANEL_KEYS.has(f.key) && f.value !== null && f.value !== undefined)
      (server as Record<string, unknown>)[f.key] = f.value;
  // The panel's choices are one value saved through the engine: in order, one save at a time,
  // only the keys that moved since the server's copy.
  const s = useSaved<TikTokValues>({
    key: `tiktok:${shape.draftId}`,
    server,
    delay: null,
    save: async (v, { base, request }) => {
      const patch: Record<string, unknown> = {};
      for (const k of TIKTOK_PANEL_KEYS) {
        const now = (v as Record<string, unknown>)[k] ?? null;
        if (now !== ((base as Record<string, unknown>)[k] ?? null)) patch[k] = now;
      }
      if (Object.keys(patch).length) await act(FIELDS, { patch, requestId: request });
      return { value: v };
    },
  });
  const live = useRef(s.value);
  live.current = s.value;
  const choose = async (key: keyof TikTokValues, value: unknown) => {
    typeIn(shape.draftId, key, value ?? undefined);
    const next = { ...live.current, [key]: value ?? undefined };
    live.current = next;
    s.set(next);
    return (await s.flush()) ? null : "Not saved. Pick it again, or reload.";
  };
  return (
    <TikTokPanel
      values={s.value}
      choose={choose}
      tiktok={shape.tiktok}
      video={shape.links.media ?? null}
    />
  );
}

/** Every field of the post, grouped: editable while it waits, as it went out once posted. */
export function PostFields({ shape, act }: { shape: Shape; act: RecordAct }) {
  // A TikTok post still open: its Direct Post settings in their own panel.
  const tiktok = shape.platform === "tiktok" && shape.editable;
  const cells = (fields: FieldView[]) =>
    fields.map((f) => {
      const link = shape.links[f.key] ?? null;
      const wide =
        f.input === "long" ||
        f.input === "image" ||
        f.input === "files" ||
        f.input === "captions" ||
        f.key === "title";
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
        ) : f.input === "files" ? (
          <FilesField {...props} links={shape.links} />
        ) : (
          <TextField
            {...props}
            picks={
              shape.platform === "reddit" &&
              (f.key === "subreddit" || f.key === "alsoTo") &&
              shape.places
                ? placePicks(shape.places)
                : undefined
            }
          />
        );
      return (
        <div key={f.key} className={wide ? "@min-[440px]/fields:col-span-2" : ""}>
          {node}
        </div>
      );
    });
  // A carousel's slides have their own editor above.
  const of = (g: Group) =>
    shape.fields.filter(
      (f) => f.input !== "slides" && groupOf(f) === g && !(tiktok && TIKTOK_PANEL_KEYS.has(f.key)),
    );
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
      {shape.carousel ? (
        <div className={shape.funnel ? "border-t border-(--ui-hair) pt-5" : ""}>
          <SlidesEditor
            draftId={shape.draftId}
            carousel={shape.carousel}
            editable={shape.editable}
            act={act}
          />
        </div>
      ) : null}
      {tiktok ? <TikTokFields shape={shape} act={act} /> : null}
      <section
        aria-label="Basics"
        className={`grid gap-4 ${shape.funnel || shape.carousel || tiktok ? "border-t border-(--ui-hair) pt-5" : ""}`}
      >
        <h3 className={GROUP_HEAD}>Basics</h3>
        {shape.editable && shape.missing?.length ? (
          <p role="status" className="m-0 text-[13px] text-(--ui-bad)">
            Fill in {listed(shape.missing)} before Approve.
          </p>
        ) : null}
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
