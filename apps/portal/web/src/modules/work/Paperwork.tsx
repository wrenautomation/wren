/**
 * Paperwork: the contract, the setup fee and the access we asked for. While any
 * of it waits, the plan hasn't started; the day it's all done, it does.
 */
import {
  Button,
  ButtonLink,
  Callout,
  Empty,
  PageHeader,
  Section,
  Tag,
  type TagTone,
} from "@wren/ui";
import { useState } from "react";
import type { AccessView, EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Engagements, Form, field, useAct, useWork } from "./bits.js";
import { at } from "./nav.js";

export function Paperwork(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  return (
    <>
      <PageHeader
        title="Paperwork"
        lede="The contract, the setup fee and the access we need. The plan starts once they're done."
      />
      <Engagements work={work} props={props}>
        {(e) => <Papers e={e} props={props} act={act} />}
      </Engagements>
    </>
  );
}

/** What still waits before the plan can start, in the order to do it. */
export function waitingOn(e: EngagementView): string[] {
  const p = e.paperwork;
  const out: string[] = [];
  if (p.contract && !p.contract.signedAt) out.push("sign the contract");
  if (p.setupPaid === false) out.push("pay the setup invoice");
  const open = p.access.filter((a) => a.status === "open").length;
  if (open) out.push(`answer ${open === 1 ? "our access request" : `${open} access requests`}`);
  return out;
}

const ACCESS: Record<AccessView["status"], [string, TagTone]> = {
  open: ["Waiting on you", "rust"],
  granted: ["Granted", "green"],
  declined: ["Declined", "neutral"],
  revoked: ["Taken back", "neutral"],
};

function Papers({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const p = e.paperwork;
  const left = waitingOn(e);
  const contract = at("contract", { e: e.id });
  return (
    <>
      {e.status === "onboarding" ? (
        <Callout>
          {left.length
            ? `To start, ${props.team ? "they" : "you"} need to ${list(left)}. The plan's dates move to the day that's done.`
            : "All done. The plan starts today."}{" "}
          <a href={at("welcome")}>Read the welcome guide</a>.
        </Callout>
      ) : null}

      <Section title="Contract">
        {!p.contract ? (
          <p className="wk-quiet">This work started without a contract in the portal.</p>
        ) : p.contract.signedAt ? (
          <div className="wk-person">
            <span>
              Signed by {p.contract.signedBy} on {dayLabel(p.contract.signedAt)}. A copy went to
              every owner by email.
            </span>
            <ButtonLink href={contract} size="sm" tone="quiet" arrow>
              Read it
            </ButtonLink>
          </div>
        ) : (
          <div className="wk-person">
            <span>
              <Tag tone="rust">To sign</Tag> Sent {dayLabel(p.contract.issuedAt)}. An owner of your
              account reads and signs it here.
            </span>
            <ButtonLink href={contract} size="sm" tone={props.team ? "quiet" : "primary"} arrow>
              {props.team ? "Read it" : "Read and sign"}
            </ButtonLink>
          </div>
        )}
      </Section>

      {p.setupPaid !== null ? (
        <Section title="Setup fee">
          <div className="wk-person">
            <span>
              {p.setupPaid ? (
                <>
                  <Tag tone="green">Paid</Tag> Thank you.
                </>
              ) : (
                <>
                  <Tag tone="rust">To pay</Tag> We send the invoice through Wise once the contract
                  is signed.
                </>
              )}
            </span>
            <ButtonLink href="/account/billing" size="sm" tone="quiet" arrow>
              Billing
            </ButtonLink>
          </div>
        </Section>
      ) : null}

      <Section
        title="Access we need"
        note="One system at a time. Grant only what's asked, and take it back whenever you like."
      >
        {p.access.length === 0 ? (
          <Empty>None asked for.</Empty>
        ) : (
          <ul className="wk-cards">
            {p.access.map((a) => (
              <Access key={a.id} a={a} props={props} act={act} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Access({
  a,
  props,
  act,
}: {
  a: AccessView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const [declining, setDeclining] = useState(false);
  const [label, tone] = ACCESS[a.status];
  const answer = (status: AccessView["status"], note?: string) =>
    act.run("access", { accessId: a.id, status, note });
  const client = !props.team && !props.demo;
  return (
    <li className="wk-card">
      <div className="wk-step-head">
        <b>{a.system}</b>
        <Tag tone={tone}>{label}</Tag>
      </div>
      <dl className="wk-access">
        <dt>What</dt>
        <dd>{a.scope}</dd>
        <dt>Why</dt>
        <dd>{a.why}</dd>
        <dt>To take it back</dt>
        <dd>{a.revoke}</dd>
        {a.note ? (
          <>
            <dt>Note</dt>
            <dd>{a.note}</dd>
          </>
        ) : null}
      </dl>
      {a.answeredAt ? (
        <p className="wk-quiet">
          {ACCESS[a.status][0]} by {a.answeredBy} on {dayLabel(a.answeredAt)}.
        </p>
      ) : null}
      {client ? (
        declining ? (
          <Form
            label="Decline access"
            submit="Decline"
            act={act}
            demo={props.demo}
            onSubmit={async (f) => {
              const ok = await answer("declined", field(f, "note"));
              if (ok) setDeclining(false);
              return ok;
            }}
          >
            <label className="wk-field wk-wide">
              <span>Why not, or what you'd give instead</span>
              <textarea name="note" required rows={2} maxLength={2000} />
            </label>
          </Form>
        ) : (
          <div className="wk-tools">
            {a.status !== "granted" ? (
              <Button size="sm" disabled={act.busy} onClick={() => void answer("granted")}>
                I've given it
              </Button>
            ) : (
              <Button
                size="sm"
                tone="secondary"
                disabled={act.busy}
                onClick={() => void answer("revoked")}
              >
                I've taken it back
              </Button>
            )}
            {a.status === "open" ? (
              <Button size="sm" tone="quiet" onClick={() => setDeclining(true)}>
                Decline
              </Button>
            ) : null}
            {act.error ? (
              <span className="wk-error" role="alert">
                {act.error}
              </span>
            ) : null}
          </div>
        )
      ) : null}
    </li>
  );
}

/** "a", "a and b", "a, b and c". */
const list = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
