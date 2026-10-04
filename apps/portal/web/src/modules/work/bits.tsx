/**
 * What every page of the work shares: the client's engagements loaded once per page, a
 * write that reloads them, and dates and figures as the client reads them.
 */
import { FILE_TYPES, MAX_FILE_BYTES, typeOfName } from "@wren/delivery/routes";
import { Alert, Button, Callout, Empty, Loading, num, Tag, type TagTone } from "@wren/ui";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  ApiError,
  type CommentView,
  call,
  type DeliveryHome,
  type EngagementView,
  type MilestoneState,
  type ResultView,
} from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { appHere, WORK } from "./nav.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" -> "Oct 5"; another year adds it ("Jan 3, 2027"). Takes a timestamp too. */
export function dayLabel(day: string | null, thisYear = new Date().getFullYear()): string {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "") ?? [];
  if (!y) return "";
  const md = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return Number(y) === thisYear ? md : `${md}, ${y}`;
}

/** A measure's figure in its unit. */
export const figure = (r: Pick<ResultView, "unit" | "value">): string =>
  r.value === null
    ? "-"
    : r.unit === "usd"
      ? `$${num(r.value)}`
      : r.unit === "hours"
        ? `${num(r.value)} h`
        : num(r.value);

export const STATE: Record<MilestoneState, [label: string, tone: TagTone]> = {
  done: ["Done", "green"],
  late: ["Running late", "rust"],
  now: ["In progress", "neutral"],
  next: ["Coming up", "neutral"],
};

/** The client's engagements, reloaded after a write (`reload`). */
export function useWork({ client, team }: PageProps) {
  const [nonce, setNonce] = useState(0);
  const home = useCall(`work:${client}:${team}:${nonce}`, () =>
    call<DeliveryHome>("delivery/home", { client, asClient: !team }),
  );
  return { ...home, reload: () => setNonce((n) => n + 1) };
}

/** D12: the demo's project is made up, and says so on every page. */
export const SampleNote = () => (
  <Callout>
    <Tag tone="rust">Sample</Tag> A made-up project, a few weeks in, to show what you'd see here.
    The names, dates and numbers are invented.
  </Callout>
);

/** The engagements this app shows: a product's app its own, the work app all of them. */
export function ofThisApp(es: EngagementView[]): EngagementView[] {
  const app = appHere();
  return app === WORK ? es : es.filter((e) => e.offer.app === app);
}

/** The page's body once loaded: each engagement, headed by its offer when there's more than one. */
export function Engagements({
  work,
  props,
  children,
}: {
  work: ReturnType<typeof useWork>;
  props: PageProps;
  children: (e: EngagementView) => ReactNode;
}) {
  if (work.error && !work.data) return <Alert onRetry={work.retry}>{work.error.message}</Alert>;
  if (!work.data) return <Loading lines={8} />;
  const es = ofThisApp(work.data.engagements);
  if (es.length === 0)
    return (
      <Empty>
        {props.team
          ? `Nothing started yet. Start an offer: wren --client ${props.client} delivery start <offer> --on <date>`
          : "Nothing started yet. Your plan shows here on day one."}
      </Empty>
    );
  const sample = props.demo ? <SampleNote /> : null;
  if (es.length === 1 && es[0])
    return (
      <>
        {sample}
        {children(es[0])}
      </>
    );
  return (
    <>
      {sample}
      {es.map((e) => (
        <section key={e.id} className="wk-engagement">
          <h2 className="wk-offer">{e.offer.name}</h2>
          {children(e)}
        </section>
      ))}
    </>
  );
}

