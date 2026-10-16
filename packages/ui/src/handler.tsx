/**
 * A handler as a form: its key first when it's an object's, a box per input field (or one JSON
 * box), its effect named and its name typed in before it runs, and the last answer under it.
 */
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { FormBox, type FormField, typedOf, valuesOf } from "./action.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Button } from "./controls.js";
import { Facts } from "./data.js";
import { TextField, useEditForm } from "./edit-form.js";
import { Alert } from "./feedback.js";
import { GROUP_LABEL } from "./layout.js";

/** What a press does outside Wren, said before it runs. */
const EFFECTS: Record<string, string> = {
  spends: "It spends money.",
  sends: "It sends to a person.",
  posts: "It posts in public.",
};

type Answer = { ok: true; value: unknown } | { ok: false; error: string };
/** Each handler's last answer, until a reload: it stays when the panel moves on and back. */
const LAST = new Map<string, Answer>();

const JSON_BOX: FormField = {
  field: "input",
  label: "Input",
  type: "json",
  optional: true,
  hint: "JSON. Left empty, it sends none.",
};
const KEY_BOX: FormField = { field: "key", label: "Key", hint: "Which object or workflow." };

/** What the handler's boxes hold: the key, and the boxes the person typed in (the rest follow their `from`). */
const BLANK: { key: string; typed: Record<string, string> } = { key: "", typed: {} };
const NO_CONFIRM = { confirm: "" };

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));
const CODE = "font-mono text-[12.5px] [overflow-wrap:anywhere]";
const PRE =
  "max-w-full min-w-0 overflow-x-auto bg-(--ui-wash) p-3 font-mono text-[12.5px] leading-5 whitespace-pre";

/** What the press sends: the input, the key when it asks one, the name typed in for an effect. */
export interface HandlerCall {
  input: unknown;
  key?: string;
  confirm?: string;
}

export function HandlerForm({
  id,
  name,
  fields,
  keyed,
  effect,
  run,
  verb = "Run",
}: {
  /** Its last answer is kept under this. */
  id: string;
  /** The handler's name, typed in to run one with an effect. */
  name: string;
  /** Its boxes; null asks the whole input as JSON. */
  fields: readonly FormField[] | null;
  keyed: boolean;
  effect: string | null;
  run: (call: HandlerCall) => Promise<unknown>;
  /** What its button says: "Install". */
  verb?: string;
}) {
  const uid = useId();
  const boxes = useEditForm({ key: null, defaults: BLANK });
  const sure = useEditForm({ key: null, defaults: NO_CONFIRM });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [last, setLast] = useState(() => LAST.get(id));
  const { key, typed } = boxes.watch();
  const form = fields ?? [JSON_BOX];
  const values = valuesOf(form, typed);
  const warning = effect ? (EFFECTS[effect] ?? `It ${effect}.`) : null;

  const inputOf = () => {
    const input = typedOf(form, values);
    return fields ? input : input.input;
  };
  const go = async (typedName?: string) => {
    setAsking(false);
    setBusy(true);
    let answer: Answer;
    try {
      const value = await run({
        input: inputOf(),
        ...(keyed ? { key: key.trim() } : {}),
        ...(typedName ? { confirm: typedName } : {}),
      });
      answer = { ok: true, value };
    } catch (err) {
      answer = { ok: false, error: said(err) };
    }
    LAST.set(id, answer);
    setLast(answer);
    setBusy(false);
  };
  const submit = boxes.onSend(async () => {
    try {
      inputOf();
    } catch (err) {
      toast.error(said(err));
      return false;
    }
    if (!effect) return go();
    sure.forget();
    setAsking(true);
    return false;
  });
  const confirmed = sure.onSend((v) => (v.confirm === name ? go(v.confirm) : false));
  const confirm = sure.watch("confirm");

  return (
    <section className="grid min-w-0 gap-5" aria-label="Run it">
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        {keyed ? (
          <FormBox
            f={KEY_BOX}
            id={`${uid}-key`}
            value={key}
            onText={(text) => boxes.setValue("key", text)}
          />
        ) : null}
        {form.map((f) => (
          <FormBox
            key={f.field}
            f={f}
            id={`${uid}-${f.field}`}
            value={values[f.field] ?? ""}
            onText={(text) => boxes.setValue("typed", { ...typed, [f.field]: text })}
          />
        ))}
        {!keyed && !form.length ? (
          <p className="text-[14px] text-(--ui-ink-2)">It takes no input.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" size="dense" type="submit" busy={busy}>
            {verb}
          </Button>
          {warning ? <span className="text-[13px] text-(--ui-bad)">{warning}</span> : null}
        </div>
      </form>

      {last ? (
        <section className="grid min-w-0 gap-2">
          <h3 className={GROUP_LABEL}>Last answer</h3>
          {last.ok ? <AnswerView value={last.value} /> : <Alert>{last.error}</Alert>}
        </section>
      ) : null}

      <Dialog open={asking} onOpenChange={(open) => !open && setAsking(false)}>
        <DialogContent>
          <form onSubmit={(e) => void confirmed(e)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {verb} {name}?
              </DialogTitle>
              <DialogDescription>
                {warning} Type {name} to {verb.toLowerCase()} it.
              </DialogDescription>
            </DialogHeader>
            <TextField
              form={sure}
              name="confirm"
              aria-label={`Type ${name}`}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <DialogFooter>
              <Button tone="quiet" size="dense" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button
                tone="primary"
                size="dense"
                type="submit"
                busy={busy}
                disabled={confirm !== name}
              >
                {verb}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** An object as a record, a line per field; anything else as JSON. */
function AnswerView({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <p className="text-[14px] text-(--ui-ink-2)">It answered nothing.</p>;
  if (typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length)
    return <pre className={PRE}>{JSON.stringify(value, null, 2)}</pre>;
  const items = Object.entries(value).map(([k, v]): [string, ReactNode] => [
    k,
    <span
      key={k}
      className={v !== null && typeof v === "object" ? CODE : "[overflow-wrap:anywhere]"}
    >
      {v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)}
    </span>,
  ]);
  return <Facts items={items} className="min-w-0" />;
}
