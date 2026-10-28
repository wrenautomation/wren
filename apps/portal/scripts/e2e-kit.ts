/**
 * What the portal's browser e2e scripts share (writes-e2e.ts, outreach-e2e.ts): the local preview's
 * address, Chrome, a fake Restate for the handlers the preview can't run, the tab hidden and back,
 * a fresh page, and the runner. Local only.
 */
import { type Browser, chromium, type Page, type Route } from "playwright-core";
import { SEND_HANDLERS } from "../src/services.js";

export const T = Number(process.env.E2E_TIMEOUT ?? 10_000);

export const url = (process.env.E2E_URL ?? `http://localhost:${process.env.PORT ?? 8792}`).replace(
  /\/$/,
  "",
);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
  console.error(`${url} isn't a local preview.`);
  process.exit(2);
}
export const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// The Worker's own list: a handler it accepts and tracks is one the fake answers 202.
const SENDS = SEND_HANDLERS;

export interface Run {
  id: string;
  handler: string;
  input: Record<string, unknown>;
  posts: number;
  at: number;
  state: "sending" | "sent" | "failed";
  answer?: unknown;
  error?: string;
  retry?: { count: number; reason: string };
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
          : { state: "sending", ...(run.retry ? { retry: run.retry } : {}) };
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
export const hide = (page: Page) => page.evaluate(seen("hidden", "blur"));
export const show = (page: Page) => page.evaluate(seen("visible", "focus"));

export async function fresh(browser: Browser) {
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

export type Test = [string, (b: Browser) => Promise<void>];

/** Each test in its own page; `argv[2]` runs only the ones whose name holds it. Exits 1 on a fail. */
export async function runTests(tests: Test[]): Promise<never> {
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
}
