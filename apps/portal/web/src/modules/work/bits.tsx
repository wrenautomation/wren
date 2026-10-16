/**
 * What the work's and the account's pages share: the client's engagements, a write that
 * reloads them, a small form, dates as the client reads them, and the classes they draw with.
 */
import {
  ACTIONS,
  Button,
  DictateField,
  type EditForm,
  Empty,
  FormKept,
  LoadFailed,
  Loading,
  TextAreaField,
  useEditForm,
} from "@wren/ui";
import { type ReactNode, useId, useRef, useState } from "react";
import { z } from "zod";
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
/** A field's own width, until a phone gives it the row. */
export const NARROW = "max-[480px]:basis-full";
export const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus:border-(--ui-focus) focus:outline-none";
const FOOT = "flex basis-full flex-wrap items-center gap-3";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" -> "Oct 5"; another year adds it ("Jan 3, 2027"). Takes a timestamp too. */
export function dayLabel(day: string | null, thisYear = new Date().getFullYear()): string {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "") ?? [];
  if (!y) return "";
  const md = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return Number(y) === thisYear ? md : `${md}, ${y}`;
}

/**
 * The client's engagements, read again after a write (`reload`). One key for every read, so a
 * reload replaces the kept answer rather than leaving an old one a page load would draw.
 */
export function useWork({ client, team }: PageProps) {
  const home = useCall(`work:${client}:${team}`, () =>
    call<DeliveryHome>("delivery/home", { client, asClient: !team }),
  );
  return { ...home, reload: home.retry };
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
  if (work.error && !work.data) return <LoadFailed error={work.error} onRetry={work.retry} />;
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
  // One write at a time; a second press of the same one is the same action (its request id).
  const flying = useRef(false);
  const run = async (route: string, body: Record<string, unknown>): Promise<boolean> => {
    if (flying.current) return false;
    flying.current = true;
    setBusy(true);
    setError(null);
    try {
      await ACTIONS.run(`delivery/${route}:${props.client}:${JSON.stringify(body)}`, (requestId) =>
        call(`delivery/${route}`, { client: props.client, ...body, requestId }),
      );
      reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Unsent values back from before, or a conflict, said on a row of their own; nothing otherwise. */
export function Kept<V extends Record<string, unknown>>({ form }: { form: EditForm<V> }) {
  return form.conflict || (form.restored && form.unsent) ? (
    <div className={WIDE}>
      <FormKept form={form} />
    </div>
  ) : null;
}

/**
 * A small form on `form` (the caller's `useEditForm`): submit runs `onSubmit` with the values,
 * and `false` means it didn't land. It starts over once sent (`clear`), or keeps what was sent
 * (a form that edits a value the server holds). Typed and unsent values come back with a note.
 */
export function Form<V extends Record<string, unknown>>({
  label,
  submit,
  act,
  form,
  onSubmit,
  clear = true,
  children,
}: {
  label: string;
  submit: string;
  act: { busy: boolean; error: string | null };
  form: EditForm<V>;
  onSubmit: (values: V) => Promise<boolean>;
  clear?: boolean;
  children: ReactNode;
}) {
  const send = form.onSend(onSubmit, { clear });
  const error = act.error ?? form.error;
  return (
    <form className={FORM} aria-label={label} onSubmit={(e) => void send(e)}>
      <Kept form={form} />
      {children}
      <div className={FOOT}>
        <Button tone="primary" type="submit" size="dense" busy={act.busy}>
          {submit}
        </Button>
        {error ? (
          <span className={ERROR} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** A form field's text, or undefined when blank. */
export const trimmed = (s: string): string | undefined => s.trim() || undefined;

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
  const form = useEditForm({
    key: `comment:${props.client}:${"updateId" in on ? `update:${on.updateId}` : `deliverable:${on.deliverableId}`}`,
    defaults: { body: "" },
    schema: z.object({ body: z.string().trim().min(1, "Write a comment.") }),
  });
  // The mic writes into the box itself.
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
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
        form={form}
        onSubmit={async (v) => {
          const body = trimmed(v.body);
          const ok = await act.run("comment", { ...on, body });
          if (ok && body) setSent((s) => [...s, body]);
          return ok;
        }}
      >
        {/* Not a <label> around it: a click on the mic inside one would focus the box instead. */}
        <div className={`${FIELD} ${WIDE}`}>
          <label htmlFor={id}>{comments.length || sent.length ? "Reply" : "Comment"}</label>
          <DictateField target={box} label="Dictate your comment">
            <TextAreaField
              form={form}
              name="body"
              ref={box}
              id={id}
              required
              rows={2}
              maxLength={4000}
            />
          </DictateField>
        </div>
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
