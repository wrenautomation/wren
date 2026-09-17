import { loadEnvFile, loadSettings } from "@wren/config";
import { createDb, migrate } from "./index.js";

const root = loadEnvFile();
const handle = createDb(loadSettings(process.env, { rootDir: root }).databaseUrl, { max: 1 });
try {
  await migrate(handle.db);
  console.log("migrations applied");
} finally {
  await handle.close();
}
