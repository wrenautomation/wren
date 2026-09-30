/**
 * What a client plugged in, for the portal's Setup page: the CRM export, the
 * sites researched with, how their emails sound and who they come from, and
 * the send rule. Read-only; changing any of it is still Wren's job.
 */
import type { Client } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { readClientProfile } from "../profile.js";
import { reactivationSettingsOf } from "../settings.js";
import { iso } from "./views.js";

export interface Setup {
  /** The export the list came from. Never its file name: that can name the firm. */
  crm: {
    format: string;
    rows: number;
    importedAt: string;
    /** The day the export was taken, when the client said. */
    asOf: string | null;
    /** Exports loaded so far, the replaced ones included. */
    imports: number;
  } | null;
  /** Sites researched with a login, by site ("linkedin"). Never whose login it is. */
  research: string[];
  profile: {
    firm: string;
    sells: string;
    voice: string;
    signature: string;
    recruiters: { name: string; email: string }[];
  } | null;
  sending: {
    /** `first`: the client approves the first batch, then it flows. `every`: each batch. */
    approval: "first" | "every";
    /** Off until the client says go; always off on the demo. */
    live: boolean;
    perDay: number;
    senders: { name: string; address: string }[];
  };
}

export async function portalSetup(db: Queryable, client: Client): Promise<Setup> {
  const [crm] = await db.execute<{
    source_type: string;
    rows: number | null;
    imported_at: unknown;
    as_of: unknown;
    imports: number;
  }>(sql`
    select i.source_type, (i.stats->>'rows')::int "rows", i.imported_at, i.as_of::text as_of,
      (select count(*)::int from imports) imports
    from imports i where i.superseded_by is null
    order by i.imported_at desc, i.id desc limit 1`);
  const profile = await readClientProfile(db);
  const settings = reactivationSettingsOf(client.products);
  return {
    crm: crm
      ? {
          format: crm.source_type,
          rows: crm.rows ?? 0,
          importedAt: iso(crm.imported_at) ?? "",
          asOf: typeof crm.as_of === "string" ? crm.as_of : null,
          imports: crm.imports,
        }
      : null,
    research: Object.entries(client.accounts)
      .filter(([, account]) => typeof account === "string" && account.trim())
      .map(([site]) => site)
      .sort(),
    profile: profile
      ? {
          firm: profile.firm,
          sells: profile.sells,
          voice: profile.voice,
          signature: profile.signature,
          recruiters: profile.recruiters.map((r) => ({ name: r.name, email: r.email })),
        }
      : null,
    sending: {
      approval: settings.approval,
      live: !client.demo && settings.on && settings.stages.send,
      perDay: settings.compose.perDay,
      senders: settings.senders
        .filter((s) => !s.suspended)
        .map((s) => ({ name: s.name, address: s.address })),
    },
  };
}
