/** Settings: who sees this project (an owner invites and removes), and how sign-in works. */
import { Alert, Button, ButtonLink, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { AUTH_ORIGIN, call, type MemberView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Form, field, useAct } from "./bits.js";

export function Settings(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const people = useCall(`people:${props.client}:${props.team}:${nonce}`, () =>
    call<{ people: MemberView[]; canManage: boolean }>("delivery/people", {
      client: props.client,
      asClient: !props.team,
    }),
  );
  const act = useAct(props, () => setNonce((n) => n + 1));
  const manage = people.data?.canManage ?? false;

  return (
    <>
      <PageHeader title="Settings" lede="Who sees this project, and how you sign in." />
      <Section title="People" note="Wren's team sees every project too.">
        {people.error && !people.data ? (
          <Alert onRetry={people.retry}>{people.error.message}</Alert>
        ) : !people.data ? (
          <Loading lines={3} />
        ) : people.data.people.length === 0 ? (
          <Empty>{props.demo ? "Nobody's listed on the demo." : "Nobody yet."}</Empty>
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
                      if (confirm(`Remove ${m.email}? They lose this project at once.`))
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
        {manage ? (
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
                <option value="owner">Owner (can invite)</option>
              </select>
            </label>
          </Form>
        ) : people.data && !props.demo ? (
          <p className="wk-quiet">An owner can invite teammates.</p>
        ) : null}
        {act.error && !manage ? <p className="wk-error">{act.error}</p> : null}
      </Section>
      <Section title="Signing in">
        <p className="wk-body">
          Sign in with your invited email, any way you like: a code by email, Google, Microsoft, or
          a password. To set one, pick "Set or reset my password" on the sign-in page.
        </p>
        {AUTH_ORIGIN ? (
          <div className="wk-tools">
            <ButtonLink href={AUTH_ORIGIN} size="sm" tone="secondary">
              Sign-in page
            </ButtonLink>
          </div>
        ) : null}
      </Section>
    </>
  );
}
