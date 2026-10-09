/**
 * Your settings, Reading aloud: on or off on this device, the voice, the speed, and a sample.
 * The voice runs in the browser; the words never leave this device.
 */
import { Button, ReadAloud, Section, useReadStatus } from "@wren/ui";
import { useState } from "react";
import { reading } from "../../reading/index.js";
import { VOICES } from "../../reading/protocol.js";
import { QUIET, TOOLS } from "../work/bits.js";

const SPEEDS: [number, string][] = [
  [0.9, "Slower"],
  [1, "Normal"],
  [1.15, "Faster"],
  [1.3, "Fastest"],
];

const SAMPLE =
  "Here's how I sound. Press the speaker on a draft, a note or a message, and I'll read it to you.";

export function Reading() {
  const status = useReadStatus();
  const engine = reading;
  const [set, setSet] = useState(() => engine?.settings() ?? null);
  if (!engine || !set) return null;
  const pick = (next: typeof set) => {
    engine.set(next);
    setSet(next);
  };
  const device = engine.device();
  return (
    <Section title="Reading aloud">
      <div className={TOOLS}>
        {(
          [
            [true, "On"],
            [false, "Off"],
          ] as const
        ).map(([on, label]) => (
          <Button
            key={label}
            size="dense"
            aria-pressed={set.on === on}
            tone={set.on === on ? "primary" : "secondary"}
            onClick={() => pick({ ...set, on })}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className={QUIET}>
        {set.on
          ? "A voice model runs in your browser. It downloads about 90 MB the first time (330 MB with a graphics card, for speed). The words stay on this device."
          : "No speaker buttons on this device."}
      </p>
      {set.on ? (
        <div className="mt-4 grid max-w-[64ch] gap-3">
          <div className="grid gap-1">
            <span className="text-[14px] text-(--ui-ink-2)">Voice</span>
            <div className={TOOLS}>
              {VOICES.map(([voice, name, where]) => (
                <Button
                  key={voice}
                  size="dense"
                  title={where}
                  aria-pressed={set.voice === voice}
                  tone={set.voice === voice ? "primary" : "secondary"}
                  onClick={() => pick({ ...set, voice })}
                >
                  {name}
                  <span className="text-(--ui-ink-3)">{where}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-[14px] text-(--ui-ink-2)">Speed</span>
            <div className={TOOLS}>
              {SPEEDS.map(([speed, label]) => (
                <Button
                  key={speed}
                  size="dense"
                  aria-pressed={set.speed === speed}
                  tone={set.speed === speed ? "primary" : "secondary"}
                  onClick={() => pick({ ...set, speed })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ReadAloud text={SAMPLE} label="Hear a sample" />
            <span className={QUIET} role="status">
              {status.state === "unavailable"
                ? `Not on here. ${status.why}`
                : device
                  ? `Hear a sample. Running on ${device === "webgpu" ? "your graphics card" : "your processor"}.`
                  : "Hear a sample."}
            </span>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
