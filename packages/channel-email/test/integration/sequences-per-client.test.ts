/**
 * O2/O3, email sequences per client (designs/2026-10-04-outbound-per-client.md): a client's
 * mailbox key sends from its database under its caps, its stops also land on main's list,
 * main's list binds it, and Wren's team flips its kill switch and reads its answers there.
 */
import { loadSettings } from "@wren/config";
import { addSuppression, suppressionEvents, suppressions } from "@wren/core";
import { addClient } from "@wren/core/clients";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeSuppression } from "../../src/guards.js";
import { emailConsoleApi } from "../../src/restate/console.js";
import { campaignPolicy } from "../../src/send/campaign-controls.js";
import { SendPolicy } from "../../src/send/policy.js";
import { ensureSuppression } from "../../src/send/suppress.js";
import {
  clientCampaign,
  clientReplies,
  clientSequences,
  sequencesSendScope,
} from "../../src/sequences.js";
import { makeCompany, makeEnrollment } from "./compose-fixtures.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);
const SEQUENCES = {
  niche: "sec_ria",
  senders: [
    { address: "Ann@Acme.example", name: "Ann", signature: "Ann, Acme" },
    { address: "bo@acme.example", name: "Bo", suspended: true },
  ],
  mailsRoleInboxes: true,
  sending: { perInboxPerDay: 7 },
};

let pg: TestPostgres;
let acme: Db;
const open = (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database));
const deps = () => ({ main: pg.db, open, policy: POLICY });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "acme",
    name: "Acme",
    accounts: { gmail: "acme-mail", calcom: "acme-cal" },
    products: {
      "research.lead_sheet": {},
      "email.sequences": SEQUENCES,
      "email.replies": {},
    },
  });
  await addClient(pg.db, pg.url, {
    id: "beta",
    name: "Beta",
    products: { "email.sequences": {} },
  });
  acme = open({ database: "wren_client_acme" });
}, 180_000);
afterAll(async () => {
  await pg?.stop();
});

describe("email sequences per client", () => {
  it("`{}` is valid and does nothing; a client without it is gone", async () => {
    const beta = await clientSequences(pg.db, "beta");
    expect(beta).toMatchObject({
      kind: "work",
      settings: { niche: null, senders: [], mailsRoleInboxes: null },
    });
    expect(await sequencesSendScope(deps(), "beta/ann@acme.example")).toBeNull();
    expect(await clientSequences(pg.db, "ghost")).toMatchObject({ kind: "gone" });
    expect(await clientReplies(pg.db, "beta")).toBeNull();
  });

  it("a listed mailbox sends from the client's database under its caps; others never", async () => {
    const scope = await sequencesSendScope(deps(), "acme/ann@acme.example");
    expect(scope?.db).toBe(acme);
    expect(scope?.policy.perInboxCeiling).toBe(7);
    expect(scope?.fleet.senders).toEqual(["ann@acme.example"]);
    expect(scope?.fleet.domainFleet).toEqual(["ann@acme.example", "bo@acme.example"]);
    expect(scope?.shared).toEqual({ main: pg.db, client: "acme" });
    expect(scope?.pixelBaseUrl).toBeNull();
    for (const key of ["acme/bo@acme.example", "acme/eve@acme.example", "ghost/ann@acme.example"])
      expect(await sequencesSendScope(deps(), key)).toBeNull();
  });

  it("composes Wren's niche with the client's mailboxes, sign-offs and role-inbox rule", async () => {
    const plan = await clientSequences(pg.db, "acme");
    if (plan.kind !== "work") throw new Error("acme has sequences");
    const base = {
      senders: ["will@wren.example"],
      ramps: { "will@wren.example": 1 },
      signatures: { "will@wren.example": "Will" },
      mailsRoleInboxes: false,
    } as unknown as Parameters<typeof clientCampaign>[0];
    expect(clientCampaign(base, plan.settings)).toMatchObject({
      senders: ["ann@acme.example"],
      ramps: {},
      signatures: { "ann@acme.example": "Ann, Acme" },
      mailsRoleInboxes: true,
    });
  });

  it("an opt-out anywhere is an opt-out everywhere", async () => {
    const scope = await sequencesSendScope(deps(), "acme/ann@acme.example");
    if (!scope) throw new Error("ann sends");
    await ensureSuppression(scope.db, "Lead@Far.example", "opt_out", undefined, scope.shared);
    const [onMain] = await pg.db.select().from(suppressions);
    expect(onMain).toMatchObject({ value: "lead@far.example", reason: "opt_out" });
    const [why] = await pg.db.select().from(suppressionEvents);
    expect(why?.evidence).toEqual({ client: "acme" });
    // Main's own stop binds the client's mail too.
    await addSuppression(pg.db, { kind: "email", value: "x@near.example", reason: "opt_out" });
    expect(await activeSuppression(acme, "x@near.example")).toBeNull();
    expect(await activeSuppression(acme, "x@near.example", scope.shared)).not.toBeNull();
  });

  it("Wren's team flips a client's kill switch in its database and reads its answers", async () => {
    const company = await makeCompany(acme);
    await makeEnrollment(acme, company, { toEmail: "info@oakbridge.example", kind: "role_inbox" });
    const api = emailConsoleApi({
      db: pg.db,
      senders: [],
      policy: POLICY,
      clients: { main: pg.db, open },
    });
    const op = { viewer: { email: "op@example.test", operator: true }, client: "acme" };
    expect(await api.campaignAction("killSwitchOff", { ...op, ids: ["sec_ria"] })).toEqual({
      done: ["sec_ria"],
      skipped: [],
    });
    const plan = await clientSequences(pg.db, "acme");
    if (plan.kind !== "work") throw new Error("acme has sequences");
    expect((await campaignPolicy(acme, POLICY)).killSwitchOn("sec_ria")).toBe(false);
    // Wren's own campaign is untouched.
    expect((await campaignPolicy(pg.db, POLICY)).killSwitchOn("sec_ria")).toBe(
      POLICY.killSwitchOn("sec_ria"),
    );
    expect(await api.answers(op)).toEqual([]);
    expect(await api.dispositionKey(op)).toBe("acme/replies");
    expect(await api.dispositionKey({ viewer: op.viewer })).toBe("fleet");
    await expect(api.answers({ ...op, client: "beta" })).rejects.toMatchObject({ status: 404 });
  });
});
