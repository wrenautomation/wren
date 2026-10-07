/**
 * Raise an issue and ask for access (designs/2026-10-06-scoped-access.md, phase 3): an issue
 * lands with whoever can act on its record, an ask with whoever can grant it, approving makes the
 * grant, and every step is in the audit log. Synthetic people and clients only.
 */
import { setAuditActor } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can, WREN } from "../../src/access.js";
import { askAccess, asksBy, asksFor, decideAsk } from "../../src/access-asks.js";
import { addClient, addMember, addOperator, setTeamSeat } from "../../src/clients/index.js";
import { saveRole } from "../../src/grants.js";
import { issuesOn, openIssuesFor, raiseIssue, resolveIssue } from "../../src/issues.js";
import { PortalRefusal, whoIs } from "../../src/portal.js";

let pg: TestPostgres;
const ADMIN = "ada@example.test";
const EDITOR = "yuri@example.test";
const LI = "lin@example.test";
const OWNER = "owen@acme.test";
const LEAD = "lee@acme.test";

const refused = async (p: Promise<unknown>, status: number, words?: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
  if (words) expect((err as Error).message).toContain(words);
};
const who = (email: string, client?: string) => whoIs(pg.db, { email }, client);
/** A write as `by`, audited as theirs. */
const as = <T>(by: string, fn: (tx: typeof pg.db) => Promise<T>) =>
  pg.db.transaction(async (tx) => {
    await setAuditActor(tx, by);
    return fn(tx as never);
  });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addOperator(pg.db, ADMIN);
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", LEAD, { role: "viewer" });
  const admin = await who(ADMIN);
  const editor = await saveRole(pg.db, admin, ADMIN, {
    client: WREN,
    name: "YouTube editor",
    grants: [
      { verbs: ["read", "act", "comment"], apps: ["marketing"], channels: ["youtube"] },
      { verbs: ["read", "comment"], apps: ["marketing", "outbound"] },
    ],
  });
  const view = await saveRole(pg.db, admin, ADMIN, {
    client: WREN,
    name: "LinkedIn view",
    grants: [{ verbs: ["read"], apps: ["marketing"], channels: ["linkedin"] }],
  });
  await setTeamSeat(pg.db, EDITOR, { role: editor.id, clients: [WREN] });
  await setTeamSeat(pg.db, LI, { role: view.id, clients: [WREN] });
});
afterAll(() => pg?.stop());

const post = (id: string, channel: string) => ({
  client: WREN,
  record: `marketing.post:${id}`,
  app: "marketing",
  channel,
  title: `Post ${id}`,
});

describe("raise an issue", () => {
  it("the YouTube editor raises one on a LinkedIn post; it waits with who can act there", async () => {
    const { id } = await as(EDITOR, async (tx) =>
      raiseIssue(tx, await who(EDITOR), EDITOR, post("l1", "linkedin"), "Typo in the hook."),
    );
    // He can't act on LinkedIn, so it isn't his to resolve; an admin's Inbox has it.
    expect((await openIssuesFor(pg.db, await who(EDITOR), WREN)).map((i) => i.id)).toEqual([]);
    expect((await openIssuesFor(pg.db, await who(ADMIN), WREN)).map((i) => i.id)).toEqual([id]);
    await refused(
      as(EDITOR, async (tx) => resolveIssue(tx, await who(EDITOR), EDITOR, WREN, id)),
      403,
    );
    await as(ADMIN, async (tx) => resolveIssue(tx, await who(ADMIN), ADMIN, WREN, id));
    const [on] = await issuesOn(pg.db, WREN, "marketing.post:l1");
    expect(on).toMatchObject({ body: "Typo in the hook.", by: EDITOR, resolvedBy: ADMIN });
    await refused(
      as(ADMIN, async (tx) => resolveIssue(tx, await who(ADMIN), ADMIN, WREN, id)),
      409,
    );
  });

  it("one on a YouTube post lands with the editor too", async () => {
    const { id } = await as(ADMIN, async (tx) =>
      raiseIssue(tx, await who(ADMIN), ADMIN, post("y1", "youtube"), "Thumbnail is blurry."),
    );
    expect((await openIssuesFor(pg.db, await who(EDITOR), WREN)).map((i) => i.id)).toEqual([id]);
  });

  it("a read-only login can't raise one, and an empty note is refused", async () => {
    await refused(
      as(LI, async (tx) => raiseIssue(tx, await who(LI), LI, post("l1", "linkedin"), "Hm")),
      403,
      "needs comment",
    );
    await refused(
      as(EDITOR, async (tx) =>
        raiseIssue(tx, await who(EDITOR), EDITOR, post("y1", "youtube"), " "),
      ),
      400,
    );
  });
});

