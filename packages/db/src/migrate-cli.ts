import { loadEnvFile, loadSettings } from "@wren/config";
import { clientDatabases, migrateClient } from "./clients.js";
import { createDb, migrate } from "./index.js";

// Main first (it owns the registry), then every client database: one schema everywhere.
const root = loadEnvFile();
const url = loadSettings(process.env, { rootDir: root }).databaseUrl;
const handle = createDb(url, { max: 1, app: "wren-migrate" });
try {
  await migrate(handle.db);
  console.log("migrations applied: main");
  for (const database of await clientDatabases(handle.db)) {
    await migrateClient(url, database);
    console.log(`migrations applied: ${database}`);
  }
} finally {
  await handle.close();
}
