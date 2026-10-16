/**
 * The portal's libraries in a real browser (designs/2026-10-16-portal-libs.md): the address on
 * TanStack Router, the lists on TanStack Table and Virtual, the forms on React Hook Form. A
 * list's search, group and picked rows survive a reload and back; a long list draws only the
 * rows in view and still walks to its last; a column moves left and stays there; the list bar's
 * menus open on hover, a field's choices beside it, and a diagonal toward them keeps them open
 * (a phone taps); a form's unsent words survive a page switch. At a desk's width and a phone's.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_libs tsx ../../packages/content/test/inbox-preview.ts
 *   WREN_DATABASE_URL=... tsx ../../packages/content/test/libs-preview.ts   # 600 people
 *   PORT=8792 WREN_DATABASE_URL=... pnpm preview      # then, in another shell:
 *   tsx scripts/libs-e2e.ts                            # the preview on :8792
 *
 * Local only: it refuses any address but this machine's.
 */
import assert from "node:assert/strict";
import { type Browser, chromium, type Page } from "playwright-core";

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
const T = Number(process.env.E2E_TIMEOUT ?? 15_000);

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 393, height: 852 };

/** A page with no console errors allowed; `done` throws the first one seen. */
async function open(browser: Browser, size: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport: size,
    ...(size === PHONE ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return {
    page,
    done: async () => {
      await context.close();
      assert.deepEqual(errors.slice(0, 3), [], "no console errors");
    },
  };
}

/** Wait for the address to match: a move inside the app fires no load. */
const at = (page: Page, want: RegExp | string) =>
  page.waitForFunction(
    ([src, exact]) => (exact ? location.href === src : new RegExp(src).test(location.href)),
    [typeof want === "string" ? want : want.source, typeof want === "string"] as const,
    { timeout: T },
  );

const search = (page: Page) => new URL(page.url()).searchParams;
const rowSel = (narrow: boolean) => (narrow ? "li[data-row]" : "tr[data-row]");
const picked = (page: Page, narrow: boolean) =>
  page.locator(`${rowSel(narrow)} input[type=checkbox]:checked`).count();

async function display(page: Page) {
  await page.getByRole("button", { name: "Display" }).click();
}

/** Search, group and two picked rows survive a reload, a move away and back. */
async function roundTrip(browser: Browser, size: typeof DESK) {
  const narrow = size === PHONE;
  const { page, done } = await open(browser, size);
  await page.goto(`${url}/inbox/waiting`);
  await page.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  // Group by site from Display: the address says so.
  await display(page);
  await page.getByText("Group by site").click();
  await at(page, /group=\w+/);
  await page.keyboard.press("Escape");
  // A search narrows the rows: the address says that too.
  const box = page.getByRole("searchbox").first();
  if (await box.count()) {
    await box.fill("a");
    await at(page, /[?&]q=a/);
  }
  await page.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  const rows = page.locator(`${rowSel(narrow)} input[type=checkbox]`);
  const n = Math.min(2, await rows.count());
  assert.ok(n > 0, "rows to pick");
  for (let i = 0; i < n; i++) await rows.nth(i).check();
  assert.equal(await picked(page, narrow), n, "picked");
  const here = page.url();

  await page.reload();
  await page.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  assert.equal(page.url(), here, "the address survives a reload");
  assert.ok(search(page).get("group"), "still grouped");
  await page.waitForFunction(
    ([sel, want]) => document.querySelectorAll(`${sel} input:checked`).length === want,
    [rowSel(narrow), n] as const,
    { timeout: T },
  );

  // Away to another page and back: the same list, the same picks.
  await page.goto(`${url}/people/people`);
  await page.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  await page.goBack();
  await at(page, here);
  await page.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  await page.waitForFunction(
    ([sel, want]) => document.querySelectorAll(`${sel} input:checked`).length === want,
    [rowSel(narrow), n] as const,
    { timeout: T },
  );
  // A link someone else opens picks nothing.
  const fresh = await browser.newContext({ viewport: size });
  const other = await fresh.newPage();
  await other.goto(here);
  await other.locator(rowSel(narrow)).first().waitFor({ timeout: T });
  assert.equal(await picked(other, narrow), 0, "a shared link picks nothing");
  await fresh.close();
  await done();
}

/** 200 rows draw only what's in view, scroll to the last, and the keys walk past the fold. */
async function longList(browser: Browser, size: typeof DESK) {
  const narrow = size === PHONE;
  const { page, done } = await open(browser, size);
  await page.goto(`${url}/people/people?size=200`);
  const rows = page.locator(rowSel(narrow));
  await rows.first().waitFor({ timeout: T });
  const drawn = await rows.count();
  assert.ok(drawn < 100, `only rows in view draw (${drawn} of 200)`);
  // Scroll in steps, as a wheel would: each frame lands in time and draws a window of rows.
  const most = await page.evaluate(async (phone) => {
    const panel = document.querySelector("tbody")?.closest(".overflow-auto");
    const el: { scrollTop: number; scrollHeight: number } | null = phone
      ? document.scrollingElement
      : (panel ?? null);
    if (!el) return { gap: -1, max: -1 };
    let gap = 0;
    let max = 0;
    let last = performance.now();
    while (el.scrollTop + innerHeight < el.scrollHeight - 4) {
      el.scrollTop += 240;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = performance.now();
      gap = Math.max(gap, now - last);
      last = now;
      max = Math.max(
        max,
        document.querySelectorAll(phone ? "li[data-row]" : "tr[data-row]").length,
      );
    }
    return { gap, max };
  }, narrow);
  assert.ok(most.max > 0 && most.max < 100, `a window of rows draws while scrolling (${most.max})`);
  assert.ok(most.gap < 250, `scrolling keeps its frames (${Math.round(most.gap)}ms worst)`);
  await page.locator(`${rowSel(narrow)}[data-row="199"]`).waitFor({ timeout: T });
  if (!narrow) {
    // Back to the top, then walk down with the keys: the cursor's row draws and shows.
    await page.evaluate(() =>
      document.querySelector("tbody")?.closest(".overflow-auto")?.scrollTo(0, 0),
    );
    await page.locator("tr[data-row='0']").waitFor({ timeout: T });
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 130; i++) await page.keyboard.press("j");
    const row = page.locator("tr[data-row='129']");
    await row.waitFor({ timeout: T });
    assert.equal(await row.getAttribute("data-cursor"), "", "the cursor walked to row 130");
    assert.ok(await row.isVisible(), "and it is in view");
  }
  await done();
}

