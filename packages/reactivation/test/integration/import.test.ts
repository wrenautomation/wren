/**
 * People > Import (B4): a client loads a CSV of its contacts. The preview reads the file and
 * writes nothing; the import is `wren crm import`'s own, so rows merge and skip the same way.
 * The result is a row in the import list with its counts. Synthetic data only.
 */
import { addMember, clients } from "@wren/core/clients";
import type { Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crmLanding } from "../../src/crm/landing.js";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  PORTAL_ROUTES,
  PORTAL_WRITES,
} from "../../src/portal/routes.js";
import { PortalRefusal, portalApi } from "../../src/portal/service.js";

let pg: TestPostgres;
let api: ReturnType<typeof portalApi>;

const AMY: Viewer = { email: "amy@acme.example" };
const DEMO: Viewer = { demo: true };

const b64 = (text: string | Uint8Array) => Buffer.from(text).toString("base64");
const FILE = [
  "Name,Job Title,Company,Email,Website",
  "Ana Reyes,Recruiter,Birch Staffing,ana@birchstaffing.example,birchstaffing.example",
  "Ben Okafor,Director,Cedar Health,,",
  "Cleo Park,,,,",
  ",Lead,Dune Co,dev@dune.example,",
  "Eli Stone,Founder,Evergreen Labs,not-an-email,",
].join("\n");
const SECOND = [
  "Name,Job Title,Company,Email,Website",
  "Ana Reyes,Recruiter,Birch Staffing,ana@birchstaffing.example,birchstaffing.example",
  "Fay Lund,Owner,Fir Foods,fay@firfoods.example,",
].join("\n");

const ask = (text: string, more: Record<string, unknown> = {}) => ({
  viewer: AMY,
  file: b64(text),
  name: "contacts.csv",
  ...more,
});

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}
const count = async (table: string) =>
  Number(
    (await pg.db.execute<{ n: number }>(sql.raw(`select count(*)::int n from ${table}`)))[0]?.n,
  );
const list = async () =>
  (await api.recordsList({ viewer: AMY, record: "reactivation.import", view: "all" })).rows;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  // The same database stands in for the client's own.
  api = portalApi({ main: pg.db, open: () => pg.db });
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});

describe("preview", () => {
  it("guesses the columns and shows the rows as the import will read them", async () => {
    const p = await api.importPreview(ask(FILE));
    expect(p.headers).toEqual(["Name", "Job Title", "Company", "Email", "Website"]);
    expect(p.columns).toMatchObject({
      fullName: "Name",
      title: "Job Title",
      company: "Company",
      email: "Email",
      website: "Website",
    });
    expect(p).toMatchObject({ rows: 5, missing: [], skipped: 2, noEmail: 1, badEmail: 1 });
    expect(p.why.map((w) => w.reason).sort()).toEqual([
      "no company: needs a website, a work email or a company name",
      "no name",
    ]);
    expect(p.sample[0]).toMatchObject({
      row: 1,
      name: "Ana Reyes",
      company: expect.stringContaining("Birch"),
      email: "ana@birchstaffing.example",
      skip: null,
      note: null,
    });
    expect(p.sample[1]).toMatchObject({ name: "Ben Okafor", email: null, note: "No email" });
    expect(p.sample[2]).toMatchObject({
      row: 3,
      name: null,
      skip: expect.stringContaining("no company"),
    });
    expect(p.sample[4]).toMatchObject({ name: "Eli Stone", note: "Email looks wrong" });
    expect(p.formats.map((f) => f.id)).toContain("hubspot");
  });

  it("shows ten rows of a longer file, and writes nothing", async () => {
    const long = [
      "Name,Company,Email",
      ...Array.from({ length: 25 }, (_, i) => `Person${i} Test,Firm ${i},p${i}@firm${i}.example`),
    ].join("\n");
    const p = await api.importPreview(ask(long));
    expect(p.rows).toBe(25);
    expect(p.sample).toHaveLength(10);
    expect(await count("people")).toBe(0);
    expect(await count("imports")).toBe(0);
  });

  it("says what a file lacks, with the columns to pick from", async () => {
    const p = await api.importPreview(ask("Who,Where\nAna Reyes,Birch Staffing\n"));
    expect(p.missing).toEqual([
      "a name (Name, or First Name)",
      "an email, company or website column",
    ]);
    expect(p).toMatchObject({ headers: ["Who", "Where"], rows: 0, sample: [] });
  });

  it("takes the columns a person picks, and refuses a column the file lacks", async () => {
    const odd = "Who,Where,Mail\nAna Reyes,Birch Staffing,ana@birchstaffing.example\n";
    const p = await api.importPreview(
      ask(odd, { columns: { fullName: "Who", company: "Where", email: "Mail" } }),
    );
    expect(p).toMatchObject({ rows: 1, missing: [] });
    expect(p.sample[0]).toMatchObject({ name: "Ana Reyes", email: "ana@birchstaffing.example" });
    // A field left blank is unused: no company, no website, an email still gives a work domain.
    const noCompany = await api.importPreview(
      ask(odd, { columns: { fullName: "Who", email: "Mail", company: "" } }),
    );
    expect(noCompany.columns).toEqual({ fullName: "Who", email: "Mail" });
    expect(await refused(api.importPreview(ask(odd, { columns: { fullName: "Nope" } })))).toBe(400);
    expect(await refused(api.importPreview(ask(odd, { columns: { shoeSize: "Who" } })))).toBe(400);
  });

  it("reads the columns for the CRM it came from", async () => {
    const hub =
      "Record ID,First Name,Last Name,Company name,Lifecycle Stage\n7,Ana,Reyes,Birch Staffing,lead\n";
    const p = await api.importPreview(ask(hub, { format: "hubspot" }));
    expect(p.format).toBe("hubspot");
    expect(p.columns).toMatchObject({
      id: "Record ID",
      company: "Company name",
      status: "Lifecycle Stage",
    });
    expect(await refused(api.importPreview(ask(hub, { format: "nope" })))).toBe(400);
  });
});

