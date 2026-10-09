/**
 * Post shapes (designs/2026-10-07-post-shapes.md): every field a platform's post takes past its
 * text and file, one zod schema per platform. A draft's `extra` is its platform's shape: checked
 * when saved, parsed again before publish, read typed by the adapter. Each field carries its UI
 * (label, input, limit, options, required, status), and the portal draws the form from that.
 * `sent`: the adapter sends it. `dev`: shown, not editable, "In development". `none`: the
 * platform's API can't, said once.
 */
import { z } from "zod";
import type { Media, Platform } from "./index.js";
import {
  SLIDE_LINE_MAX,
  SLIDE_LINES_MAX,
  SLIDE_TITLE_MAX,
  SLIDES_MAX,
  SLIDES_MIN,
} from "./slides.js";
import {
  TIKTOK_COPY,
  TIKTOK_PRIVACY,
  TIKTOK_PRIVACY_LABELS,
  tiktokBroken,
  tiktokMissing,
} from "./tiktok.js";

export type FieldInput =
  | "line"
  | "long"
  | "pick"
  | "switch"
  | "list"
  | "image"
  | "files"
  | "captions"
  | "number"
  | "slides";
export type FieldStatus = "sent" | "dev" | "none";

export interface FieldUi {
  label: string;
  input: FieldInput;
  status: FieldStatus;
  /** Characters on a line, items in a list. */
  max?: number;
  /** A list's characters all told (YouTube's tags). */
  maxTotal?: number;
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  /** What the platform does when it's unset. */
  default?: string | boolean | number;
  hint?: string;
  /** Only on these kinds (YouTube: a thumbnail on a video, not a Short). */
  kinds?: readonly string[];
  /** Kept in the draft's own column, not in `extra`. */
  column?: "title";
  /** Shown, set elsewhere (YouTube's kind, at the video's approve). */
  readOnly?: boolean;
  /** A file's types and size. */
  accept?: readonly string[];
  maxBytes?: number;
}

/** One field as the portal draws it: its UI and the draft's value. */
export interface FieldView extends FieldUi {
  key: string;
  value: unknown;
}

interface Field<Z extends z.ZodType = z.ZodType> {
  zod: Z;
  ui: FieldUi;
}

const MB = 1024 * 1024;
/** A file: a stored object (`s3://`, the editor's upload), a URL, or a path on the desk's disk. */
const FILE = /^(s3:\/\/[^/]+\/.+|https:\/\/\S+|\/\S.*)$/i;

const line = (label: string, max: number, ui: Partial<FieldUi> = {}, pattern?: RegExp) => ({
  zod: (pattern
    ? z
        .string()
        .trim()
        .max(max, `${label}: up to ${max} characters`)
        .regex(pattern, `${label}: ${ui.hint ?? "not in the right form"}`)
    : z.string().trim().max(max, `${label}: up to ${max} characters`)
  ).optional(),
  ui: { label, input: "line" as const, status: "sent" as const, max, ...ui },
});
const url = (label: string, ui: Partial<FieldUi> = {}) => ({
  zod: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/i, `${label}: a full link, https://…`)
    .max(2000)
    .optional(),
  ui: { label, input: "line" as const, status: "sent" as const, hint: "https://…", ...ui },
});
const pick = <const V extends readonly [string, ...string[]]>(
  label: string,
  values: V,
  labels: Record<V[number], string>,
  ui: Partial<FieldUi> = {},
) => ({
  zod: z.enum(values, { error: `${label}: pick one of the options` }).optional(),
  ui: {
    label,
    input: "pick" as const,
    status: "sent" as const,
    options: values.map((value) => ({ value, label: labels[value as V[number]] })),
    ...ui,
  },
});
const flag = (label: string, ui: Partial<FieldUi> = {}) => ({
  zod: z.boolean({ error: `${label}: on or off` }).optional(),
  ui: { label, input: "switch" as const, status: "sent" as const, ...ui },
});
const ms = (label: string, ui: Partial<FieldUi> = {}) => ({
  zod: z
    .number({ error: `${label}: a number of milliseconds` })
    .int(`${label}: whole milliseconds`)
    .min(0, `${label}: 0 or more`)
    .max(15 * 60 * 1000, `${label}: inside the video`)
    .optional(),
  ui: { label, input: "number" as const, status: "sent" as const, hint: "Milliseconds in", ...ui },
});
const file = (
  label: string,
  accept: readonly string[],
  maxBytes: number,
  ui: Partial<FieldUi> = {},
) => ({
  zod: z.string().regex(FILE, `${label}: upload a file`).optional(),
  ui: {
    label,
    input: "image" as const,
    status: "sent" as const,
    accept,
    maxBytes,
    ...ui,
  },
});
/** Several files on one field, in order: X's images. `max` is how many. */
const files = (
  label: string,
  accept: readonly string[],
  maxBytes: number,
  max: number,
  ui: Partial<FieldUi> = {},
) => ({
  zod: z
    .array(z.string().regex(FILE, `${label}: upload a file`))
    .max(max, `${label}: up to ${max}`)
    .optional(),
  ui: { label, input: "files" as const, status: "sent" as const, accept, maxBytes, max, ...ui },
});
/** Shown so the field is seen, never stored: the adapter can't send it yet. */
const dev = (label: string, input: FieldInput, hint: string, ui: Partial<FieldUi> = {}) => ({
  zod: z.never().optional(),
  ui: { label, input, status: "dev" as const, hint, ...ui },
});

