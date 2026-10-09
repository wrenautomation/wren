/**
 * Marketing → Auto-reply (designs/2026-10-09-auto-reply.md): per channel, what happens when
 * someone writes in. Suggest drafts a reply into To approve; Auto is held and does the same; Off
 * does nothing. Wren's own on InboxDesk, a client's on MarketingConsole. `manage` to change.
 */
import { LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { ERROR, LIST, QUIET, SELECT, SPLIT } from "../work/bits.js";

type Mode = "off" | "suggest" | "auto";
interface Modes {
  modes: Record<string, Mode>;
  held: boolean;
}

const CHANNELS: [string, string][] = [
  ["text", "Texts"],
  ["email", "Email"],
  ["dm", "DMs"],
  ["comment", "Comments"],
];
const MODES: [Mode, string][] = [
  ["off", "Off"],
  ["suggest", "Suggest"],
  ["auto", "Auto"],
];
const SAYS: Record<Mode, string> = {
  off: "Nothing happens until someone opens the thread.",
  suggest: "A reply is drafted a minute after they write and waits in To approve.",
  auto: "Sends the reply when it's safe to; otherwise it waits in To approve.",
};

/** Wren's own through the console, a client's through its Marketing. */
const ask = (client: string, set?: { channel: string; mode: Mode }) =>
  client === WREN.id
    ? call<Modes>("console/call", {
        service: "InboxDesk",
        handler: set ? "autoReplySet" : "autoReplies",
        input: set ?? {},
      })
    : call<Modes>(set ? "marketing/inboxAutoSet" : "marketing/inboxAuto", { client, ...set });

export function AutoReplyPage(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`auto-reply:${props.client}:${nonce}`, () => ask(props.client));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = load.data;
  const set = async (channel: string, mode: Mode) => {
    setBusy(true);
    setError(null);
    try {
      await ask(props.client, { channel, mode });
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Auto-reply"
        lede="What happens when someone writes in, per channel. Every draft reads the whole thread and what you know about them."
      />
      <Section>
        {load.error && !data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !data ? (
          <Loading lines={4} />
        ) : (
          <ul className={`m-0 list-none p-0 ${LIST}`}>
            {CHANNELS.map(([id, name]) => {
              const mode = data.modes[id] ?? "suggest";
              return (
                <li key={id}>
                  <div className={SPLIT}>
                    <span className="grid gap-0.5">
                      <b className="flex items-center gap-2">
                        {name}
                        {mode === "auto" && data.held ? <Tag tone="warn">Held</Tag> : null}
                      </b>
                      <span className={`text-[13px] ${QUIET}`}>
                        {mode === "auto" && data.held
                          ? "Auto is held: nothing sends on its own yet. Drafts wait in To approve."
                          : SAYS[mode]}
                      </span>
                    </span>
                    <select
                      className={SELECT}
                      aria-label={`${name} auto-reply`}
                      value={mode}
                      disabled={busy || props.demo}
                      onChange={(e) => void set(id, e.target.value as Mode)}
                    >
                      {MODES.map(([m, label]) => (
                        <option key={m} value={m}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className={ERROR}>{error}</p> : null}
      </Section>
    </>
  );
}
