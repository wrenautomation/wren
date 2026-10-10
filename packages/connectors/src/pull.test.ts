/** The apps' reads and sign-in against fake answers: no network. Synthetic data only. */
import { CONNECTOR_APP_NAMES } from "@wren/core/logic";
import { describe, expect, it } from "vitest";
import { APPS, CONNECTOR_APPS } from "./apps.js";
import { connectUrl, exchange, refresh } from "./oauth.js";
import { pullHubspot } from "./pull/hubspot.js";
import { pullJobber } from "./pull/jobber.js";
import { pullQuickbooks } from "./pull/quickbooks.js";
import { peopleCsv } from "./sync.js";

type Call = { url: string; init: RequestInit };
const fake = (answer: (c: Call, n: number) => unknown, status = 200) => {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return new Response(JSON.stringify(answer(c, calls.length)), { status });
  };
  return { fetch, calls };
};
const KEYS = { id: "app-id", secret: "app-secret" };
const body = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

describe("sign-in", () => {
  it("asks for read scopes, and none for Jobber (set on its app)", () => {
    const hs = new URL(connectUrl("hubspot", KEYS, { redirect: "https://p.test/cb", state: "s1" }));
    expect(hs.searchParams.get("scope")).toBe(
      "oauth crm.objects.contacts.read crm.objects.companies.read",
    );
    expect(hs.searchParams.get("state")).toBe("s1");
    const jb = new URL(connectUrl("jobber", KEYS, { redirect: "https://p.test/cb", state: "s2" }));
    expect(jb.searchParams.has("scope")).toBe(false);
  });

  it("sends QuickBooks the app's keys as basic auth, the others in the body", async () => {
    const f = fake(() => ({ access_token: "a1", refresh_token: "r2", expires_in: 3600 }));
    await exchange(f.fetch, "quickbooks", KEYS, { code: "c", redirect: "https://p.test/cb" });
    await exchange(f.fetch, "hubspot", KEYS, { code: "c", redirect: "https://p.test/cb" });
    const [qb, hs] = f.calls as [Call, Call];
    expect((qb.init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    expect(String(qb.init.body)).not.toContain("app-secret");
    expect(String(hs.init.body)).toContain("client_secret=app-secret");
  });

  it("keeps the old refresh token when none comes back, and says a revoked grant", async () => {
    const ok = fake(() => ({ access_token: "a2", expires_in: 60 }));
    expect((await refresh(ok.fetch, "hubspot", KEYS, "r1")).refresh).toBe("r1");
    const no = fake(() => ({ error: "invalid_grant" }), 400);
    await expect(refresh(no.fetch, "jobber", KEYS, "r1")).rejects.toMatchObject({ revoked: true });
  });
});

describe("HubSpot", () => {
  it("pages contacts oldest change first and keeps the newest as its cursor", async () => {
    const f = fake((_c, n) => ({
      results: [
        {
          id: String(n),
          properties: {
            firstname: "Ada",
            lastname: `L${n}`,
            email: `ada${n}@example.test`,
            createdate: "2026-10-01T00:00:00Z",
            lastmodifieddate: `2026-10-0${n}T00:00:00Z`,
          },
        },
      ],
      ...(n < 2 ? { paging: { next: { after: "p2" } } } : {}),
    }));
    const out = await pullHubspot({
      fetch: f.fetch,
      token: "t",
      extra: {},
      cursor: { contacts: "2026-09-30T00:00:00Z" },
      cap: 100,
    });
    expect(out.people.map((p) => p.id)).toEqual(["1", "2"]);
    expect(out.people[0]?.company).toBe("Ada L1");
    expect(out.cursor.contacts).toBe("2026-10-02T00:00:00Z");
    expect(body(f.calls[1] as Call).after).toBe("p2");
    const filter = (body(f.calls[0] as Call).filterGroups as { filters: { value: string }[] }[])[0];
    expect(filter?.filters[0]?.value).toBe(String(Date.parse("2026-09-30T00:00:00Z")));
    expect(out.changes.map((c) => c.key)).toEqual(["contact:1", "contact:2"]);
  });

  it("says a refused token is the token's fault", async () => {
    const f = fake(() => ({}), 401);
    await expect(
      pullHubspot({ fetch: f.fetch, token: "t", extra: {}, cursor: {}, cap: 10 }),
    ).rejects.toMatchObject({ auth: true });
  });
});

describe("QuickBooks", () => {
  it("reads customers then invoices; a zero balance is paid", async () => {
    const f = fake((c) => {
      const q = decodeURIComponent(c.url);
      if (q.includes("from Customer"))
        return {
          QueryResponse: {
            Customer: [
              {
                Id: "7",
                DisplayName: "Pat Doe",
                PrimaryPhone: { FreeFormNumber: "+1 416 555 0100" },
                MetaData: {
                  CreateTime: "2026-10-02T00:00:00Z",
                  LastUpdatedTime: "2026-10-02T01:00:00Z",
                },
              },
            ],
          },
        };
      return {
        QueryResponse: {
          Invoice: [
            {
              Id: "90",
              DocNumber: "1001",
              Balance: 0,
              TotalAmt: 250,
              CustomerRef: { value: "7", name: "Pat Doe" },
              MetaData: { LastUpdatedTime: "2026-10-03T00:00:00Z" },
            },
            {
              Id: "91",
              Balance: 40,
              TotalAmt: 40,
              MetaData: { LastUpdatedTime: "2026-10-03T02:00:00Z" },
            },
          ],
        },
      };
    });
    const out = await pullQuickbooks({
      fetch: f.fetch,
      token: "t",
      extra: { realm: "123" },
      cursor: {},
      cap: 100,
    });
    expect(f.calls[0]?.url).toContain("/v3/company/123/query");
    expect(out.people[0]).toMatchObject({ id: "7", fullName: "Pat Doe", company: "Pat Doe" });
    expect(out.changes.map((c) => [c.key, c.change])).toEqual([
      ["customer:7", "contact_added"],
      ["invoice:90", "invoice_paid"],
    ]);
    expect(out.cursor).toEqual({
      customers: "2026-10-02T01:00:00Z",
      invoices: "2026-10-03T02:00:00Z",
    });
  });
});

describe("Jobber", () => {
  it("keeps its page when cut at the cap, and its since until the walk ends", async () => {
    const node = (n: number) => ({
      id: `c${n}`,
      firstName: "Sam",
      lastName: `K${n}`,
      emails: [{ address: `sam${n}@example.test`, primary: true }],
      phones: [],
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: `2026-10-0${n}T00:00:00Z`,
    });
    const page = (n: number, next: boolean) => ({
      data: {
        clients: { nodes: [node(n)], pageInfo: { hasNextPage: next, endCursor: `e${n}` } },
      },
    });
    const first = fake(() => page(3, true));
    const cut = await pullJobber({
      fetch: first.fetch,
      token: "t",
      extra: {},
      cursor: { clients: "2026-09-01T00:00:00Z" },
      cap: 1,
    });
    expect(cut.more).toBe(true);
    expect(cut.cursor).toEqual({
      clients: "2026-09-01T00:00:00Z",
      "clients.page": "e3",
      "clients.top": "2026-10-03T00:00:00Z",
    });
    const rest = fake((c) =>
      String(c.init.body).includes("Clients") ? page(2, false) : { data: { jobs: { nodes: [] } } },
    );
    const done = await pullJobber({
      fetch: rest.fetch,
      token: "t",
      extra: {},
      cursor: cut.cursor,
      cap: 10,
    });
    expect(body(rest.calls[0] as Call).variables).toMatchObject({ after: "e3" });
    expect(done.cursor).toEqual({ clients: "2026-10-03T00:00:00Z" });
    expect(done.people[0]?.email).toBe("sam2@example.test");
  });

  it("reads jobs by completion: filter, cursor and job_done all use completedAt", async () => {
    const f = fake((c) =>
      String(c.init.body).includes("Clients")
        ? { data: { clients: { nodes: [] } } }
        : {
            data: {
              jobs: {
                nodes: [
                  {
                    id: "j1",
                    jobNumber: 7,
                    title: "Deep clean",
                    completedAt: "2026-10-05T00:00:00Z",
                    updatedAt: "2026-10-09T00:00:00Z",
                    total: 120,
                    client: { id: "c1" },
                  },
                ],
              },
            },
          },
    );
    const out = await pullJobber({
      fetch: f.fetch,
      token: "t",
      extra: {},
      cursor: { jobs: "2026-10-01T00:00:00Z" },
      cap: 10,
    });
    const asked = body(f.calls[1] as Call);
    expect(String(asked.query)).toContain("completedAt: { after: $since }");
    expect(asked.variables).toMatchObject({ since: "2026-10-01T00:00:00Z" });
    expect(out.cursor.jobs).toBe("2026-10-05T00:00:00Z");
    expect(out.changes).toEqual([
      expect.objectContaining({ key: "job:j1", change: "job_done", person: "c1" }),
    ]);
  });

  it("says a GraphQL error", async () => {
    const f = fake(() => ({ errors: [{ message: "Field 'nope' doesn't exist" }] }));
    await expect(
      pullJobber({ fetch: f.fetch, token: "t", extra: {}, cursor: {}, cap: 10 }),
    ).rejects.toMatchObject({ auth: false });
  });
});

describe("peopleCsv", () => {
  it("quotes what needs it", () => {
    const csv = peopleCsv([
      {
        id: "1",
        firstName: "Jo",
        lastName: 'O"Neil',
        fullName: null,
        email: null,
        phone: null,
        company: "Smith, Jones & Co",
        website: null,
        title: null,
        status: null,
        created: null,
        lastContacted: null,
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe('1,Jo,"O""Neil",,,,"Smith, Jones & Co",,,,,');
  });
});

describe("apps", () => {
  it("name the apps as the App trigger does", () => {
    expect(Object.fromEntries(CONNECTOR_APPS.map((a) => [a, APPS[a].label]))).toEqual(
      CONNECTOR_APP_NAMES,
    );
  });
});