/**
 * A carousel's slides (`@wren/core/content/slides`): set when the post is drafted and in its slide
 * editor, which writes the LinkedIn and Instagram drafts of one set together; never a form field.
 */
const slideSet = (kinds: readonly string[]) => ({
  zod: z
    .array(
      z.object({
        title: z
          .string()
          .trim()
          .min(1, "Slides: each needs a title")
          .max(SLIDE_TITLE_MAX, `Slides: a title is up to ${SLIDE_TITLE_MAX} characters`),
        lines: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(SLIDE_LINE_MAX, `Slides: a line is up to ${SLIDE_LINE_MAX} characters`),
          )
          .max(SLIDE_LINES_MAX, `Slides: up to ${SLIDE_LINES_MAX} lines each`),
      }),
    )
    .min(SLIDES_MIN, `Slides: ${SLIDES_MIN} to ${SLIDES_MAX}`)
    .max(SLIDES_MAX, `Slides: ${SLIDES_MIN} to ${SLIDES_MAX}`)
    .optional(),
  ui: {
    label: "Slides",
    input: "slides" as const,
    status: "sent" as const,
    readOnly: true,
    kinds,
  },
});
/** The slides as drawn: a square image each and one PDF, with the set they were drawn from. */
const slideFiles = (kinds: readonly string[]) => ({
  zod: z
    .object({
      images: z.array(z.string().regex(FILE)).max(SLIDES_MAX),
      pdf: z.string().regex(FILE).nullable(),
      of: z.string(),
      at: z.string(),
    })
    .optional(),
  ui: {
    label: "Slide images",
    input: "slides" as const,
    status: "sent" as const,
    readOnly: true,
    kinds,
  },
});

/** One slide set's id: the LinkedIn and Instagram drafts drawn from it share it. */
const deckId = (kinds: readonly string[]) => ({
  zod: z.string().uuid().optional(),
  ui: {
    label: "Slide set",
    input: "slides" as const,
    status: "sent" as const,
    readOnly: true,
    kinds,
  },
});

type Fields = Record<string, Field>;
type SchemaOf<F extends Fields> = z.ZodObject<{ [K in keyof F]: F[K]["zod"] }>;

/** Rules across a shape's fields, past each field's own. */
interface ShapeRules {
  /** Why fields that each pass can't go together (an X poll with images); the schema refuses it. */
  broken?: (v: Record<string, unknown>) => string | null;
  /** What's still to pick before the yes, past the required fields. */
  missing?: (v: Record<string, unknown>) => string[];
  /** The person's yes covers the fields: a change sends an approved post back for another. */
  consent?: true;
}

export interface Shape<F extends Fields = Fields> extends ShapeRules {
  schema: SchemaOf<F>;
  fields: readonly (FieldUi & { key: string })[];
}

function shape<F extends Fields>(fields: F, rules: ShapeRules = {}): Shape<F> {
  const zods = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.zod]));
  const object = z.object(zods);
  const { broken } = rules;
  return {
    schema: (broken
      ? object.superRefine((v, ctx) => {
          const why = broken(v);
          if (why) ctx.addIssue({ code: "custom", message: why });
        })
      : object) as unknown as SchemaOf<F>,
    fields: Object.entries(fields).map(([key, f]) => ({ key, ...f.ui })),
    ...rules,
  };
}

