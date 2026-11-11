import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { type AgentChatRow, AgentChats, type ChatFolders } from "./agent-chats.js";
import { WORST } from "./fixtures/worst.js";
import type { FolderActs, FolderNode } from "./folders.js";

export default {
  title: "Components/Agent chat/Chats",
  id: "agent-chats",
} satisfies Meta;

type Story = StoryObj;

const H = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();
const ROWS: AgentChatRow[] = [
  {
    session: "s1",
    at: ago(0.2),
    title: "Which tools do career coaches use to book discovery calls?",
  },
  { session: "s2", at: ago(2), title: "What color is this? One word." },
  { session: "s3", at: ago(26), title: "Benchmarks for cold email reply rates in 2026" },
  { session: "s4", at: ago(80), title: "Which CRMs do small law firms use most?" },
  { session: "s5", at: ago(24 * 40) },
];

/** A folder tree in memory, as the portal's `useFolders` gives it. */
function useFakeFolders(start: FolderNode[], startFiled: Record<string, number>): ChatFolders {
  const [folders, setFolders] = useState(start);
  const [filed, setFiled] = useState(startFiled);
  const acts: FolderActs = {
    make: async (name, parent) => {
      const f = { id: Math.max(0, ...folders.map((x) => x.id)) + 1, parent, name };
      setFolders((fs) => [...fs, f]);
      return f;
    },
    rename: async (id, name) =>
      setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f))),
    move: async (id, to) =>
      setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, parent: to } : f))),
    drop: async (id) => {
      const up = folders.find((f) => f.id === id)?.parent ?? null;
      setFolders((fs) =>
        fs.filter((f) => f.id !== id).map((f) => (f.parent === id ? { ...f, parent: up } : f)),
      );
      setFiled((m) =>
        Object.fromEntries(
          Object.entries(m).flatMap(([k, v]) =>
            v !== id ? [[k, v]] : up == null ? [] : [[k, up]],
          ),
        ),
      );
    },
    file: async (keys, folder) =>
      setFiled((m) => {
        const n = { ...m };
        for (const k of keys) {
          if (folder == null) delete n[k];
          else n[k] = folder;
        }
        return n;
      }),
  };
  return { id: "story", folders, folderOf: (k) => filed[k] ?? null, acts };
}

const FOLDERS: FolderNode[] = [
  { id: 1, parent: null, name: "Coaching" },
  { id: 2, parent: 1, name: "Booking tools" },
  { id: 3, parent: null, name: "Cold email" },
];

function List({ rows = ROWS, folders }: { rows?: AgentChatRow[]; folders?: ChatFolders }) {
  const [open, setOpen] = useState<string | null>("s2");
  return (
    <div className="flex max-h-[520px] w-[248px] flex-col bg-(--ui-paper) p-3">
      <AgentChats
        rows={rows}
        open={open}
        hrefOf={(r) => `#${r.session}`}
        onOpen={(r) => setOpen(r.session)}
        folders={folders}
      />
    </div>
  );
}

function Filed({ start, filed }: { start: FolderNode[]; filed: Record<string, number> }) {
  return <List folders={useFakeFolders(start, filed)} />;
}

/** Day heads, the time at the right, the open chat marked; a click opens another. */
export const Default: Story = {
  render: () => <List />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("heading", { name: "Today" })).toBeTruthy();
    await expect(c.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
    await expect(c.getByText("Untitled chat")).toBeTruthy();
    const open = c.getByRole("link", { current: "page" });
    await expect(open.textContent).toContain("What color is this?");
    await userEvent.click(c.getByText(/Which CRMs/));
    await expect(c.getByRole("link", { current: "page" }).textContent).toContain("Which CRMs");
  },
};

const WORST_ROWS: AgentChatRow[] = [
  { session: "s1", at: ago(0.1), title: WORST.longText },
  { session: "s2", at: ago(1), title: WORST.url },
  { session: "s3", at: ago(25), title: WORST.nonLatin },
  { session: "s4", at: ago(30), title: WORST.emoji },
  { session: "s5", at: ago(50), title: WORST.empty },
  ...Array.from({ length: 30 }, (_, i) => ({
    session: `old${i}`,
    at: ago(24 * (8 + i * 3)),
    title: `${WORST.longLabel} ${i + 1}`,
  })),
];

/** Long, unbroken, non-Latin, emoji and empty titles, and 35 chats: the list scrolls, never widens. */
export const WorstCase: Story = {
  render: () => <List rows={WORST_ROWS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText("Untitled chat")).toHaveLength(1);
    const list = canvasElement.querySelector(".overflow-y-auto") as HTMLElement;
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  },
};

/** Folders first, nested one level; chats in no folder under their day heads. A folder opens on a click. */
export const Folders: Story = {
  render: () => <Filed start={FOLDERS} filed={{ s1: 2, s3: 3 }} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.queryByText(/Benchmarks for cold email/)).toBeNull();
    await userEvent.click(c.getByRole("button", { name: /^Cold email/ }));
    await expect(c.getByText(/Benchmarks for cold email/)).toBeTruthy();
  },
};

/** No folders yet: one quiet row offers them. */
export const FoldersEmpty: Story = {
  render: () => <Filed start={[]} filed={{}} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Group chats in folders" }));
    await expect(c.getByRole("textbox", { name: "Folder name" })).toBeTruthy();
  },
};

/** Three levels, long names, an empty folder: the open chat's folders open by themselves; names wrap, the list never widens. */
export const FoldersDeep: Story = {
  render: () => (
    <Filed
      start={[
        { id: 1, parent: null, name: WORST.longLabel },
        { id: 2, parent: 1, name: WORST.longText.slice(0, 80) },
        { id: 3, parent: 2, name: WORST.nonLatin.slice(0, 40) },
        { id: 4, parent: null, name: "Empty" },
      ]}
      filed={{ s1: 3, s2: 3 }}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    // the open chat's folders open by themselves
    await expect(c.getByText(/What color is this/)).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: /^Empty/ }));
    await expect(c.getByText(/^Empty\. Drag chats here/)).toBeTruthy();
    const list = canvasElement.querySelector(".overflow-y-auto") as HTMLElement;
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  },
};
