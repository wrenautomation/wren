/**
 * The steps of one domain provision, in order. Each is idempotent (get
 * before create) and hands what later steps need through the memo. A step
 * that runs a browser leg proves the result through an API read afterwards
 * where one exists. Browser legs are Restate calls in their own right, so
 * they are never wrapped in `host.run`.
 */
import { randomBytes } from "node:crypto";
import type { DnsRecord } from "./clients/cloudflare.js";
import type { Availability } from "./clients/rdap.js";
import { appendEntries } from "./clients/roster.js";
import type { Deps, DkimRecord } from "./deps.js";
import { type Gate, type GateAnswer, GateOpen, type Host, NeedsHuman } from "./host.js";
import { inboxAddress, type Plan } from "./plan.js";

/** Everything the steps learn that later steps need. Never a password: those go from generation to the secret store inside one journaled effect. */
export interface Memo {
  availability?: Availability;
  owned?: boolean;
  zoneId?: string;
  verificationToken?: string;
  dkim?: DkimRecord;
  rosterAdded?: string[];
}

export const SECRET_PREFIX = "/wren/inboxes";

export interface StepResult {
  status: "done" | "skipped" | "rejected";
  detail: string;
}

export interface StepContext {
  host: Host;
  deps: Deps;
  plan: Plan;
  memo: Memo;
  /** The person's answer for a gate, or throws GateOpen so the driver can ask. */
  gate(name: Gate, prompt: string): GateAnswer;
}

export interface Step {
  name: string;
  /** Money moves, a password changes, something outside learns of the domain. */
  irreversible?: boolean;
  run(c: StepContext): Promise<StepResult>;
}

const done = (detail: string): StepResult => ({ status: "done", detail });
const skipped = (detail: string): StepResult => ({ status: "skipped", detail });
const rejected = (detail: string): StepResult => ({ status: "rejected", detail });

export const check: Step = {
  name: "check",
  async run({ host, deps, plan, memo }) {
    const owned = await host.run("cloudflare registered", () =>
      deps.cloudflare.registered(plan.domain),
    );
    memo.owned = owned;
    if (owned) {
      memo.availability = "taken";
      return done("already registered in this Cloudflare account");
    }
    const availability = await host.run("rdap", () => deps.availability(plan.domain));
    memo.availability = availability;
    if (availability === "taken") throw new Error(`${plan.domain} is registered by someone else`);
    if (availability === "unknown")
      throw new Error(`RDAP could not say whether ${plan.domain} is free`);
    return done("available");
  },
};

export const buy: Step = {
  name: "buy",
  irreversible: true,
  async run({ host, deps, plan, memo, gate }) {
    if (memo.owned) return skipped("already owned");
    if (!plan.buy) throw new Error(`${plan.domain} is not owned and buy=false`);
    const answer = gate(
      "purchase",
      `Buy ${plan.domain} at Cloudflare Registrar (renews yearly at the registrar's cost price)?`,
    );
    if (!answer.approved) return rejected(answer.note ?? "purchase declined");
    const bought = await deps.browser.buy({ domain: plan.domain });
    // The dashboard said yes; the API is the proof.
    const registered = await host.run("cloudflare registered after buy", () =>
      deps.cloudflare.registered(plan.domain),
    );
    if (!registered)
      throw new NeedsHuman(`checkout finished but the Registrar API does not list ${plan.domain}`);
    memo.owned = true;
    return done(`bought${bought.priceText ? ` (${bought.priceText})` : ""}`);
  },
};

export const zone: Step = {
  name: "zone",
  async run({ host, deps, plan, memo }) {
    const existing = await host.run("zone lookup", () => deps.cloudflare.zoneId(plan.domain));
    memo.zoneId =
      existing ?? (await host.run("zone create", () => deps.cloudflare.createZone(plan.domain)));
    return done(existing ? `zone ${existing}` : `zone created ${memo.zoneId}`);
  },
};

export const workspaceDomain: Step = {
  name: "workspace-domain",
  async run({ host, deps, plan }) {
    const current = await host.run("workspace domain get", () =>
      deps.google.getDomain(plan.domain),
    );
    if (current)
      return done(current.verified ? "in Workspace, verified" : "in Workspace, unverified");
    await host.run("workspace domain add", () => deps.google.addDomain(plan.domain));
    return done("added to Workspace as a secondary domain");
  },
};