/** Who sees a YouTube upload; the video's Approve picks from the same list (`VIDEO_PRIVACY`). */
export const YOUTUBE_PRIVACY = ["private", "unlisted", "public"] as const;

const LANGUAGES = ["en", "es", "fr", "de", "pt", "it", "nl", "ja", "ko", "zh-Hans", "hi"] as const;
const LANGUAGE_NAMES: Record<(typeof LANGUAGES)[number], string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  ja: "Japanese",
  ko: "Korean",
  "zh-Hans": "Chinese",
  hi: "Hindi",
};
/** A language's name, "English" for "en"; the code itself when the list lacks it. */
export const languageName = (code: string): string =>
  (LANGUAGE_NAMES as Record<string, string>)[code] ?? code;
/** YouTube's assignable categories (US), by id. */
const CATEGORIES = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "19": "Travel & Events",
  "20": "Gaming",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
  "29": "Nonprofits & Activism",
} as const;
const CATEGORY_IDS = Object.keys(CATEGORIES) as [
  keyof typeof CATEGORIES,
  ...(keyof typeof CATEGORIES)[],
];

export const YOUTUBE_TAGS_MAX = 500;
/** YouTube counts a tag with a space as if quoted, and a comma between tags. */
export const tagsLength = (tags: readonly string[]): number =>
  tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

const youtube = shape({
  kind: pick(
    "Kind",
    ["video", "short"],
    { video: "Video", short: "Short" },
    {
      default: "video",
      readOnly: true,
    },
  ),
  title: line("Title", 100, { required: true, column: "title" }),
  privacyStatus: pick(
    "Who sees it",
    YOUTUBE_PRIVACY,
    { private: "Private", unlisted: "Unlisted", public: "Public" },
    { required: true, default: "private", hint: "Scheduled uploads stay private until their time" },
  ),
  madeForKids: flag("Made for kids", {
    required: true,
    default: false,
    hint: "YouTube asks every upload",
  }),
  thumbnail: file("Thumbnail", ["image/jpeg", "image/png"], 2 * MB, {
    kinds: ["video"],
    hint: "JPG or PNG, 1280x720, up to 2 MB",
  }),
  shortThumbnail: {
    zod: z.never().optional(),
    ui: {
      label: "Thumbnail",
      input: "image" as const,
      status: "none" as const,
      kinds: ["short"],
      hint: "YouTube's API can't set a Short's thumbnail. Pick the frame in the YouTube app.",
    },
  },
  tags: {
    zod: z
      .array(z.string().trim().min(1).max(100), { error: "Tags: a list of words" })
      .refine(
        (t) => tagsLength(t) <= YOUTUBE_TAGS_MAX,
        `Tags: up to ${YOUTUBE_TAGS_MAX} characters all told`,
      )
      .optional(),
    ui: {
      label: "Tags",
      input: "list" as const,
      status: "sent" as const,
      maxTotal: YOUTUBE_TAGS_MAX,
    },
  },
  categoryId: pick("Category", CATEGORY_IDS, CATEGORIES, { default: "22" }),
  playlistId: line("Playlist", 64, { hint: "A playlist id, PL…" }, /^[A-Za-z0-9_-]{10,64}$/),
  captions: {
    zod: z
      .string()
      .regex(
        /^(s3:\/\/[^/]+\/.+|https:\/\/\S+|\/\S.*)\.(srt|vtt)$/i,
        "Subtitles: an .srt or .vtt file",
      )
      .optional(),
    ui: {
      label: "Subtitles",
      input: "captions" as const,
      status: "sent" as const,
      accept: ["application/x-subrip", "text/vtt"],
      maxBytes: 2 * MB,
      hint: ".srt or .vtt",
    },
  },
  captionsLanguage: pick("Subtitles language", LANGUAGES, LANGUAGE_NAMES, { default: "en" }),
  defaultLanguage: pick("Title language", LANGUAGES, LANGUAGE_NAMES),
  defaultAudioLanguage: pick("Audio language", LANGUAGES, LANGUAGE_NAMES),
  notifySubscribers: flag("Notify subscribers", { default: true }),
  syntheticMedia: flag("Made with AI", {
    default: false,
    hint: "Realistic altered or synthetic content",
  }),
});

