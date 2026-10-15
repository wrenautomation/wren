/**
 * The one write path in a real browser (designs/2026-10-15-one-write-path.md): a send, a draft
 * then a send, and a set-aside with undo, each with the tab hidden mid-write, a row switch or a
 * reload, must end with the page matching the server.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_writes_e2e tsx ../../packages/content/test/inbox-preview.ts
 *   PORT=8792 WREN_DATABASE_URL=... pnpm preview      # then, in another shell:
 *   tsx scripts/writes-e2e.ts                          # the preview on :8792
 *
 * The preview has no Restate, so the handlers it can't run (`console/call`: a reply, a DM, a
 * draft, a pass) are answered here by a fake that does what Restate does for the portal: one run
 * per request id, sends taken at once and their outcome read from `writes/status`. Local only.
 */
import assert from "node:assert/strict";
import { type Browser, chromium, type Page, type Route } from "playwright-core";

const url = (process.env.E2E_URL ?? `http://localhost:${process.env.PORT ?? 8792}`).replace(
  /\/$/,
  "",
);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
  console.error(`${url} isn't a local preview.`);
  process.exit(2);
}
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SENDS = new Set([
  "InboxDesk/reply",
  "ReachDesk/reply",
  "ReachDesk/answerComment",
  "ReachDesk/dmComment",
]);

interface Run {
  id: string;
  handler: string;
  input: Record<string, unknown>;
  posts: number;
  at: number;
  state: "sending" | "sent" | "failed";
  answer?: unknown;
  error?: string;
}

/** Restate as the portal sees it: one run per request id; a send's outcome read by its id. */
class FakeRestate {
  runs = new Map<string, Run>();
  order: string[] = [];

  async attach(page: Page) {
    await page.route("**/api/console/call", (r) => this.call(r));
    await page.route("**/api/writes/status", (r) => this.status(r));
  }

  private async call(route: Route) {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const handler = `${body.service}/${body.handler}`;
    const id = typeof body.requestId === "string" ? body.requestId : null;
    if (!id) return route.fulfill({ status: 400, json: { message: "no request id" } });
    let run = this.runs.get(id);
    if (!run) {
      run = {
        id,
        handler,
        input: (body.input ?? {}) as Record<string, unknown>,
        posts: 0,
        at: Date.now(),
        state: "sending",
      };
      this.runs.set(id, run);
      this.order.push(id);
      // Anything but a send runs at once.
      if (!SENDS.has(handler)) {
        run.state = "sent";
        run.answer = { done: true };
      }
    }
    run.posts += 1;
    if (SENDS.has(handler))
      return route.fulfill({
        status: 202,
        json: { accepted: true, state: "queued", requestId: id },
      });
    return route.fulfill({ status: 200, json: run.answer });
  }

  private async status(route: Route) {
    const { requestId } = route.request().postDataJSON() as { requestId: string };
    const run = this.runs.get(requestId);
    const json = !run
      ? { state: "unknown" }
      : run.state === "sent"
        ? { state: "sent", answer: run.answer }
        : run.state === "failed"
          ? { state: "failed", error: run.error }
          : { state: "sending" };
    return route.fulfill({ status: 200, json });
  }

  of(handler: string): Run[] {
    return [...this.runs.values()].filter((r) => r.handler === handler);
  }

