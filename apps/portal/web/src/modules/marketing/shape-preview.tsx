/**
 * A post as its platform shows it, live as he types (designs/2026-10-07-post-shapes.md): YouTube's
 * home, search and watch page, a Short, a Reel, TikTok, a Reddit post, LinkedIn's feed and an X
 * post. Each draws in the device frame the message previews use, at the app's own width. A
 * platform without its own card (Facebook) keeps the generic feed preview.
 */
import type { FieldView } from "@wren/core/content/shapes";
import { DeviceFrame, type MessageKind, MessagePreview, useDraftText } from "@wren/ui";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import type { Shape } from "./fields.js";
import { CarouselPreview, onSlidesTyped, slidesTyped } from "./slides.js";
import { XThread } from "./thread.js";

const PHONE = 393;
const GRAY = "text-[#6b6b70]";
const ART = "grid place-items-center bg-[#e9e9ee] px-4 text-center text-[13px] text-[#6b6b70]";
const ON_ART = "text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]";

type Device = "phone" | "laptop";

const fieldValue = (fields: FieldView[], key: string) => fields.find((f) => f.key === key)?.value;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const on = (fields: FieldView[], key: string) => {
  const f = fields.find((x) => x.key === key);
  return (typeof f?.value === "boolean" ? f.value : f?.default) === true;
};
const pickLabel = (fields: FieldView[], key: string) => {
  const f = fields.find((x) => x.key === key);
  const v = (f?.value ?? f?.default) as string | undefined;
  return f?.options?.find((o) => o.value === v)?.label ?? v ?? null;
};

/** A round mark for the account. */
const Avatar = ({ size, letter = "W" }: { size: number; letter?: string }) => (
  <span
    style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    className="grid shrink-0 place-items-center rounded-full bg-[#d9d9de] font-semibold text-black"
  >
    {letter}
  </span>
);

/** The picture a post leads with: its image, a frame of its video, or what the app picks. */
function Art({
  src,
  video,
  at,
  ratio,
  empty,
  children,
}: {
  src: string | null;
  video?: string | null | undefined;
  /** Seconds into the video for its frame. */
  at?: number | undefined;
  ratio: string;
  empty: string;
  children?: ReactNode;
}) {
  return (
    <div className={`relative w-full overflow-hidden ${ratio}`}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : video ? (
        <video
          src={`${video}#t=${at ?? 0.1}`}
          preload="metadata"
          muted
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className={`absolute inset-0 ${ART}`}>{empty}</div>
      )}
      {children}
    </div>
  );
}

/** Phone or laptop, where the app draws them differently. */
function Devices({ value, set }: { value: Device; set: (d: Device) => void }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      {(["phone", "laptop"] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => set(d)}
          className="cursor-pointer border-0 bg-transparent p-0 text-(--ui-ink-2) underline-offset-4 aria-pressed:text-(--ui-ink) aria-pressed:underline"
        >
          {d === "phone" ? "Phone" : "Laptop"}
        </button>
      ))}
    </div>
  );
}

/** What every card reads: the words and title as typed, the fields as set. */
interface Post {
  s: Shape;
  text: string;
  title: string;
  fields: FieldView[];
  device: Device;
}

const videoOf = (s: Shape) => (s.media?.kind === "video" ? (s.links.media ?? null) : null);
const secs = (ms: unknown) => (typeof ms === "number" ? ms / 1000 : undefined);

/** YouTube's line under a title. */
const ytMeta = "No views · Just now";