const SUBREDDIT = /^(r\/)?[A-Za-z0-9_]{2,21}$|^u[_/][A-Za-z0-9_-]{3,20}$/;
const reddit = shape({
  subreddit: line(
    "Subreddit",
    23,
    { required: true, hint: "Its name, like startups, or u_YourName for the profile" },
    SUBREDDIT,
  ),
  title: line("Title", 300, { required: true, column: "title" }),
  url: url("Link", { hint: "Set it to make a link post; the body is dropped" }),
  sendReplies: flag("Replies to inbox", { default: true }),
  flair: line("Flair", 64, { hint: "As the sub shows it. Set on the post right after it lands." }),
  nsfw: flag("NSFW", { default: false }),
  spoiler: flag("Spoiler", { default: false }),
  image: dev("Image", "image", "Old Reddit's form, which posts go through, has no image upload."),
});

const linkedin = shape({
  kind: pick(
    "Kind",
    ["post", "document"],
    { post: "Post", document: "Document (PDF)" },
    { default: "post", readOnly: true },
  ),
  visibility: pick(
    "Who sees it",
    ["PUBLIC", "CONNECTIONS"],
    { PUBLIC: "Anyone", CONNECTIONS: "Connections" },
    { default: "PUBLIC" },
  ),
  noReshare: flag("Turn off reshares", { default: false }),
  attachment: file("Image or PDF", ["image/jpeg", "image/png", "application/pdf"], 2 * MB, {
    // No `kinds`: a draft with no kind reads as "video" (`kindOf`). A carousel's own PDF wins.
    hint: "JPEG, PNG or a PDF shown as a document, up to 2 MB. A video goes as the post's own video.",
  }),
  deck: deckId(["document"]),
  slides: slideSet(["document"]),
  rendered: slideFiles(["document"]),
});

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const instagram = shape({
  // A draft with no kind is a Reel: `kindOf` reads it as "video".
  kind: pick(
    "Kind",
    ["video", "carousel"],
    { video: "Reel", carousel: "Carousel" },
    { default: "video", readOnly: true },
  ),
  shareToFeed: flag("Also in Feed", { default: true, kinds: ["video"] }),
  cover: file("Cover", ["image/jpeg"], 2 * MB, {
    hint: "JPEG, 9:16, up to 2 MB",
    kinds: ["video"],
  }),
  thumbOffset: ms("Cover frame", {
    hint: "Milliseconds in; a cover image wins",
    kinds: ["video"],
  }),
  collaborators: {
    zod: z
      .array(z.string().trim().regex(USERNAME, "Collaborators: Instagram usernames"))
      .max(3, "Collaborators: up to 3")
      .optional(),
    ui: {
      label: "Collaborators",
      input: "list" as const,
      status: "sent" as const,
      max: 3,
      hint: "Usernames, up to 3",
    },
  },
  audioName: line("Audio name", 100, { kinds: ["video"] }),
  deck: deckId(["carousel"]),
  slides: slideSet(["carousel"]),
  rendered: slideFiles(["carousel"]),
});

/**
 * TikTok's Direct Post form (`./tiktok.ts`): who can see it has no default, every interaction
 * starts off, and the disclosure starts off with its two choices under it. The person's yes covers
 * these, so a change sends an approved post back for another yes.
 */
const tiktok = shape(
  {
    privacy: pick("Who can see it", TIKTOK_PRIVACY, TIKTOK_PRIVACY_LABELS, {
      required: true,
      hint: "Pick one. The options are the account's own.",
    }),
    allowComment: flag("Allow comment", { default: false }),
    allowDuet: flag("Allow duet", { default: false }),
    allowStitch: flag("Allow stitch", { default: false }),
    disclose: flag(TIKTOK_COPY.disclose, { default: false, hint: TIKTOK_COPY.discloseHint }),
    yourBrand: flag(TIKTOK_COPY.yourBrand, { default: false, hint: TIKTOK_COPY.yourBrandHint }),
    brandedContent: flag(TIKTOK_COPY.brandedContent, {
      default: false,
      hint: TIKTOK_COPY.brandedContentHint,
    }),
    coverMs: ms("Cover frame"),
    aiGenerated: flag("AI-generated label", { default: false }),
  },
  { broken: tiktokBroken, missing: tiktokMissing, consent: true },
);

