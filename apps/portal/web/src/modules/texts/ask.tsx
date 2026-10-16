/**
 * Review requests by hand: one customer's name and mobile or email, into the client's live
 * template (`sms/askReview`). The ask goes out under the same rules as any other: texting hours,
 * opt-outs, once per customer, the client's sends switch.
 */
import { ACTIONS, Button, Tag, TextField, useEditForm } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";

const BLANK = { name: "", phone: "", email: "" };

export function AskReview({ client, reload }: { client: string; reload: () => void }) {
  const form = useEditForm({ key: "review-ask:new", defaults: BLANK });
  const { phone, email } = form.watch();
  const any = !!(phone.trim() || email.trim());
  const [said, setSaid] = useState<{ ok: boolean; line: string } | null>(null);
  const submit = form.onSend(
    async (v) => {
      if (!any) return false;
      setSaid(null);
      await ACTIONS.run(`ask-review:${client}`, (requestId) =>
        call("sms/askReview", {
          client,
          name: v.name.trim() || null,
          phone: v.phone.trim() || null,
          email: v.email.trim() || null,
          requestId,
        }),
      );
      setSaid({ ok: true, line: "Asked. It shows here in a moment." });
      setTimeout(reload, 1500);
    },
    { clear: true },
  );
  const line = form.error ? { ok: false, line: form.error } : said;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex w-full min-w-0 flex-1 basis-full flex-col gap-1.5 sm:max-w-lg lg:basis-auto"
    >
      <div className="flex min-w-0 flex-wrap gap-2">
        <TextField
          form={form}
          name="name"
          box="min-w-0 flex-1 basis-32"
          placeholder="Name"
          aria-label="Customer's name"
        />
        <TextField
          form={form}
          name="phone"
          type="tel"
          box="min-w-0 flex-1 basis-32"
          placeholder="Mobile"
          aria-label="Customer's mobile"
        />
        <TextField
          form={form}
          name="email"
          type="email"
          box="min-w-0 flex-1 basis-32"
          placeholder="Email"
          aria-label="Customer's email"
        />
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={!any}
        >
          Ask for a review
        </Button>
      </div>
      {line ? (
        <span className={`text-[13px] ${line.ok ? "text-(--ui-ink-2)" : "text-(--ui-bad)"}`}>
          {line.line}
        </span>
      ) : null}
    </form>
  );
}

/** Under the numbers: what isn't counted yet, and why. */
export function ReviewsGained() {
  return (
    <p className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-(--ui-ink-2)">
      <span>Reviews gained</span>
      <Tag>In development</Tag>
      <span>Google has to approve our Business Profile API access first.</span>
    </p>
  );
}
