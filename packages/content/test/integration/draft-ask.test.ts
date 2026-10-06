/**
 * Ask Claude on a draft against Postgres and a Restate test environment, over a fake desk
 * `claude`: an ask rewrites a post and keeps what it replaced, a question writes nothing, Undo
 * puts the text back, a hand edit meanwhile is never overwritten, a closed comment is refused.
 * Then `wren drafts`' reads and writes: the waiting list, the cap, the Inbox's thread; a DM
 * reply and an accepted invite's first message on `reach_contacts.draft`. His edits: the box's
 * save and a changed send kept as before and after, read back per kind into the next ask.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { draftTurns, editsFor, keepSentEdit } from "@wren/core/ask";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import {
  addAccount,
  addProspects,
  comments,
  contactByHandle,
  reachContacts,
  reachMessages,
  receive,
} from "@wren/outreach";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addIdea,
  contentDrafts,
  editDraft,
  listEdits,
  listWaiting,
  readDraft,
  writeDraft,
} from "../../src/index.js";
import { makeDraftAsk } from "../../src/restate/draft-ask.js";
import { inboxRecord } from "../../src/social/records.js";

/** What the fake desk answers next, and what it was asked. */
const answers: string[] = [];
const asked: { question: string; system: string }[] = [];
const fakeClaude = restate.service({
  name: "claude",
  handlers: {
    ask: async (_ctx: restate.Context, req: { question: string; system: string }) => {
      asked.push(req);
      return { answer: answers.shift() ?? "{}", ms: 10, turns: 1, model: "fake", denied: 0 };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({ services: [fakeClaude, makeDraftAsk(pg.db)], alwaysReplay: true });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_ideas",
    "content_drafts",
    "comments",
    "runs",
    "reach_messages",
    "reach_contacts",
    "reach_accounts",
  ]);
  answers.length = 0;
  asked.length = 0;
});

const desk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ReturnType<typeof makeDraftAsk>>({ name: "DraftAsk" });

async function post(text: string) {
  const idea = await addIdea(pg.db, "Why small teams skip the CRM", "cli");
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({ ideaId: idea.id, platform: "linkedin", text, promptVersion: "test" })
    .returning();
  return d?.id as string;
}

async function comment(state: "waiting" | "answered", draft: string | null) {
  const [c] = await pg.db
    .insert(comments)
    .values({
      platform: "linkedin",
      channel: "content",
      ref: `c-${Math.random()}`,
      post: "p1",
      parent: "p1",
      kind: "post_reply",
      author: "Sample Reader",
      body: "How do you pick what to automate first?",
      url: "https://linkedin.test/c",
      at: new Date(),
      raw: {},
      state,
      draft,
    })
    .returning();
  return String(c?.id);
}

/** The thread once nothing on it is thinking. */
async function settled(record: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const turns = await draftTurns(pg.db, record, id);
    if (turns.length && turns.every((t) => t.state !== "thinking")) return turns;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("still thinking");
}