function YouTubeVideo({ s, text, title, device }: Post) {
  const thumb = s.links.thumbnail ?? null;
  const art = (
    <Art
      src={thumb}
      video={videoOf(s)}
      ratio="aspect-video"
      empty="No thumbnail: YouTube picks a frame"
    />
  );
  const name = title || "No title";
  if (device === "phone")
    return (
      <>
        <DeviceFrame label="Home and search, phone" width={PHONE}>
          {art}
          <div className="flex gap-3 px-3 pt-3 pb-4">
            <Avatar size={36} />
            <div className="grid min-w-0 gap-0.5">
              <p className="line-clamp-2 text-[14px] leading-5 font-semibold">{name}</p>
              <p className={`text-[12px] ${GRAY}`}>Wren Automation · {ytMeta}</p>
            </div>
          </div>
        </DeviceFrame>
        <DeviceFrame label="Watch page, phone" width={PHONE}>
          {art}
          <div className="grid gap-2 p-3">
            <p className="line-clamp-2 text-[18px] leading-6 font-bold">{name}</p>
            <p className={`text-[12px] ${GRAY}`}>
              {ytMeta} <span className="font-semibold text-black">...more</span>
            </p>
            <div className="flex items-center gap-2.5">
              <Avatar size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                Wren Automation
              </span>
              <span className="rounded-full bg-black px-3 py-1.5 text-[13px] font-semibold text-white">
                Subscribe
              </span>
            </div>
          </div>
        </DeviceFrame>
      </>
    );
  return (
    <>
      <DeviceFrame label="Home, laptop" width={360}>
        <div className="p-2">
          <div className="overflow-hidden rounded-xl">{art}</div>
          <div className="flex gap-3 pt-3 pb-2">
            <Avatar size={36} />
            <div className="grid min-w-0 gap-0.5">
              <p className="line-clamp-2 text-[16px] leading-[22px] font-semibold">{name}</p>
              <p className={`text-[14px] ${GRAY}`}>Wren Automation</p>
              <p className={`text-[14px] ${GRAY}`}>{ytMeta}</p>
            </div>
          </div>
        </div>
      </DeviceFrame>
      <DeviceFrame label="Search, laptop" width={600}>
        <div className="flex gap-4 p-3">
          <div className="w-[260px] shrink-0 overflow-hidden rounded-lg">{art}</div>
          <div className="grid min-w-0 content-start gap-1.5">
            <p className="line-clamp-2 text-[18px] leading-[26px]">{name}</p>
            <p className={`text-[12px] ${GRAY}`}>{ytMeta}</p>
            <p className={`flex items-center gap-2 text-[12px] ${GRAY}`}>
              <Avatar size={24} /> Wren Automation
            </p>
            <p className={`line-clamp-2 text-[12px] ${GRAY}`}>{text.replace(/\s+/g, " ")}</p>
          </div>
        </div>
      </DeviceFrame>
      <DeviceFrame label="Watch page, laptop" width={600}>
        {art}
        <div className="grid gap-3 p-3">
          <p className="line-clamp-2 text-[20px] leading-7 font-bold">{name}</p>
          <div className="flex items-center gap-3">
            <Avatar size={40} />
            <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">
              Wren Automation
            </span>
            <span className="rounded-full bg-black px-4 py-2 text-[14px] font-semibold text-white">
              Subscribe
            </span>
          </div>
          <div className="grid gap-1 rounded-xl bg-[#e9e9ee] p-3 text-[14px]">
            <p className="font-semibold">{ytMeta}</p>
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{text.trim()}</p>
            <p className="font-semibold">...more</p>
          </div>
        </div>
      </DeviceFrame>
    </>
  );
}

/** A tall video's right edge: what a viewer taps. */
function Rail({ items }: { items: (string | null)[] }) {
  return (
    <div className={`absolute right-2 bottom-24 grid justify-items-center gap-4 ${ON_ART}`}>
      {items.map((label, i) =>
        label === null ? null : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed rail; order is identity.
          <span key={i} className="grid justify-items-center gap-1 text-[11px] font-semibold">
            <span className="size-9 rounded-full bg-white/25" />
            {label}
          </span>
        ),
      )}
    </div>
  );
}

/** The dark wash under a tall video's words. */
const Wash = ({ children }: { children: ReactNode }) => (
  <div
    className={`absolute inset-x-0 bottom-0 grid gap-1.5 bg-linear-to-t from-black/70 to-transparent p-3 pt-10 pr-16 ${ON_ART}`}
  >
    {children}
  </div>
);

/** Two tall frames side by side: where it's found, and playing. */
const Pair = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">{children}</div>
);

