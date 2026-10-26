import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, screen, userEvent, within } from "storybook/test";
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

export default {
  title: "Parts/Action",
  id: "action",
} satisfies Meta;

type Story = StoryObj;

const NAMES = { one: "lead", many: "leads" };
const IDS = [1, 2, 3];

/**
 * A button per action on these ids, with the dialog and the toasts `useRun` makes. `open` runs
 * one action on mount (the way a press would); a story's `play` presses the buttons itself.
 */
function Demo({
  call,
  actions = ACTIONS,
  ids = IDS,
  open,
}: {
  call: Call;
  actions?: readonly Action[];
  ids?: (string | number)[];
  open?: Action;
}) {
  const { run, running, dialog } = useRun(call, () => {}, NAMES);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one press, on mount.
  useEffect(() => {
    if (open) run(open, open.form ? [] : ids);
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
export const Default: Story = {
  render: () => <Demo call={fakeCall("ok")} />,
};

/** No state of its own: the "Why?" dialog open with its text box empty. */
export const Empty: Story = {
  render: () => <Demo call={fakeCall("ok")} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: PAUSE.label }));
    const dialog = await screen.findByRole("dialog");
    await expect(within(dialog).getByLabelText("Why?")).toHaveValue("");
  },
};

/** The call never answers: Approve runs at once and its button stays busy. */
export const Loading: Story = {
  render: () => <Demo call={fakeCall("pending")} open={ACTIONS[0] as Action} />,
};

/** The call fails: the confirm dialog stays open and says why. */
export const Failed: Story = {
  render: () => <Demo call={fakeCall("fails")} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: CLOSE.label }));
    const dialog = within(await screen.findByRole("dialog", { name: "Close these leads?" }));
    // The dialog's corner X is also "Close": the action is the form's submit button.
    const go = dialog
      .getAllByRole("button", { name: CLOSE.label })
      .find((b) => b.getAttribute("type") === "submit");
    await userEvent.click(go as HTMLElement);
    await expect(await dialog.findByRole("alert")).toHaveTextContent("could not answer");
  },
};

/** A long confirm line and label, on a thousand and more leads. */
export const WorstCase: Story = {
  render: () => (
    <Demo
      call={fakeCall("ok")}
      actions={[WORST_CLOSE]}
      ids={Array.from({ length: 1234 }, (_, i) => i + 1)}
      open={WORST_CLOSE}
    />
  ),
};

/** The form action: a dialog of boxes, a city list read through the call. */
export const FormDialog: Story = {
  render: () => <Demo call={fakeCall("ok")} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: INVITE.label }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Name"), "Ada Example");
    await expect(dialog.getByLabelText("Name")).toHaveValue("Ada Example");
  },
};

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
export const FormBoxDefault: Story = {
  render: () => (
    <Boxes
      fields={[...FORM_FIELDS, ...MORE_FIELDS]}
      values={FORM_VALUES}
      call={fakeCall("ok", 0)}
    />
  ),
};

/** The same boxes, nothing typed. */
export const FormBoxEmpty: Story = {
  render: () => <Boxes fields={[...FORM_FIELDS, ...MORE_FIELDS]} call={fakeCall("ok", 0)} />,
};

/** A combo whose list never answers: a plain line to type in, no choices yet. */
export const FormBoxLoading: Story = {
  render: () => <Boxes fields={MORE_FIELDS.slice(-1)} call={fakeCall("pending")} />,
};

/** A combo whose list fails: it says so, with Try again, and leaves the line to type in. */
export const FormBoxFailed: Story = {
  render: () => <Boxes fields={MORE_FIELDS.slice(-1)} call={fakeCall("fails")} />,
};

/** Long, non-Latin and emoji labels, hints and choices. */
export const FormBoxWorstCase: Story = {
  render: () => <Boxes fields={WORST_FIELDS} />,
};
