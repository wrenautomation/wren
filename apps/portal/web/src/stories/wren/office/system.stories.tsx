/** Back office › System: portal speed per route. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { within } from "storybook/test";
import { ANSWERS } from "../../../mocks/data/index.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { ownRows } from "../../../mocks/data/records.js";
import { SPEED_ROWS } from "../../../mocks/data/speed.js";
import { pageAt, rowsFit, shows } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Back office/System" };
export default meta;

const SPEED = ownRows("console.speed", SPEED_ROWS, ANSWERS);

export const Speed = pageAt("/office/speed?view=today", {
  me: ADMIN,
  answers: SPEED,
  check: rowsFit,
});

export const SpeedWeek = pageAt("/office/speed?view=week", {
  me: ADMIN,
  answers: SPEED,
  check: shows("Speed"),
});

export const SpeedEmpty = pageAt("/office/speed", {
  me: ADMIN,
  answers: ownRows("console.speed", [], ANSWERS),
  check: async (page) => {
    await within(page).findByText("Speed shows here once people use the portal.");
  },
});

export const SpeedPending = pageAt("/office/speed", { me: ADMIN, mode: "pending" });

export const SpeedFails = pageAt("/office/speed", { me: ADMIN, mode: "fails" });
