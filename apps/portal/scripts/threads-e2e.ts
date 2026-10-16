/**
 * Engage's threads in a real browser (designs/2026-10-15-engage-threads.md), on a local preview
 * seeded by `packages/content/test/threads-preview.ts`: one person's two comments show as one
 * row, newest first; the row's whole thread draws nested; Reply from Wren on a deep reply sends
 * that comment's ref, once however often it's pressed; and on a phone the thread opens as its own
 * sheet. Shots land in E2E_SHOTS (default: the system temp folder).
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_threads_preview tsx ../../packages/content/test/threads-preview.ts
 *   PORT=8793 WREN_DATABASE_URL=... pnpm preview      # then, in another shell:
 *   PORT=8793 tsx scripts/threads-e2e.ts
 *
 * The preview has no Restate: `console/call` is answered here, a send taken at once and read
 * back as sent. Local only.
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const url = (process.env.E2E_URL ?? `http://localhost:${process.env.PORT ?? 8793}`).replace(
  /\/$/,
  "",
);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
  console.error(`${url} isn't a local preview.`);
  process.exit(2);
}
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.E2E_SHOTS ?? tmpdir();
const T = Number(process.env.E2E_TIMEOUT ?? 15_000);

interface Call {
  handler: string;
  input: Record<string, unknown>;
  requestId: string;
}

/** Restate as the portal sees it: one run per request id, each send taken and then sent. */
async function fake(page: Page) {
  const calls: Call[] = [];
  const done = new Set<string>();
  await page.route("**/api/console/call", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const requestId = String(body.requestId ?? "");
    if (!done.has(requestId)) {
      done.add(requestId);
      calls.push({
        handler: `${body.service}/${body.handler}`,
        input: (body.input ?? {}) as Record<string, unknown>,
        requestId,
      });
    }
    return route.fulfill({ status: 202, json: { accepted: true, state: "queued", requestId } });
  });
  await page.route("**/api/writes/status", (route) =>
    route.fulfill({ status: 200, json: { state: "sent", answer: { id: 1, ref: "t1_new" } } }),
  );
  return calls;
}

async function open(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  const calls = await fake(page);
  await page.goto(`${url}/marketing/engage`);
  await page.getByText("harbor_plumbing").first().waitFor();
  return { context, page, calls };
}

const tests: [string, (b: Browser) => Promise<void>][] = [
  [
    "1440: one row per person, the thread nested, a reply to a deep node sent once",
    async (browser) => {
      const { context, page, calls } = await open(browser, 1440, 900);
      // One row for harbor_plumbing, with both messages, the newest first.
      const fold = page.locator("[data-fold]").first();
      await fold.waitFor();
      assert.equal(await fold.getAttribute("data-fold"), "2");
      const words = await fold.innerText();
      assert.ok(
        words.indexOf("after hours") < words.indexOf("more than voicemail"),
        `newest first: ${words}`,
      );
      assert.equal(await page.getByText("harbor_plumbing", { exact: true }).count(), 1);
      await page.screenshot({ path: join(SHOTS, "engage-threads-list-1440.png") });

      await page.getByText("harbor_plumbing", { exact: true }).first().click();
      const view = page.locator("[data-thread-view]");
      await view.waitFor();
      // Nested in order: ours, their reply, their follow-up, the third person under it.
      const order = await view
        .locator("[data-node]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-node")));
      assert.deepEqual(order, ["t1_ours", "t1_a1", "t1_a2", "t1_b1", "t1_x1"]);
      const deep = view.locator('[data-node="t1_a2"] [data-node="t1_b1"]');
      assert.equal(await deep.count(), 1, "the third person sits under the follow-up");
      assert.equal(await view.locator("[data-focus]").count(), 1);
      assert.equal(
        await view.locator('[data-node="t1_ours"] > div').getByText("Reply from Wren").count(),
        0,
        "no reply to ourselves",
      );
      await page.getByText("The site hid 1 more reply").waitFor();
      await page.screenshot({
        path: join(SHOTS, "engage-threads-detail-1440.png"),
        fullPage: true,
      });

      // Reply from Wren on the third person's comment.
      const b1 = view.locator('[data-node="t1_b1"] > div').first();
      await b1.getByText("Reply from Wren").click();
      const box = b1.locator("textarea");
      await box.fill("It texts back after hours too, from the same number.");
      const send = b1.getByRole("button", { name: /^(Send|Sending)$/ });
      await send.click();
      await send.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      const replies = calls.filter((c) => c.handler === "ReachDesk/replyInThread");
      assert.equal(replies.length, 1, `one send for a double press: ${replies.length}`);
      assert.equal(replies[0]?.input.ref, "t1_b1");
      assert.equal(replies[0]?.input.body, "It texts back after hours too, from the same number.");
      assert.ok(typeof replies[0]?.input.id === "number");
      // Refresh reads the thread again.
      await view.getByRole("button", { name: "Refresh" }).click();
      await page.waitForTimeout(500);
      assert.equal(calls.filter((c) => c.handler === "ReachDesk/readThread").length, 1);
      await context.close();
    },
  ],
  [
    "1440: unsent words in a thread reply come back after a reload",
    async (browser) => {
      const { context, page } = await open(browser, 1440, 900);
      await page.getByText("harbor_plumbing", { exact: true }).first().click();
      const a2 = page.locator('[data-node="t1_a2"] > div').first();
      await a2.getByText("Reply from Wren").click();
      await a2.locator("textarea").fill("Yes, nights too.");
      await page.waitForTimeout(2600);
      await page.reload();
      await page.getByText("harbor_plumbing", { exact: true }).first().click();
      const again = page.locator('[data-node="t1_a2"] > div').first();
      await again.getByText("Reply from Wren").click();
      assert.equal(await again.locator("textarea").inputValue(), "Yes, nights too.");
      await context.close();
    },
  ],
  [
    "393: the row shows both messages; the thread opens as a full sheet",
    async (browser) => {
      const { context, page } = await open(browser, 393, 852);
      const fold = page.locator("[data-fold]").first();
      await fold.waitFor();
      assert.equal(await fold.getAttribute("data-fold"), "2");
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 393, `no sideways scroll: ${width}`);
      await page.screenshot({ path: join(SHOTS, "engage-threads-list-393.png") });
      await page.getByText("harbor_plumbing", { exact: true }).first().click();
      await page.getByRole("button", { name: /See the whole thread/ }).click();
      const view = page.locator("[data-thread-view]");
      await view.waitFor();
      assert.equal(await view.locator("[data-node]").count(), 5);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, "engage-threads-sheet-393.png") });
      await context.close();
    },
  ],
];

const browser = await chromium.launch({ executablePath: CHROME });
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
    console.log(`FAIL ${name}\n     ${m.split("\n").slice(0, 4).join("\n     ")}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
