/**
 * What Wren needs Listmonk's settings to say (designs/2026-10-21-esign-and-newsletter.md): the
 * postback messenger that sends every message to Wren, a slow steady rate under Gmail's daily
 * cap, and none of Listmonk's own tracking or public pages (sign-up stays on the lander, where
 * the proof of consent is kept). `wren listmonk setup` applies it; running it twice changes nothing.
 */
import { ensureTemplate, MESSENGER } from "./campaign.js";
import type { Listmonk, SettingsMap } from "./client.js";

interface SetupOptions {
  /** Where Listmonk is reached from outside, for its own links. */
  rootUrl: string;
  /** Where it posts each message: the Restate ingress's `ListmonkIntake/post`, on the box. */
  intakeUrl: string;
  /** Messages a second. Wren sends one at a time, so one a second is the pace. */
  perSecond?: number;
  /** Messages in any 24 hours: under Gmail's 2,000 a day for a Workspace mailbox. */
  perDay?: number;
}

/** The sending cap: the same number the direct send keeps (`ISSUE_DAILY`). */
const DEFAULT_PER_DAY = 1500;

/** Keys whose value Wren sets. A key the running Listmonk does not know is left out and reported. */
function wanted(o: SetupOptions): SettingsMap {
  return {
    "app.root_url": o.rootUrl,
    "app.check_updates": false,
    "app.concurrency": 1,
    "app.message_rate": o.perSecond ?? 1,
    "app.message_sliding_window": true,
    "app.message_sliding_window_duration": "24h",
    "app.message_sliding_window_rate": o.perDay ?? DEFAULT_PER_DAY,
    // Sign-up pages and archives are off: a person joins on the lander, with the proof kept.
    "app.enable_public_subscription_page": false,
    "app.enable_public_archive": false,
    // No opens or click tracking: Wren's own links and pixel stay the one measure.
    "privacy.individual_tracking": false,
    "privacy.disable_tracking": true,
  };
}

interface Messenger {
  name?: unknown;
  [k: string]: unknown;
}

/** The settings to PUT back: the current ones with Wren's values over them. */
export function settingsFor(
  current: SettingsMap,
  o: SetupOptions,
): { settings: SettingsMap; unknown: string[] } {
  const settings: SettingsMap = { ...current };
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(wanted(o))) {
    if (k in current) settings[k] = v;
    else unknown.push(k);
  }
  const messenger = {
    enabled: true,
    name: MESSENGER,
    root_url: o.intakeUrl,
    username: "",
    password: "",
    max_conns: 1,
    timeout: "30s",
    retries: 0,
  };
  const others = ((current.messengers as Messenger[] | undefined) ?? []).filter(
    (m) => m.name !== MESSENGER,
  );
  settings.messengers = [...others, messenger];
  return { settings, unknown };
}

/** Listmonk restarts itself after a settings change: wait until it answers again. */
async function answering(lm: Listmonk, tries: number, gapMs: number): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await lm.settings();
      return;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}

/** Apply the settings and make the `wren plain` template. Returns what it did, for the CLI to print. */
export async function applySetup(lm: Listmonk, o: SetupOptions, wait = { tries: 30, gapMs: 1000 }) {
  const { settings, unknown } = settingsFor(await lm.settings(), o);
  await lm.putSettings(settings);
  await answering(lm, wait.tries, wait.gapMs);
  return { templateId: await ensureTemplate(lm), unknown };
}
