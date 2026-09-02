import type { Browser, Page } from "playwright";
import { CHROME_SELECTOR, CONTENT_ROOT_SELECTORS } from "./contentRoot.js";
import { log } from "./log.js";
import type { LayoutBox } from "./types.js";

export const LAYOUT_VIEWPORT = { width: 1280, height: 800 } as const;
export const LAYOUT_EPSILON_PX = 2;
export const LAYOUT_WAIT_UNTIL = "load" as const;

const LAYOUT_SELECTOR =
  'h1, h2, h3, p, li, td, th, button, a[href], img[src]';

export type LayoutExtractResult =
  | { ok: true; boxes: LayoutBox[] }
  | { ok: false; error: string };

export async function createBrowserPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    viewport: LAYOUT_VIEWPORT,
  });
  return page;
}

export async function extractLayoutBoxes(
  page: Page,
  url: string,
): Promise<LayoutExtractResult> {
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: LAYOUT_WAIT_UNTIL, timeout: 30_000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });

    const boxes = await page.evaluate(
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
          .filter((el) => !el.hasAttribute("hidden"))
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

    if (boxes === null) {
      log.info("layout", {
        url,
        waitUntil: LAYOUT_WAIT_UNTIL,
        ms: Date.now() - started,
        ok: false,
        error: "missing extraction root",
      });
      return { ok: false, error: "missing extraction root" };
    }
    log.info("layout", {
      url,
      waitUntil: LAYOUT_WAIT_UNTIL,
      ms: Date.now() - started,
      ok: true,
      boxes: boxes.length,
    });
    return { ok: true, boxes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info("layout", {
      url,
      waitUntil: LAYOUT_WAIT_UNTIL,
      ms: Date.now() - started,
      ok: false,
      error: message,
    });
    return { ok: false, error: message };
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