export const verifyDomain: Step = {
  name: "verify-domain",
  async run({ host, deps, plan, memo }) {
    const current = await host.run("workspace domain verified?", () =>
      deps.google.getDomain(plan.domain),
    );
    if (current?.verified) return skipped("already verified");
    const zoneId = need(memo.zoneId, "zoneId");
    const token = await host.run("verification token", () =>
      deps.google.verificationToken(plan.domain),
    );
    memo.verificationToken = token;
    await host.run("verification txt", () =>
      deps.cloudflare.upsertRecord(zoneId, { type: "TXT", name: "@", content: token }),
    );
    const verified = await pollUntil(host, "verify", deps.dnsWaitMs ?? 10 * 60_000, () =>
      deps.google.verifyDomain(plan.domain),
    );
    if (!verified)
      throw new NeedsHuman(
        `Google cannot see the verification TXT for ${plan.domain} yet; check DNS and approve to retry`,
      );
    return done("verified by DNS TXT");
  },
};

export const mailDns: Step = {
  name: "mail-dns",
  async run({ host, deps, memo }) {
    const zoneId = need(memo.zoneId, "zoneId");
    const records: DnsRecord[] = [
      { type: "MX", name: "@", content: "smtp.google.com", priority: 1 },
      { type: "TXT", name: "@", content: "v=spf1 include:_spf.google.com ~all" },
      {
        type: "TXT",
        name: "_dmarc",
        content: `v=DMARC1; p=none${deps.dmarcRua ? `; rua=mailto:${deps.dmarcRua}` : ""}`,
      },
    ];
    const outcomes: string[] = [];
    for (const r of records) {
      const o = await host.run(`dns ${r.type} ${r.name}`, () =>
        deps.cloudflare.upsertRecord(zoneId, r, {
          replace: r.type === "MX" || r.name === "_dmarc",
        }),
      );
      outcomes.push(`${r.type} ${r.name} ${o}`);
    }
    return done(outcomes.join(", "));
  },
};

export const dkimGenerate: Step = {
  name: "dkim-generate",
  async run({ deps, plan, memo }) {
    const dkim = await deps.browser.dkimGenerate({ domain: plan.domain });
    if (!/^v=DKIM1;/.test(dkim.value))
      throw new NeedsHuman("the admin console showed something that is not a DKIM record");
    memo.dkim = dkim;
    return done(`${dkim.name} (${dkim.value.length} chars)`);
  },
};

export const dkimDns: Step = {
  name: "dkim-dns",
  async run({ host, deps, memo }) {
    const zoneId = need(memo.zoneId, "zoneId");
    const dkim = need(memo.dkim, "dkim");
    const o = await host.run("dns TXT dkim", () =>
      deps.cloudflare.upsertRecord(
        zoneId,
        { type: "TXT", name: dkim.name, content: dkim.value },
        { replace: true },
      ),
    );
    return done(`TXT ${dkim.name} ${o}`);
  },
};

export const dkimStart: Step = {
  name: "dkim-start",
  async run({ host, deps, plan }) {
    // Google needs to see the TXT first; give the resolvers a moment before the first try.
    await host.sleep(
      deps.dnsWaitMs === undefined ? 2 * 60_000 : Math.min(deps.dnsWaitMs, 2 * 60_000),
    );
    return done(await deps.browser.dkimStart({ domain: plan.domain }));
  },
};

export const inboxes: Step = {
  name: "inboxes",
  irreversible: true,
  async run({ host, deps, plan, gate }) {
    const outcomes: string[] = [];
    const emails = plan.inboxes.map((i) => inboxAddress(plan, i));
    // Resetting a password somebody may be using is the `password` gate's call.
    const existing = await host.run("existing inboxes", async () => {
      const found = await Promise.all(emails.map((e) => deps.google.getUser(e)));
      return emails.filter((_, i) => found[i] !== null);
    });
    if (existing.length > 0) {
      const answer = gate(
        "password",
        `Reset the password of ${existing.join(", ")} to a new random one (kept in SSM)?`,
      );
      if (!answer.approved) return rejected(answer.note ?? "password reset declined");
    }
    for (const inbox of plan.inboxes) {
      const email = inboxAddress(plan, inbox);
      // One journaled effect per inbox: the password exists only inside it and in
      // the secret store. A rerun of an unfinished effect resets the password, so
      // the store never holds a stale one.
      const o = await host.run(`inbox ${email}`, async () => {
        const password = randomBytes(18).toString("base64url");
        const current = await deps.google.getUser(email);
        if (current) await deps.google.setPassword(email, password);
        else
          await deps.google.createUser({
            primaryEmail: email,
            givenName: inbox.givenName,
            familyName: inbox.familyName,
            password,
          });
        await deps.secrets.put(`${SECRET_PREFIX}/${email}/password`, password);
        return current ? "password reset" : "created";
      });
      outcomes.push(`${email} ${o}`);
    }
    return done(outcomes.join(", "));
  },
};

