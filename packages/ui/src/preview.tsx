/**
 * A message as its reader meets it, on a laptop and on a phone: first the inbox row or lock
 * screen (what shows before the click, cut where those apps cut it), then the message opened.
 * Each frame is drawn at its device's real width, so length and shape read true; the laptop
 * ones are scaled down to fit. A foundation: the channel counts SMS parts, and knows a post's
 * or a DM's cap and where a feed cuts, and passes them in.
 */
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

export type MessageKind =
  | {
      kind: "email";
      from?: string;
      subject?: string | null;
      /** The whole email around the text, when the text is one part of it (a line of copy). */
      fill?: (text: string) => { subject: string | null; body: string };
    }
  | {
      kind: "sms";
      from?: string;
      /** Billed parts, from the SMS channel's counter. */
      parts?: (text: string) => { parts: number; encoding: string };
      /** The text as sent, when what's typed is a template (`subject` unused). */
      fill?: (text: string) => { subject: string | null; body: string };
    }
  | {
      kind: "post";
      /** The app it posts to: "LinkedIn". */
      site: string;
      from?: string;
      title?: string | null;
      /** The platform's cap on the text. */
      max?: number;
      /** Lines its feed shows before "see more" (null: all of it, 0: none). */
      feed: { laptop: number | null; phone: number | null };
    }
  | {
      kind: "dm";
      /** The app it goes through: "Reddit". */
      site: string;
      from?: string;
      /** A Reddit message's subject line. */
      subject?: string | null;
      max?: number;
      /** The whole message around the text, when the text is one part of it (a template slot). */
      fill?: (text: string) => { subject: string | null; body: string };
    };

// Gmail in a laptop window with its nav open; iPhone 15's width.
const LAPTOP = 960;
const LAPTOP_ZOOM = 0.72;
const PHONE = 393;
// LinkedIn's feed column; the other apps' are within a few dozen pixels.
const FEED = 555;
// LinkedIn's and Reddit's conversation list on a laptop.
const DM_LIST = 340;
const WPM = 238;

/** The numbers a skim checks: subject length, words, time to read; for a text, its parts. */
export function shapeOf(kind: MessageKind, body: string): string[] {
  const text = body.trim();
  const words = text ? text.split(/\s+/).length : 0;
  if (kind.kind === "sms") {
    const p = kind.parts?.(text);
    return [
      `${[...text].length} characters`,
      ...(p ? [`${p.parts} ${p.parts === 1 ? "text" : "texts"} (${p.encoding})`] : []),
    ];
  }
  const secs = Math.max(1, Math.round((words / WPM) * 60));
  const chars = [...text].length;
  return [
    ...((kind.kind === "email" || kind.kind === "dm") && kind.subject
      ? [`subject ${[...kind.subject].length} characters`]
      : []),
    ...(kind.kind === "dm"
      ? [kind.max ? `${chars} of ${kind.max} characters` : `${chars} characters`]
      : []),
    ...(kind.kind === "post"
      ? [
          ...(kind.title ? [`title ${[...kind.title].length} characters`] : []),
          kind.max ? `${chars} of ${kind.max} characters` : `${chars} characters`,
        ]
      : []),
    `${words} ${words === 1 ? "word" : "words"}`,
    `${secs < 60 ? `${secs} s` : `${Math.round(secs / 6) / 10} min`} to read`,
  ];
}

/** What an inbox row shows after the subject: the body on one line. */
const snippetOf = (body: string) => body.replace(/\s+/g, " ").trim();

