/**
 * The Wren pages that draw their lists with `Rows` (designs/2026-10-21-crm-rows-everywhere.md,
 * batch B3), on the fake server: Ask, made workflows, the home's client health, automations
 * (its switch), the company dossier and a split's ended pages (Retire). Settings has its own
 * stories in `pages-wren.stories.tsx`.
 */
import type { Meta } from "@storybook/react-vite";
import { focusManager } from "@wren/ui";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "./mocks/api.js";
import { ANSWERS } from "./mocks/data/index.js";
import { ADMIN } from "./mocks/data/me.js";
import {
  ASK_ROWS,
  automationRows,
  DOSSIER,
  DRAWN,
  detailOf,
  ENDED_SPLIT,
  EXEC_ROWS,
  FLAG_ROWS,
  HEALTH_ROWS,
  MADE_FLOWS,
  rowsOf,
} from "./mocks/data/wren-rows.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Wren rows" };
export default meta;

type Reply = (body: Record<string, unknown>) => unknown;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Ask: each question a row, its answer in a box under it. */
export const AskQuestions = pageAt("/ask", {
  me: ADMIN,
  answers: rowsOf(ANSWERS, "console", { "console.ask": { rows: ASK_ROWS } }),
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByLabelText("questions")).toBeVisible();
    await expect(await view.findByText(/Why did the Monday digest skip/)).toBeVisible();
    await expect(await view.findByText("Thinking")).toBeVisible();
    await expect(await view.findByText(/Eleven replies/)).toBeVisible();
    await expect(await view.findByText("Failed")).toBeVisible();
  },
});

/** New automation: the workflows made here, as rows. */
export const MadeWorkflows = pageAt("/workflows/new", {
  me: ADMIN,
  answers: { "console/workflowsMade": MADE_FLOWS },
  check: async (page) => {
    const view = within(page);
    const rows = await view.findByLabelText("made workflows");
    await expect(within(rows).getByText("Quote follow-up")).toBeVisible();
    await expect(within(rows).getByText("Live, draft open")).toBeVisible();
    await expect(within(rows).getByText("Draft")).toBeVisible();
  },
});

/** Wren's home: clients at risk and urgent flags, one list. */
export const HealthAtRisk = pageAt("/", {
  me: ADMIN,
  answers: rowsOf(ANSWERS, "console", {
    "console.health": { rows: HEALTH_ROWS },
    "console.flag": { rows: FLAG_ROWS },
  }),
  check: async (page) => {
    // Client health sits on Wren's home, under the map.
    const view = within(page);
    const rows = await view.findByLabelText("Client health");
    // The sheet slides in: wait for it to settle before the visible checks.
    await waitFor(async () => {
      await expect(within(rows).getByText("Acme Plumbing")).toBeVisible();
      await expect(within(rows).getByText("Sender domain flagged")).toBeVisible();
      await expect(within(rows).getByText("Urgent")).toBeVisible();
    });
  },
});

/** A company's dossier: facts and posts as rows. */
export const Dossier = pageAt("/outbound/companies/1", {
  me: ADMIN,
  answers: { "email/dossier": DOSSIER },
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByLabelText("Facts")).toBeVisible();
    await expect(await view.findByLabelText("Recent posts")).toBeVisible();
  },
});