function YouTubeShort({ s, text, title }: Post) {
  const video = videoOf(s);
  const name = title || "No title";
  return (
    <Pair>
      <DeviceFrame label="Shorts shelf" width={180}>
        <Art src={null} video={video} ratio="aspect-[9/16]" empty="A frame YouTube picks">
          <div className={`absolute inset-x-0 bottom-0 grid gap-0.5 p-2 ${ON_ART}`}>
            <p className="line-clamp-2 text-[14px] leading-[18px] font-semibold">{name}</p>
            <p className="text-[12px]">No views</p>
          </div>
        </Art>
      </DeviceFrame>
      <DeviceFrame label="Shorts player" width={300}>
        <Art src={null} video={video} ratio="aspect-[9/16]" empty="A frame YouTube picks">
          <Rail items={["Like", "Dislike", "0", "Share"]} />
          <Wash>
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <Avatar size={26} /> @wrenautomation
              <span className="rounded-full bg-white px-2.5 py-1 text-[12px] text-black [text-shadow:none]">
                Subscribe
              </span>
            </p>
            <p className="line-clamp-2 text-[13px] leading-[18px]">{name}</p>
            {text.trim() ? (
              <p className="line-clamp-1 text-[12px] opacity-90">{text.replace(/\s+/g, " ")}</p>
            ) : null}
          </Wash>
        </Art>
      </DeviceFrame>
    </Pair>
  );
}

function Reel({ s, text, fields }: Post) {
  const cover = s.links.cover ?? null;
  const at = secs(fieldValue(fields, "thumbOffset"));
  const collab = (fieldValue(fields, "collaborators") as string[] | undefined) ?? [];
  const audio = str(fieldValue(fields, "audioName"));
  const feed = on(fields, "shareToFeed");
  const empty = at === undefined ? "The first frame" : `The frame at ${at} s`;
  return (
    <Pair>
      <DeviceFrame label={feed ? "Profile grid" : "Reels tab only"} width={180}>
        <Art src={cover} video={videoOf(s)} at={at} ratio="aspect-[3/4]" empty={empty} />
      </DeviceFrame>
      <DeviceFrame label="Reel" width={300}>
        <Art src={cover} video={videoOf(s)} at={at} ratio="aspect-[9/16]" empty={empty}>
          <Rail items={["0", "0", "Share"]} />
          <Wash>
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold">
              <Avatar size={26} />
              <span className="min-w-0">
                wrenautomation{collab.length ? ` and ${collab.join(", ")}` : ""}
              </span>
              <span className="rounded-md border border-white/70 px-2 py-0.5 text-[12px]">
                Follow
              </span>
            </p>
            <p className="line-clamp-2 text-[13px] leading-[18px]">{text.trim() || "No caption"}</p>
            <p className="truncate text-[12px] opacity-90">
              ♫ {audio ?? "wrenautomation · Original audio"}
            </p>
          </Wash>
        </Art>
      </DeviceFrame>
    </Pair>
  );
}

function TikTok({ s, text, fields }: Post) {
  const at = secs(fieldValue(fields, "coverMs"));
  const who = pickLabel(fields, "privacy");
  const labels = [
    on(fields, "aiGenerated") ? "Creator labeled as AI-generated" : null,
    on(fields, "brandContent") ? "Paid partnership" : null,
    on(fields, "brandOrganic") ? "Promotional content" : null,
  ].filter((x): x is string => !!x);
  return (
    <Pair>
      <DeviceFrame label="Profile grid" width={180}>
        <Art src={null} video={videoOf(s)} at={at} ratio="aspect-[3/4]" empty="The cover frame">
          <p className={`absolute bottom-1.5 left-2 text-[12px] font-semibold ${ON_ART}`}>▷ 0</p>
        </Art>
      </DeviceFrame>
      <DeviceFrame label="For You" width={300}>
        <Art src={null} video={videoOf(s)} at={at} ratio="aspect-[9/16]" empty="The cover frame">
          {who && who !== "Everyone" ? (
            <span className="absolute top-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[12px] font-semibold text-white">
              {who}
            </span>
          ) : null}
          <Rail items={["0", on(fields, "noComment") ? null : "0", "0", "Share"]} />
          <Wash>
            <p className="text-[14px] font-semibold">wrenautomation</p>
            <p className="line-clamp-3 text-[13px] leading-[18px]">{text.trim() || "No caption"}</p>
            {labels.map((l) => (
              <span
                key={l}
                className="w-fit rounded-sm bg-white/25 px-1.5 py-0.5 text-[11px] font-semibold"
              >
                {l}
              </span>
            ))}
          </Wash>
        </Art>
      </DeviceFrame>
    </Pair>
  );
}

