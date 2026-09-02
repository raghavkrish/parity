import "./loadEnv.js";
import { closeMongo, connectMongo, ensureIndexes } from "./db/mongo.js";
import { log } from "./log.js";
import { createRunStore } from "./runStore.js";
import { createApp } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const db = await connectMongo();
await ensureIndexes(db);
const store = createRunStore(db);
await store.failStaleRuns("interrupted");
const app = createApp({ store });

const server = app.listen(port, host, () => {
  log.info("listen", { host, port, url: `http://${host}:${port}` });
});

async function shutdown(signal: string): Promise<void> {
  log.info("shutdown", { signal });
  server.close();
  await closeMongo();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