const POST_ID = /^\d{1,19}$/;
/** X: four images a post, a poll choice 25 characters. */
export const X_IMAGES_MAX = 4;
const X_POLL_OPTION_MAX = 25;
const x = shape(
  {
    kind: pick(
      "Kind",
      ["post", "thread"],
      { post: "Post", thread: "Thread" },
      { default: "post", readOnly: true, hint: "A thread's posts are split by a line of ---" },
    ),
    replySettings: pick(
      "Who can reply",
      ["following", "mentionedUsers", "subscribers", "verified"],
      {
        following: "People you follow",
        mentionedUsers: "People you mention",
        subscribers: "Subscribers",
        verified: "Verified accounts",
      },
      { hint: "Unset: everyone" },
    ),
    replyTo: line("Reply to", 19, { hint: "A post id" }, POST_ID),
    quote: line("Quote", 19, { hint: "A post id" }, POST_ID),
    images: files("Images", ["image/jpeg", "image/png"], 2 * MB, X_IMAGES_MAX, {
      hint: `JPEG or PNG, up to ${X_IMAGES_MAX} with the post's own file, 2 MB each`,
    }),
    poll: {
      zod: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(X_POLL_OPTION_MAX, `Poll: a choice is up to ${X_POLL_OPTION_MAX} characters`),
        )
        .min(2, "Poll: 2 to 4 choices")
        .max(4, "Poll: 2 to 4 choices")
        .optional(),
      ui: {
        label: "Poll",
        input: "list" as const,
        status: "sent" as const,
        max: 4,
        hint: `2 to 4 choices, ${X_POLL_OPTION_MAX} characters each. No images with a poll.`,
      },
    },
    pollMinutes: {
      zod: z
        .number({ error: "Poll length: minutes" })
        .int("Poll length: whole minutes")
        .min(5, "Poll length: 5 minutes to 7 days")
        .max(10_080, "Poll length: 5 minutes to 7 days")
        .optional(),
      ui: {
        label: "Poll length",
        input: "number" as const,
        status: "sent" as const,
        default: 1440,
        hint: "Minutes, 5 to 10080 (7 days)",
      },
    },
  },
  {
    broken: (v) =>
      v.poll && Array.isArray(v.images) && v.images.length
        ? "A post on X takes a poll or images, not both"
        : null,
  },
);

const facebook = shape({
  link: url("Link"),
});

/** A Business Profile post's button: what it says and where it goes. */
const googleBusiness = shape({
  action: pick(
    "Button",
    ["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"],
    {
      LEARN_MORE: "Learn more",
      BOOK: "Book",
      ORDER: "Order online",
      SHOP: "Buy",
      SIGN_UP: "Sign up",
      CALL: "Call now",
    },
    { hint: "Unset: no button" },
  ),
  actionUrl: url("Button link", { hint: "https://… (not for Call now)" }),
});

export const SHAPES = {
  youtube,
  reddit,
  linkedin,
  instagram,
  tiktok,
  x,
  facebook,
  google_business: googleBusiness,
} as const satisfies Record<Platform, Shape>;

export type FieldsOf<P extends Platform> = z.output<(typeof SHAPES)[P]["schema"]>;

/** A refused value, in the words the field editor shows. */
export class ShapeError extends Error {
  override name = "ShapeError";
}

const messageOf = (err: z.ZodError) => {
  const i = err.issues[0];
  return i?.message ?? "a field isn't right";
};

/**
 * The draft's fields for its adapter, typed; a bad one throws `ShapeError`. Keys outside the shape
 * (the publish path's `title`, now carried in the shape) are dropped.
 */
export function fieldsOf<P extends Platform>(platform: P, extra: unknown): FieldsOf<P> {
  const s: Shape = SHAPES[platform];
  const got = s.schema.safeParse(extra ?? {});
  if (!got.success) throw new ShapeError(`${platform}: ${messageOf(got.error)}`);
  return got.data as FieldsOf<P>;
}

/** The person's yes covers this platform's fields (TikTok's): a change asks for it again. */
export const consented = (platform: Platform): boolean =>
  (SHAPES[platform] as Shape).consent === true;

