/** People: who sees this account's projects. An owner invites and removes. */
import { Alert, Button, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import type { PageProps } from "../../module.js";
import { dayLabel, Form, field, useAct } from "../work/bits.js";
import { usePeople } from "./load.js";

export function People(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const people = usePeople(props, nonce);
  const act = useAct(props, () => setNonce((n) => n + 1));
  const manage = people.data?.canManage ?? false;

  return (
    <>
      <PageHeader
        title="People"
        lede="Everyone here sees your projects with Wren. Wren's team does too."
      />
      <Section>
        {people.error && !people.data ? (
          <Alert onRetry={people.retry}>{people.error.message}</Alert>
        ) : !people.data ? (
          <Loading lines={3} />
        ) : people.data.people.length === 0 ? (
          <Empty>Nobody yet.</Empty>
        ) : (
          <ul className="wk-list">
            {people.data.people.map((m) => (
              <li key={m.email} className="wk-person">
                <span>
                  <b>{m.email}</b> {m.role === "owner" ? <Tag tone="neutral">Owner</Tag> : null}
                  <span className="wk-quiet wk-block">
                    {m.lastSeenAt ? `Last here ${dayLabel(m.lastSeenAt)}` : "Hasn't signed in yet"}
                    {m.invitedBy ? ` · invited by ${m.invitedBy}` : ""}
                  </span>
                </span>
                {manage ? (
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={act.busy}
                    onClick={() => {
                      if (confirm(`Remove ${m.email}? They lose access right away.`))
                        void act.run("remove", { email: m.email });
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {act.error && !manage ? <p className="wk-error">{act.error}</p> : null}
      </Section>
      {manage ? (
        <Section
          title="Invite someone"
          note="They sign in with this email. Owners can invite others and see billing."
        >
          <Form
            label="Invite someone"
            submit="Invite"
            act={act}
            demo={props.demo}
            onSubmit={(f) =>
              act.run("invite", { email: field(f, "email"), role: field(f, "role") })
            }
          >
            <label className="wk-field wk-grow">
              <span>Their work email</span>
              <input name="email" type="email" required maxLength={254} />
            </label>
            <label className="wk-field">
              <span>Role</span>
              <select name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          </Form>
        </Section>
      ) : people.data ? (
        <p className="wk-quiet">Ask an owner to invite a teammate.</p>
      ) : null}
    </>
  );
}
