/**
 * The one write path in a real browser (designs/2026-10-15-one-write-path.md): a send, a draft
 * then a send, and a set-aside with undo, each with the tab hidden mid-write, a row switch or a
 * reload, must end with the page matching the server. Then the data layer: the retry reason
 * shown, unsent words kept across pages and reloads, a moved draft shown beside them, the list
 * painted from the device copy, and a write in one tab read again in another. Then the lists
 * moved onto it (designs/2026-10-15-one-write-path.md, "Row versions"): the calendar, a
 * workflow's side panel and a board each paint from the device copy on a reload and read again
 * after a tab away; a board asks only for the cards that changed, and a board save over a
 * newer one is refused with both shown.
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
import type { Page, Route } from "playwright-core";
import { fresh, hide, runTests, show, T, type Test, url } from "./e2e-kit.js";

/**
 * The server's draft on every inbox row, as `draft.value` says (null: as the server has it).
 * Reads go out without row hashes so each answer carries the rows whole.
 */
async function serveDraft(page: Page, draft: { value: string | null }) {
  await page.route(/\/api\/console\/records(List|Get)$/, async (route) => {
    if (draft.value === null) return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    delete body.known;
    const res = await route.fetch({ postData: JSON.stringify(body) });
    const json = (await res.json()) as unknown;
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("draft" in o && "id" in o) o.draft = draft.value;
        Object.values(o).forEach(walk);
      }
    };
    walk(json);
    return route.fulfill({ response: res, json });
  });
}

const inboxComment = async (page: Page) => {
  await page.goto(`${url}/inbox/waiting`);
  await page.getByText("Comment", { exact: true }).first().click();
  await page.getByText("Reply by").waitFor();
};
/** A row of `path` (`/outreach/dms`) opened by its words, its draft box ready. */
const openRow = async (page: Page, path: string, words: string) => {
  await page.goto(`${url}${path}`);
  await page.getByText(words).first().click();
  await page.getByPlaceholder("Write it here.").first().waitFor();
};
const replyBox = (page: Page) => page.locator("textarea").first();

/** Away past the focus window (a minute), and back: what's shown is read again. */
const awayAndBack = async (page: Page) => {
  await hide(page);
  await page.clock.fastForward(61_000);
  await show(page);
};
/**
 * Every call to `path` (`notes/board`) answered by `serve`, sent alone or inside a pulse (the
 * reads one moment starts go out as one request). `real` is the server's own answer.
 */
