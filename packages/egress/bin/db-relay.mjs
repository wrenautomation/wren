#!/usr/bin/env node
// Locked roles reach loopback only (Seatbelt cannot pin a remote IP), so prod's database comes
// through here: 127.0.0.1:<port> to WREN_DATABASE_URL's host and port, nothing else. TLS stays
// end to end. Usage: db-relay.mjs <port> <env file>. Prints no value from the file.
import { readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { parse } from "../../../scripts/secrets.mjs";

const [port, file] = process.argv.slice(2);
if (!port || !file) {
  console.error("db-relay.mjs <port> <env file>");
  process.exit(2);
}
const url = new URL(parse(readFileSync(file, "utf8")).WREN_DATABASE_URL);
const to = { host: url.hostname, port: Number(url.port || 5432) };

createServer((a) => {
  const b = connect(to);
  a.pipe(b).pipe(a);
  const end = () => {
    a.destroy();
    b.destroy();
  };
  a.on("error", end);
  b.on("error", (e) => {
    console.error(`db-relay: ${e.code ?? e.message}`);
    end();
  });
  a.on("close", end);
  b.on("close", end);
}).listen(Number(port), "127.0.0.1", () => console.error(`db-relay: 127.0.0.1:${port} up`));
