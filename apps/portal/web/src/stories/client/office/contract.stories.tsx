/** A client's contract, paperwork and documents. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { pageAt, shows } from "../../../mocks/page.js";
import { answers } from "../client-places-kit.js";

const meta: Meta = { title: "Client/Back office/Contract" };
export default meta;

export const Contract = pageAt("/office/contract", {
  empty: false,
  answers,
  check: shows("Contract", "Sign the contract"),
});

export const Paperwork = pageAt("/office/paperwork", { answers, check: shows("Paperwork") });

export const Documents = pageAt("/office/documents", {
  answers,
  check: shows("Documents", "New document"),
});
