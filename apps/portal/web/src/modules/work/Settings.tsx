/**
 * Settings: who sees this project (an owner invites and removes), the mail each person
 * gets from us (D9), and how sign-in works.
 */
import { Alert, Button, ButtonLink, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { AUTH_ORIGIN, call, type MailLevel, type MemberView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Form, field, useAct } from "./bits.js";

const MAIL: [MailLevel, string, string][] = [
  ["all", "Everything", "Anything that needs you, right away, plus a Friday recap."],
  ["digest", "Friday recap only", "One email on Friday afternoon with the week."],
  ["off", "None", "No email. Everything is still here."],
];

export function Settings(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const people = useCall(`people:${props.client}:${props.team}:${nonce}`, () =>
    call<{ people: MemberView[]; canManage: boolean; mail: MailLevel | null }>("delivery/people", {
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
      {people.data?.mail ? (
        <Section title="Email from us" note="Just for you. Each person picks their own.">
          <div className="wk-tools">
            {MAIL.map(([level, label]) => (
              <Button
                key={level}
                size="sm"
                aria-pressed={people.data?.mail === level}
                tone={people.data?.mail === level ? "primary" : "secondary"}
                disabled={act.busy}
                onClick={() => void act.run("mail", { level })}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="wk-quiet">{MAIL.find(([l]) => l === people.data?.mail)?.[2]}</p>
        </Section>
      ) : null}
      <Section title="Signing in">
        <p className="wk-body">
          Sign in with your invited email, any way you like: a passkey, a code by email, Google,
          Microsoft, or a password. A passkey is Face ID, Touch ID or your phone's screen lock; add
          one per device. To set a password, pick "Set or reset my password" on the sign-in page.
        </p>
        {AUTH_ORIGIN ? (
          <div className="wk-tools">
            <ButtonLink
              href={`${AUTH_ORIGIN}/passkeys?next=${encodeURIComponent(location.href)}`}
              size="sm"
              tone="secondary"
            >
              Passkeys
            </ButtonLink>
            <ButtonLink href={AUTH_ORIGIN} size="sm" tone="quiet">
              Sign-in page
            </ButtonLink>
          </div>
        ) : null}
      </Section>
    </>
  );
}
