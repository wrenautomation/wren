/**
 * A client login's portal survey (`console/surveysDue`): one question in the corner, answered
 * once. Not now hides it for this visit; it asks again next sign-in until answered.
 */
import { Button } from "@wren/ui";
import { useEffect, useState } from "react";
import { call } from "./api.js";

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
  const [due, setDue] = useState<Due | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"ask" | "busy" | "thanks">("ask");

  useEffect(() => {
    let live = true;
    setDue(null);
    setState("ask");
    call<Due[]>("console/surveysDue", { client })
      .then((all) => {
        const skip = hidden();
        if (live) setDue(all.find((s) => !skip.includes(s.key)) ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client]);

  if (!due) return null;
  const close = () => {
    hide(due.key);
    setDue(null);
  };
  const answer = (value: string) => {
    setState("busy");
    call("console/surveyAnswer", { client, survey: due.key, value })
      .then(() => {
        hide(due.key);
        setState("thanks");
        setTimeout(() => setDue(null), 1800);
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
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                aria-label="Your answer"
                className="min-w-0 flex-1 rounded-(--ui-radius) border border-(--ui-hair) bg-transparent px-2 py-1"
              />
              <Button type="submit" tone="primary" size="sm" busy={busy} disabled={!text.trim()}>
                Send
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
