/** In-memory dependencies for tests: every call recorded, nothing leaves the process. */
import type { CloudflareClient, DnsRecord } from "./clients/cloudflare.js";
import type { Deps } from "./deps.js";

export function fakeCloudflare(opts: { zone?: string | null } = {}) {
  const records: Array<DnsRecord & { id: string }> = [];
  let zone = opts.zone ?? null;
  const client: CloudflareClient & { records: typeof records; created: string[] } = {
    records,
    created: [],
    async zoneId() {
      return zone;
    },
    async registered() {
      return false;
    },
    async createZone(domain) {
      zone = `zone-${domain}`;
      client.created.push(domain);
      return zone;
    },
    async listRecords(_z, type, name) {
      return records.filter((r) => (!type || r.type === type) && (!name || r.name === name));
    },
    async upsertRecord(_z, record, o = {}) {
      const same = records.find(
        (r) => r.type === record.type && r.name === record.name && r.content === record.content,
      );
      if (same) return "kept";
      const existing = records.find((r) => r.type === record.type && r.name === record.name);
      if (existing && o.replace) {
        existing.content = record.content;
        return "replaced";
      }
      records.push({ ...record, id: `r${records.length + 1}` });
      return "created";
    },
  };
  return client;
}

export interface FakeWorld {
  deps: Deps;
  calls: string[];
  cloudflare: ReturnType<typeof fakeCloudflare>;
  users: Set<string>;
  rosterText: () => string;
  /** Flip to make `registered` say yes (a domain already in the account). */
  owned: { value: boolean };
  /** How many `verifyDomain` calls answer false before true. */
  dnsLag: { value: number };
}

export function fakeWorld(over: Partial<Deps> = {}): FakeWorld {
  const calls: string[] = [];
  const users = new Set<string>();
  const domains = new Map<string, boolean>();
  const bought = new Set<string>();
  const owned = { value: false };
  const dnsLag = { value: 0 };
  let roster =
    '# roster\n[[senders]]\naddress = "old@fleet.test"\ndisplay_name = "Old"\nniches = "all"\n';
  const cloudflare = fakeCloudflare();
  const deps: Deps = {
    cloudflare: {
      ...cloudflare,
      registered: async (d) => owned.value || bought.has(d),
    },
    google: {
      async getDomain(d) {
        return domains.has(d) ? { domainName: d, verified: domains.get(d) ?? false } : null;
      },
      async addDomain(d) {
        calls.push(`addDomain ${d}`);
        domains.set(d, false);
        return { domainName: d, verified: false };
      },
      async verificationToken() {
        return "google-site-verification=tok";
      },
      async verifyDomain(d) {
        if (dnsLag.value > 0) {
          dnsLag.value -= 1;
          return false;
        }
        calls.push(`verify ${d}`);
        domains.set(d, true);
        return true;
      },
      async getUser(e) {
        return users.has(e) ? { primaryEmail: e } : null;
      },
      async createUser(u) {
        calls.push(`createUser ${u.primaryEmail}`);
        users.add(u.primaryEmail);
        return { primaryEmail: u.primaryEmail };
      },
      async setPassword(e) {
        calls.push(`setPassword ${e}`);
      },
    },
    signatures: {
      async setSignature(e) {
        calls.push(`signature ${e}`);
        return "set";
      },
    },
    roster: {
      async read() {
        return roster;
      },
      async write(t) {
        calls.push("roster write");
        roster = t;
      },
    },
    secrets: {
      async put(name) {
        calls.push(`secret ${name}`);
      },
    },
    reloader: {
      name: "fleet reloaded",
      async reload() {
        calls.push("reload");
      },
      async ready() {
        return true;
      },
    },
    loops: {
      async start(a) {
        calls.push(`loops ${a}`);
        return { send: true, inbox: true };
      },
    },
    browser: {
      async buy({ domain }) {
        calls.push(`buy ${domain}`);
        bought.add(domain);
        return { priceText: "$10.11" };
      },
      async dkimGenerate() {
        calls.push("dkimGenerate");
        return { name: "google._domainkey", value: "v=DKIM1; k=rsa; p=abc" };
      },
      async dkimStart() {
        calls.push("dkimStart");
        return "started";
      },
      async warmup({ email }) {
        calls.push(`warmup ${email}`);
        return "enrolled";
      },
    },
    availability: async () => "available",
    dmarcRua: "dmarc@fleet.test",
    dnsWaitMs: 60_000,
    ...over,
  };
  return { deps, calls, cloudflare, users, rosterText: () => roster, owned, dnsLag };
}
