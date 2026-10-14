/**
 * Marketing → Engage's head (`marketing.engage` is the queue under it): the paste box and the
 * invites still waiting. A subreddit or an account gets watched, a thread or a post gets a reply
 * drafted, all by `ReachDesk.paste`; the result shows here and the row joins the queue.
 */
import { Button, cx, Input } from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError, call } from "../../api.js";
import { ERROR, QUIET } from "../work/bits.js";

interface Pasted {
  did: string;
  said: string;
  item: string | null;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const INVITES = {
  record: "marketing.approval",
  where: { type: ["invite", "connect"], state: ["waiting"] },
};

export function EngageHead(props: { reload: () => void; demo: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ n: number; text: string }[]>([]);
  const [invites, setInvites] = useState(0);

  useEffect(() => {
    if (props.demo) return;
    call<{ total: number }>("console/recordsList", { ...INVITES, limit: 1 }).then(
      (r) => setInvites(r.total),
      () => setInvites(0),
    );
  }, [props.demo]);

  const paste = async () => {
    const link = url.trim();
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const out = await call<Pasted>("console/call", {
        service: "ReachDesk",
        handler: "paste",
        input: { url: link },
      });
      setSaid((s) => [{ n: (s[0]?.n ?? 0) + 1, text: out.said }, ...s].slice(0, 5));
      setUrl("");
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
          value={url}
          placeholder="Paste a subreddit, thread, post or account (Reddit, LinkedIn, X, Instagram)"
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button size="dense" type="submit" disabled={busy || props.demo || !url.trim()}>
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
      {invites ? (
        <p className={cx("m-0 text-[13.5px]", QUIET)}>
          {invites} LinkedIn {invites === 1 ? "invite waits" : "invites wait"} in{" "}
          <a href="/inbox/approve?view=invites" className="font-medium">
            To approve
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
