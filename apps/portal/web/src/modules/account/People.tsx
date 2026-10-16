/** People: who sees this account's projects. An owner or a manager invites and removes. */
import {
  Button,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useState } from "react";
import type { PageProps } from "../../module.js";
import { PersonAccess } from "../access/PersonAccess.js";
import { BLOCK, dayLabel, ERROR, Form, LIST, NARROW, QUIET, SPLIT, useAct } from "../work/bits.js";
import { usePeople } from "./load.js";

const BUILT_IN: Record<string, string> = { owner: "Owner", viewer: "Viewer" };

/** `bare`: inside a client's record on Wren's Clients app, under its own heading. */
export function People(props: PageProps & { bare?: boolean }) {
  const people = usePeople(props);
  const act = useAct(props, people.retry);
  const manage = people.data?.canManage ?? false;
  // Built-ins first, then the account's own roles; a role's name by its id for the tags.
  const roles = people.data?.roles?.length
    ? people.data.roles
    : [
        { id: "member", name: "Member" },
        { id: "viewer", name: "Viewer" },
        { id: "owner", name: "Owner" },
      ];
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? BUILT_IN[id] ?? id;
  // Whose access is open below their row.
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      {props.bare ? null : (
        <PageHeader
          title="People"
          lede="Everyone here sees your projects with Wren. Wren's team does too."
        />
      )}
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
                  {m.role === "member" ? null : <Tag tone="neutral">{roleName(m.role)}</Tag>}
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
          note="They sign in with this email. Owners see billing. Viewers only read. A manager role (under Roles) invites and sets access without billing."
        >
          <Invite client={props.client} act={act} roles={roles} />
        </Section>
      ) : people.data ? (
        <p className={QUIET}>Ask an owner or a manager to invite a teammate.</p>
      ) : null}
    </>
  );
}

function Invite({
  client,
  act,
  roles,
}: {
  client: string;
  act: ReturnType<typeof useAct>;
  roles: { id: string; name: string }[];
}) {
  const form = useEditForm({
    key: `invite:new:${client}`,
    defaults: { email: "", role: "member" },
  });
  return (
    <Form
      label="Invite someone"
      submit="Invite"
      act={act}
      form={form}
      onSubmit={(v) => act.run("invite", { email: v.email.trim(), role: v.role })}
    >
      <TextField
        form={form}
        name="email"
        label="Their work email"
        className={`${NARROW} grow basis-[220px]`}
        type="email"
        required
        maxLength={254}
      />
      <SelectField
        form={form}
        name="role"
        label="Role"
        className={NARROW}
        options={roles.map((r) => [r.id, r.name] as const)}
      />
    </Form>
  );
}
