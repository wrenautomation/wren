import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useState } from "react";
import { type Action, type Call, FormBox, type FormField, Toasts, useRun } from "./action.js";
import { Button } from "./controls.js";
import {
  ACTIONS,
  CLOSE,
  FORM_FIELDS,
  FORM_VALUES,
  fakeCall,
  INVITE,
  MORE_FIELDS,
  PAUSE,
  WORST_CLOSE,
  WORST_FIELDS,
} from "./fixtures/action.js";

export default { title: "Action" } as StoryDefault;

const NAMES = { one: "lead", many: "leads" };
const IDS = [1, 2, 3];

/**
 * A button per action on these ids, with the dialog and the toasts `useRun` makes. `open` runs
 * one action on mount (the way a press would), and `then` runs a second call after a beat.
 */
function Demo({
  call,
  actions = ACTIONS,
  ids = IDS,
  open,
  send,
}: {
  call: Call;
  actions?: readonly Action[];
  ids?: (string | number)[];
  open?: Action;
  /** Sent after a beat, through the open dialog. */
  send?: Action;
}) {
  const { run, send: sendNow, running, dialog } = useRun(call, () => {}, NAMES);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one press, on mount.
  useEffect(() => {
    if (open) run(open, open.form ? [] : ids);
    if (!send) return;
    const t = setTimeout(() => void sendNow(send, ids, { ids }), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {actions.map((a) => (
        <Button
          key={a.id}
          tone="secondary"
          size="dense"
          busy={running?.action === a.id}
          onClick={() => run(a, a.form ? [] : ids)}
        >
          {a.label}
        </Button>
      ))}
      {dialog}
      <Toasts />
    </div>
  );
}

/** Four actions on three leads: one at once with undo, one that confirms, one that asks why, one form. */
export const Default: Story = () => <Demo call={fakeCall("ok")} />;

/** No state of its own: the "Why?" dialog open with its text box empty. */
export const Empty: Story = () => <Demo call={fakeCall("ok")} open={PAUSE} />;

/** The call never answers: Approve runs at once and its button stays busy. */
export const Loading: Story = () => <Demo call={fakeCall("pending")} open={ACTIONS[0] as Action} />;

/** The call fails: the confirm dialog stays open and says why. */
export const Failed: Story = () => <Demo call={fakeCall("fails")} open={CLOSE} send={CLOSE} />;

/** A long confirm line and label, on a thousand and more leads. */
export const WorstCase: Story = () => (
  <Demo
    call={fakeCall("ok")}
    actions={[WORST_CLOSE]}
    ids={Array.from({ length: 1234 }, (_, i) => i + 1)}
    open={WORST_CLOSE}
  />
);

/** The form action: a dialog of boxes, a city list read through the call. */
export const FormDialog: Story = () => <Demo call={fakeCall("ok")} open={INVITE} />;

/** Boxes held in state, as `useRun`'s dialog holds them. */
function Boxes({
  fields,
  call,
  values = {},
}: {
  fields: FormField[];
  call?: Call | undefined;
  values?: Record<string, string>;
}) {
  const [typed, setTyped] = useState(values);
  return (
    <div className="grid max-w-xl gap-4">
      {fields.map((f) => (
        <FormBox
          key={f.field}
          f={f}
          id={`box-${f.field}`}
          value={typed[f.field] ?? ""}
          onText={(t) => setTyped((o) => ({ ...o, [f.field]: t }))}
          call={call}
        />
      ))}
    </div>
  );
}

/** Every box type, filled. */
export const FormBoxDefault: Story = () => (
  <Boxes fields={[...FORM_FIELDS, ...MORE_FIELDS]} values={FORM_VALUES} call={fakeCall("ok", 0)} />
);

/** The same boxes, nothing typed. */
export const FormBoxEmpty: Story = () => (
  <Boxes fields={[...FORM_FIELDS, ...MORE_FIELDS]} call={fakeCall("ok", 0)} />
);

/** A combo whose list never answers: a plain line to type in, no choices yet. */
export const FormBoxLoading: Story = () => (
  <Boxes fields={MORE_FIELDS.slice(-1)} call={fakeCall("pending")} />
);

/** A combo whose list fails: it says so, with Try again, and leaves the line to type in. */
export const FormBoxFailed: Story = () => (
  <Boxes fields={MORE_FIELDS.slice(-1)} call={fakeCall("fails")} />
);

/** Long, non-Latin and emoji labels, hints and choices. */
export const FormBoxWorstCase: Story = () => <Boxes fields={WORST_FIELDS} />;
