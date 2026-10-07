/**
 * `wren keys …`: the key store (designs/2026-10-07-key-store.md). Names, last 4 and versions;
 * never a value. `put` reads the value from stdin and seals it with the public key
 * (WREN_KEYSTORE_PUBLIC), so it never needs the private one. `rewrap` does: run it under
 * `node scripts/secrets.mjs run /wren/prod/keystore -- 'pnpm wren keys rewrap'`.
 */
import { getClient } from "@wren/core/clients";
import { keyRing, keySealer, pgKeyStore, publicSpecOf, rewrapAll } from "@wren/core/keys";
import { clientSecrets } from "@wren/core/keys-schema";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { and, eq } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const BY = "cli";

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Pipe the value in on stdin; it never goes in argv.");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** The sealer: the public key, or the one the private key in the env makes. */
function sealer() {
  const pub = process.env.WREN_KEYSTORE_PUBLIC;
  const priv = process.env.WREN_KEYSTORE_KEY;
  if (pub) return keySealer(pub);
  if (priv) return keySealer(publicSpecOf(priv));
  throw new Error("Set WREN_KEYSTORE_PUBLIC (terraform.tfvars keystore_public_key).");
}

export function registerKeys(program: Command, withMainDb: WithDb) {
  const cmd = program.command("keys").description("Clients' own keys, sealed (never shown)");

  cmd
    .command("list")
    .argument("<client>")
    .description("A client's keys: name, last 4, version, when and by whom")
    .action(async (client: string) => {
      const rows = await withMainDb(async (db) => {
        await getClient(db, client);
        return db
          .select({
            ref: clientSecrets.id,
            name: clientSecrets.name,
            last4: clientSecrets.last4,
            version: clientSecrets.version,
            at: clientSecrets.updatedAt,
            by: clientSecrets.updatedBy,
          })
          .from(clientSecrets)
          .where(and(eq(clientSecrets.client, client), eq(clientSecrets.state, "live")));
      });
      if (!rows.length) console.log("No keys.");
      for (const r of rows)
        console.log(
          `${r.ref}\t${r.name}\t…${r.last4}\tv${r.version}\t${r.at.toISOString()}\t${r.by}`,
        );
    });

  cmd
    .command("put")
    .argument("<client>")
    .argument("<name>", "MAIL_GOOGLE_CLIENT_SECRET, STRIPE_SECRET_KEY, …")
    .description("Seal the value on stdin as a client's key (Wren's own under the client wren)")
    .action(async (client: string, name: string) => {
      const value = await stdin();
      const info = await withMainDb(async (db) => {
        await getClient(db, client);
        return pgKeyStore(db, sealer()).put({ client, name, value, by: BY });
      });
      console.log(`${info.ref}\t${info.name}\t…${info.last4}\tv${info.version}`);
    });

  cmd
    .command("delete")
    .argument("<client>")
    .argument("<ref>")
    .description("Remove a key by its ref")
    .action(async (client: string, ref: string) => {
      const gone = await withMainDb((db) =>
        pgKeyStore(db, sealer()).delete({ client, ref, by: BY }),
      );
      console.log(gone ? "Removed." : "No such key.");
    });

  cmd
    .command("rewrap")
    .description("After a new private key goes first: every data key sealed for it")
    .action(async () => {
      const spec = process.env.WREN_KEYSTORE_KEY;
      if (!spec) throw new Error("WREN_KEYSTORE_KEY isn't set: run it under scripts/secrets.mjs.");
      const n = await withMainDb((db) => rewrapAll(db, keyRing(spec)));
      console.log(`Rewrapped ${n}.`);
    });
}
