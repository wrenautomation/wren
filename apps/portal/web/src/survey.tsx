/**
 * A client login's portal survey (`console/surveysDue`): one question in the corner, answered
 * once. Not now hides it for this visit; it asks again next sign-in until answered.
 */
import { Button, UnsavedMark, useEdit } from "@wren/ui";
import { useState } from "react";
import { call } from "./api.js";
import { useCall } from "./load.js";

interface Due {
  key: string;
  question: string;
  kind: "choice" | "scale" | "text";
  choices: string[];
}

const SCALE = Array.from({ length: 10 }, (_, i) => String(i + 1));
const HIDDEN = "wren.survey.hidden";
const hidden = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(HIDDEN) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const hide = (key: string) => {
  try {
    sessionStorage.setItem(HIDDEN, JSON.stringify([...hidden(), key]));
  } catch {}
};

export function SurveyCard({ client }: { client: string }) {
  const [state, setState] = useState<"ask" | "busy" | "thanks">("ask");
  // The questions due, kept; the ones put away this visit are skipped.
  const got = useCall(`surveys:due:${client}`, () => call<Due[]>("console/surveysDue", { client }));
  const [gone, setGone] = useState<string[]>([]);
  /** The one being thanked for, held while the thanks shows. */
  const [held, setHeld] = useState<Due | null>(null);
  const skip = [...hidden(), ...gone];
  const due = held ?? got.data?.find((s) => !skip.includes(s.key)) ?? null;
  const putAway = (key: string) => {
    setHeld(null);
    setState("ask");
    setGone((g) => [...g, key]);
  };

  const reply = useEdit(due ? `survey:${due.key}:answer` : null, "");
  const text = reply.value;
  if (!due) return null;
  const close = () => {
    hide(due.key);
    putAway(due.key);
  };
  const answer = (value: string) => {
    setState("busy");
    call("console/surveyAnswer", { client, survey: due.key, value })
      .then(() => {
        setHeld(due);
        hide(due.key);
        if (due.kind === "text") reply.saved(value);
        setState("thanks");
        setTimeout(() => putAway(due.key), 1800);
      })
      .catch(() => setState("ask"));
  };
  const busy = state === "busy";

  return (
    <section
      aria-label="A question"
      className="fixed right-4 bottom-4 z-30 w-[min(360px,calc(100vw-32px))] rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) p-4 text-sm text-(--ui-ink) shadow-(--ui-shadow) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      {state === "thanks" ? (
        <p>Thanks. That helps.</p>
      ) : (
        <>
          <p className="mb-3 pr-6 font-medium">{due.question}</p>
          <button
            type="button"
            aria-label="Not now"
            onClick={close}
            className="absolute top-3 right-3 px-1 text-(--ui-ink-3) hover:text-(--ui-ink)"
          >
            ×
          </button>
          {due.kind === "choice" ? (
            <div className="flex flex-wrap gap-2">
              {due.choices.map((c) => (
                <Button
                  key={c}
                  tone="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => answer(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
          ) : due.kind === "scale" ? (
            <>
              <div className="grid grid-cols-10 gap-1">
                {SCALE.map((n) => (
                  <Button
                    key={n}
                    tone="secondary"
                    size="dense"
                    disabled={busy}
                    onClick={() => answer(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <p className="mt-1.5 flex justify-between text-xs text-(--ui-ink-3)">
                <span>Low</span>
                <span>High</span>
              </p>
            </>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) answer(text.trim());
              }}
            >
              <input
                {...reply.field}
                maxLength={500}
                aria-label="Your answer"
                className="min-w-0 flex-1 rounded-(--ui-radius) border border-(--ui-hair) bg-transparent px-2 py-1"
              />
              <Button type="submit" tone="primary" size="sm" busy={busy} disabled={!text.trim()}>
                Send
              </Button>
              <UnsavedMark edit={reply} />
            </form>
          )}
        </>
      )}
    </section>
  );
}
