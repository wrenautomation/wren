import { loadEnvFile, loadSettings } from "@wren/config";
import { clientDatabases, migrateClients } from "./clients.js";
import { createDb, migrate } from "./index.js";

// Main first (it owns the registry), then every client database at once: one schema everywhere.
const root = loadEnvFile();
const url = loadSettings(process.env, { rootDir: root }).databaseUrl;
const handle = createDb(url, { max: 1, app: "wren-migrate" });
try {
  await migrate(handle.db);
  console.log("migrations applied: main");
  await migrateClients(url, await clientDatabases(handle.db), (database) =>
    console.log(`migrations applied: ${database}`),
  );
} finally {
  await handle.close();
}
