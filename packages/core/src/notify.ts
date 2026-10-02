/**
 * Nudges to the operator: a `Notifier` seam with three forms — none, console,
 * Discord webhook. A notification is a pointer, not a mirror: "2 new replies
 * from will@…", never the reply text, never an address we mailed. Nothing here
 * throws into the caller: a webhook that is down is logged as `false` and the
 * campaign keeps going. The webhook URL authorises posting into the channel, so
 * it is a secret: read once from settings, never in argv, a log line or a
 * ledger row.
 */

/**
 * How loud: `info` is a routine report (posted silent, no push); `action`
 * means someone waits on William (a reply, a booking); `warning` means
 * something broke or stopped. `action` and `warning` ping him.
 */
export type NotifyLevel = "info" | "action" | "warning";

/** Whether this level should reach William's phone, not just the channel. */
export const pings = (level: NotifyLevel): boolean => level !== "info";

export interface Notifier {
  readonly name: string;
  /** True when the message went out; false when it could not (already logged). */
  notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean>;
}

export const NOTIFIER_KINDS = ["none", "console", "discord"] as const;
export type NotifierKind = (typeof NOTIFIER_KINDS)[number];

export class NoneNotifier implements Notifier {
  readonly name = "none";
  async notify(): Promise<boolean> {
    return false;
  }
}

export class ConsoleNotifier implements Notifier {
  readonly name = "console";
  constructor(private readonly write: (line: string) => void = console.log) {}
  async notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean> {
    this.write(`[notify:${level}] ${title}${body ? `\n${body}` : ""}`);
    return true;
  }
}

/** Discord rejects content over 2000 chars; a long digest is cut, never refused. */
const DISCORD_CONTENT_LIMIT = 1900;
const MARK: Record<NotifyLevel, string> = { info: "", action: "🔔 ", warning: "⚠️ " };
/** Discord's @silent: the post lands, no push or sound. */
const SUPPRESS_NOTIFICATIONS = 1 << 12;

export class DiscordNotifier implements Notifier {
  readonly name = "discord";
  constructor(
    private readonly webhookUrl: string,
    private readonly http: typeof fetch = fetch,
    private readonly log: (line: string) => void = console.warn,
    /** William's Discord user id: a ping @mentions him, so it reaches him under "only @mentions". */
    private readonly pingUserId?: string,
  ) {}

  async notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean> {
    const loud = pings(level);
    const mention = loud && this.pingUserId ? `<@${this.pingUserId}> ` : "";
    const text = `${mention}${MARK[level]}**${title}**${body ? `\n${body}` : ""}`.slice(
      0,
      DISCORD_CONTENT_LIMIT,
    );
    try {
      const res = await this.http(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: text,
          // Only the one mention we put there: a body quoting "@everyone" pings nobody.
          allowed_mentions: { parse: [], users: mention ? [this.pingUserId] : [] },
          ...(loud ? {} : { flags: SUPPRESS_NOTIFICATIONS }),
        }),
      });
      if (!res.ok) {
        this.log(`discord notify failed: HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      // The URL is a secret: log the error class, never the request.
      this.log(`discord notify failed: ${err instanceof Error ? err.name : "error"}`);
      return false;
    }
  }
}

/**
 * One ping, many subscribers: Discord, a text to William, the console. Every
 * subscriber is a `Notifier`, so callers never know how many there are. One
 * subscriber failing never stops the others; true when any one delivered.
 */
export class Broadcast implements Notifier {
  readonly name: string;
  constructor(private readonly subscribers: readonly Notifier[]) {
    this.name = subscribers.map((s) => s.name).join("+") || "none";
  }

  async notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean> {
    const sent = await Promise.all(
      this.subscribers.map((s) => s.notify(title, body, level).catch(() => false)),
    );
    return sent.some(Boolean);
  }
}

/** The notifier settings name; discord with no URL refuses on purpose rather than posting nowhere. */
export function makeNotifier(
  kind: NotifierKind,
  opts: {
    discordWebhookUrl?: string | null;
    discordPingUserId?: string | null;
    http?: typeof fetch;
  } = {},
): Notifier {
  if (kind === "none") return new NoneNotifier();
  if (kind === "console") return new ConsoleNotifier();
  const url = opts.discordWebhookUrl?.trim() ?? "";
  if (!url) throw new Error("WREN_NOTIFY=discord needs WREN_DISCORD_WEBHOOK_URL");
  return new DiscordNotifier(
    url,
    opts.http ?? fetch,
    console.warn,
    opts.discordPingUserId?.trim() || undefined,
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
