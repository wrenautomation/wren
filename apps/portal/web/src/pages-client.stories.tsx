/**
 * Each client app's first page, as the client's owner sees it, on the fake server
 * (designs/2026-10-18-portal-page-stories.md). `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { failedIn, pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Client" };
export default meta;

export const Today = pageAt("/");
export const Work = pageAt("/work");
export const Reactivation = pageAt("/reactivation");
export const Leads = pageAt("/leads");
export const Texts = pageAt("/texts");
export const Calls = pageAt("/calls");
export const Payments = pageAt("/payments");
export const Documents = pageAt("/documents");
export const Deals = pageAt("/deals");
export const People = pageAt("/people");
export const Marketplace = pageAt("/marketplace");
export const Marketing = pageAt("/marketing");
export const Sites = pageAt("/sites");
export const Learn = pageAt("/learn");
export const Notes = pageAt("/notes");
export const Calendar = pageAt("/calendar");
export const Voice = pageAt("/voice");
export const Settings = pageAt("/settings");
export const Library = pageAt("/library");
export const Account = pageAt("/account");

/** A record open in its panel, over the list (`?<record's one name>=<id>`). */
export const PersonOpen = pageAt("/people/people?profile=1");

/** The shell while nothing has come back, and when every read fails: an error, never "nothing waits". */
export const Loading = pageAt("/", { mode: "pending" });
export const Failed = pageAt("/", { mode: "fails", check: failedIn("Needs you") });