describe("DraftAsk", () => {
  it("rewrites a post from Claude's draft, keeps what it replaced, and Undo puts it back", async () => {
    const id = await post("First take on the CRM post.");
    answers.push(
      '```json\n{"reply": "Shorter, and it opens on the point.", "draft": "Tighter take."}\n```',
    );
    await desk().ask({ record: "draft", id, message: "make it shorter" });
    const [turn] = await settled("draft", id);
    expect(turn).toMatchObject({
      command: "draft-ask",
      by: "console",
      message: "make it shorter",
      state: "done",
      reply: "Shorter, and it opens on the point.",
      draft: "Tighter take.",
      before: "First take on the CRM post.",
    });
    expect(asked[0]?.question).toContain("make it shorter");
    expect(asked[0]?.system).toContain("First take on the CRM post.");
    const [row] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, id));
    expect(row).toMatchObject({ text: "Tighter take.", edited: true, status: "draft" });

    await desk().undo({ record: "draft", id });
    expect((await readDraft(pg.db, `draft:${id}`)).draft).toBe("First take on the CRM post.");
    const turns = await draftTurns(pg.db, "draft", id);
    expect(turns.map((t) => t.command)).toEqual(["draft-ask", "draft-undo"]);
  });

  it("writes nothing when he only asked, or when the draft changed while Claude worked", async () => {
    const id = await post("Draft one.");
    answers.push('{"reply": "It reads fine.", "draft": null}');
    await desk().ask({ record: "draft", id, message: "is this too long?" });
    expect((await settled("draft", id))[0]).toMatchObject({ reply: "It reads fine.", draft: null });
    expect((await readDraft(pg.db, `draft:${id}`)).draft).toBe("Draft one.");
    await expect(desk().undo({ record: "draft", id })).rejects.toThrow(/nothing to undo/);

    // The hand edit lands between Claude's read and Wren's write.
    await editDraft(pg.db, id, { text: "His own words." });
    await expect(
      writeDraft(pg.db, `draft:${id}`, "Claude's words.", {
        command: "draft-ask",
        by: "console",
        expect: "Draft one.",
      }),
    ).rejects.toThrow(/changed since/);
    expect((await readDraft(pg.db, `draft:${id}`)).draft).toBe("His own words.");
  });

  it("refuses an empty ask, a missing draft and an answered comment", async () => {
    const id = await comment("answered", "Thanks!");
    await expect(desk().ask({ record: "comment", id, message: " " })).rejects.toThrow(/say what/);
    await expect(desk().ask({ record: "comment", id: "999", message: "x" })).rejects.toThrow(
      /no comment 999/,
    );
    await expect(desk().ask({ record: "comment", id, message: "warmer" })).rejects.toThrow(
      /sent or closed/,
    );
  });
});

describe("drafts from a terminal", () => {
  it("lists waiting drafts, sets one with a runs row, holds the cap, and the Inbox shows the thread", async () => {
    const p = await post("A post draft.");
    const c = await comment("waiting", "Start with the task you do every day.");
    await comment("answered", "Done.");
    const all = await listWaiting(pg.db);
    expect(all.map((w) => w.item).sort()).toEqual([`comment:${c}`, `draft:${p}`].sort());
    expect((await listWaiting(pg.db, { type: "comment" })).map((w) => w.item)).toEqual([
      `comment:${c}`,
    ]);

    await writeDraft(pg.db, `comment:${c}`, "Start with the daily task.", {
      command: "draft-set",
      by: "cli",
    });
    const [row] = await pg.db
      .select()
      .from(comments)
      .where(eq(comments.id, Number(c)));
    expect(row?.draft).toBe("Start with the daily task.");
    await expect(
      writeDraft(pg.db, `comment:${c}`, "x".repeat(1251), { command: "draft-set", by: "cli" }),
    ).rejects.toThrow(/over 1250/);
    await expect(
      writeDraft(pg.db, "nope:1", "x", { command: "draft-set", by: "cli" }),
    ).rejects.toThrow(/say a draft as/);

    const detail = (await inboxRecord.load?.(pg.db, `comment:${c}`)) as {
      ask: { command: string; by: string; draft: string }[];
    };
    expect(detail.ask).toEqual([
      expect.objectContaining({
        command: "draft-set",
        by: "cli",
        draft: "Start with the daily task.",
      }),
    ]);
  });
});