/** A write: busy while it runs, its refusal shown, the page reloaded after. */
export function useAct(props: PageProps, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** With a file, it goes up first and its key rides along as `fileKey`. */
  const run = async (
    route: string,
    body: Record<string, unknown>,
    file?: File,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const fileKey = file ? await upload(props.client, file) : undefined;
      await call(`delivery/${route}`, { client: props.client, ...body, fileKey });
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

/** A small form: submit runs `onSubmit`, cleared when it worked. The demo can't send. */
export function Form({
  label,
  submit,
  act,
  demo,
  onSubmit,
  children,
  className,
}: {
  label: string;
  submit: string;
  act: ReturnType<typeof useAct>;
  demo: boolean;
  onSubmit: (form: FormData) => Promise<boolean>;
  children: ReactNode;
  className?: string;
}) {
  const sent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (await onSubmit(new FormData(form))) form.reset();
  };
  return (
    <form className={className ?? "wk-form"} aria-label={label} onSubmit={sent}>
      {children}
      <div className="wk-form-foot">
        <Button type="submit" size="sm" disabled={act.busy || demo}>
          {submit}
        </Button>
        {demo ? <span className="wk-quiet">Works in your own workspace.</span> : null}
        {act.error ? (
          <span className="wk-error" role="alert">
            {act.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The thread under an update or a deliverable, and a box to add to it. A client
 * sees Wren's lines as "Wren"; the team sees who wrote each.
 */
export function Thread({
  props,
  act,
  on,
  comments,
}: {
  props: PageProps;
  act: ReturnType<typeof useAct>;
  on: { updateId: number } | { deliverableId: number };
  comments: CommentView[];
}) {
  const [open, setOpen] = useState(false);
  if (comments.length === 0 && !open)
    return (
      <Button size="sm" tone="quiet" disabled={props.demo} onClick={() => setOpen(true)}>
        Comment
      </Button>
    );
  return (
    <div className="wk-thread">
      {comments.length > 0 ? (
        <ol>
          {comments.map((c) => (
            <li key={c.id}>
              <span className="wk-quiet">
                {c.fromWren && !props.team ? "Wren" : c.author} · {dayLabel(c.at)}
              </span>
              <p className="wk-body">{c.body}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {open ? (
        <Form
          label="Comment"
          submit="Send"
          act={act}
          demo={props.demo}
          onSubmit={async (f) => {
            const ok = await act.run("comment", { ...on, body: field(f, "body") });
            if (ok) setOpen(false);
            return ok;
          }}
        >
          <label className="wk-field wk-wide">
            <span>{comments.length > 0 ? "Reply" : "Comment"}</span>
            <textarea name="body" required rows={2} maxLength={4000} />
          </label>
        </Form>
      ) : (
        <Button size="sm" tone="quiet" disabled={props.demo} onClick={() => setOpen(true)}>
          Reply
        </Button>
      )}
    </div>
  );
}

/** Straight to the private bucket on a signed PUT; the portal only signs (D11). */
async function upload(client: string | undefined, file: File): Promise<string> {
  const type = FILE_TYPES[file.type] ? file.type : typeOfName(file.name);
  if (!type)
    throw new ApiError("That kind of file isn't taken. Send a PDF, image, sheet or doc.", 400);
  if (file.size > MAX_FILE_BYTES)
    throw new ApiError(`Files go up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`, 400);
  const { key, url } = await call<{ key: string; url: string }>("delivery/upload", {
    client,
    name: file.name,
    type,
    size: file.size,
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": type },
    body: file,
  }).catch(() => null);
  if (!res?.ok) throw new ApiError("The file didn't go up. Try again.", res?.status ?? 0);
  return key;
}

/** What a file input accepts. */
export const ACCEPT = [...Object.keys(FILE_TYPES), ...Object.values(FILE_TYPES), ".jpeg"].join(",");

/** The picked file, or undefined when none. */
export const fileOf = (f: FormData, name: string): File | undefined => {
  const v = f.get(name);
  return v instanceof File && v.size > 0 ? v : undefined;
};

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
    <>
      <Button size="sm" tone="secondary" icon="download" disabled={busy} onClick={open}>
        Download
      </Button>
      {error ? <span className="wk-error">{error}</span> : null}
    </>
  );
}

/** A form field's text, or undefined when blank. */
export const field = (f: FormData, name: string): string | undefined => {
  const v = f.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** The plan's steps as options, for "which step is this part of". */
export function StepPick({ e, name = "step" }: { e: EngagementView; name?: string }) {
  return (
    <label className="wk-field">
      <span>Step</span>
      <select name={name} defaultValue="">
        <option value="">None</option>
        {e.steps.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StateTag({ state }: { state: MilestoneState }) {
  const [label, tone] = STATE[state];
  return <Tag tone={tone}>{label}</Tag>;
}