function Reddit({ text, title, fields, device }: Post) {
  const sub = str(fieldValue(fields, "subreddit"))?.replace(/^r\//, "") ?? null;
  const link = str(fieldValue(fields, "url"));
  const host = link ? link.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0] : null;
  const phone = device === "phone";
  return (
    <DeviceFrame label={`Feed, ${device}`} width={phone ? PHONE : 640}>
      <div className="grid gap-2 p-4">
        <p className="flex items-center gap-2 text-[12px]">
          <Avatar size={24} letter="r/" />
          <span className="font-semibold">{sub ? `r/${sub}` : "No subreddit"}</span>
          <span className={GRAY}>· Just now</span>
        </p>
        <p className={`${phone ? "text-[17px]" : "text-[18px]"} leading-snug font-semibold`}>
          {title || "No title"}
        </p>
        {link ? (
          <p className="flex items-center justify-between gap-3 rounded-xl border border-[#d9d9de] px-3 py-2.5 text-[13px]">
            <span className="min-w-0 truncate">{host}</span>
            <span className={GRAY}>↗</span>
          </p>
        ) : text.trim() ? (
          <p
            className={`${phone ? "line-clamp-3" : "line-clamp-4"} text-[14px] leading-5 whitespace-pre-wrap break-words`}
          >
            {text.trim()}
          </p>
        ) : null}
        <p className="flex gap-2 pt-1 text-[12px] font-semibold">
          {["▲ Vote ▼", "0 comments", "Share"].map((x) => (
            <span key={x} className="rounded-full bg-[#e9e9ee] px-3 py-1.5">
              {x}
            </span>
          ))}
        </p>
      </div>
    </DeviceFrame>
  );
}

function LinkedIn({ text, fields, device, feed }: Post & { feed: number | null }) {
  const [open, setOpen] = useState(false);
  const who = pickLabel(fields, "visibility") ?? "Anyone";
  const cut = open ? null : feed;
  return (
    <DeviceFrame label={`Feed, ${device}`} width={device === "phone" ? PHONE : 555}>
      <div className="grid gap-3 p-4 text-[14px] leading-5">
        <div className="flex items-center gap-2.5">
          <Avatar size={48} />
          <span className="grid">
            <span className="font-semibold">Wren Automation</span>
            <span className={`text-[12px] ${GRAY}`}>Now · {who}</span>
          </span>
        </div>
        <div>
          <p
            style={
              cut
                ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: cut }
                : undefined
            }
            className="overflow-hidden whitespace-pre-wrap break-words"
          >
            {text.trim() || "No text"}
          </p>
          {feed ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className={`cursor-pointer border-0 bg-transparent p-0 text-[14px] ${GRAY}`}
            >
              {open ? "...less" : "...more"}
            </button>
          ) : null}
        </div>
        <p
          className={`flex justify-between border-t border-[#d9d9de] pt-2 text-[13px] font-semibold ${GRAY}`}
        >
          <span>Like</span>
          <span>Comment</span>
          <span>{on(fields, "noReshare") ? "Repost off" : "Repost"}</span>
          <span>Send</span>
        </p>
      </div>
    </DeviceFrame>
  );
}

const REPLIES: Record<string, string> = {
  following: "Accounts we follow can reply",
  mentionedUsers: "Only accounts we mention can reply",
  subscribers: "Only subscribers can reply",
  verified: "Only verified accounts can reply",
};