export function MessagePreview({
  message: kind,
  body: text,
  reader = false,
}: {
  message: MessageKind;
  body: string;
  /**
   * For someone who reads it and doesn't write it (a client's recap): the opened message at the
   * page's width, without the device frames and the skim's numbers.
   */
  reader?: boolean;
}) {
  const [opened, setOpened] = useState<"laptop" | "phone">("phone");
  const whole = "fill" in kind ? kind.fill?.(text) : undefined;
  const message = whole && kind.kind !== "sms" ? { ...kind, subject: whole.subject } : kind;
  const body = whole ? whole.body : text;
  const from = message.from || "You";
  const shape = shapeOf(message, body);
  if (reader && message.kind === "email")
    return (
      <section
        aria-label="The message"
        className="min-w-0 overflow-hidden border border-(--ui-hair) bg-white font-[system-ui] text-black"
      >
        <Opened from={from} subject={message.subject} body={body} size={15} pad={16} links />
      </section>
    );
  const openedOn = (
    <div className="flex items-center gap-3">
      <span className="text-(--ui-ink-2)">Opened on</span>
      {(["phone", "laptop"] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={opened === d}
          onClick={() => setOpened(d)}
          className="cursor-pointer border-0 bg-transparent p-0 text-(--ui-ink-2) underline-offset-4 aria-pressed:text-(--ui-ink) aria-pressed:underline"
        >
          {d}
        </button>
      ))}
    </div>
  );
  return (
    <section aria-label="How it looks" className="grid min-w-0 gap-3 text-[13px]">
      <p className="text-(--ui-ink-2)">{shape.join(" · ")}</p>
      {message.kind === "dm" ? (
        <>
          <DeviceFrame label={`Messages, laptop (${message.site})`} width={DM_LIST}>
            <div className="flex items-center gap-3 px-3 py-2.5 text-[14px] leading-[1.3]">
              <span className="size-10 shrink-0 rounded-full bg-[#d9d9de]" />
              <span className="grid min-w-0 flex-1">
                <span className="flex justify-between gap-2 font-semibold">
                  <span className="truncate">{from}</span>
                  <span className="shrink-0 font-normal text-[#6b6b70]">now</span>
                </span>
                <span className="truncate text-[#6b6b70]">
                  {message.subject ? `${message.subject}: ` : ""}
                  {snippetOf(body)}
                </span>
              </span>
            </div>
          </DeviceFrame>
          <DeviceFrame label={`Lock screen (${message.site})`} width={PHONE}>
            <LockScreen
              from={from}
              body={`${message.subject ? `${message.subject}\n` : ""}${body}`}
            />
          </DeviceFrame>
          {openedOn}
          <DeviceFrame label={`Opened, ${opened}`} width={opened === "phone" ? PHONE : FEED}>
            {message.subject ? <p className="px-3 pt-3 font-semibold">{message.subject}</p> : null}
            <Bubble body={body} size={opened === "phone" ? 17 : 14} />
          </DeviceFrame>
        </>
      ) : message.kind === "post" ? (
        <>
          {(["laptop", "phone"] as const).map((d) => (
            <DeviceFrame
              key={d}
              label={`Feed, ${d} (${message.site}${cutOf(message.feed[d])})`}
              width={d === "phone" ? PHONE : FEED}
            >
              <FeedPost
                from={from}
                title={message.title}
                body={body}
                lines={message.feed[d]}
                size={d === "phone" ? 15 : 14}
              />
            </DeviceFrame>
          ))}
          {openedOn}
          <DeviceFrame label={`Opened, ${opened}`} width={opened === "phone" ? PHONE : FEED}>
            <FeedPost
              from={from}
              title={message.title}
              body={body}
              lines={null}
              size={opened === "phone" ? 15 : 14}
            />
          </DeviceFrame>
        </>
      ) : message.kind === "email" ? (
        <>
          <DeviceFrame label="Inbox, laptop (Gmail)" width={LAPTOP} zoom={LAPTOP_ZOOM}>
            <GmailRow from={from} subject={message.subject} body={body} />
          </DeviceFrame>
          <DeviceFrame label="Inbox, phone (iPhone Mail)" width={PHONE}>
            <IosMailRow from={from} subject={message.subject} body={body} />
          </DeviceFrame>
          {openedOn}
          {opened === "phone" ? (
            <DeviceFrame label="Opened, phone" width={PHONE}>
              <Opened from={from} subject={message.subject} body={body} size={17} pad={16} />
            </DeviceFrame>
          ) : (
            <DeviceFrame label="Opened, laptop" width={LAPTOP} zoom={LAPTOP_ZOOM}>
              <Opened from={from} subject={message.subject} body={body} size={14} pad={24} />
            </DeviceFrame>
          )}
        </>
      ) : (
        <>
          <DeviceFrame label="Lock screen" width={PHONE}>
            <LockScreen from={from} body={body} />
          </DeviceFrame>
          <DeviceFrame label="Opened, phone (Messages)" width={PHONE}>
            <Bubble body={body} size={17} />
          </DeviceFrame>
        </>
      )}
    </section>
  );
}

/** A phone's notification: who, then four lines of it. */
const LockScreen = ({ from, body }: { from: string; body: string }) => (
  <div className="m-2 rounded-2xl bg-[#e9e9ee] p-3 text-[15px] leading-[1.3] text-black">
    <p className="flex justify-between font-semibold">
      <span className="truncate">{from}</span>
      <span className="font-normal text-[#6b6b70]">now</span>
    </p>
    <p className="line-clamp-4 break-words">{snippetOf(body)}</p>
  </div>
);

/** Ours, in a chat: right side, blue. */
const Bubble = ({ body, size }: { body: string; size: number }) => (
  <div className="flex justify-end p-3">
    <p
      style={{ fontSize: size }}
      className="max-w-[75%] rounded-[18px] bg-[#0b84fe] px-3 py-1.5 leading-[1.3] break-words whitespace-pre-wrap text-white"
    >
      {body.trim()}
    </p>
  </div>
);

