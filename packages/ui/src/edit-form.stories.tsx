import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./controls.js";
import { EDITS } from "./data/edits.js";
import {
  AccountField,
  CheckField,
  ChecksField,
  DateField,
  FormKept,
  MoneyField,
  RadioField,
  SelectField,
  TextAreaField,
  TextField,
  useEditForm,
} from "./edit-form.js";
import {
  CHANNELS,
  CONTACT,
  CONTACT_BLANK,
  CONTACT_DEFAULTS,
  CONTACT_WORST,
  type ContactValues,
  FORM_ACCOUNTS,
  STAGES,
  TONES,
} from "./fixtures/edit-form.js";
import { fails, pending } from "./fixtures/load.js";
import { WORST } from "./fixtures/worst.js";
import { writeForm } from "./save/journal.js";

export default {
  title: "Forms/Edit form",
  id: "edit-form",
} satisfies Meta;

type Story = StoryObj;

type Run = "submit" | "validate" | undefined;

/** One form with every field kind, on `useEditForm`. `run` presses Send, or only checks, on open. */
function ContactForm({
  id,
  defaults,
  send = async () => {},
  run,
  kept,
}: {
  id: string;
  defaults: ContactValues;
  send?: (v: ContactValues) => Promise<unknown>;
  run?: Run;
  /** Values typed over another starting point, kept before the form opens: a conflict. */
  kept?: Partial<Record<keyof ContactValues, string>>;
}) {
  useState(() => {
    if (kept)
      writeForm(EDITS.view(), `story:${id}`, kept as Record<string, string>, "older", Date.now());
  });
  const form = useEditForm<ContactValues>({ key: `story:${id}`, defaults, schema: CONTACT });
  const [busy, setBusy] = useState(false);
  const go = form.onSend(async (v) => {
    setBusy(true);
    try {
      return await send(v);
    } finally {
      setBusy(false);
    }
  });
  // The story presses Send, or checks the form, once on open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on open.
  useEffect(() => {
    if (run === "submit") void go();
    if (run === "validate") void form.trigger();
  }, []);
  return (
    <form onSubmit={go} className="grid max-w-xl gap-4">
      <FormKept form={form} what="contact changes" labels={{ name: "Name", note: "Note" }} />
      <TextField form={form} name="name" label="Name" hint="As they sign their email." />
      <TextField form={form} name="email" label="Email" inputMode="email" />
      <TextAreaField form={form} name="note" label="Note" rows={3} />
      <SelectField form={form} name="stage" label="Stage" options={STAGES} />
      <DateField form={form} name="follow" label="Follow up on" />
      <MoneyField form={form} name="budget" label="Budget ($)" />
      <CheckField form={form} name="vip" label="Treat as VIP" />
      <ChecksField form={form} name="channels" label="Reach them by" options={CHANNELS} />
      <RadioField form={form} name="tone" label="Tone" options={TONES} />
      <AccountField form={form} name="account" pick={FORM_ACCOUNTS} />
      {form.error ? (
        <p role="alert" className="text-[13px] text-(--ui-bad)">
          {form.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" tone="primary" busy={busy}>
          Send
        </Button>
      </div>
    </form>
  );
}

/** Every field kind, filled from the server's values. Type to see the kept-values line on a reload. */
export const Default: Story = {
  render: () => <ContactForm id="default" defaults={CONTACT_DEFAULTS} />,
};

/** A new contact: blank boxes. Send shows each missing field's message. */
export const Empty: Story = {
  render: () => <ContactForm id="empty" defaults={CONTACT_BLANK} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(await canvas.findByText("Say a name.")).toBeVisible();
  },
};

/** Typed, refused, fixed and sent: a bad email shows its message, a good one goes. */
export const Saved: StoryObj<{ send: (v: ContactValues) => Promise<unknown> }> = {
  args: { send: fn(async () => {}) },
  render: (args) => <ContactForm id="saved" defaults={CONTACT_BLANK} send={args.send} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole("button", { name: "Send" });
    await userEvent.type(canvas.getByRole("textbox", { name: /^Name/ }), "Ada Example");
    await userEvent.type(canvas.getByRole("textbox", { name: /^Email/ }), "ada@");
    await userEvent.click(send);
    await expect(await canvas.findByText("That is not an email.")).toBeVisible();
    await expect(args.send).not.toHaveBeenCalled();
    await userEvent.type(canvas.getByRole("textbox", { name: /^Email/ }), "example.com");
    await userEvent.click(send);
    await expect(args.send).toHaveBeenCalledOnce();
    await expect(args.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ada Example", email: "ada@example.com" }),
    );
  },
};

/** The nearest real state: Send pressed and the write never answers, so the button stays busy. */
export const Loading: Story = {
  render: () => (
    <ContactForm id="loading" defaults={CONTACT_DEFAULTS} send={pending()} run="submit" />
  ),
};

/** The write fails: the form shows the reason and keeps the values. */
export const Failed: Story = {
  render: () => (
    <ContactForm
      id="failed"
      defaults={CONTACT_DEFAULTS}
      send={fails("The server refused this contact.", 400)}
      run="submit"
    />
  ),
};

/** Long, unbreakable, non-Latin and emoji values, an invalid amount, and kept values in conflict. */
export const WorstCase: Story = {
  render: () => (
    <div className="grid gap-10">
      <ContactForm id="worst" defaults={CONTACT_WORST} run="validate" />
      <ContactForm
        id="conflict"
        defaults={CONTACT_DEFAULTS}
        kept={{ name: `${WORST.nonLatin} ${WORST.emoji}`, note: WORST.longText }}
      />
    </div>
  ),
};
