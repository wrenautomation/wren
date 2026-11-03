/** Links in a sequence text carry where they came from, unless the switch is off or it costs a part. */
import { saveMessageSettings } from "@wren/core/message-settings";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addContact } from "../../src/contacts.js";
import { tick } from "../../src/deliver.js";
import { enroll } from "../../src/enroll.js";
import { FakeProvider } from "../../src/provider.js";
import { segments } from "../../src/templates.js";
import { fillTemplates, numbers, OPEN, POLICY, SEQ, SEQUENCES, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "message_settings"]);
  provider = new FakeProvider();
  await numbers(pg.db, provider, ["+13125550001"]);
  await addContact(pg.db, { phone: "+12125550101", basis: "opt_in", why: "form, 2026-09-28" });
});

const LINK = "https://cal.example/intro";
const send = async (body: string, linkSource?: string) => {
  await fillTemplates(pg.db, { "recruiting-sms#1": body, "recruiting-sms#2": "again" });
  await enroll(pg.db, {
    sequence: SEQ,
    policy: POLICY,
    provider,
    senderName: "William",
    heldNiches: [],
    limit: 10,
    now: OPEN,
  });
  await tick(pg.db, {
    provider,
    policy: POLICY,
    live: false,
    sequences: SEQUENCES,
    senderName: "William",
    ...(linkSource ? { linkSource } : {}),
    now: OPEN,
  });
  return provider.sent.map((m) => m.text);
};

describe("link parameters on a text", () => {
  it("adds source, medium and the sequence's name to a link", async () => {
    expect(await send(`William here, book at ${LINK} or reply STOP`, "Acme Co")).toEqual([
      `William here, book at ${LINK}?utm_source=acme-co&utm_medium=sms&utm_campaign=recruiting-sms or reply STOP`,
    ]);
  });

  it("leaves the text as written when the workspace turned it off", async () => {
    await saveMessageSettings(pg.db, { utmLinks: false }, "test");
    expect(await send(`book at ${LINK}`, "acme")).toEqual([`book at ${LINK}`]);
  });

  it("leaves it as written when no source is given", async () => {
    expect(await send(`book at ${LINK}`)).toEqual([`book at ${LINK}`]);
  });

  it("keeps the text's price: tags that would add a part are dropped", async () => {
    const body = `${"x".repeat(125)} ${LINK}`;
    expect(segments(body).parts).toBe(1);
    expect(await send(body, "acme")).toEqual([body]);
  });
});
