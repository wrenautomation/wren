/**
 * Notes' dialogs on the fake server: Share's "People with access" as `Rows`. A role pick writes
 * through the page's own `share` call; Remove leaves the row. No pixel compare: render, play, axe.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { type Answers, fakeApi, freshStory } from "./mocks/api.js";
import { ANSWERS } from "./mocks/data/index.js";
import { CLIENT } from "./mocks/data/me.js";
import type { NoteOpen, NoteShare } from "./modules/notes/api.js";
import { ShareDialog } from "./modules/notes/share.js";

const meta: Meta = { title: "Pages/Notes dialogs" };
export default meta;

const START: NoteShare[] = [
  { who: "sam@acme.example", role: "edit", by: "owner@acme.example", at: null },
  { who: "jo@acme.example", role: "view", by: "owner@acme.example", at: null },
];
let shares = START;
const NOTE = {
  id: "n1",
  name: "Spring promo plan",
  owner: "owner@acme.example",
  role: "owner",
  general: "private",
  generalRole: "view",
  get shares() {
    return shares;
  },
} as unknown as NoteOpen;

const answers: Answers = {
  ...ANSWERS,
  // The server keeps the new set and answers with it, as `share` does.
  "notes/share": (b) => {
    shares = b.role
      ? shares.some((s) => s.who === b.who)
        ? shares.map((s) => (s.who === b.who ? { ...s, role: b.role as NoteShare["role"] } : s))
        : [
            ...shares,
            { who: String(b.who), role: b.role as NoteShare["role"], by: "you", at: null },
          ]
      : shares.filter((s) => s.who !== b.who);
    return { shares };
  },
} as Answers;

export const Share: StoryObj = {
  render: () => (
    <ShareDialog
      client={CLIENT.id}
      note={NOTE}
      people={null}
      open
      onOpenChange={() => {}}
      onChanged={() => {}}
    />
  ),
  beforeEach: () => {
    shares = START;
    freshStory();
  },
  parameters: { layout: "fullscreen", msw: fakeApi(answers) },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    const list = within(dialog);
    // The owner, then each share: a table on a wide screen, a list on a phone.
    await expect(list.getByText("sam@acme.example")).toBeVisible();
    await expect(list.getByText("Owner")).toBeVisible();
    const role = list.getByRole("combobox", { name: "sam@acme.example's role" });
    await userEvent.selectOptions(role, "view");
    // The row draws again from the server's answer: read the select afresh.
    await waitFor(() =>
      expect(list.getByRole("combobox", { name: "sam@acme.example's role" })).toHaveValue("view"),
    );
    // Two removes fast: both rows go and neither press is lost.
    await userEvent.selectOptions(
      list.getByRole("combobox", { name: "sam@acme.example's role" }),
      "",
    );
    await userEvent.selectOptions(
      list.getByRole("combobox", { name: "jo@acme.example's role" }),
      "",
    );
    await waitFor(() => {
      expect(list.queryByText("sam@acme.example")).toBeNull();
      expect(list.queryByText("jo@acme.example")).toBeNull();
    });
  },
};
