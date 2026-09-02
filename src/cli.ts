import "./loadEnv.js";
import path from "node:path";
import { checkAll } from "./check.js";
import { loadMapping } from "./mapping.js";
import { printTerminalReport, writeHtmlReport } from "./report.js";

const OLD_ORIGIN = process.env.OLD_ORIGIN ?? "http://127.0.0.1:4173";
const NEW_ORIGIN = process.env.NEW_ORIGIN ?? "http://127.0.0.1:4174";
const MAPPING = process.env.MAPPING ?? path.resolve("fixtures/mapping.csv");
const REPORT = process.env.REPORT ?? path.resolve("reports/latest.html");

async function main(): Promise<number> {
  const mapping = await loadMapping(MAPPING);
  if (!mapping.ok) {
    console.error(mapping.error);
    return 1;
  }

  const results = await checkAll(OLD_ORIGIN, NEW_ORIGIN, mapping.pairs, {
    allowPrivate: process.env.ALLOW_PRIVATE_ORIGINS === "1",
  });
  printTerminalReport(results);
  await writeHtmlReport(results, REPORT);
  console.log(`HTML report: ${REPORT}`);

  return results.every((r) => r.status === "pass") ? 0 : 1;
}

const code = await main();
process.exit(code);
