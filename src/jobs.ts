import type { Browser } from "playwright";
import { chromium } from "playwright";
import { checkAll } from "./check.js";
import { log, withLogContext } from "./log.js";
import { renderHtmlReport } from "./report.js";
import { renderPdf } from "./pdf.js";
import type { MappingPair, PageResult } from "./types.js";
import type { DiscoverSource } from "./discover.js";
import type { RunStore, RunSummary } from "./runStore.js";

export function summarizeResults(results: PageResult[]): RunSummary {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    error: results.filter((r) => r.status === "error").length,
  };
}

export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Run timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "RunTimeoutError";
  }
}

export async function runWithBrowserTimeout<T>(
  timeoutMs: number,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log.warn("run timeout", { timeoutMs });
    void browser.close();
  }, timeoutMs);
  try {
    const result = await fn(browser);
    if (timedOut) throw new RunTimeoutError(timeoutMs);
    return result;
  } catch (err) {
    if (timedOut) throw new RunTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}

export type ExecuteRunInput = {
  store: RunStore;
  runId: string;
  oldOrigin: string;
  newOrigin: string;
  pairs: MappingPair[];
  timeoutMs: number;
  allowPrivate?: boolean;
  source?: DiscoverSource;
  html?: { old: string; new: string };
};

export async function executeRun(input: ExecuteRunInput): Promise<void> {
  const { store, runId, oldOrigin, newOrigin, pairs, timeoutMs, allowPrivate, source, html: uploadedHtml } = input;
  await withLogContext({ runId }, async () => {
    log.info("run start", {
      oldOrigin,
      newOrigin,
      pairCount: pairs.length,
      timeoutMs,
      source,
    });
    try {
      const output = await runWithBrowserTimeout(timeoutMs, async (browser) => {
        const results = await checkAll(oldOrigin, newOrigin, pairs, {
          browser,
          allowPrivate,
          html: uploadedHtml,
        });
        const html = renderHtmlReport(results);
        const printHtml = renderHtmlReport(results, { printMode: true });
        const pdf = await renderPdf(browser, printHtml);
        return { results, html, printHtml, pdf };
      });

      const summary = summarizeResults(output.results);
      await store.completeRun(runId, {
        results: output.results,
        summary,
        artifacts: {
          html: Buffer.from(output.html),
          printHtml: Buffer.from(output.printHtml),
          pdf: output.pdf,
        },
      });
      log.info("run done", summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("run failed", { error: message });
      await store.failRun(runId, message);
    }
  });
}
