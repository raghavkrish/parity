import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";

export const CHROME_SELECTOR = [
  "header",
  "footer",
  "nav",
  "[role=banner]",
  "[role=contentinfo]",
  ".site-header",
  ".site-footer",
  ".c-main-nav",
  ".c-breadcrumbs",
  "#_breadcrumbs",
  ".c-comp-accessibility",
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
].join(", ");

export const CONTENT_ROOT_SELECTORS = [
  "[data-content]",
  "[role=main]",
  "#site-content",
  "main",
] as const;

export const CONTENT_TEXT_SELECTOR = "h1, h2, h3, p, li, td, th, button";

export function stripChrome($: CheerioAPI): void {
  $(CHROME_SELECTOR).remove();
}

export function selectContentRoot($: CheerioAPI): Cheerio<Element> {
  for (const sel of CONTENT_ROOT_SELECTORS) {
    const el = $(sel).first();
    if (el.length) return el.add(el.nextAll());
  }
  return $("body").first();
}

export function prepareContentRoot($: CheerioAPI): Cheerio<Element> {
  stripChrome($);
  return selectContentRoot($);
}
