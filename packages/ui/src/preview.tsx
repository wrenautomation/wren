/**
 * A message as its reader meets it, on a laptop and on a phone: first the inbox row or lock
 * screen (what shows before the click, cut where those apps cut it), then the message opened.
 * Each frame is drawn at its device's real width, so length and shape read true; the laptop
 * ones are scaled down to fit. A foundation: the channel counts SMS parts and passes them in.
 */
import { type ReactNode, useState } from "react";

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
    };

// Gmail in a laptop window with its nav open; iPhone 15's width.
const LAPTOP = 960;
const LAPTOP_ZOOM = 0.72;
const PHONE = 393;
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
  return [
    ...(kind.subject ? [`subject ${[...kind.subject].length} characters`] : []),
    `${words} ${words === 1 ? "word" : "words"}`,
    `${secs < 60 ? `${secs} s` : `${Math.round(secs / 6) / 10} min`} to read`,
  ];
}

/** What an inbox row shows after the subject: the body on one line. */
const snippetOf = (body: string) => body.replace(/\s+/g, " ").trim();

export function MessagePreview({
  message: kind,
  body: text,
}: {
  message: MessageKind;
  body: string;
}) {
  const [opened, setOpened] = useState<"laptop" | "phone">("phone");
  const whole = kind.kind === "email" && kind.fill?.(text);
  const message = whole ? { ...kind, subject: whole.subject } : kind;
  const body = whole ? whole.body : text;
  const from = message.from || "You";
  const shape = shapeOf(message, body);
  return (
    <section aria-label="How it looks" className="grid min-w-0 gap-3 text-[13px]">
      <p className="text-(--ui-ink-2)">{shape.join(" · ")}</p>
      {message.kind === "email" ? (
        <>
          <Frame label="Inbox, laptop (Gmail)" width={LAPTOP} zoom={LAPTOP_ZOOM}>
            <GmailRow from={from} subject={message.subject} body={body} />
          </Frame>
          <Frame label="Inbox, phone (iPhone Mail)" width={PHONE}>
            <IosMailRow from={from} subject={message.subject} body={body} />
          </Frame>
          <div className="flex items-center gap-3">
            <span className="text-(--ui-ink-2)">Opened on</span>
            {(["phone", "laptop"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={opened === d}
                onClick={() => setOpened(d)}
                className="cursor-pointer text-(--ui-ink-2) underline-offset-4 aria-pressed:text-(--ui-ink) aria-pressed:underline"
              >
                {d}
              </button>
            ))}
          </div>
          {opened === "phone" ? (
            <Frame label="Opened, phone" width={PHONE}>
              <Opened from={from} subject={message.subject} body={body} size={17} pad={16} />
            </Frame>
          ) : (
            <Frame label="Opened, laptop" width={LAPTOP} zoom={LAPTOP_ZOOM}>
              <Opened from={from} subject={message.subject} body={body} size={14} pad={24} />
            </Frame>
          )}
        </>
      ) : (
        <>
          <Frame label="Lock screen" width={PHONE}>
            <div className="m-2 rounded-2xl bg-[#e9e9ee] p-3 text-[15px] leading-[1.3] text-black">
              <p className="flex justify-between font-semibold">
                <span className="truncate">{from}</span>
                <span className="font-normal text-[#6b6b70]">now</span>
              </p>
              <p className="line-clamp-4 break-words">{snippetOf(body)}</p>
            </div>
          </Frame>
          <Frame label="Opened, phone (Messages)" width={PHONE}>
            <div className="flex justify-end p-3">
              <p className="max-w-[75%] rounded-[18px] bg-[#0b84fe] px-3 py-1.5 text-[17px] leading-[1.3] break-words whitespace-pre-wrap text-white">
                {body.trim()}
              </p>
            </div>
          </Frame>
        </>
      )}
    </section>
  );
}

/** A device's width, in white like the apps; scaled when it is a laptop's. */
function Frame({
  label,
  width,
  zoom = 1,
  children,
}: {
  label: string;
  width: number;
  zoom?: number;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 grid min-w-0 gap-1">
      <figcaption className="text-[12px] text-(--ui-ink-3)">{label}</figcaption>
      <div className="max-w-full overflow-x-auto">
        <div
          style={{ width, zoom }}
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

function Opened({
  from,
  subject,
  body,
  size,
  pad,
}: {
  from: string;
  subject?: string | null | undefined;
  body: string;
  size: number;
  pad: number;
}) {
  return (
    <div style={{ padding: pad, fontSize: size }} className="grid gap-3 leading-[1.45]">
      {subject ? <p className="text-[1.3em] font-semibold leading-[1.25]">{subject}</p> : null}
      <p className="font-semibold">{from}</p>
      <div className="break-words whitespace-pre-wrap">{body.trim()}</div>
    </div>
  );
}