const blank = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The draft's kind on its platform: YouTube's video or Short; one kind elsewhere. */
export const kindOf = (extra: Readonly<Record<string, unknown>> | null | undefined): string =>
  typeof extra?.kind === "string" ? extra.kind : "video";

const onKind = (f: FieldUi, kind: string) => !f.kinds || f.kinds.includes(kind);

/**
 * A patch over the stored fields: `null` or "" unsets one. The result is checked whole. A column
 * field (the title) comes back apart, so the caller writes it to its own column.
 */
export function patchFields(
  platform: Platform,
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): {
  extra: Record<string, unknown>;
  title?: string | null;
  changed: Record<string, [unknown, unknown]>;
} {
  const fields = SHAPES[platform].fields;
  const next: Record<string, unknown> = {};
  for (const f of fields)
    if (!f.column && current[f.key] !== undefined) next[f.key] = current[f.key];
  let title: string | null | undefined;
  const changed: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw new ShapeError(`${platform} has no field ${k}`);
    if (f.status !== "sent") throw new ShapeError(`${f.label} is in development`);
    if (f.readOnly) throw new ShapeError(`${f.label} is set when the post is made`);
    const value = blank(v) ? undefined : typeof v === "string" ? v.trim() : v;
    if (f.column === "title") {
      title = value === undefined ? null : (value as string);
      continue;
    }
    if (JSON.stringify(next[k]) === JSON.stringify(value)) continue;
    changed[k] = [next[k] ?? null, value ?? null];
    if (value === undefined) delete next[k];
    else next[k] = value;
  }
  const checked = fieldsOf(platform, { ...next, ...(title ? { title } : {}) }) as Record<
    string,
    unknown
  >;
  delete checked.title;
  return { extra: checked, ...(title !== undefined ? { title } : {}), changed };
}

/**
 * Why the fields can't go with the post's own file, or null: on X a poll takes no file, a video
 * goes alone, and images run to four with the file counted.
 */
export function mediaUnfit(
  platform: Platform,
  extra: Readonly<Record<string, unknown>> | null | undefined,
  media: Pick<Media, "kind"> | null | undefined,
): string | null {
  if (platform !== "x") return null;
  const images = Array.isArray(extra?.images) ? extra.images.length : 0;
  if (media && Array.isArray(extra?.poll)) return "A post on X takes a poll or a file, not both";
  if (media?.kind === "video" && images) return "A video on X goes alone, with no images";
  if (images + (media ? 1 : 0) > X_IMAGES_MAX)
    return `X takes up to ${X_IMAGES_MAX} images with the post's own file`;
  return null;
}

/** The labels of required fields still unset; the title is the draft's column. */
export function missingFields(
  platform: Platform,
  extra: Readonly<Record<string, unknown>>,
  title: string | null | undefined,
): string[] {
  const kind = kindOf(extra);
  const s: Shape = SHAPES[platform];
  const labels = s.fields
    .filter((f) => f.required && f.status === "sent" && f.default === undefined && onKind(f, kind))
    .filter((f) => blank(f.column === "title" ? title : extra[f.key]))
    .map((f) => f.label);
  return [...new Set([...labels, ...(s.missing?.(extra) ?? [])])];
}

/** The draft's fields as the portal draws them, for its kind. */
export function fieldViews(
  platform: Platform,
  extra: Readonly<Record<string, unknown>>,
  title: string | null | undefined,
): FieldView[] {
  const kind = kindOf(extra);
  return SHAPES[platform].fields
    .filter((f) => onKind(f, kind))
    .map((f) => ({ ...f, value: (f.column === "title" ? title : extra[f.key]) ?? null }));
}

/** A typed value from words (the CLI's `key=value`): on/off, a number, a comma list. */
export function coerceField(platform: Platform, key: string, raw: string): unknown {
  const f = SHAPES[platform].fields.find((x) => x.key === key);
  if (!f) throw new ShapeError(`${platform} has no field ${key}`);
  const v = raw.trim();
  if (v === "") return null;
  if (f.input === "switch") {
    if (/^(true|on|yes|1)$/i.test(v)) return true;
    if (/^(false|off|no|0)$/i.test(v)) return false;
    throw new ShapeError(`${f.label}: on or off`);
  }
  if (f.input === "number") return Number(v);
  if (f.input === "list")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return v;
}
