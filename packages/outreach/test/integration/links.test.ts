/** Links in a sequence DM carry where they came from, unless the workspace turned that off. */

import { saveMessageSettings } from "@wren/core/message-settings";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import { addContact } from "../../src/contacts.js";
import { enroll } from "../../src/enroll.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import type { ReachAccount } from "../../src/schema.js";
import { REACH_SEQUENCES, slotsOf, stepKey, subjectKey } from "../../src/sequences.js";
import { setTemplate } from "../../src/store.js";
import { tick } from "../../src/tick.js";

const POLICY = { ...DEFAULT_POLICY, gapSeconds: 0 };
// Thursday 14:00 New York.
const OPEN = new Date("2026-10-01T18:00:00Z");
const SLOTS = slotsOf(REACH_SEQUENCES.values());
const REDDIT = REACH_SEQUENCES.get("reddit-dm");
if (!REDDIT) throw new Error("reddit-dm");

let pg: TestPostgres;
let channel: ReturnType<typeof fakeOutreachChannel>;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "reach_messages",
    "reach_contacts",
    "reach_accounts",
    "templates",
    "template_versions",
    "message_settings",
  ]);
  channel = fakeOutreachChannel("reddit", { account: "reddit@alt", connects: false });
  channel.setHealth({
    handle: "alt",
    createdAt: new Date(OPEN.getTime() - 45 * 86_400_000).toISOString(),
    karma: 200,
    suspended: false,
  });
  const a = await addAccount(pg.db, {
    platform: "reddit",
    account: "reddit@alt",
    now: new Date(OPEN.getTime() - 40 * 86_400_000),
  });
  await refreshHealth(pg.db, [a], () => channel, new Date(OPEN.getTime() - 40 * 86_400_000));
  await setAccountState(pg.db, a.id, "active", { reason: null, now: OPEN });
  await addContact(pg.db, { platform: "reddit", handle: "u/dana_dev", name: "Dana Lee" });
});

const send = async (linkSource?: string) => {
  const set = (key: string, body: string) =>
    setTemplate(pg.db, { slots: SLOTS, sender: "William" }, { key, body, by: "test" });
  await set(subjectKey(REDDIT, 1), "the guide");
  await set(stepKey(REDDIT, 1), "Hi {first_name|there}, the guide: https://example.test/guide.");
  await set(stepKey(REDDIT, 2), "Bumping this.");
  await enroll(pg.db, { sequence: REDDIT, sender: "William", limit: 10, now: OPEN });
  await tick(pg.db, {
    channelFor: (_a: ReachAccount) => channel,
    policy: POLICY,
    sequences: REACH_SEQUENCES,
    sender: "William",
    live: true,
    ...(linkSource ? { linkSource } : {}),
    now: OPEN,
  });
  return channel.sent.map((m) => m.text);
};

describe("link parameters on a DM", () => {
  it("adds source, medium and the sequence's name, leaving the sentence's period out", async () => {
    expect(await send("acme")).toEqual([
      "Hi Dana, the guide: https://example.test/guide?utm_source=acme&utm_medium=dm&utm_campaign=reddit-dm.",
    ]);
  });

  it("leaves the text as written when the workspace turned it off", async () => {
    await saveMessageSettings(pg.db, { utmLinks: false }, "test");
    expect(await send("acme")).toEqual(["Hi Dana, the guide: https://example.test/guide."]);
  });

  it("leaves it as written when no source is given", async () => {
    expect(await send()).toEqual(["Hi Dana, the guide: https://example.test/guide."]);
  });
});
