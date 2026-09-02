import "./loadEnv.js";
import path from "node:path";
import { checkAll } from "./check.js";
import { loadMapping } from "./mapping.js";
import { printTerminalReport, writeHtmlReport } from "./report.js";
import { fixturesRoot, startStaticServer } from "./serve.js";

const OLD_PORT = Number(process.env.OLD_PORT ?? 4173);
const NEW_PORT = Number(process.env.NEW_PORT ?? 4174);
const MAPPING = process.env.MAPPING ?? path.resolve("fixtures/mapping.csv");
const REPORT = process.env.REPORT ?? path.resolve("reports/latest.html");

async function main(): Promise<number> {
  const root = fixturesRoot();
  const oldServer = await startStaticServer(path.join(root, "old-site"), OLD_PORT);
  const newServer = await startStaticServer(path.join(root, "new-site"), NEW_PORT);

  console.log(`Old site: ${oldServer.origin}`);
  console.log(`New site: ${newServer.origin}`);

  try {
    const mapping = await loadMapping(MAPPING);
    if (!mapping.ok) {
      console.error(mapping.error);
      return 1;
    }

    const results = await checkAll(oldServer.origin, newServer.origin, mapping.pairs, {
      allowPrivate: true,
    });
    printTerminalReport(results);
    await writeHtmlReport(results, REPORT);
    console.log(`HTML report: ${REPORT}`);

    const holdMs = Number(process.env.DEMO_HOLD_MS ?? 60_000);
    if (holdMs > 0) {
      console.log("\nOpen the mock sites while servers are up:");
      console.log(`  ${oldServer.origin}/index.html`);
      console.log(`  ${newServer.origin}/index.html`);
      console.log(
        `Demo servers stay running for ${Math.round(holdMs / 1000)}s so you can compare in a browser...`,
      );
      await new Promise((r) => setTimeout(r, holdMs));
    }

    return results.every((r) => r.status === "pass") ? 0 : 1;
  } finally {
    await Promise.all([oldServer.close(), newServer.close()]);
  }
}

const code = await main();
process.exit(code);
