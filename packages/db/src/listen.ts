/**
 * LISTEN on one database: one connection of its own that stays open and comes back by itself
 * after a drop (postgres.js re-listens on reconnect). Never through PgBouncer: a pooled session
 * loses its LISTEN between transactions.
 */
import postgres from "postgres";

export interface Listening {
  close(): Promise<void>;
}

export async function listen(
  databaseUrl: string,
  channel: string,
  onPayload: (payload: string) => void,
  opts: { app?: string } = {},
): Promise<Listening> {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    ...(opts.app ? { connection: { application_name: opts.app.slice(0, 63) } } : {}),
  });
  await sql.listen(channel, onPayload);
  return { close: () => sql.end({ timeout: 5 }) };
}