/**
 * A device's width, in white like the apps; scaled when it is a laptop's. The platform previews
 * (a YouTube watch page, a Reel) draw in it too.
 */
export function DeviceFrame({
  label,
  width,
  zoom = 1,
  children,
}: {
  label?: string | undefined;
  width: number;
  zoom?: number;
  children: ReactNode;
}) {
  // The device keeps its width, so lines break where they would on it; a column narrower than
  // the device shows it smaller instead of cutting it off or scrolling sideways.
  const room = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(zoom);
  useEffect(() => {
    const el = room.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFit(Math.min(zoom, el.clientWidth / width) || zoom);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width, zoom]);
  return (
    <figure className="m-0 grid min-w-0 gap-1">
      {label ? <figcaption className="text-[12px] text-(--ui-ink-3)">{label}</figcaption> : null}
      <div ref={room} className="max-w-full min-w-0 overflow-hidden">
        <div
          style={{ width, zoom: fit }}
          className="overflow-hidden border border-[#d9d9de] bg-white font-[system-ui] text-black"
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

function GmailRow({
  from,
  subject,
  body,
}: {
  from: string;
  subject?: string | null | undefined;
  body: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
      <span className="w-[168px] shrink-0 truncate font-bold">{from}</span>
      <span className="min-w-0 flex-1 truncate">
        {subject ? <b>{subject}</b> : null}
        <span className="text-[#5f6368]">
          {subject ? " - " : ""}
          {snippetOf(body)}
        </span>
      </span>
      <span className="shrink-0 text-[12px] font-bold">9:41 AM</span>
    </div>
  );
}

function IosMailRow({
  from,
  subject,
  body,
}: {
  from: string;
  subject?: string | null | undefined;
  body: string;
}) {
  return (
    <div className="grid gap-0.5 px-4 py-2.5 leading-[1.3]">
      <p className="flex justify-between gap-2 text-[17px] font-semibold">
        <span className="truncate">{from}</span>
        <span className="shrink-0 text-[15px] font-normal text-[#8a8a8e]">9:41</span>
      </p>
      {subject ? <p className="truncate text-[15px]">{subject}</p> : null}
      <p className="line-clamp-2 text-[15px] text-[#8a8a8e]">{snippetOf(body)}</p>
    </div>
  );
}

/** A plain-text line that ends in an address: "The full picture: https://…". */
const LINE_LINK = /^(.+?):\s+(https?:\/\/\S+)$/;

/** The body with each such line as its words, linked, the way a mail app shows a link. */
function linked(body: string): ReactNode {
  return body.split("\n").map((line, i) => {
    const m = LINE_LINK.exec(line);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: lines have no other identity.
      <Fragment key={i}>
        {i ? "\n" : null}
        {m ? (
          <a href={m[2]} className="text-[#0b57d0] underline underline-offset-2">
            {m[1]}
          </a>
        ) : (
          line
        )}
      </Fragment>
    );
  });
}

function Opened({
  from,
  subject,
  body,
  size,
  pad,
  links = false,
}: {
  from: string;
  subject?: string | null | undefined;
  body: string;
  size: number;
  pad: number;
  /** Lines ending in an address read as linked words (a reader's preview). */
  links?: boolean;
}) {
  return (
    <div style={{ padding: pad, fontSize: size }} className="grid gap-3 leading-[1.45]">
      {subject ? (
        <p className="text-[1.3em] font-semibold leading-[1.25] break-words">{subject}</p>
      ) : null}
      <p className="font-semibold">{from}</p>
      <div className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {links ? linked(body.trim()) : body.trim()}
      </div>
    </div>
  );
}

/** Where a feed cuts, for a frame's label. */
const cutOf = (lines: number | null) =>
  lines === null
    ? ", the whole post"
    : lines === 0
      ? ", text behind more"
      : `, ${lines} lines then more`;

/** A post in a feed: who, its title, its text cut at `lines` (null: all of it, 0: none). */
function FeedPost({
  from,
  title,
  body,
  lines,
  size,
}: {
  from: string;
  title?: string | null | undefined;
  body: string;
  lines: number | null;
  size: number;
}) {
  return (
    <div style={{ fontSize: size }} className="grid gap-2 p-4 leading-[1.4]">
      <p className="flex items-center gap-2 font-semibold">
        <span className="size-8 shrink-0 rounded-full bg-[#d9d9de]" />
        <span className="truncate">{from}</span>
        <span className="ml-auto shrink-0 font-normal text-[#6b6b70]">now</span>
      </p>
      {title ? <p className="text-[1.15em] font-semibold leading-[1.25]">{title}</p> : null}
      {lines === 0 ? null : (
        <div
          style={
            lines === null
              ? undefined
              : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }
          }
          className="overflow-hidden break-words whitespace-pre-wrap"
        >
          {body.trim()}
        </div>
      )}
    </div>
  );
}
