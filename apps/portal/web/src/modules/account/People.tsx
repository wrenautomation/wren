/** People: who sees this account's projects. An owner invites and removes. */
import { Button, Empty, Input, LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import type { PageProps } from "../../module.js";
import { PersonAccess } from "../access/PersonAccess.js";
import {
  BLOCK,
  dayLabel,
  ERROR,
  FIELD,
  Form,
  field,
  LIST,
  QUIET,
  SELECT,
  SPLIT,
  useAct,
} from "../work/bits.js";
import { usePeople } from "./load.js";

const BUILT_IN: Record<string, string> = { owner: "Owner", viewer: "Viewer" };

export function People(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const people = usePeople(props, nonce);
  const act = useAct(props, () => setNonce((n) => n + 1));
  const manage = people.data?.canManage ?? false;
  // Whose access is open below their row.
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="People"
        lede="Everyone here sees your projects with Wren. Wren's team does too."
      />
      <Section>
        {people.error && !people.data ? (
          <LoadFailed error={people.error} onRetry={people.retry} />
        ) : !people.data ? (
          <Loading lines={3} />
        ) : people.data.people.length === 0 ? (
          <Empty>Invite someone below and they show here.</Empty>
        ) : (
          <ul className={LIST}>
            {people.data.people.map((m) => (
              <li key={m.email} className={`${SPLIT} flex-wrap`}>
                <span>
                  <b>{m.email}</b>{" "}
                  {m.role === "member" ? null : (
                    <Tag tone="neutral">{BUILT_IN[m.role] ?? m.role}</Tag>
                  )}
                  <span className={`${QUIET} ${BLOCK}`}>
                    {m.lastSeenAt ? `Last here ${dayLabel(m.lastSeenAt)}` : "Hasn't signed in yet"}
                    {m.invitedBy ? ` · invited by ${m.invitedBy}` : ""}
                  </span>
                </span>
                {manage ? (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      tone="quiet"
                      aria-expanded={open === m.email}
                      onClick={() => setOpen(open === m.email ? null : m.email)}
                    >
                      Access
                    </Button>
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
                  </span>
                ) : null}
                {open === m.email ? (
                  <div className="basis-full pt-3">
                    <PersonAccess client={props.client} email={m.email} role={m.role} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {act.error && !manage ? <p className={ERROR}>{act.error}</p> : null}
      </Section>
      {manage ? (
        <Section
          title="Invite someone"
          note="They sign in with this email. Owners invite others and see billing. Viewers only read."
        >
          <Form
            label="Invite someone"
            submit="Invite"
            act={act}
            onSubmit={(f) =>
              act.run("invite", { email: field(f, "email"), role: field(f, "role") })
            }
          >
            <label className={`${FIELD} grow basis-[220px]`}>
              <span>Their work email</span>
              <Input name="email" type="email" required maxLength={254} />
            </label>
            <label className={FIELD}>
              <span>Role</span>
              <select className={SELECT} name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          </Form>
        </Section>
      ) : people.data ? (
        <p className={QUIET}>Ask an owner to invite a teammate.</p>
      ) : null}
    </>
  );
}
