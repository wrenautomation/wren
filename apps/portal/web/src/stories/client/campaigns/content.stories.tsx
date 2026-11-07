/** A client's drafts and posts. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { pageAt, shows } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";

const meta: Meta = { title: "Client/Campaigns/Content" };
export default meta;

export const Drafts = pageAt("/campaigns/drafts", {
  answers,
  check: shows("Drafts", "Redraft"),
});

export const Content = pageAt("/campaigns/content", { answers, check: shows("Posts") });