export const signatures: Step = {
  name: "signatures",
  async run({ host, deps, plan }) {
    if (!plan.signatureHtml) return skipped("no signature in the plan");
    const outcomes: string[] = [];
    for (const inbox of plan.inboxes) {
      const email = inboxAddress(plan, inbox);
      // A just-created user takes a little while to have a mailbox.
      const o = await retry(host, `signature ${email}`, 5, 30_000, () =>
        deps.signatures.setSignature(email, plan.signatureHtml),
      );
      outcomes.push(`${email} ${o}`);
    }
    return done(outcomes.join(", "));
  },
};

export const warmup: Step = {
  name: "warmup",
  async run({ deps, plan }) {
    if (!plan.warmup) return skipped("warmup=false");
    const outcomes: string[] = [];
    for (const inbox of plan.inboxes) {
      const email = inboxAddress(plan, inbox);
      outcomes.push(`${email} ${await deps.browser.warmup({ email })}`);
    }
    return done(outcomes.join(", "));
  },
};

export const roster: Step = {
  name: "roster",
  irreversible: true,
  async run({ host, deps, plan, memo }) {
    if (!plan.handoff) return skipped("handoff=false");
    const entries = plan.inboxes.map((i) => ({
      address: inboxAddress(plan, i),
      displayName: `${i.givenName} ${i.familyName}`,
      niches: plan.niches,
    }));
    const added = await host.run("roster append", async () => {
      const current = await deps.roster.read();
      const next = appendEntries(current, entries);
      if (next.added.length > 0) await deps.roster.write(next.text);
      return next.added;
    });
    memo.rosterAdded = added;
    if (added.length === 0) return done("all inboxes already on the roster");
    await host.run("reload", () => deps.reloader.reload());
    const ready = await pollUntil(host, "reload", 5 * 60_000, () => deps.reloader.ready());
    if (!ready) throw new Error("the fleet did not reload in 5 minutes");
    return done(`added ${added.join(", ")}; ${deps.reloader.name}`);
  },
};

export const loops: Step = {
  name: "loops",
  irreversible: true,
  async run({ deps, plan }) {
    if (!plan.handoff) return skipped("handoff=false");
    const outcomes: string[] = [];
    for (const inbox of plan.inboxes) {
      const email = inboxAddress(plan, inbox);
      const o = await deps.loops.start(email);
      outcomes.push(`${email} send=${o.send} inbox=${o.inbox}`);
    }
    return done(outcomes.join(", "));
  },
};

/** In order. */
export const STEPS: readonly Step[] = [
  check,
  buy,
  zone,
  workspaceDomain,
  verifyDomain,
  mailDns,
  dkimGenerate,
  dkimDns,
  dkimStart,
  inboxes,
  signatures,
  warmup,
  roster,
  loops,
];

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`memo has no ${what}; an earlier step did not run`);
  return value;
}

/** Ask every 30 s inside the budget, sleeping durably between asks. */
export async function pollUntil(
  host: Host,
  name: string,
  budgetMs: number,
  probe: () => Promise<boolean>,
): Promise<boolean> {
  const stepMs = 30_000;
  for (let waited = 0; ; waited += stepMs) {
    if (await host.run(`${name} ${waited}`, probe)) return true;
    if (waited + stepMs > budgetMs) return false;
    await host.sleep(stepMs);
  }
}

async function retry<T>(
  host: Host,
  name: string,
  times: number,
  gapMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i += 1) {
    try {
      return await host.run(`${name} #${i + 1}`, fn);
    } catch (err) {
      last = err;
      if (i + 1 < times) await host.sleep(gapMs);
    }
  }
  throw last;
}

export { GateOpen, NeedsHuman };
