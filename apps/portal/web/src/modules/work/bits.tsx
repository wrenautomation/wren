/**
 * What the work's and the account's pages share: the client's engagements, a write that
 * reloads them, a small form, dates as the client reads them, and the classes they draw with.
 */
import { Alert, Button, Empty, Loading, Textarea } from "@wren/ui";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  ApiError,
  type CommentView,
  call,
  type DeliveryHome,
  type EngagementView,
} from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { appHere, WORK } from "./nav.js";

export const QUIET = "text-(--ui-ink-2)";
export const ERROR = "text-[13.5px] text-(--ui-bad)";
/** Ruled rows. */
export const LIST =
  "border-t border-(--ui-hair) [&>li]:border-b [&>li]:border-(--ui-hair) [&>li]:py-3 [&>li]:text-[15px] [&>li]:leading-normal";
/** A row's name on the left, its controls on the right. */
export const SPLIT = "flex items-center justify-between gap-3";
export const BLOCK = "block text-[13.5px]";
export const TOOLS = "mt-3 flex flex-wrap items-center gap-2";
export const BODY = "max-w-[72ch] text-[15px] leading-[1.55] text-pretty whitespace-pre-wrap";
export const FORM = "mt-3 flex flex-wrap items-end gap-3";
export const FIELD = "flex flex-col gap-1.5 text-[13px] text-(--ui-ink-2) max-[480px]:basis-full";
export const WIDE = "basis-full";
export const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";
const FOOT = "flex basis-full flex-wrap items-center gap-3";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" -> "Oct 5"; another year adds it ("Jan 3, 2027"). Takes a timestamp too. */
export function dayLabel(day: string | null, thisYear = new Date().getFullYear()): string {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "") ?? [];
  if (!y) return "";
  const md = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return Number(y) === thisYear ? md : `${md}, ${y}`;
}

/** The client's engagements, reloaded after a write (`reload`). */
export function useWork({ client, team }: PageProps) {
  const [nonce, setNonce] = useState(0);
  const home = useCall(`work:${client}:${team}:${nonce}`, () =>
    call<DeliveryHome>("delivery/home", { client, asClient: !team }),
  );
  return { ...home, reload: () => setNonce((n) => n + 1) };
}

/** The engagements this app shows: a product's app its own, the work app all of them. */
export function ofThisApp(es: EngagementView[]): EngagementView[] {
  const app = appHere();
  return app === WORK ? es : es.filter((e) => e.offer.app === app);
}

/** The page's body once loaded: each engagement, headed by its offer when there's more than one. */
export function Engagements({
  work,
  children,
}: {
  work: ReturnType<typeof useWork>;
  children: (e: EngagementView) => ReactNode;
}) {
  if (work.error && !work.data) return <Alert onRetry={work.retry}>{work.error.message}</Alert>;
  if (!work.data) return <Loading lines={8} />;
  const es = ofThisApp(work.data.engagements);
  if (es.length === 0) return <Empty>Nothing started yet. Your plan shows here on day one.</Empty>;
  if (es.length === 1 && es[0]) return children(es[0]);
  return es.map((e) => (
    <section key={e.id} className="mt-10 first:mt-0">
      <h2 className="mb-2 text-[22px] font-semibold">{e.offer.name}</h2>
      {children(e)}
    </section>
  ));
}

/** A write: busy while it runs, its refusal shown, the page reloaded after. */
export function useAct(props: PageProps, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (route: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await call(`delivery/${route}`, { client: props.client, ...body });
      reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** A small form: submit runs `onSubmit`, cleared when it worked. */
export function Form({
  label,
  submit,
  act,
  onSubmit,
  children,
}: {
  label: string;
  submit: string;
  act: ReturnType<typeof useAct>;
  onSubmit: (form: FormData) => Promise<boolean>;
  children: ReactNode;
}) {
  const sent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (await onSubmit(new FormData(form))) form.reset();
  };
  return (
    <form className={FORM} aria-label={label} onSubmit={sent}>
      {children}
      <div className={FOOT}>
        <Button type="submit" size="dense" busy={act.busy}>
          {submit}
        </Button>
        {act.error ? (
          <span className={ERROR} role="alert">
            {act.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** A form field's text, or undefined when blank. */
export const field = (f: FormData, name: string): string | undefined => {
  const v = f.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/**
 * The thread under an update or a deliverable, and a box to add to it. A client sees Wren's
 * lines as "Wren"; the team sees who wrote each. What's sent shows at once.
 */
export function Thread({
  props,
  on,
  comments,
}: {
  props: PageProps;
  on: { updateId: number } | { deliverableId: number };
  comments: CommentView[];
}) {
  const [sent, setSent] = useState<string[]>([]);
  const act = useAct(props, () => undefined);
  return (
    <div className="grid gap-3">
      {comments.length || sent.length ? (
        <ol className={LIST}>
          {comments.map((c) => (
            <li key={c.id}>
              <span className={QUIET}>
                {c.fromWren && !props.team ? "Wren" : c.author} · {dayLabel(c.at)}
              </span>
              <p className={BODY}>{c.body}</p>
            </li>
          ))}
          {sent.map((body) => (
            <li key={body}>
              <span className={QUIET}>You · just now</span>
              <p className={BODY}>{body}</p>
            </li>
          ))}
        </ol>
      ) : null}
      <Form
        label="Comment"
        submit="Send"
        act={act}
        onSubmit={async (f) => {
          const body = field(f, "body");
          const ok = await act.run("comment", { ...on, body });
          if (ok && body) setSent((s) => [...s, body]);
          return ok;
        }}
      >
        <label className={`${FIELD} ${WIDE}`}>
          <span>{comments.length || sent.length ? "Reply" : "Comment"}</span>
          <Textarea name="body" required rows={2} maxLength={4000} />
        </label>
      </Form>
    </div>
  );
}

/** Downloads a deliverable's or an answer's file on a link signed just now. */
export function OpenFile({
  props,
  of,
}: {
  props: PageProps;
  of: { deliverableId: number } | { askId: number };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await call<{ url: string }>("delivery/file", {
        client: props.client,
        asClient: !props.team,
        ...of,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="dense" tone="secondary" icon="download" disabled={busy} onClick={open}>
        Download
      </Button>
      {error ? <span className={ERROR}>{error}</span> : null}
    </span>
  );
}