describe("ask for access", () => {
  it("lands with who can grant it; approving makes the grant, audited", async () => {
    const until = new Date(Date.now() + 3 * 864e5).toISOString();
    const { id } = await as(LI, async (tx) =>
      askAccess(tx, await who(LI), LI, WREN, {
        verbs: ["act"],
        apps: ["marketing"],
        channels: ["linkedin"],
        until,
        reason: "covering Friday",
      }),
    );
    // The editor can't hand out LinkedIn; the admin can.
    expect(await asksFor(pg.db, await who(EDITOR), EDITOR, WREN)).toEqual([]);
    const [ask] = await asksFor(pg.db, await who(ADMIN), ADMIN, WREN);
    expect(ask).toMatchObject({ id, email: LI, state: "open" });
    expect(ask?.what).toMatch(/^Can act on LinkedIn in Marketing until /);
    await refused(
      as(EDITOR, async (tx) => decideAsk(tx, await who(EDITOR), EDITOR, WREN, id, true)),
      403,
    );
    const done = await as(ADMIN, async (tx) =>
      decideAsk(tx, await who(ADMIN), ADMIN, WREN, id, true),
    );
    expect(done.grant).toEqual(expect.any(Number));
    expect(can(await who(LI), "act", { client: WREN, app: "marketing", channel: "linkedin" })).toBe(
      true,
    );
    expect((await asksBy(pg.db, LI, WREN))[0]).toMatchObject({
      state: "approved",
      decidedBy: ADMIN,
    });
    await refused(
      as(ADMIN, async (tx) => decideAsk(tx, await who(ADMIN), ADMIN, WREN, id, true)),
      409,
    );
    const log = await pg.db.execute<{ table_name: string; actor: string }>(
      sql`select table_name, actor from audit_events
          where table_name in ('access_asks', 'grants') order by id`,
    );
    expect(log.map((r) => `${r.table_name}:${r.actor}`)).toEqual([
      `access_asks:${LI}`,
      `grants:${ADMIN}`,
      `access_asks:${ADMIN}`,
    ]);
  });

  it("refuses an ask for what they hold, for Wren's money, or with no reason", async () => {
    const lin = await who(LI);
    await refused(
      as(LI, async (tx) =>
        askAccess(tx, lin, LI, WREN, {
          verbs: ["read"],
          apps: ["marketing"],
          channels: ["linkedin"],
          reason: "x",
        }),
      ),
      409,
      "already",
    );
    await refused(
      as(LI, async (tx) => askAccess(tx, lin, LI, WREN, { verbs: ["money"], reason: "x" })),
      400,
      "stay with admins",
    );
    await refused(
      as(LI, async (tx) => askAccess(tx, lin, LI, WREN, { verbs: ["act"], apps: ["outbound"] })),
      400,
      "say why",
    );
  });

  it("a client's viewer asks; the owner declines; nothing is granted", async () => {
    const { id } = await as(LEAD, async (tx) =>
      askAccess(tx, await who(LEAD, "acme"), LEAD, "acme", {
        verbs: ["act"],
        record: "delivery.update:7",
        reason: "to sign off",
      }),
    );
    const owner = await who(OWNER, "acme");
    expect((await asksFor(pg.db, owner, OWNER, "acme")).map((a) => a.id)).toEqual([id]);
    await refused(
      as(LEAD, async (tx) => decideAsk(tx, await who(LEAD, "acme"), LEAD, "acme", id, true)),
      403,
    );
    expect(await as(OWNER, async (tx) => decideAsk(tx, owner, OWNER, "acme", id, false))).toEqual({
      decided: id,
      grant: null,
    });
    const lead = await who(LEAD, "acme");
    expect(can(lead, "act", { client: "acme", record: "delivery.update:7" })).toBe(false);
  });
});
