import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listNotes } from "../../src/notes.js";
import { INBOX_KEY, type LinkedinInbox, makeLinkedinInbox } from "../../src/restate/inbox.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
let inboxDir: string;

beforeAll(async () => {
  [pg, inboxDir] = await Promise.all([startTestPostgres(), mkdtemp(join(tmpdir(), "inbox-"))]);
  // alwaysReplay re-runs the journal after every step, which fails loudly if
  // handler code outside ctx.run is non-deterministic.
  env = await RestateTestEnvironment.start({
    services: [makeLinkedinInbox({ db: pg.db, inboxDir })],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

describe("LinkedinInbox virtual object", () => {
  it("ingest journals every note and add returns the row id", async () => {
    await writeFile(join(inboxDir, "a.md"), "hello");
    await writeFile(join(inboxDir, "a.png"), "");
    const client = clients
      .connect({ url: env.baseUrl() })
      .objectClient<LinkedinInbox>({ name: "LinkedinInbox" }, INBOX_KEY);

    expect(await client.ingest()).toEqual({ ingested: 1 });
    expect(await client.ingest()).toEqual({ ingested: 0 });
    const { id } = await client.add("from cli");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await listNotes(pg.db, "new");
    expect(rows.map((r) => [r.source, r.body]).sort()).toEqual([
      ["cli", "from cli"],
      ["inbox", "hello"],
    ]);
    expect((await readdir(join(inboxDir, "done"))).sort()).toEqual(["a.md", "a.png"]);
  });
});
