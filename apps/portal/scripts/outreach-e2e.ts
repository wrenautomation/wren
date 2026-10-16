/**
 * Outreach in a real browser (designs/2026-10-16-outreach-app.md): its tabs in the nav and gone
 * from Marketing's, old Marketing addresses landing on the new ones, Invites' To approve and To
 * message, the Account filter, and two writes through the one write path: an invite approved by
 * a double press goes once, and a comment on someone's post sent with the tab hidden goes once
 * and lands on return.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_outreach_preview \
 *     tsx ../../packages/content/test/outreach-preview.ts
 *   PORT=8792 WREN_DATABASE_URL=... pnpm preview      # then, in another shell:
 *   tsx scripts/outreach-e2e.ts                        # the preview on :8792
 *
 * The preview has no Restate: `e2e-kit.ts`'s fake answers the handlers. Local only.
 */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { fresh, hide, runTests, show, type Test, url } from "./e2e-kit.js";

const at = (page: Page, path: string) =>
  page.waitForURL((u) => u.pathname + u.search === path, { timeout: 5000 });
const navLink = (page: Page, path: string) => page.locator(`nav a[href^="${path}"]`);

const tests: Test[] = [
  [
    "nav: Outreach holds Engage, DMs, Invites and People; Marketing no longer does",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.goto(`${url}/outreach`);
      await page.getByRole("heading", { name: "Engage" }).waitFor();
      for (const p of ["engage", "dms", "invites", "people", "accounts", "dm-copy"])
        assert.ok((await navLink(page, `/outreach/${p}`).count()) > 0, `Outreach's nav links ${p}`);
      await page.goto(`${url}/marketing`);
      await navLink(page, "/marketing/").first().waitFor();
      for (const p of ["engage", "dms", "invites", "people"])
        assert.equal(await navLink(page, `/marketing/${p}`).count(), 0, `Marketing drops ${p}`);
      await context.close();
    },
  ],
  [
    "old addresses: Marketing's DMs and Invites land on Outreach's, search kept",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.goto(`${url}/marketing/dms?view=all`);
      await at(page, "/outreach/dms?view=all");
      await page.getByText("Dana Rivera").first().waitFor();
      await page.goto(`${url}/marketing/invites?view=proposed`);
      await at(page, "/outreach/invites?view=proposed");
      await page.getByText("Alex Sample").first().waitFor();
      // Back goes past the redirect, to the page before it.
      await page.goBack();
      await at(page, "/outreach/dms?view=all");
      await context.close();
    },
  ],
  [
    "Invites: a proposed one waits in To approve, an accepted one in To message",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.goto(`${url}/outreach/invites?view=proposed`);
      await page.getByText("Alex Sample").first().waitFor();
      assert.equal(await page.getByText("Jordan Sample").count(), 0);
      await page.goto(`${url}/outreach/invites?view=message`);
      await page.getByText("Jordan Sample").first().waitFor();
      assert.equal(await page.getByText("Alex Sample").count(), 0);
      await context.close();
    },
  ],
  [
    "Account filter: one account narrows Invites, and rides in the address",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.goto(`${url}/outreach/invites?view=all`);
      await page.getByText("Jordan Sample").first().waitFor();
      await page.locator("[data-account-filter]").first().click();
      await page.getByRole("option", { name: /alt/ }).click();
      await page.waitForURL(/[?&]account=/);
      await page.getByText("Alex Sample").first().waitFor();
      await page.getByText("Jordan Sample").first().waitFor({ state: "detached" });
      await page.reload();
      await page.getByText("Alex Sample").first().waitFor();
      assert.equal(await page.getByText("Jordan Sample").count(), 0, "kept across a reload");
      await context.close();
    },
  ],
  [
    "Invites: Send invite pressed twice goes once",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await page.goto(`${url}/outreach/invites?view=proposed`);
      await page.getByText("Alex Sample").first().click();
      // The panel's button by its words: the row's icon button shares its name.
      await page.locator("button", { hasText: /^Send invite$/ }).click();
      const yes = page
        .getByRole("dialog")
        .getByRole("button", { name: "Send invite", exact: true });
      await yes.dblclick().catch(() => undefined);
      const run = await fake.waitFor("ReachDesk/approveInvites");
      await page.waitForTimeout(800);
      assert.equal(fake.of("ReachDesk/approveInvites").length, 1, "one run");
      assert.equal(run.posts, 1);
      assert.equal((run.input.ids as unknown[]).length, 1);
      await context.close();
    },
  ],
  [
    "Engage: a comment on their post, hidden mid-send, goes once and lands on return",
    async (browser) => {
      const { context, page, fake, reads } = await fresh(browser);
      await page.goto(`${url}/outreach/engage`);
      await page.getByText("Pat Example").first().click();
      const box = page.getByPlaceholder("Write it here.").first();
      await box.waitFor();
      assert.match(await box.inputValue(), /texted every missed call back/);
      await box.press("Meta+Enter");
      await page.getByRole("dialog").getByRole("button", { name: "Comment", exact: true }).click();
      const run = await fake.waitFor("ReachDesk/commentPost");
      await hide(page);
      const before = reads.length;
      run.state = "sent";
      run.answer = { commented: true };
      await page.waitForTimeout(1500);
      await show(page);
      await page.waitForTimeout(1500);
      assert.ok(reads.length > before, "the page read again after it landed");
      assert.equal(run.posts, 1);
      assert.equal(fake.of("ReachDesk/commentPost").length, 1);
      await context.close();
    },
  ],
  [
    "phone: Outreach's tabs are Engage, DMs and Invites; a bare invite is no DM sent",
    async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 393, height: 852 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.goto(`${url}/outreach/dms?view=all`);
      const tabs = page.getByRole("navigation", { name: "Outreach tabs" });
      for (const name of [/Engage$/, /DMs$/, /Invites$/])
        await tabs.getByRole("link", { name }).waitFor();
      await page.getByText("Jordan Sample").first().waitFor();
      await page.goto(`${url}/outreach/dms?view=sent`);
      await page.getByText("Jordan Sample").first().waitFor({ state: "detached" });
      await page.waitForTimeout(1000);
      assert.equal(await page.getByText("Jordan Sample").count(), 0, "Invites holds it");
      assert.equal(await page.getByText("Alex Sample").count(), 0, "Invites holds it");
      await context.close();
    },
  ],
];

await runTests(tests);
