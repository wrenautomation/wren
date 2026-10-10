/**
 * Client portals on the client's own host (designs/2026-10-06-custom-domains.md). Cloudflare for
 * SaaS issues and renews the cert; this keeps which host is whose, and asks Cloudflare how each is
 * doing. Every function runs on the main database.
 */
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq } from "drizzle-orm";
import { getDomain, parse } from "tldts";
import { z } from "zod";
import { PortalRefusal } from "../refusal.js";
import {
  type ClientDomain,
  clientDomains,
  clientMembers,
  type DomainRecords,
  operators,
} from "./schema.js";

/** A host a client can't have, and why: the page shows it. */
export class DomainRefusal extends PortalRefusal {}

/** One custom host per client, for now. */
export const DOMAINS_PER_CLIENT = 1;

/**
 * The host as we store it: lowercase, no dot at the end, punycode. Refused: anything that isn't
 * a public name, an apex (it can't take a CNAME everywhere), and our own domain.
 */
export function normalHost(raw: string, own: string): string {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  // A port, a login or a path isn't part of a host name; the URL parser would quietly drop them.
  if (!text || /[:@?#\\\s]/.test(text)) throw new DomainRefusal("That isn't a domain name.");
  let host: string;
  try {
    host = new URL(`https://${text}`).hostname;
  } catch {
    throw new DomainRefusal("That isn't a domain name.");
  }
  const info = parse(host);
  if (info.isIp || !info.isIcann || !info.domain || !info.publicSuffix)
    throw new DomainRefusal("Use a public domain name, like portal.yourcompany.com.");
  if (host === info.domain)
    throw new DomainRefusal("Use a subdomain, like portal.yourcompany.com.");
  if (info.domain === getDomain(own)) throw new DomainRefusal("That's one of our hosts.");
  return host;
}

/** What Cloudflare says about one custom hostname (the parts we keep). */
export interface CloudflareHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_errors?: { message?: string }[] };
  verification_errors?: string[];
  ownership_verification?: { type?: string; name?: string; value?: string };
}

interface CloudflareAnswer<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
}