  async waitFor(handler: string, n = 1): Promise<Run> {
    for (let i = 0; i < 100; i++) {
      const got = this.of(handler);
      if (got.length >= n) return got[n - 1] as Run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no ${handler} call`);
  }
}

/** The tab hidden (another app to the front), and back. A string: tsx renames functions. */
const seen = (state: "hidden" | "visible", moment: "blur" | "focus") => `
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "${state}" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => ${state === "hidden"} });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("${moment}"));
`;
const hide = (page: Page) => page.evaluate(seen("hidden", "blur"));
const show = (page: Page) => page.evaluate(seen("visible", "focus"));

async function fresh(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  const fake = new FakeRestate();
  await fake.attach(page);
  const reads: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/console\/records(List|Get)$/.test(r.url())) reads.push(r.url());
  });
  return { context, page, fake, reads };
}

const inboxComment = async (page: Page) => {
  await page.goto(`${url}/inbox/waiting`);
  await page.getByText("Comment", { exact: true }).first().click();
  await page.getByText("Reply by").waitFor();
};
const openEngage = async (page: Page, words: string) => {
  await page.goto(`${url}/marketing/engage`);
  await page.getByText(words).first().click();
  await page.getByPlaceholder("Write it here.").first().waitFor();
};
const replyBox = (page: Page) => page.locator("textarea").first();
const sendButton = (page: Page) => page.getByRole("button", { name: /^(Send|Sending)/ }).first();

const tests: [string, (b: Browser) => Promise<void>][] = [
  [
    "Inbox reply refused while away: words back, the reason said, one run",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await inboxComment(page);
      await replyBox(page).fill("True that");
      await sendButton(page).click();
      const run = await fake.waitFor("InboxDesk/reply");
      assert.equal(run.input.body, "True that");
      // Another row, then another app, while it sends; it's refused out of sight.
      await page.keyboard.press("Escape");
      await page.getByText("Text", { exact: true }).first().click();
      await hide(page);
      run.state = "failed";
      run.error = "LinkedIn refused it: invalid input.";
      await page.waitForTimeout(1500);
      await show(page);
      await page.getByText("didn't go through").first().waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await page.getByText("Comment", { exact: true }).first().click();
      await page.getByText("Not sent: LinkedIn refused it: invalid input.").waitFor();
      assert.equal(await replyBox(page).inputValue(), "True that");
      assert.equal(fake.of("InboxDesk/reply").length, 1);
      await context.close();
    },
  ],
  [
    "Inbox reply that lands while hidden: said on return, the page reads again",
    async (browser) => {
      const { context, page, fake, reads } = await fresh(browser);
      await inboxComment(page);
      await replyBox(page).fill("Sounds good");
      await sendButton(page).click();
      const run = await fake.waitFor("InboxDesk/reply");
      await hide(page);
      run.state = "sent";
      run.answer = { sent: true };
      await page.waitForTimeout(1500);
      const before = reads.length;
      await show(page);
      await page.getByText("Sent.", { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await replyBox(page).inputValue(), "");
      await page.waitForTimeout(500);
      assert.ok(reads.length > before, "the page read again on return");
      assert.equal(run.posts, 1);
      await context.close();
    },
  ],
  [
    "a reload mid-send: given again under its id, run once, the outcome shown",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await inboxComment(page);
      await replyBox(page).fill("On it");
      await sendButton(page).click();
      const run = await fake.waitFor("InboxDesk/reply");
      await page.reload();
      for (let i = 0; i < 50 && run.posts < 2; i++) await page.waitForTimeout(100);
      assert.equal(run.posts, 2, "the new load gave it again");
      assert.equal(fake.of("InboxDesk/reply").length, 1, "under the same id");
      run.state = "sent";
      run.answer = { sent: true };
      await page.getByText("Comment", { exact: true }).first().click();
      await page.getByText("Sent.", { exact: true }).waitFor({ timeout: 8000 });
      await context.close();
    },
  ],
  [
    "Engage DM: the draft's save lands before the send, hidden mid-send, it lands",
    async (browser) => {
      const { context, page, fake, reads } = await fresh(browser);
      await openEngage(page, "Still drowning in voicemails.");
      const box = page.getByPlaceholder("Write it here.").first();
      await box.fill("Let's fix that this week");
      // Sent at once: the save may still be waiting on its delay.
      await box.press("Meta+Enter");
      await page.getByRole("dialog").getByRole("button", { name: "Reply", exact: true }).click();
      const run = await fake.waitFor("ReachDesk/reply");
      const saved = fake
        .of("DraftAsk/set")
        .find((s) => s.input.record === "dm" && s.input.text === "Let's fix that this week");
      assert.ok(saved, "the draft saved its words");
      assert.ok(
        fake.order.indexOf(saved.id) < fake.order.indexOf(run.id),
        "the save landed before the send",
      );
      await hide(page);
      run.state = "sent";
      run.answer = { queued: true };
      await page.waitForTimeout(1500);
      const before = reads.length;
      await show(page);
      await page.waitForTimeout(1500);
      assert.ok(reads.length > before, "the page read again on return");
      assert.equal(run.posts, 1);
      assert.equal(fake.of("ReachDesk/reply").length, 1);
      await context.close();
    },
  ],
  [
    "Engage comment answer: hidden mid-send, refused, the reason said on return",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await openEngage(page, "Does this work for a two-truck shop?");
      const box = page.getByPlaceholder("Write it here.").first();
      await box.fill("Two trucks is the sweet spot");
      await box.press("Meta+Enter");
      await page.getByRole("dialog").getByRole("button", { name: "Answer", exact: true }).click();
      const run = await fake.waitFor("ReachDesk/answerComment");
      await hide(page);
      run.state = "failed";
      run.error = "YouTube refused it: comments are off.";
      await page.waitForTimeout(1500);
      await show(page);
      await page
        .getByText(/YouTube refused it: comments are off\./)
        .first()
        .waitFor({ timeout: 5000 });
      assert.equal(run.posts, 1);
      await context.close();
    },
  ],
  [
    "set aside with undo: undo sends nothing; past its deadline while hidden it goes once",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await page.clock.install();
      await openEngage(page, "Does this work for a two-truck shop?");
      const drop = () =>
        page.locator("aside").last().getByRole("button", { name: "Drop", exact: true }).click();
      const undo = page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" });
      await drop();
      await undo.first().click();
      await page.clock.fastForward(12_000);
      await page.waitForTimeout(300);
      assert.equal(fake.of("ReachDesk/dropComment").length, 0, "undo sent nothing");
      // Back on the list; again, and the tab hides past the deadline (its timers may not run).
      const row = page.getByText("Does this work for a two-truck shop?").first();
      if (!(await page.locator("aside").last().getByRole("button", { name: "Drop" }).isVisible()))
        await row.click();
      await drop();
      await hide(page);
      await page.clock.fastForward(12_000);
      await show(page);
      await fake.waitFor("ReachDesk/dropComment");
      await page.waitForTimeout(500);
      assert.equal(fake.of("ReachDesk/dropComment").length, 1);
      assert.equal(fake.of("ReachDesk/dropComment")[0]?.posts, 1);
      await context.close();
    },
  ],
];

const browser = await chromium.launch({ executablePath: CHROME });
const T = Number(process.env.E2E_TIMEOUT ?? 10_000);
let failed = 0;
const only = process.argv[2];
for (const [name, run] of tests) {
  if (only && !name.includes(only)) continue;
  try {
    await run(browser);
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    const m = err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${name}\n     ${m.split("\n").slice(0, 3).join("\n     ")}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