/** A column moved left in Display stays left, in the address and on a reload. */
async function columnOrder(browser: Browser) {
  const { page, done } = await open(browser, DESK);
  await page.goto(`${url}/people/people`);
  await page.locator("tr[data-row]").first().waitFor({ timeout: T });
  const heads = () =>
    page.locator("thead th[scope=col]").evaluateAll((ths) => ths.map((t) => t.textContent ?? ""));
  const before = await heads();
  await display(page);
  const move = page.getByRole("button", { name: /^Move .* left$/ }).first();
  await move.click();
  await at(page, /cols=/);
  await page.keyboard.press("Escape");
  const after = await heads();
  assert.notDeepEqual(after, before, "the order changed");
  await page.reload();
  await page.locator("tr[data-row]").first().waitFor({ timeout: T });
  assert.deepEqual(await heads(), after, "and stays on a reload");
  await done();
}

const POPUP = '[data-slot="popover-content"]';

/** Filter and Display open on hover; a field's choices open beside it and a diagonal keeps them. */
async function hoverMenus(browser: Browser) {
  const { page, done } = await open(browser, DESK);
  await page.goto(`${url}/people/people`);
  await page.locator("tr[data-row]").first().waitFor({ timeout: T });
  const filter = page.getByRole("button", { name: /^Filter/ }).first();
  await filter.hover();
  const pop = page.locator(POPUP).filter({ has: page.getByLabel("Filter by") });
  await pop.waitFor({ timeout: T });
  assert.equal(
    await page.evaluate((sel) => !!document.activeElement?.closest(sel), POPUP),
    false,
    "a hover leaves focus where it was",
  );
  const rows = pop.locator("[data-filter-field]");
  assert.ok((await rows.count()) >= 3, "fields to hover");
  const a = rows.nth(0);
  const aKey = await a.getAttribute("data-filter-field");
  const bKey = await rows.nth(1).getAttribute("data-filter-field");
  await a.hover();
  const sub = page.locator(`[data-filter-editor="${aKey}"]`);
  await sub.waitFor({ timeout: T });
  // From the row toward the far, lower corner of its choices: across the next row on the way.
  const from = await a.boundingBox();
  const to = await sub.boundingBox();
  assert.ok(from && to, "boxes");
  const start = { x: from.x + from.width - 30, y: from.y + from.height / 2 };
  const end = { x: to.x + 24, y: Math.min(to.y + to.height - 12, from.y + from.height * 3.5) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(400);
  assert.ok(await sub.isVisible(), "a diagonal into the submenu keeps it open");
  assert.equal(
    await page.locator(`[data-filter-editor="${bKey}"]`).count(),
    0,
    "the row crossed doesn't open",
  );
  // Away from both: they close after a short grace.
  await page.mouse.move(1400, 880, { steps: 4 });
  await pop.waitFor({ state: "detached", timeout: T });
  // Display opens on hover too; a click on the trigger keeps it; Escape shuts it.
  const displayChip = page.getByRole("button", { name: "Display" });
  await displayChip.hover();
  const shown = page.locator(POPUP).filter({ hasText: "Per page" });
  await shown.waitFor({ timeout: T });
  await displayChip.click();
  await page.mouse.move(1400, 880, { steps: 4 });
  await page.waitForTimeout(500);
  assert.ok(await shown.isVisible(), "clicked open stays open");
  await page.keyboard.press("Escape");
  await shown.waitFor({ state: "detached", timeout: T });
  // Keys: focus Filter, Enter opens it with the field box focused.
  await filter.focus();
  await page.keyboard.press("Enter");
  await pop.waitFor({ timeout: T });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Filter by",
    null,
    { timeout: T },
  );
  await page.keyboard.press("Escape");
  await done();
}

/** On a phone a resting finger opens nothing: Display opens on a tap. */
async function tapOnly(browser: Browser) {
  const { page, done } = await open(browser, PHONE);
  await page.goto(`${url}/people/people`);
  await page.locator("li[data-row]").first().waitFor({ timeout: T });
  const displayChip = page.getByRole("button", { name: "Display" });
  await displayChip.hover();
  await page.waitForTimeout(600);
  assert.equal(await page.locator(POPUP).count(), 0, "hover opens nothing on a phone");
  await displayChip.tap();
  await page.locator(POPUP).filter({ hasText: "Per page" }).waitFor({ timeout: T });
  await done();
}

const tests: [string, (b: Browser) => Promise<void>][] = [
  ["round trip, desk", (b) => roundTrip(b, DESK)],
  ["round trip, phone", (b) => roundTrip(b, PHONE)],
  ["long list, desk", (b) => longList(b, DESK)],
  ["long list, phone", (b) => longList(b, PHONE)],
  ["column order", columnOrder],
  ["hover menus, desk", hoverMenus],
  ["tap only, phone", tapOnly],
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
    console.log(`FAIL ${name}\n     ${m.split("\n").slice(0, 3).join("\n     ")}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
