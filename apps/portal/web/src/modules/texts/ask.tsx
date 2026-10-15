/**
 * Review requests by hand: one customer's name and mobile or email, into the client's live
 * template (`sms/askReview`). The ask goes out under the same rules as any other: texting hours,
 * opt-outs, once per customer, the client's sends switch.
 */
import { ACTIONS, Button, Input, Tag } from "@wren/ui";
import { type FormEvent, useRef, useState } from "react";
import { call } from "../../api.js";

export function AskReview({ client, reload }: { client: string; reload: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const any = !!(phone.trim() || email.trim());
  const [busy, setBusy] = useState(false);
  const flying = useRef(false);
  const [said, setSaid] = useState<{ ok: boolean; line: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!any || flying.current) return;
    flying.current = true;
    setBusy(true);
    setSaid(null);
    const sent = { name, phone, email };
    try {
      await ACTIONS.run(`ask-review:${client}`, (requestId) =>
        call("sms/askReview", {
          client,
          name: name.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          requestId,
        }),
      );
      // Clear what was sent; anything typed meanwhile stays.
      setName((v) => (v === sent.name ? "" : v));
      setPhone((v) => (v === sent.phone ? "" : v));
      setEmail((v) => (v === sent.email ? "" : v));
      setSaid({ ok: true, line: "Asked. It shows here in a moment." });
      setTimeout(reload, 1500);
    } catch (err) {
      setSaid({ ok: false, line: err instanceof Error ? err.message : String(err) });
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="flex w-full min-w-0 flex-1 basis-full flex-col gap-1.5 sm:max-w-lg lg:basis-auto"
    >
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 basis-32"
          placeholder="Name"
          aria-label="Customer's name"
        />
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="min-w-0 flex-1 basis-32"
          placeholder="Mobile"
          aria-label="Customer's mobile"
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 basis-32"
          placeholder="Email"
          aria-label="Customer's email"
        />
        <Button tone="primary" size="dense" type="submit" busy={busy} disabled={!any}>
          Ask for a review
        </Button>
      </div>
      {said ? (
        <span className={`text-[13px] ${said.ok ? "text-(--ui-ink-2)" : "text-(--ui-bad)"}`}>
          {said.line}
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
