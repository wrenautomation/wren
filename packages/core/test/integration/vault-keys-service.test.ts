/**
 * VaultKeys on a real Restate and Postgres, with a fake `sites` and `desk` (nothing calls a real
 * autobrowse): the hourly `sync` mirrors the list, `revoke` and `spend` call `sites` then mirror
 * again, `rotate` goes to `desk` and answers its run, and a key the mirror doesn't hold is
 * refused before autobrowse hears of it. Synthetic keys only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keyId } from "../../src/key-id.js";
import { vaultKeys } from "../../src/keys-schema.js";
import { startTestRestate } from "../../src/testing.js";
import { type KeyRow, makeVaultKeys } from "../../src/vault-keys.js";

const calls: string[] = [];
const state = new Map<string, KeyRow>();
const key = (account: string): KeyRow => ({
  address: `exa@${account}`,
  id: keyId(`synthetic-${account}`),
  site: "exa",
  account,
  owner: "wren",
  purposes: ["default"],
  status: "live",
  madeAt: "2026-10-01T00:00:00.000Z",
  uses: 0,
  lastUsedAt: null,
});
const at = (address: string) => {
  const k = state.get(address);
  if (!k) throw new restate.TerminalError(`no key ${address}`, { errorCode: 404 });
  return k;
};

const sites = restate.service({
  name: "sites",
  handlers: {
    keys: async (_ctx: restate.Context, _req: { all?: boolean }) => {
      calls.push("sites/keys");
      return { keys: [...state.values()] };
    },
    keySpend: async (_ctx: restate.Context, req: { address: string; until?: string }) => {
      calls.push(`sites/keySpend ${req.address} ${req.until ?? ""}`.trim());
      const k = {
        ...at(req.address),
        status: "spent" as const,
        spentUntil: req.until ?? "2026-11-01T00:00:00.000Z",
      };
      state.set(req.address, k);
      return k;
    },
    keyRevoke: async (_ctx: restate.Context, req: { address: string }) => {
      calls.push(`sites/keyRevoke ${req.address}`);
      const k = {
        ...at(req.address),
        status: "revoked" as const,
        revokedAt: "2026-10-19T00:00:00.000Z",
      };
      state.set(req.address, k);
      return { key: k, projected: { put: ["EXA_API_KEY"], removed: [] } };
    },
  },
});
const desk = restate.service({
  name: "desk",
  handlers: {
    keyRotate: async (_ctx: restate.Context, req: { address: string }) => {
      calls.push(`desk/keyRotate ${req.address}`);
      return { run: `Compiled_wren/${req.address}`, workflow: "exa-key" };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [sites, desk, makeVaultKeys({ db: pg.db, limitMs: 5_000 })],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const vault = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ReturnType<typeof makeVaultKeys>>({ name: "VaultKeys" }, "box");
const mirrored = async () =>
  (await pg.db.select().from(vaultKeys).orderBy(vaultKeys.address)).map((r) => [
    r.address,
    r.status,
  ]);

describe("VaultKeys", () => {
  it("sync mirrors what sites lists, and the next one an hour on", async () => {
    state.set("exa@env-0", key("env-0"));
    state.set("exa@env-1", key("env-1"));
    const out = await vault().sync();
    expect(out).toMatchObject({ error: null, delayMs: 3_600_000 });
    expect(out.stats).toMatchObject({ keys: 2, removed: 0, refused: 0 });
    expect(await mirrored()).toEqual([
      ["exa@env-0", "live"],
      ["exa@env-1", "live"],
    ]);
  });

  it("spend calls sites then mirrors the new state", async () => {
    calls.length = 0;
    const out = await vault().spend({ address: "exa@env-0", until: "2026-12-01T00:00:00.000Z" });
    expect(out).toMatchObject({ address: "exa@env-0", status: "spent" });
    expect(calls).toEqual(["sites/keySpend exa@env-0 2026-12-01T00:00:00.000Z", "sites/keys"]);
    expect(await mirrored()).toEqual([
      ["exa@env-0", "spent"],
      ["exa@env-1", "live"],
    ]);
  });

  it("revoke calls sites then mirrors, and says what the projection did", async () => {
    calls.length = 0;
    const out = await vault().revoke({ address: "exa@env-1" });
    expect(out).toMatchObject({
      status: "revoked",
      projected: { put: ["EXA_API_KEY"], removed: [] },
    });
    expect(calls).toEqual(["sites/keyRevoke exa@env-1", "sites/keys"]);
    expect(await mirrored()).toContainEqual(["exa@env-1", "revoked"]);
  });

  it("rotate starts the run on the desk and answers its id, without a sync", async () => {
    calls.length = 0;
    const out = await vault().rotate({ address: "exa@env-0" });
    expect(out).toEqual({ run: "Compiled_wren/exa@env-0", workflow: "exa-key" });
    expect(calls).toEqual(["desk/keyRotate exa@env-0"]);
  });

  it("a key the mirror doesn't hold is refused before autobrowse hears of it", async () => {
    calls.length = 0;
    for (const act of [
      () => vault().rotate({ address: "exa@nope" }),
      () => vault().revoke({ address: "exa@nope" }),
      () => vault().spend({ address: "exa@nope" }),
    ])
      await expect(act()).rejects.toThrow(/No operator key exa@nope/);
    expect(calls).toEqual([]);
  });
});
