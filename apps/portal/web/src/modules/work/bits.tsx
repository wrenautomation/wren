/**
 * What every page of the work shares: the client's engagements loaded once per page, a
 * write that reloads them, and dates and figures as the client reads them.
 */
import { Alert, Button, Empty, Loading, num, Tag, type TagTone } from "@wren/ui";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  ApiError,
  call,
  type DeliveryHome,
  type EngagementView,
  type MilestoneState,
  type ResultView,
} from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

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
  const es = work.data.engagements;
  if (es.length === 0)
    return (
      <Empty>
        {props.team
          ? `Nothing started yet. Start an offer: wren --client ${props.client} delivery start <offer> --on <date>`
          : "Nothing started yet. Your plan shows here on day one."}
      </Empty>
    );
  if (es.length === 1 && es[0]) return <>{children(es[0])}</>;
  return (
    <>
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
        {demo ? <span className="wk-quiet">Off on the demo.</span> : null}
        {act.error ? (
          <span className="wk-error" role="alert">
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
