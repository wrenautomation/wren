/**
 * Jobber: clients changed since their cursor, then jobs completed since theirs, through its
 * GraphQL API. Checked against a live test account 2026-10-10: `JobFilterAttributes` has no
 * `updatedAt`, so jobs page by `completedAt` (designs/2026-10-09-connectors.md). Its version
 * header is pinned below.
 */
import {
  jsonOf,
  later,
  PAGE,
  PullError,
  type PulledChange,
  type PulledPerson,
  type Puller,
  str,
  type WhoAmI,
} from "./types.js";

export const JOBBER_API = "https://api.getjobber.com/api/graphql";
export const JOBBER_VERSION = "2025-04-16";

type Row = Record<string, unknown>;

const PERSON = `id firstName lastName companyName isCompany createdAt updatedAt
  emails { address primary } phones { number primary }`;

const CLIENTS = `query Clients($first: Int!, $after: String, $since: ISO8601DateTime) {
  clients(first: $first, after: $after, filter: { updatedAt: { after: $since } }) {
    nodes { ${PERSON} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const JOBS = `query Jobs($first: Int!, $after: String, $since: ISO8601DateTime) {
  jobs(first: $first, after: $after, filter: { completedAt: { after: $since } }) {
    nodes { id jobNumber title completedAt updatedAt total client { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function gql(
  i: Pick<Parameters<Puller>[0], "fetch" | "token">,
  query: string,
  variables: Row,
): Promise<Row> {
  const j = await jsonOf(
    await i.fetch(JOBBER_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${i.token}`,
        "content-type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": JOBBER_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    }),
    "Jobber",
  );
  const errs = Array.isArray(j.errors) ? (j.errors as { message?: unknown }[]) : [];
  if (errs.length) {
    const said = str(errs[0]?.message) ?? "an error";
    throw new PullError(`Jobber said ${said.slice(0, 160)}`, /unauthori[sz]ed|token/i.test(said));
  }
  return (j.data ?? {}) as Row;
}

const primary = (list: unknown, key: string): string | null => {
  const xs = Array.isArray(list) ? (list as Row[]) : [];
  return str((xs.find((x) => x.primary) ?? xs[0])?.[key]);
};

const person = (c: Row): PulledPerson | null => {
  const id = str(c.id);
  if (!id) return null;
  const first = str(c.firstName);
  const last = str(c.lastName);
  const company = str(c.companyName);
  return {
    id,
    firstName: first,
    lastName: last,
    fullName: first || last ? null : company,
    email: primary(c.emails, "address"),
    phone: primary(c.phones, "number"),
    company: company ?? ([first, last].filter(Boolean).join(" ") || null),
    website: null,
    title: null,
    status: null,
    created: str(c.createdAt),
    lastContacted: null,
  };
};

/**
 * Jobber pages in its own order, not by change, so a walk cut at the cap keeps its page
 * (`<what>.page`) and the newest change seen (`<what>.top`), and its `since` stays until the
 * walk ends.
 */
export const pullJobber: Puller = async (i) => {
  const cursor = { ...i.cursor };
  const people: PulledPerson[] = [];
  const changes: PulledChange[] = [];
  let read = 0;
  let more = false;
  for (const what of ["clients", "jobs"] as const) {
    let top = cursor[`${what}.top`] ?? cursor[what];
    let after: string | null = cursor[`${what}.page`] ?? null;
    for (;;) {
      const data = await gql(i, what === "clients" ? CLIENTS : JOBS, {
        first: PAGE,
        after,
        since: cursor[what] ?? null,
      });
      const conn = (data[what] ?? {}) as { nodes?: Row[]; pageInfo?: Row };
      const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
      for (const n of nodes) {
        // Clients move their cursor by change, jobs by completion: what each filter reads.
        top = later(top, str(what === "clients" ? n.updatedAt : n.completedAt));
        if (what === "clients") {
          const p = person(n);
          if (!p) continue;
          people.push(p);
          if (p.created)
            changes.push({
              key: `client:${p.id}`,
              change: "contact_added",
              at: p.created,
              person: p.id,
              data: {},
            });
          continue;
        }
        const id = str(n.id);
        const done = str(n.completedAt);
        if (!id || !done) continue;
        changes.push({
          key: `job:${id}`,
          change: "job_done",
          at: done,
          person: str((n.client as Row | undefined)?.id),
          data: { job: str(n.jobNumber) ?? id, title: str(n.title), total: n.total ?? null },
        });
      }
      read += nodes.length;
      after = conn.pageInfo?.hasNextPage ? str(conn.pageInfo.endCursor) : null;
      if (!after || !nodes.length) break;
      if (read >= i.cap) {
        more = true;
        break;
      }
    }
    if (more && after) {
      cursor[`${what}.page`] = after;
      if (top) cursor[`${what}.top`] = top;
      break;
    }
    delete cursor[`${what}.page`];
    delete cursor[`${what}.top`];
    if (top) cursor[what] = top;
  }
  return { people, changes, cursor, more };
};

export const whoJobber: WhoAmI = async (fetch, token) => {
  const data = await gql({ fetch, token }, "query { account { id name } }", {});
  const a = (data.account ?? {}) as Row;
  const id = str(a.id);
  if (!id) throw new Error("Jobber named no account");
  return { id, name: str(a.name) };
};
