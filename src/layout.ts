import type { Browser, Page } from "playwright";
import {
  CHROME_SELECTOR,
  CONTENT_ROOT_SELECTORS,
  CONTENT_TEXT_SELECTOR,
} from "./contentRoot.js";
import { withBaseHref } from "./htmlOrigin.js";
import { log } from "./log.js";
import type { LayoutBox } from "./types.js";

export const LAYOUT_VIEWPORT = { width: 1280, height: 800 } as const;
export const LAYOUT_EPSILON_PX = 2;
export const LAYOUT_WAIT_UNTIL = "load" as const;

const LAYOUT_SELECTOR = `${CONTENT_TEXT_SELECTOR}, a[href], img[src]`;

export type LayoutExtractResult =
  | { ok: true; boxes: LayoutBox[] }
  | { ok: false; error: string };

export async function createBrowserPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    viewport: LAYOUT_VIEWPORT,
  });
  return page;
}

async function collectLayoutBoxes(page: Page): Promise<LayoutBox[] | null> {
  return page.evaluate(
    ({ chrome, roots, selector }) => {
      document.querySelectorAll(chrome).forEach((el) => el.remove());
      let root: HTMLElement | null = null;
      for (const sel of roots) {
        root = document.querySelector(sel) as HTMLElement | null;
        if (root) break;
      }
      if (!root) root = document.body;
      if (!root) return null;

      const rootRect = root.getBoundingClientRect();
      const nodes = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
      return nodes
        .filter((el) => !el.hasAttribute("hidden") && !el.querySelector(selector))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            x: Math.round(r.left - rootRect.left),
            y: Math.round(r.top - rootRect.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        });
    },
    {
      chrome: CHROME_SELECTOR,
      roots: [...CONTENT_ROOT_SELECTORS],
      selector: LAYOUT_SELECTOR,
    },
  );
}

async function measureLoadedPage(
  page: Page,
  started: number,
  label: string,
): Promise<LayoutExtractResult> {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  const boxes = await collectLayoutBoxes(page);
  if (boxes === null) {
    log.info("layout", {
      url: label,
      waitUntil: LAYOUT_WAIT_UNTIL,
      ms: Date.now() - started,
      ok: false,
      error: "missing extraction root",
    });
    return { ok: false, error: "missing extraction root" };
  }
  log.info("layout", {
    url: label,
    waitUntil: LAYOUT_WAIT_UNTIL,
    ms: Date.now() - started,
    ok: true,
    boxes: boxes.length,
  });
  return { ok: true, boxes };
}

function layoutError(started: number, label: string, err: unknown): LayoutExtractResult {
  const message = err instanceof Error ? err.message : String(err);
  log.info("layout", {
    url: label,
    waitUntil: LAYOUT_WAIT_UNTIL,
    ms: Date.now() - started,
    ok: false,
    error: message,
  });
  return { ok: false, error: message };
}

export async function extractLayoutBoxes(
  page: Page,
  url: string,
): Promise<LayoutExtractResult> {
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: LAYOUT_WAIT_UNTIL, timeout: 30_000 });
    return await measureLoadedPage(page, started, url);
  } catch (err) {
    return layoutError(started, url, err);
  }
}

export async function extractLayoutFromHtml(
  page: Page,
  html: string,
  baseOrigin: string,
): Promise<LayoutExtractResult> {
  const started = Date.now();
  const label = `${baseOrigin} (upload)`;
  try {
    await page.setContent(withBaseHref(html, baseOrigin), {
      waitUntil: LAYOUT_WAIT_UNTIL,
      timeout: 30_000,
    });
    return await measureLoadedPage(page, started, label);
  } catch (err) {
    return layoutError(started, label, err);
  }
}

export function summarizeLayoutBox(box: LayoutBox): string {
  return `${box.tag} @(${box.x},${box.y}) ${box.w}x${box.h}`;
}

export function layoutBoxesEqual(
  a: LayoutBox,
  b: LayoutBox,
  epsilon = LAYOUT_EPSILON_PX,
): boolean {
  if (a.tag !== b.tag) return false;
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon &&
    Math.abs(a.h - b.h) <= epsilon
  );
}