/** Cloudflare for SaaS custom hostnames on one zone: a token with "SSL and Certificates: Edit". */
export class CustomHostnames {
  constructor(private readonly o: { token: string; zone: string; fetch?: typeof fetch }) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await (this.o.fetch ?? fetch)(
      `https://api.cloudflare.com/client/v4/zones/${this.o.zone}/custom_hostnames${path}`,
      {
        ...init,
        headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" },
      },
    );
    const body = (await res.json().catch(() => null)) as CloudflareAnswer<T> | null;
    if (!body?.success) {
      const why = body?.errors?.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
      throw new Error(`Cloudflare ${res.status}: ${why || "no answer"}`);
    }
    return body.result;
  }

  /** Validated over HTTP once the CNAME points at us: the client sets one record. */
  create(hostname: string): Promise<CloudflareHostname> {
    return this.call("", {
      method: "POST",
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
    });
  }

  async find(hostname: string): Promise<CloudflareHostname | null> {
    const rows = await this.call<CloudflareHostname[]>(`?hostname=${encodeURIComponent(hostname)}`);
    return rows.find((r) => r.hostname === hostname) ?? null;
  }

  get(id: string): Promise<CloudflareHostname> {
    return this.call(`/${encodeURIComponent(id)}`);
  }

  async remove(id: string): Promise<void> {
    await this.call(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

/** Where the domain stands, read off Cloudflare's answer. */
export function domainState(cf: CloudflareHostname, target: string) {
  const own = cf.ownership_verification;
  const records: DomainRecords = {
    cname: { name: cf.hostname, target },
    txt: own?.name && own.value ? { name: own.name, value: own.value } : null,
  };
  const problem =
    [...(cf.verification_errors ?? []), ...(cf.ssl?.validation_errors ?? []).map((e) => e.message)]
      .filter(Boolean)
      .join(" ") || null;
  return { status: cf.status, sslStatus: cf.ssl?.status ?? "unknown", records, problem };
}

/** Live: Cloudflare routes it and the cert is out. */
export const isLive = (d: Pick<ClientDomain, "status" | "sslStatus">) =>
  d.status === "active" && d.sslStatus === "active";

export interface DomainsDeps {
  main: Db;
  /** Unset: custom domains aren't set up, and adding one says so. */
  cloudflare?: CustomHostnames;
  /** The fallback origin clients CNAME to, e.g. customers.wrenautomation.com. */
  target: string;
}

export async function listDomains(main: Queryable, clientId: string): Promise<ClientDomain[]> {
  return main
    .select()
    .from(clientDomains)
    .where(eq(clientDomains.clientId, clientId))
    .orderBy(asc(clientDomains.createdAt));
}

/** `Domains/resolve`'s input: the host the portal Worker was asked for. */
export const HOST_LOOKUP = z.object({ host: z.string().max(253).describe("The request's host") });

/** The client a live host belongs to, or null. The portal Worker pins requests to it. */
export async function clientOfHost(main: Queryable, host: string): Promise<string | null> {
  const [row] = await main
    .select({ clientId: clientDomains.clientId })
    .from(clientDomains)
    .where(
      and(
        eq(clientDomains.hostname, host.toLowerCase()),
        eq(clientDomains.status, "active"),
        eq(clientDomains.sslStatus, "active"),
      ),
    );
  return row?.clientId ?? null;
}

/**
 * May sign-in be carried to this host for this email: a live host, and they're a member of its
 * client. Never Wren's team: the client controls the host's DNS, so a team session stays on ours.
 */
export async function mayHandOff(main: Queryable, host: string, email: string): Promise<boolean> {
  const client = await clientOfHost(main, host);
  if (!client) return false;
  const who = email.trim().toLowerCase();
  const [team] = await main
    .select({ e: operators.email })
    .from(operators)
    .where(eq(operators.email, who));
  if (team) return false;
  const [member] = await main
    .select({ e: clientMembers.email })
    .from(clientMembers)
    .where(and(eq(clientMembers.clientId, client), eq(clientMembers.email, who)));
  return member !== undefined;
}

const cloudflareOf = (d: DomainsDeps): CustomHostnames => {
  if (!d.cloudflare) throw new DomainRefusal("Custom domains aren't set up yet.", 503);
  return d.cloudflare;
};

/** Register a host with Cloudflare and keep it for this client. Again for the same host: its row. */
export async function addDomain(
  d: DomainsDeps,
  clientId: string,
  raw: string,
  by: string,
): Promise<ClientDomain> {
  const hostname = normalHost(raw, d.target);
  const [held] = await d.main
    .select()
    .from(clientDomains)
    .where(eq(clientDomains.hostname, hostname));
  if (held && held.clientId !== clientId) throw new DomainRefusal("That domain is taken.", 409);
  if (held) return held;
  if ((await listDomains(d.main, clientId)).length >= DOMAINS_PER_CLIENT)
    throw new DomainRefusal("Remove the current domain first.", 409);
  const cf = cloudflareOf(d);
  // A row lost after Cloudflare said yes: take Cloudflare's, don't make a second.
  const made = (await cf.find(hostname)) ?? (await cf.create(hostname));
  const [row] = await d.main
    .insert(clientDomains)
    .values({ hostname, clientId, cfId: made.id, addedBy: by, ...domainState(made, d.target) })
    .returning();
  if (!row) throw new Error("client_domains insert returned nothing");
  return row;
}

/** Ask Cloudflare again and keep its answer. */
export async function checkDomain(d: DomainsDeps, row: ClientDomain): Promise<ClientDomain> {
  const cf = await cloudflareOf(d).get(row.cfId);
  const [next] = await d.main
    .update(clientDomains)
    .set({ ...domainState(cf, d.target), checkedAt: new Date() })
    .where(eq(clientDomains.hostname, row.hostname))
    .returning();
  return next ?? row;
}

export async function removeDomain(
  d: DomainsDeps,
  clientId: string,
  raw: string,
): Promise<boolean> {
  const hostname = String(raw ?? "")
    .trim()
    .toLowerCase();
  const [row] = await d.main
    .select()
    .from(clientDomains)
    .where(and(eq(clientDomains.hostname, hostname), eq(clientDomains.clientId, clientId)));
  if (!row) return false;
  await cloudflareOf(d)
    .remove(row.cfId)
    .catch((e: unknown) => {
      // Already gone at Cloudflare is fine; anything else keeps the row.
      if (!/\b404\b|1436/.test(String(e))) throw e;
    });
  await d.main.delete(clientDomains).where(eq(clientDomains.hostname, hostname));
  return true;
}
