/**
 * Your settings, Dictation: which way this device turns speech into text, the browser's own
 * speech as a fallback (off by default), and why the mic is missing when it is.
 */
import { Button, DICTATE_KEYS, Section, useDictateStatus } from "@wren/ui";
import type { Choice } from "@wren/voice/dictation";
import { useState } from "react";
import { dictation } from "../../dictation/index.js";
import { QUIET, TOOLS } from "../work/bits.js";

const CHOICE: [Choice, string, string][] = [
  ["auto", "Auto", "This device when it can, else our server."],
  [
    "browser",
    "This device",
    "A speech model runs in your browser. It downloads about 160 MB the first time. Your audio stays on this device.",
  ],
  ["server", "Our server", "Your audio goes to our speech server. We don't keep it."],
  ["off", "Off", "No mic in the text boxes."],
];

const ADAPTER: Record<string, string> = {
  browser: "this device",
  server: "our server",
  speech: "your browser's speech service",
};

/** A phone has no keys to hold. */
const KEYS = typeof matchMedia === "undefined" || !matchMedia("(pointer: coarse)").matches;

export function Dictation() {
  const status = useDictateStatus();
  const engine = dictation;
  const [set, setSet] = useState(() => engine?.settings() ?? null);
  if (!engine || !set) return null;
  const pick = (next: typeof set) => {
    engine.set(next);
    setSet(next);
  };
  return (
    <Section title="Dictation">
      <div className={TOOLS}>
        {CHOICE.map(([choice, label]) => (
          <Button
            key={choice}
            size="dense"
            aria-pressed={set.choice === choice}
            tone={set.choice === choice ? "primary" : "secondary"}
            onClick={() => pick({ ...set, choice })}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className={QUIET}>{CHOICE.find(([c]) => c === set.choice)?.[2]}</p>
      <label className="mt-4 flex max-w-[64ch] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={set.fallback}
          disabled={set.choice === "off"}
          onChange={(e) => pick({ ...set, fallback: e.target.checked })}
          className="mt-1 size-4 accent-(--ui-accent)"
        />
        <span className="grid gap-0.5">
          <span className="text-[15px]">Use the browser's speech when nothing else works</span>
          <span className="text-[14px] text-(--ui-ink-2)">
            Chrome sends your audio to Google, Safari to Apple.
          </span>
        </span>
      </label>
      <p className={`mt-4 ${QUIET}`} role="status">
        {status.state === "ready"
          ? `On here, using ${ADAPTER[status.adapter] ?? status.adapter}. Press the mic in a text box${KEYS ? `, or hold ${DICTATE_KEYS}` : ""}.`
          : status.state === "unavailable"
            ? `Not on here. ${status.why}`
            : "Off on this device."}
      </p>
    </Section>
  );
}