describe("his edits", () => {
  it("keeps every hand change as before and after, and the next ask on that kind reads them", async () => {
    const c = await comment("waiting", "Start with the task you do every day.");
    // The box's save: only over the text it started from.
    await desk().set({
      record: "comment",
      id: c,
      text: "Start with the daily one.",
      expect: "Start with the task you do every day.",
    });
    await expect(
      desk().set({ record: "comment", id: c, text: "x", expect: "Something else." }),
    ).rejects.toThrow(/changed since/);
    // A send whose words differ from the draft; an unchanged one keeps nothing.
    await keepSentEdit(pg.db, {
      record: "dm",
      id: "7",
      by: "console",
      before: "Model words.",
      after: "His words.",
    });
    await keepSentEdit(pg.db, {
      record: "dm",
      id: "8",
      by: "console",
      before: "Same.",
      after: "Same.",
    });
    await keepSentEdit(pg.db, {
      record: "invite",
      id: "9",
      by: "console",
      before: null,
      after: "Hi.",
    });

    expect(await listEdits(pg.db, { type: "comment" })).toEqual([
      expect.objectContaining({
        record: "comment",
        by: "console",
        before: "Start with the task you do every day.",
        after: "Start with the daily one.",
      }),
    ]);
    expect((await listEdits(pg.db, { type: "invite" })).map((e) => e.after)).toEqual([
      "His words.",
    ]);
    expect(await listEdits(pg.db)).toHaveLength(2);
    expect(await editsFor(pg.db, ["thread"])).toBe("");

    answers.push('{"reply": "Fine.", "draft": null}');
    await desk().ask({ record: "comment", id: c, message: "ok?" });
    await settled("comment", c);
    expect(asked[0]?.system).toContain("How he edited earlier drafts");
    expect(asked[0]?.system).toContain("Start with the task you do every day.");
    expect(asked[0]?.system).not.toContain("His words.");
  });
});

describe("DM drafts", () => {
  it("asks on a DM reply, answers their newest word, lists DMs and invites apart", async () => {
    const now = new Date();
    const a = await addAccount(pg.db, { platform: "reddit", account: "reddit@test", now });
    await receive(
      pg.db,
      "reddit",
      a.id,
      {
        ref: "m1",
        handle: "jo_test",
        name: null,
        text: "What do you use for invoices?",
        at: now.toISOString(),
        threadUrl: null,
      },
      now,
    );
    const jo = await contactByHandle(pg.db, "reddit", "jo_test");
    await pg.db
      .update(reachContacts)
      .set({ draft: "A sheet, mostly." })
      .where(eq(reachContacts.id, jo.id));

    const l = await addAccount(pg.db, { platform: "linkedin", account: "linkedin@test", now });
    await addProspects(pg.db, "linkedin", [
      { handle: "ana-test", url: "", name: "Ana Test", headline: "Founder", foundIn: "people" },
    ]);
    const ana = await contactByHandle(pg.db, "linkedin", "ana-test");
    await pg.db
      .update(reachContacts)
      .set({ accountId: l.id, connectedAt: now, draft: "Thanks for connecting." })
      .where(eq(reachContacts.id, ana.id));
    await pg.db.insert(reachMessages).values({
      contactId: ana.id,
      accountId: l.id,
      direction: "out",
      kind: "connect",
      body: "",
      state: "sent",
      sentAt: now,
    });
    expect((await listWaiting(pg.db, { type: "dm" })).map((w) => w.item)).toEqual([`dm:${jo.id}`]);
    expect((await listWaiting(pg.db, { type: "invite" })).map((w) => w.item)).toEqual([
      `invite:${ana.id}`,
    ]);

    answers.push('{"reply": "Warmer.", "draft": "Mostly a sheet. What do you use?"}');
    await desk().ask({ record: "dm", id: String(jo.id), message: "warmer" });
    expect((await settled("dm", String(jo.id)))[0]).toMatchObject({
      draft: "Mostly a sheet. What do you use?",
    });
    expect(asked[0]?.question).toContain("Them: What do you use for invoices?");
    const [m1] = await pg.db.select().from(reachMessages).where(eq(reachMessages.ref, "m1"));
    const [row] = await pg.db.select().from(reachContacts).where(eq(reachContacts.id, jo.id));
    expect(row).toMatchObject({ draft: "Mostly a sheet. What do you use?", draftFor: m1?.id });
    expect(row?.draftAt).not.toBeNull();

    const detail = (await inboxRecord.load?.(pg.db, `dm:${jo.id}`)) as {
      messages: unknown[];
      ask: unknown[];
    };
    expect(detail.messages).toHaveLength(1);
    expect(detail.ask).toHaveLength(1);
    await desk().undo({ record: "dm", id: String(jo.id) });
    expect((await readDraft(pg.db, `dm:${jo.id}`)).draft).toBe("A sheet, mostly.");
  });
});