/** A workflow's runs: the phone's shape in the 320px pane, one open beside it. */
export const ExecutionsPane = pageAt("/workflows/canvas?path=wren&pane=runs", {
  me: ADMIN,
  answers: {
    ...rowsOf(ANSWERS, "console", { "console.execution": { rows: EXEC_ROWS } }),
    ...detailOf(ANSWERS, "console.component", DRAWN),
  },
  check: async (page) => {
    const view = within(page);
    const rows = await view.findByLabelText("executions");
    await expect(within(rows).getByText("Bo Fenwick")).toBeVisible();
    await expect(within(rows).getByText("Failed at Read the company")).toBeVisible();
    // A row names its run in the address, and the page stays on the list when it opens.
    const cai = within(rows).getByRole("link", { name: "Cai Moreno" });
    await expect(cai).toHaveAttribute("href", expect.stringContaining("run=x3"));
    await userEvent.click(cai);
    await expect(await view.findByLabelText("executions")).toBeVisible();
    await expect(view.getByRole("tab", { name: "Executions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
});

// Automations: a table of switches. One state per story, so a flip changes the row as the server would.
const AUTOS = automationRows();
const FLIPS: Record<string, unknown>[] = [];
const resetAutos = () => {
  AUTOS.splice(0, AUTOS.length, ...automationRows());
  FLIPS.length = 0;
  freshStory();
};
const AUTO_ANSWERS = {
  ...rowsOf(ANSWERS, "console", { "console.automation": { rows: AUTOS } }),
  "console/workflowSwitch": ((b) => {
    FLIPS.push({ workflow: b.workflow, on: b.on });
    const row = AUTOS.find((r) => r.ref === b.workflow);
    if (row) row.state = b.on ? "on" : "off";
    return { ok: true };
  }) as Reply,
};
const automations = (check: (page: HTMLElement) => Promise<void>) => ({
  ...pageAt("/workflows/all", { me: ADMIN, answers: AUTO_ANSWERS, check }),
  beforeEach: resetAutos,
});

/** The table: a fold per kind, a switch for a made workflow, a failing keyword's error under it. */
export const Automations = automations(async (page) => {
  const view = within(page);
  await expect(await view.findByLabelText("automations")).toBeVisible();
  await expect(await view.findByRole("switch", { name: "Turn Quote follow-up on" })).toBeVisible();
  await expect(await view.findByText(/Instagram refused the DM/)).toBeVisible();
  await expect((await view.findAllByRole("link", { name: "Test run" })).length).toBeGreaterThan(0);
});

/** Flip a switch: one write, the row shows it, and a tab away and back keeps it. */
export const AutomationFlip = automations(async (page) => {
  const view = within(page);
  await userEvent.click(await view.findByRole("switch", { name: "Turn Quote follow-up on" }));
  await expect(await view.findByRole("switch", { name: "Turn Quote follow-up off" })).toBeVisible();
  expect(FLIPS).toEqual([{ workflow: "wf-quote", on: true }]);
  // Away and back: the list reads again; the row stays on.
  focusManager.setFocused(false);
  await wait(50);
  focusManager.setFocused(true);
  await wait(300);
  expect(await view.findByRole("switch", { name: "Turn Quote follow-up off" })).toBeVisible();
  expect(FLIPS).toHaveLength(1);
});

/** Two clicks on one switch run once; two rows switched at once each run once. */
export const AutomationRace = automations(async (page) => {
  const view = within(page);
  const quote = await view.findByRole("switch", { name: "Turn Quote follow-up on" });
  fireEvent.click(quote);
  fireEvent.click(quote);
  await waitFor(() => expect(FLIPS).toHaveLength(1));
  await view.findByRole("switch", { name: "Turn Quote follow-up off" });
  const win = await view.findByRole("switch", { name: "Turn Win-back text on" });
  fireEvent.click(win);
  fireEvent.click(await view.findByRole("switch", { name: "Turn Quote follow-up off" }));
  // The second asks to confirm an off: declined here, so only the first writes.
  await waitFor(() => expect(FLIPS.filter((f) => f.workflow === "wf-win")).toHaveLength(1));
  expect(FLIPS.filter((f) => f.workflow === "wf-quote")).toHaveLength(1);
});

// A split that ended: Retire asks once and the row waits.
const RETIRES: Record<string, unknown>[] = [];
// A client's page: Wren's own page detail also draws a Notes section twice (its key clashes).
const retire = (check: (page: HTMLElement) => Promise<void>) => ({
  ...pageAt("/sites/pages/1", {
    answers: {
      ...detailOf(ANSWERS, "sites.page", ENDED_SPLIT),
      "sites/retireAsk": ((b) => {
        RETIRES.push({ id: b.id });
        return { ok: true };
      }) as Reply,
    },
    check,
  }),
  beforeEach: () => {
    RETIRES.length = 0;
    freshStory();
  },
});

/** The ended split's other pages as rows; a live one has Retire, a retired or waiting one has none. */
export const SplitEnded = retire(async (page) => {
  const view = within(page);
  const rows = await view.findByLabelText("Other versions");
  await expect(within(rows).getByText("Roof check, short")).toBeVisible();
  await expect(within(rows).getByText("Retired")).toBeVisible();
  await expect(within(rows).getByText("Waiting to retire")).toBeVisible();
  await expect(within(rows).getAllByRole("button", { name: /^Retire / })).toHaveLength(2);
});

/** Retire asks once, even when pressed twice, and says what happens next. */
export const SplitRetire = retire(async (page) => {
  const view = within(page);
  const b = await view.findByRole("button", { name: "Retire B" });
  fireEvent.click(b);
  fireEvent.click(b);
  await waitFor(() => expect(RETIRES).toEqual([{ id: "p2" }]));
  await expect(await view.findByText(/Asked\. B comes down/)).toBeVisible();
});

/** Two Retire buttons pressed together run one ask: the page does one thing at a time. */
export const SplitRetireTwo = retire(async (page) => {
  const view = within(page);
  const b = await view.findByRole("button", { name: "Retire B" });
  const c = await view.findByRole("button", { name: "Retire C" });
  fireEvent.click(b);
  fireEvent.click(c);
  await waitFor(() => expect(RETIRES).toHaveLength(1));
  await wait(300);
  expect(RETIRES).toEqual([{ id: "p2" }]);
});
