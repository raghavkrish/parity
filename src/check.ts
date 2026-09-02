import type { Browser } from "playwright";
import { chromium } from "playwright";
import { diffLayouts, diffModels } from "./diff.js";
import { extractContentModel } from "./extract.js";
import { fetchPage } from "./fetchPage.js";
import { createBrowserPage, extractLayoutBoxes, extractLayoutFromHtml } from "./layout.js";
import { log } from "./log.js";
import { isSafeHttpPath } from "./origins.js";
import type { MappingPair, PageResult } from "./types.js";

export type CheckOptions = {
  browser?: Browser;
  allowPrivate?: boolean;
  index?: number;
  total?: number;
  html?: { old: string; new: string };
};

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function checkPair(
  oldOrigin: string,
  newOrigin: string,
  pair: MappingPair,
  options: CheckOptions = {},
): Promise<PageResult> {
  const { oldPath, newPath } = pair;
  const fetchOpts = { allowPrivate: options.allowPrivate };
  const index = options.index;
  const total = options.total;

  let oldUrl = oldPath;
  let newUrl = newPath;
  try {
    oldUrl = new URL(oldPath, oldOrigin).toString();
  } catch {
    /* keep path */
  }
  try {
    newUrl = new URL(newPath, newOrigin).toString();
  } catch {
    /* keep path */
  }

  const finish = (
    status: PageResult["status"],
    mismatches: PageResult["mismatches"],
    errorReason?: string,
  ): PageResult => {
    log.info("compare result", {
      oldUrl,
      newUrl,
      oldPath,
      newPath,
      status,
      mismatches: [...new Set(mismatches.map((m) => m.kind))],
      errorReason,
      index,
      total,
    });
    return errorReason === undefined
      ? { oldPath, newPath, status, mismatches }
      : { oldPath, newPath, status, mismatches, errorReason };
  };

  log.info("compare start", { oldUrl, newUrl, oldPath, newPath, index, total });

  if (!isSafeHttpPath(oldPath) || !isSafeHttpPath(newPath)) {
    return finish("error", [], "invalid mapping row");
  }

  let oldHtml: string;
  let newHtml: string;
  if (options.html) {
    oldHtml = options.html.old;
    newHtml = options.html.new;
  } else {
    const [oldFetch, newFetch] = await Promise.all([
      fetchPage(oldOrigin, oldPath, fetchOpts),
      fetchPage(newOrigin, newPath, fetchOpts),
    ]);

    if (!oldFetch.ok || !newFetch.ok) {
      const reasons = [
        !oldFetch.ok ? `old: ${oldFetch.error}` : null,
        !newFetch.ok ? `new: ${newFetch.error}` : null,
      ].filter(Boolean);
      return finish("error", [], reasons.join("; "));
    }
    oldHtml = oldFetch.html;
    newHtml = newFetch.html;
  }

  const [oldExtract, newExtract] = await Promise.all([
    extractContentModel(oldHtml, oldUrl, fetchOpts),
    extractContentModel(newHtml, newUrl, fetchOpts),
  ]);

  if (!oldExtract.ok || !newExtract.ok) {
    const reasons = [
      !oldExtract.ok ? `old: ${oldExtract.error}` : null,
      !newExtract.ok ? `new: ${newExtract.error}` : null,
    ].filter(Boolean);
    return finish("error", [], reasons.join("; "));
  }

  const mismatches = diffModels(oldExtract.model, newExtract.model);

  const runLayout = async (browser: Browser) => {
    const page = await createBrowserPage(browser);
    try {
      const oldLayout = options.html
        ? await extractLayoutFromHtml(page, options.html.old, oldUrl)
        : await extractLayoutBoxes(page, oldUrl);
      const newLayout = options.html
        ? await extractLayoutFromHtml(page, options.html.new, newUrl)
        : await extractLayoutBoxes(page, newUrl);
      if (!oldLayout.ok || !newLayout.ok) {
        return {
          error: [
            !oldLayout.ok ? `old layout: ${oldLayout.error}` : null,
            !newLayout.ok ? `new layout: ${newLayout.error}` : null,
          ]
            .filter(Boolean)
            .join("; "),
        } as const;
      }
      return {
        layoutMismatches: diffLayouts(oldLayout.boxes, newLayout.boxes),
      } as const;
    } finally {
      await page.close();
    }
  };

  let layoutResult: Awaited<ReturnType<typeof runLayout>>;
  if (options.browser) {
    layoutResult = await runLayout(options.browser);
  } else {
    layoutResult = await withBrowser(runLayout);
  }

  if ("error" in layoutResult) {
    return finish(mismatches.length ? "fail" : "error", mismatches, layoutResult.error);
  }

  mismatches.push(...layoutResult.layoutMismatches);

  return finish(mismatches.length ? "fail" : "pass", mismatches);
}

export async function checkAll(
  oldOrigin: string,
  newOrigin: string,
  pairs: MappingPair[],
  options: CheckOptions = {},
): Promise<PageResult[]> {
  const run = async (browser: Browser) => {
    const results: PageResult[] = [];
    for (let i = 0; i < pairs.length; i++) {
      results.push(
        await checkPair(oldOrigin, newOrigin, pairs[i], {
          ...options,
          browser,
          index: i + 1,
          total: pairs.length,
        }),
      );
    }
    return results;
  };

  if (options.browser) {
    return run(options.browser);
  }
  return withBrowser(run);
}
