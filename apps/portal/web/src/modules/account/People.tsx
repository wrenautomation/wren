/** People: who sees this account's projects. An owner or a manager invites and removes. */
import {
  avatarOf,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Pill,
  Section,
  SelectField,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { useState } from "react";
import type { PageProps } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { PersonAccess } from "../access/PersonAccess.js";
import { dayLabel, ERROR, Form, NARROW, QUIET, useAct } from "../work/bits.js";
import { usePeople } from "./load.js";

type Member = NonNullable<ReturnType<typeof usePeople>["data"]>["people"][number];

const BUILT_IN: Record<string, string> = { owner: "Owner", viewer: "Viewer" };

/** `bare`: inside a client's record on Wren's Clients app, under its own heading. */
export function People(props: PageProps & { bare?: boolean }) {
  const people = usePeople(props);
  const narrow = useNarrow();
  const { go, stateOf } = useGoing();
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
          <PageRows<Member>
            label="People"
            noun="person"
            lines={rowLines(
              people.data.people,
              (m) => m.email,
              (m) =>
                open === m.email ? (
                  <PersonAccess client={props.client} email={m.email} role={m.role} />
                ) : null,
            )}
            rowState={(m) => stateOf(m.email)}
            // Their title opens their access below the row, for whoever manages.
            open={
              manage
                ? { id: open, onOpen: (m) => setOpen(open === m.email ? null : m.email) }
                : undefined
            }
            name={{
              label: "Person",
              icon: "user",
              min: 240,
              title: (m) => m.email,
              avatar: (m) => avatarOf(m.email),
              sub: (m) => (
                <span className={`${QUIET} truncate text-[12.5px]`}>
                  {m.lastSeenAt ? `Last here ${dayLabel(m.lastSeenAt)}` : "Hasn't signed in yet"}
                  {m.invitedBy ? ` · invited by ${m.invitedBy}` : ""}
                </span>
              ),
            }}
            columns={[
              {
                key: "role",
                label: "Role",
                icon: "shield",
                width: 160,
                phone: true,
                cell: (m) => <Pill>{roleName(m.role)}</Pill>,
              },
            ]}
            end={
              manage
                ? (m) => (
                    <RowDoes
                      title={m.email}
                      lone={narrow}
                      busy={act.busy}
                      does={[
                        {
                          id: "access",
                          label: "Access",
                          run: () => setOpen(open === m.email ? null : m.email),
                        },
                        {
                          id: "remove",
                          label: "Remove",
                          confirm: `Remove ${m.email}? They lose access right away.`,
                          run: () =>
                            go(m.email, "Removing", () => act.run("remove", { email: m.email })),
                        },
                      ]}
                    />
                  )
                : undefined
            }
          />
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
