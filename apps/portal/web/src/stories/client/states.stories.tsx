/** A client's portal while loading and when it fails. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { failedIn, pageAt } from "../../mocks/page.js";

const meta: Meta = { title: "Client/States" };
export default meta;

/** The shell while nothing has come back, and when every read fails: an error, never "nothing waits". */
export const Loading = pageAt("/", { mode: "pending" });

export const Failed = pageAt("/", { mode: "fails", check: failedIn("Needs you") });