describe("import", () => {
  it("loads the file and says how each row went", async () => {
    const r = await api.importRun(ask(FILE));
    expect(r).toMatchObject({
      rows: 5,
      created: 3,
      merged: 0,
      skipped: 2,
      noEmail: 1,
      badEmail: 1,
      seen: null,
    });
    expect(r.why.map((w) => w.reason).sort()).toEqual([
      "no company: needs a website, a work email or a company name",
      "no name",
    ]);
    expect(await count("people")).toBe(3);
    expect(await count("crm_contacts")).toBe(3);
    // The CRM's email joins the same check every imported address gets.
    expect(await count("contact_candidates")).toBe(1);
  });

  it("lists itself with its counts and why rows were skipped", async () => {
    const [row] = await list();
    expect(row).toMatchObject({
      id: String((await pg.db.execute<{ id: number }>(sql`select max(id) id from imports`))[0]?.id),
      file: "contacts.csv",
      source: "Any contact export",
      rows: 5,
      created: 3,
      merged: 0,
      skipped: 2,
    });
    expect(String(row?.why)).toContain("no name (1)");
    expect(String(row?.notes)).toContain("1 with no email");
    expect(String(row?.notes)).toContain("1 with an email that looks wrong");
    const skipped = await api.recordsList({
      viewer: AMY,
      record: "reactivation.import",
      view: "skipped",
    });
    expect(skipped.rows).toHaveLength(1);
  });

  it("merges people it already has, and adds only the new", async () => {
    const r = await api.importRun(ask(SECOND, { name: "second.csv" }));
    expect(r).toMatchObject({ rows: 2, created: 1, merged: 1, skipped: 0 });
    expect(await count("people")).toBe(4);
    expect(await count("crm_contacts")).toBe(4);
    expect((await list()).map((x) => x.file)).toEqual(["second.csv", "contacts.csv"]);
  });

  it("knows the same file when it comes again, and the preview says so", async () => {
    const before = await api.importPreview(ask(FILE));
    expect(before.seen).toBeGreaterThan(0);
    const r = await api.importRun(ask(FILE));
    expect(r).toMatchObject({ created: 0, merged: 3, skipped: 2 });
    expect(r.seen).toBe(before.seen);
    expect(await count("people")).toBe(4);
    const [row] = await list();
    expect(String(row?.notes)).toContain(`Same file as import ${before.seen}`);
  });

  it("leaves a connected app's hourly reads out of the list", async () => {
    const n = (await list()).length;
    await crmLanding.land(pg.db, {
      format: "quickbooks",
      ref: "quickbooks:1:2026-10-14T00:00:00.000Z",
      csv: new TextEncoder().encode(
        "id,name,company,email\n9,Gus Hall,Gus Hall,gus@example.test\n",
      ),
    });
    expect(await count("imports")).toBeGreaterThan(n);
    expect(await list()).toHaveLength(n);
  });

  it("refuses a file with columns it can't use, and writes nothing", async () => {
    const before = await count("imports");
    expect(await refused(api.importRun(ask("Who,Where\nAna Reyes,Birch Staffing\n")))).toBe(422);
    expect(await count("imports")).toBe(before);
  });
});

describe("limits and who", () => {
  it("refuses what isn't a CSV, is too big, or has too many rows", async () => {
    expect(await refused(api.importPreview({ viewer: AMY, file: "", name: "x.csv" }))).toBe(400);
    expect(await refused(api.importPreview(ask("a,b\n1,2\n", { file: "not base64!" })))).toBe(422);
    expect(await refused(api.importPreview(ask("Name,Company\nAna\u0000,Birch\n")))).toBe(422);
    expect(await refused(api.importPreview(ask("Name,Company\n")))).toBe(422);
    const big = `Name,Company\n${"x".repeat(IMPORT_MAX_BYTES)}`;
    expect(await refused(api.importPreview(ask(big)))).toBe(422);
    const many = `Name,Company\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i} T,F${i}`).join("\n")}`;
    expect(await refused(api.importPreview(ask(many)))).toBe(422);
    expect(await refused(api.importRun(ask(many)))).toBe(422);
  });

  it("never runs on the demo", async () => {
    expect(await refused(api.importPreview({ ...ask(FILE), viewer: DEMO }))).toBe(403);
    expect(await refused(api.importRun({ ...ask(FILE), viewer: DEMO }))).toBe(403);
  });

  it("needs manage, and is a write", () => {
    for (const r of ["importPreview", "importRun"] as const) {
      expect(PORTAL_ROUTES[r]).toBe("manage");
      expect(PORTAL_WRITES).toContain(r);
    }
  });
});
