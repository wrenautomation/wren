/**
 * Outreach → Engage's head (`marketing.engage` is the queue under it): the paste box. A subreddit
 * or an account gets watched, a thread or a post gets a reply drafted, all by `ReachDesk.paste`;
 * the result shows here and the row joins the queue. Invites wait on Outreach → Invites, counted
 * on its tab.
 */
import { Button, Input, useEdit } from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "../../api.js";
import { DraftModels } from "../marketing/draft-models.js";
import { ERROR, QUIET } from "../work/bits.js";

interface Pasted {
  did: string;
  said: string;
  item: string | null;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

export function EngageHead(props: { reload: () => void; demo: boolean }) {
  // The link stays until it is added: another page and back gives it again.
  const link = useEdit(props.demo ? null : "engage:paste:link", "");
  const url = link.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ n: number; text: string }[]>([]);

  const paste = async () => {
    const sent = url.trim();
    if (!sent) return;
    setBusy(true);
    setError(null);
    try {
      const out = await call<Pasted>("console/call", {
        service: "ReachDesk",
        handler: "paste",
        input: { url: sent },
      });
      setSaid((s) => [{ n: (s[0]?.n ?? 0) + 1, text: out.said }, ...s].slice(0, 5));
      link.saved(url);
      props.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    // A phone: the box takes the row, Add beside it.
    <div className="mb-4 grid gap-2 max-sm:w-full">
      <form
        className="flex flex-wrap items-center gap-2 max-sm:flex-nowrap"
        onSubmit={(e) => {
          e.preventDefault();
          void paste();
        }}
      >
        <Input
          aria-label="Paste a link"
          className="min-w-0 flex-1 basis-[320px] max-sm:basis-0"
          {...link.field}
          placeholder="Paste a subreddit, thread, post or account (Reddit, LinkedIn, X, Instagram)"
        />
        <Button
          tone="primary"
          size="dense"
          type="submit"
          disabled={busy || props.demo || !url.trim()}
        >
          {busy ? "Reading…" : "Add"}
        </Button>
      </form>
      {error ? <p className={ERROR}>{error}</p> : null}
      {said.length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-[13.5px]">
          {said.map((s, i) => (
            <li key={s.n} className={i ? QUIET : undefined}>
              {s.text}
            </li>
          ))}
        </ul>
      ) : null}
      <DraftModels demo={props.demo} />
    </div>
  );
}
