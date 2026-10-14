/**
 * Account > Messaging (B4): an owner reads and changes the message rules kept in the client's own
 * database. A member who isn't an owner is refused, the demo isn't offered them, and a bad cap says
 * why. The rules take effect in `mayMarket`, which `message-caps.test.ts` in core covers.
 */
import { addMember, clients } from "@wren/core/clients";
import { MESSAGE_DEFAULTS, readMessageSettings } from "@wren/core/message-settings";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingApi } from "../../src/messaging.js";
import { DELIVERY_ROUTES, DELIVERY_WRITES } from "../../src/routes.js";
import { deliveryApi } from "../../src/service.js";

let pg: TestPostgres;
let api: ReturnType<typeof deliveryApi>;
let set: ReturnType<typeof messagingApi>;
/** Without a client database. */
let bare: ReturnType<typeof deliveryApi>;
let bareSet: ReturnType<typeof messagingApi>;

const AMY: Viewer = { email: "amy@acme.example" };
const CY: Viewer = { email: "cy@acme.example" };
const DEMO: Viewer = { demo: true };

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

const rules = async (viewer: Viewer, service = api) =>
  Object.fromEntries(
    (await service.recordsList({ viewer, record: "delivery.messaging", view: "all" })).rows.map(
      (r) => [r.id, r.value],
    ),
  );
const ask = (id: string, value?: string) => ({
  viewer: AMY,
  ids: [id],
  ...(value === undefined ? {} : { value }),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  await addMember(pg.db, "acme", "cy@acme.example", { role: "member" });
  // The same database stands in for the client's own.
  api = deliveryApi({ main: pg.db, demoName: "Demo firm", open: () => pg.db });
  set = messagingApi({
    main: pg.db,
    open: () => pg.db,
    senders: async (client) => (client === "acme" ? ["news@acme.example"] : []),
  });
  bare = deliveryApi({ main: pg.db, demoName: "Demo firm" });
  bareSet = messagingApi({ main: pg.db });
}, 120_000);
afterAll(async () => {
  await pg.stop();
});

describe("message rules", () => {
  it("start as the defaults, in words", async () => {
    expect(await rules(AMY)).toEqual({
      "caps.day": String(MESSAGE_DEFAULTS.capPerDay),
      "caps.week": String(MESSAGE_DEFAULTS.capPerWeek),
      links: "On",
      sender: "Not set: email broadcasts can't send",
      postal: "Not set: email broadcasts can't send",
    });
  });

  it("an owner picks a connected mailbox to send from, or clears it", async () => {
    await set.messagingSender(ask("sender", " News@Acme.example "));
    expect((await rules(AMY)).sender).toBe("news@acme.example");
    expect(await refused(set.messagingSender(ask("sender", "cy@acme.example")))).toBe(400);
    expect((await readMessageSettings(pg.db)).sender).toBe("news@acme.example");
    await set.messagingSender(ask("sender", ""));
    expect((await readMessageSettings(pg.db)).sender).toBeNull();
  });

  it("an owner sets the postal address; too short says why", async () => {
    await set.messagingPostal(ask("postal", "1 Main St\nTown, ST 00000"));
    expect((await rules(AMY)).postal).toBe("1 Main St, Town, ST 00000");
    expect(await refused(set.messagingPostal(ask("postal", "Town")))).toBe(400);
    expect(await refused(set.messagingPostal(ask("sender", "1 Main St, Town")))).toBe(404);
  });

  it("an owner changes a cap, or turns it off", async () => {
    expect(await set.messagingChange(ask("caps.day", "3"))).toEqual({
      done: ["caps.day"],
      skipped: [],
    });
    expect((await rules(AMY))["caps.day"]).toBe("3");
    await set.messagingChange(ask("caps.week", "off"));
    expect((await rules(AMY))["caps.week"]).toBe("No cap");
    expect((await readMessageSettings(pg.db)).capPerWeek).toBeNull();
  });

  it("refuses a cap that isn't a number, or a week under the day", async () => {
    expect(await refused(set.messagingChange(ask("caps.day", "many")))).toBe(400);
    expect(await refused(set.messagingChange(ask("caps.day", "2.5")))).toBe(400);
    expect(await refused(set.messagingChange(ask("caps.day", "101")))).toBe(400);
    await set.messagingChange(ask("caps.week", "5"));
    expect(await refused(set.messagingChange(ask("caps.day", "9")))).toBe(400);
    expect((await rules(AMY))["caps.day"]).toBe("3");
  });

  it("links turn off and back on", async () => {
    await set.messagingLinksOff(ask("links"));
    expect((await rules(AMY)).links).toBe("Off");
    await set.messagingLinksOn(ask("links"));
    expect((await rules(AMY)).links).toBe("On");
  });

  it("each route changes only its own rows", async () => {
    expect(await refused(set.messagingLinksOn(ask("caps.day")))).toBe(404);
    expect(await refused(set.messagingChange(ask("links", "3")))).toBe(404);
    expect(
      await refused(
        set.messagingChange({ viewer: AMY, ids: ["caps.day", "caps.week"], value: "3" }),
      ),
    ).toBe(404);
  });

  it("a member who isn't an owner can't read them; the demo isn't offered them", async () => {
    expect(
      await refused(api.recordsList({ viewer: CY, record: "delivery.messaging", view: "all" })),
    ).toBe(403);
    const types = (await api.recordsTypes({ viewer: DEMO })).map((t) => t.id);
    expect(types).not.toContain("delivery.messaging");
  });

  it("without a client database they aren't offered, and a change says so", async () => {
    const types = (await bare.recordsTypes({ viewer: AMY })).map((t) => t.id);
    expect(types).not.toContain("delivery.messaging");
    expect(await refused(bareSet.messagingLinksOff(ask("links")))).toBe(409);
  });

  it("the routes need manage and never run on the demo", () => {
    for (const r of [
      "messagingChange",
      "messagingSender",
      "messagingPostal",
      "messagingLinksOn",
      "messagingLinksOff",
    ] as const) {
      expect(DELIVERY_ROUTES[r]).toBe("manage");
      expect(DELIVERY_WRITES).toContain(r);
    }
  });
});