function X({ s, text, fields }: Post) {
  const replyTo = str(fieldValue(fields, "replyTo"));
  const quote = str(fieldValue(fields, "quote"));
  const replies = str(fieldValue(fields, "replySettings"));
  return (
    <DeviceFrame label="Timeline, phone" width={PHONE}>
      <div className="flex gap-3 p-4 text-[15px] leading-5">
        <Avatar size={40} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <p className="truncate">
            <span className="font-bold">Wren Automation</span>{" "}
            <span className={GRAY}>@wrenautomation · now</span>
          </p>
          {replyTo ? <p className={`text-[14px] ${GRAY}`}>Replying to post {replyTo}</p> : null}
          <p className="whitespace-pre-wrap break-words">{text.trim() || "No text"}</p>
          {s.media ? (
            <Art
              src={s.media.kind === "image" ? (s.links.media ?? null) : null}
              video={videoOf(s)}
              ratio="aspect-video rounded-2xl border border-[#d9d9de]"
              empty={s.media.name}
            />
          ) : null}
          {quote ? (
            <p className={`rounded-2xl border border-[#d9d9de] p-3 text-[14px] ${GRAY}`}>
              Quoting post {quote}
            </p>
          ) : null}
          {replies ? (
            <p className="text-[13px] font-semibold text-[#0b84fe]">
              {REPLIES[replies] ?? replies}
            </p>
          ) : null}
          <p className={`flex justify-between pt-1 text-[13px] ${GRAY}`}>
            <span>Reply</span>
            <span>Repost</span>
            <span>Like</span>
            <span>Views</span>
          </p>
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Which platforms draw their own card, and whether phone and laptop differ there. */
const OWN: Record<string, { devices: boolean }> = {
  youtube: { devices: true },
  reddit: { devices: true },
  linkedin: { devices: true },
  instagram: { devices: false },
  tiktok: { devices: false },
  x: { devices: false },
};

/** The fields as last typed (`typed`): the saved value until a key is typed over. */
export type Typed = (key: string) => { has: boolean; value: unknown };

/**
 * The post on its platform, beside the editor. `typed` reads a field as typed; the words come from
 * the draft box as typed. `look` is the generic feed preview, for a platform without its own card.
 * `link` is the funnel's, appended on its own line as the post goes out.
 */
export function PlatformPreview({
  shape,
  typed,
  look,
  link = null,
}: {
  shape: Shape;
  typed: Typed;
  look: MessageKind | null;
  link?: string | null;
}) {
  const live = useDraftText();
  const [device, setDevice] = useState<Device>("phone");
  const typedSlides = useSyncExternalStore(onSlidesTyped, () => slidesTyped(shape.draftId));
  const words = live ?? shape.text;
  const text = link && words.trim() ? `${words.trimEnd()}\n\n${link}` : words;
  const fields = shape.fields.map((f) => {
    const t = typed(f.key);
    return t.has ? { ...f, value: t.value } : f;
  });
  const t = typed("title");
  const title = String((t.has ? t.value : shape.title) ?? "").trim();
  const own = OWN[shape.platform];
  const post: Post = { s: shape, text, title, fields, device };
  const short = shape.platform === "youtube" && shape.kind === "short";
  const who =
    shape.platform === "youtube"
      ? pickLabel(fields, "privacyStatus")
      : shape.platform === "tiktok"
        ? pickLabel(fields, "privacy")
        : null;
  const feed = look?.kind === "post" ? look.feed[device] : 3;
  const thread = Boolean(shape.thread);
  const carousel = shape.carousel;
  return (
    <section aria-label={`On ${shape.site}`} className="grid min-w-0 gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">
          On {shape.site}
          {short ? " Shorts" : ""}
          {thread
            ? ", as a thread"
            : carousel
              ? shape.platform === "linkedin"
                ? ", as a PDF"
                : ", as a carousel"
              : ""}
          {who ? <span className="font-normal text-(--ui-ink-3)"> · {who}</span> : null}
        </h3>
        {own?.devices && !short && !carousel ? <Devices value={device} set={setDevice} /> : null}
      </div>
      {thread ? (
        <XThread text={words} link={link} />
      ) : carousel ? (
        <CarouselPreview
          platform={shape.platform}
          slides={typedSlides ?? carousel.slides}
          text={words}
        />
      ) : !own ? (
        look && text.trim() ? (
          <MessagePreview message={look} body={text} />
        ) : (
          <p className="text-[13px] text-(--ui-ink-2)">The preview shows once there are words.</p>
        )
      ) : shape.platform === "youtube" ? (
        short ? (
          <YouTubeShort {...post} />
        ) : (
          <YouTubeVideo {...post} />
        )
      ) : shape.platform === "instagram" ? (
        <Reel {...post} />
      ) : shape.platform === "tiktok" ? (
        <TikTok {...post} />
      ) : shape.platform === "reddit" ? (
        <Reddit {...post} />
      ) : shape.platform === "linkedin" ? (
        <LinkedIn {...post} feed={feed} />
      ) : (
        <X {...post} />
      )}
    </section>
  );
}