type Serve = (body: Record<string, unknown>, real: () => Promise<unknown>) => Promise<unknown>;
async function serveCall(page: Page, path: string, serve: Serve): Promise<() => Promise<void>> {
  const alone = new RegExp(`/api/${path.replace("/", "\\/")}$`);
  const one = async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    // A read still out when the test closes its page: nothing left to answer.
    const json = await serve(body, async () => (await route.fetch()).json()).catch(() => null);
    if (json === null) return;
    return route.fulfill({ json }).catch(() => undefined);
  };
  const pulse = async (route: Route) => {
    const { calls } = route.request().postDataJSON() as {
      calls: { path: string; body: Record<string, unknown> }[];
    };
    if (!calls.some((c) => c.path === path)) return route.fallback();
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const got = (await res.json()) as { answers: { status: number; body: unknown }[] };
    got.answers = await Promise.all(
      got.answers.map(async (a, i) => {
        const c = calls[i];
        if (c?.path !== path) return a;
        return { status: 200, body: await serve(c.body, async () => a.body) };
      }),
    );
    return route.fulfill({ response: res, json: got }).catch(() => undefined);
  };
  await page.route(alone, one);
  await page.route(/\/api\/pulse$/, pulse);
  return async () => {
    await page.unroute(alone, one);
    await page.unroute(/\/api\/pulse$/, pulse);
  };
}
/** A reload with `path`'s reads held 6 s: what shows within 3 s came from the device copy. */
const reloadHeld = async (page: Page, path: string, shows: string) => {
  // The copy is written at most every 2 s.
  await page.waitForTimeout(2600);
  const held: Promise<unknown>[] = [];
  // Held, then passed on to whatever answers it (the server, or a stand-in routed before).
  const hold = (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as { calls?: { path: string }[] };
    if (body.calls && !body.calls.some((c) => c.path === path)) return route.fallback();
    const done = new Promise((r) => setTimeout(r, 6000)).then(() =>
      route.fallback().catch(() => undefined),
    );
    held.push(done);
    return done;
  };
  const alone = new RegExp(`/api/${path.replace("/", "\\/")}$`);
  await page.route(alone, hold);
  await page.route(/\/api\/pulse$/, hold);
  await page.reload();
  await page.getByText(shows).first().waitFor({ timeout: 3000 });
  assert.ok(held.length > 0, "the read was still out");
  // The held reads answer before the next step, so none is left hanging.
  await Promise.all(held);
  await page.unroute(alone, hold);
  await page.unroute(/\/api\/pulse$/, hold);
};
/** The preview's API from here, as the server's other writers would change things. */
const api = async <T>(route: string, body: Record<string, unknown> = {}): Promise<T> => {
  const res = await fetch(`${url}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${route}: ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const stamp = () => Date.now().toString(36);

/** Wren's calendar, answered here: the preview has no Restate for Wren's own calls. */
const serveCalendar = (page: Page, call: { name: string }) =>
  serveCall(page, "calendar/range", async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      length: 30,
      open: [],
      calls: [
        {
          id: 1,
          start: start.toISOString(),
          end: end.toISOString(),
          name: call.name,
          offer: null,
          state: "booked",
          outcome: null,
          meet: null,
        },
      ],
    };
  });
const PANEL = `${url}/workflows/canvas?path=wren%2Fonboarding&component=delivery.invoices`;
const sendButton = (page: Page) => page.getByRole("button", { name: /^(Send|Sending)/ }).first();

const tests: Test[] = [
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
      // Reads after it landed count, hidden or back.
      const before = reads.length;
      run.state = "sent";
      run.answer = { sent: true };
      await page.waitForTimeout(1500);
      await show(page);
      await page.getByText("Sent.", { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await replyBox(page).inputValue(), "");
      await page.waitForTimeout(500);
      assert.ok(reads.length > before, "the page read again after it landed");
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
    "Outreach DM: the draft's save lands before the send, hidden mid-send, it lands",
    async (browser) => {
      const { context, page, fake, reads } = await fresh(browser);
      await openRow(page, "/outreach/dms", "Still drowning in voicemails.");
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
      const before = reads.length;
      run.state = "sent";
      run.answer = { queued: true };
      await page.waitForTimeout(1500);
      await show(page);
      await page.waitForTimeout(1500);
      assert.ok(reads.length > before, "the page read again after it landed");
      assert.equal(run.posts, 1);
      assert.equal(fake.of("ReachDesk/reply").length, 1);
      await context.close();
    },
  ],
  [
    "Comment answer: hidden mid-send, refused, the reason said on return",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await openRow(page, "/marketing/comments", "Does this work for a two-truck shop?");
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
      await openRow(page, "/marketing/comments", "Does this work for a two-truck shop?");
      const drop = () =>
        page.locator("aside").last().getByRole("button", { name: "Skip", exact: true }).click();
      const undo = page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" });
      await drop();
      await undo.first().click();
      await page.clock.fastForward(12_000);
      await page.waitForTimeout(300);
      assert.equal(fake.of("ReachDesk/dropComment").length, 0, "undo sent nothing");
      // Back on the list; again, and the tab hides past the deadline (its timers may not run).
      const row = page.getByText("Does this work for a two-truck shop?").first();
      if (!(await page.locator("aside").last().getByRole("button", { name: "Skip" }).isVisible()))
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
  [
    "Restate retrying a send: why shows under the box until it lands",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await inboxComment(page);
      await replyBox(page).fill("Back to you soon");
      await sendButton(page).click();
      const run = await fake.waitFor("InboxDesk/reply");
      run.retry = { count: 2, reason: "LinkedIn answered 429: slow down" };
      await page
        .getByText(
          "Trying again (2): LinkedIn answered 429: slow down. It keeps trying even if you leave this page.",
        )
        .waitFor({ timeout: 8000 });
      run.state = "sent";
      run.answer = { sent: true };
      await page.getByText("Sent.", { exact: true }).waitFor({ timeout: 8000 });
      assert.equal(run.posts, 1);
      await context.close();
    },
  ],
  [
    "unsent words: back after another app, and after a reload",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      await inboxComment(page);
      await replyBox(page).fill("Half a thought");
      await page.goto(`${url}/outreach/engage`);
      await page.getByRole("heading", { name: "Engage" }).waitFor();
      await inboxComment(page);
      assert.equal(await replyBox(page).inputValue(), "Half a thought", "back after another app");
      await page.waitForTimeout(300);
      await page.reload();
      await page.getByText("Comment", { exact: true }).first().click();
      await page.getByText("Reply by").waitFor();
      assert.equal(await replyBox(page).inputValue(), "Half a thought", "back after a reload");
      assert.equal(fake.of("InboxDesk/reply").length, 0, "nothing sent");
      await context.close();
    },
  ],
  [
    "the draft moved on the server under unsent words: both shown, he picks, nothing lost",
    async (browser) => {
      const { context, page } = await fresh(browser);
      const draft = { value: "First draft" as string | null };
      await serveDraft(page, draft);
      await inboxComment(page);
      assert.equal(await replyBox(page).inputValue(), "First draft");
      await replyBox(page).fill("My own words");
      await page.goto(`${url}/outreach/engage`);
      await page.getByRole("heading", { name: "Engage" }).waitFor();
      draft.value = "Their new draft";
      await inboxComment(page);
      const conflict = page.locator("[data-edit-conflict]");
      await conflict.waitFor({ timeout: 8000 });
      await conflict.getByText("My own words").waitFor();
      await conflict.getByText("Their new draft").waitFor();
      assert.equal(await replyBox(page).inputValue(), "My own words", "his words stay in the box");
      await conflict.getByRole("button", { name: "Keep mine" }).click();
      await conflict.waitFor({ state: "detached" });
      assert.equal(await replyBox(page).inputValue(), "My own words");
      await context.close();
    },
  ],
  [
    "the list paints from the device copy before the read answers",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.goto(`${url}/inbox/waiting`);
      await page.getByText("Comment", { exact: true }).first().waitFor();
      // The copy is written at most every 2 s.
      await page.waitForTimeout(2600);
      let held = 0;
      await page.route(/\/api\/console\/recordsList$/, async (route) => {
        held += 1;
        await new Promise((r) => setTimeout(r, 6000));
        await route.fallback().catch(() => undefined);
      });
      await page.reload();
      await page.getByText("Comment", { exact: true }).first().waitFor({ timeout: 3000 });
      assert.ok(held > 0, "the list was still being read");
      await context.close();
    },
  ],
  [
    "a send that lands in one tab: the other tab reads again",
    async (browser) => {
      const { context, page, fake } = await fresh(browser);
      const other = await context.newPage();
      other.setDefaultTimeout(T);
      const otherReads: string[] = [];
      other.on("request", (r) => {
        if (/\/api\/console\/records(List|Get)$/.test(r.url())) otherReads.push(r.url());
      });
      await other.goto(`${url}/inbox/waiting`);
      await other.getByText("Comment", { exact: true }).first().waitFor();
      await inboxComment(page);
      await replyBox(page).fill("See you then");
      await sendButton(page).click();
      const run = await fake.waitFor("InboxDesk/reply");
      await other.waitForTimeout(500);
      const before = otherReads.length;
      run.state = "sent";
      run.answer = { sent: true };
      await page.getByText("Sent.", { exact: true }).waitFor({ timeout: 8000 });
      for (let i = 0; i < 30 && otherReads.length === before; i++) await other.waitForTimeout(100);
      assert.ok(otherReads.length > before, "the other tab read again");
      await context.close();
    },
  ],
  [
    "the calendar: painted from the device copy on a reload, read again after a tab away",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.clock.install();
      const call = { name: "Call with Ada Sample" };
      await serveCalendar(page, call);
      await page.goto(`${url}/calendar/schedule?v=day`);
      await page.getByText(call.name).first().waitFor();
      await reloadHeld(page, "calendar/range", call.name);
      call.name = "Call with Bea Sample";
      await awayAndBack(page);
      await page.getByText(call.name).first().waitFor({ timeout: 5000 });
      await context.close();
    },
  ],
  [
    "a workflow's side panel: painted from the device copy on a reload, read again after a tab away",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.clock.install();
      const words = { now: null as string | null };
      await serveCall(page, "console/recordsGet", async (_, real) => {
        const got = await real();
        if (!words.now) return got;
        return JSON.parse(JSON.stringify(got).replace(/Each invoice as a PDF[^"]*/, words.now));
      });
      await page.goto(PANEL);
      await page.getByText("Each invoice as a PDF").first().waitFor();
      await reloadHeld(page, "console/recordsGet", "Each invoice as a PDF");
      words.now = "Each invoice, read again.";
      await awayAndBack(page);
      await page.getByText(words.now).first().waitFor({ timeout: 5000 });
      await context.close();
    },
  ],
  [
    "a board: painted from the device copy, then only the changed cards read after a tab away",
    async (browser) => {
      const { context, page } = await fresh(browser);
      await page.clock.install();
      const k = stamp();
      const still = await api<{ id: string }>("notes/taskAdd", { title: `Stays ${k}` });
      const moves = await api<{ id: string }>("notes/taskAdd", { title: `Moves ${k}` });
      await page.goto(`${url}/notes/board`);
      await page.getByText(`Moves ${k}`).first().waitFor();
      await reloadHeld(page, "notes/board", `Moves ${k}`);
      await page.waitForTimeout(500);

      const asks: { known?: string[] }[] = [];
      const answers: { cards: { id: string; name?: string }[]; same?: number[] }[] = [];
      await serveCall(page, "notes/board", async (body, real) => {
        asks.push(body);
        const got = (await real()) as (typeof answers)[number];
        answers.push(got);
        return got;
      });
      // Changed elsewhere while the tab is away: a raw edit bumps the card's version.
      await hide(page);
      await api("notes/taskEdit", { id: moves.id, due: "2031-01-09" });
      await page.clock.fastForward(61_000);
      await show(page);
      for (let i = 0; i < 50 && !answers.length; i++) await page.waitForTimeout(100);
      assert.ok(asks[0]?.known?.length, "it sent the marks of the cards it holds");
      const got = answers[0];
      const full = got?.cards.filter((c) => "name" in c).map((c) => c.id) ?? [];
      assert.ok(full.includes(moves.id), "the changed card came whole");
      assert.ok(!full.includes(still.id), "the untouched card came as a stub");
      await page.getByText(`Stays ${k}`).first().waitFor();
      await page.getByText(`Moves ${k}`).first().waitFor();
      await context.close();
    },
  ],
  [
    "a board saved elsewhere since it was opened: the save is refused, both names shown",
    async (browser) => {
      const { context, page } = await fresh(browser);
      const k = stamp();
      const board = await api<{ id: string; version: number }>("notes/boardCreate", {
        name: `Board ${k}`,
      });
      await page.goto(`${url}/notes/board?b=${board.id}`);
      await page.getByRole("button", { name: /board settings/i }).click();
      const name = page.getByRole("dialog").getByRole("textbox").first();
      await name.fill(`Mine ${k}`);
      await api("notes/boardSave", { id: board.id, name: `Theirs ${k}`, expect: board.version });
      await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByText(/saved this board after you opened it/)
        .first()
        .waitFor({ timeout: 5000 });
      const conflict = page.locator("[data-edit-conflict]");
      await conflict.waitFor({ timeout: 8000 });
      await conflict.getByText(`Mine ${k}`).waitFor();
      await conflict.getByText(`Theirs ${k}`).waitFor();
      const now = await api<{ board: { name: string } }>("notes/board", { id: board.id });
      assert.equal(now.board.name, `Theirs ${k}`, "theirs stays until he picks");
      await context.close();
    },
  ],
];

await runTests(tests);
