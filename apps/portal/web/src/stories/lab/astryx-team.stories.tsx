/**
 * WA-1278 trial: the client Team page (modules/account/People.tsx) in Astryx parts, beside
 * Client/Back office/Team. Static data, no server. Not in the app: a look to judge, no swap.
 */
import "./astryx-bridge.css";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Selector } from "@astryxdesign/core/Selector";
import { pixel, proportional, Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Theme } from "@astryxdesign/core/theme";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

interface Member extends Record<string, unknown> {
  email: string;
  role: string;
  seen: string;
}

const PEOPLE: Member[] = [
  { email: "owner@acme.example", role: "Owner", seen: "Last here today" },
  {
    email: "sam@acme.example",
    role: "Member",
    seen: "Last here 2 days ago · invited by owner@acme.example",
  },
  {
    email: "pat@acme.example",
    role: "Viewer",
    seen: "Hasn't signed in yet · invited by owner@acme.example",
  },
];
const ROLES = ["Member", "Viewer", "Owner"].map((r) => ({ value: r.toLowerCase(), label: r }));

// the portal's narrow cut (useNarrow)
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const q = matchMedia("(max-width: 640px)");
    const on = () => setNarrow(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return narrow;
}

function TeamPage() {
  const narrow = useNarrow();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const columns: TableColumn<Member>[] = [
    {
      key: "email",
      header: "Person",
      width: proportional(3, { minWidth: 200 }),
      renderCell: (m) => (
        <HStack gap={3} align="center">
          <Avatar name={m.email} size="sm" />
          <VStack gap={0.5}>
            <Text>{m.email}</Text>
            <Text type="supporting">{m.seen}</Text>
          </VStack>
        </HStack>
      ),
    },
    {
      key: "role",
      header: "Role",
      width: pixel(110),
      renderCell: (m) => <Badge label={m.role} />,
    },
    {
      key: "do",
      header: "Actions",
      width: pixel(narrow ? 56 : 200),
      align: "end",
      renderCell: (m) =>
        narrow ? (
          <MoreMenu
            label={`More for ${m.email}`}
            items={[
              { label: "Access", onClick: () => {} },
              { label: "Remove", onClick: () => {} },
            ]}
          />
        ) : (
          <HStack gap={2} justify="end">
            <Button label="Access" size="sm" />
            <Button label="Remove" size="sm" variant="ghost" />
          </HStack>
        ),
    },
  ];
  return (
    <VStack gap={6}>
      <VStack gap={1}>
        <Heading level={1}>People</Heading>
        <Text color="secondary">
          Everyone here sees your projects with Wren. Wren's team does too.
        </Text>
      </VStack>
      <Table<Member> data={PEOPLE} columns={columns} idKey="email" hasHover />
      <VStack gap={3}>
        <Heading level={2}>Invite someone</Heading>
        <Text type="supporting">
          They sign in with this email. Owners see billing. Viewers only read. A manager role (under
          Roles) invites and sets access without billing.
        </Text>
        <HStack gap={3} align="end" wrap="wrap">
          <div style={{ flex: "1 1 220px", maxWidth: 360 }}>
            <TextInput
              label="Their work email"
              type="email"
              value={email}
              onChange={setEmail}
              isRequired
            />
          </div>
          <div style={{ width: 160 }}>
            <Selector label="Role" options={ROLES} value={role} onChange={setRole} />
          </div>
          <Button label="Invite" variant="primary" type="submit" />
        </HStack>
      </VStack>
    </VStack>
  );
}

const meta: Meta = {
  title: "Lab/Astryx Team",
  parameters: { layout: "fullscreen" },
};
export default meta;

/** Astryx's own neutral theme: what it looks like out of the box. */
export const Stock: StoryObj = {
  render: (_a, { globals }) => (
    <Theme theme={neutralTheme} mode={globals.theme === "dark" ? "dark" : "light"}>
      <div style={{ padding: 24, minHeight: "100vh" }}>
        <TeamPage />
      </div>
    </Theme>
  ),
};

/** The same parts on our --ui-* tokens (astryx-bridge.css): Wren's look, Astryx's parts. */
export const OnWrenTokens: StoryObj = {
  render: (_a, { globals }) => (
    <Theme theme={neutralTheme} mode={globals.theme === "dark" ? "dark" : "light"}>
      <div className="astryx-wren" style={{ padding: 24, minHeight: "100vh" }}>
        <TeamPage />
      </div>
    </Theme>
  ),
};
