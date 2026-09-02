import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { CONTENT_TEXT_SELECTOR, prepareContentRoot } from "./contentRoot.js";
import { fetchBytes, type FetchOptions } from "./fetchPage.js";
import { log } from "./log.js";
import { normalizeHref, normalizeText } from "./normalize.js";
import type { ContentModel, ExtractResult, ImageItem, LinkItem, TextBlock } from "./types.js";

export async function extractContentModel(
  html: string,
  pageUrl: string,
  options: FetchOptions = {},
): Promise<ExtractResult> {
  const $ = cheerio.load(html);
  $("script, style").remove();

  const rootEl = prepareContentRoot($);

  if (!rootEl.length) {
    return { ok: false, error: "missing extraction root" };
  }

  const texts: TextBlock[] = [];
  const headings = { h1: "", h2: "", h3: "" };
  findInScope(rootEl, CONTENT_TEXT_SELECTOR).each((_, el) => {
    const node = $(el);
    if (node.attr("hidden") !== undefined) return;
    if (node.find(CONTENT_TEXT_SELECTOR).length) return;
    const text = normalizeText(node.text());
    if (!text) return;
    const tag = ((el as { tagName?: string }).tagName ?? "").toLowerCase();
    const where = headingWhere(headings, tag, text);
    texts.push({ text, where });
  });

  const links: LinkItem[] = [];
  findInScope(rootEl, "a[href]").each((_, el) => {
    const node = $(el);
    if (node.attr("hidden") !== undefined) return;
    const hrefRaw = node.attr("href") ?? "";
    const href = normalizeHref(hrefRaw, pageUrl);
    if (!href) return;
    const text = linkLabel(node);
    if (!text) return;
    const where = nearestHeading($, node) || text;
    links.push({ text, href, where });
  });

  const images: ImageItem[] = [];
  const imgNodes = findInScope(rootEl, "img[src]").toArray();
  for (const el of imgNodes) {
    const node = $(el);
    if (node.attr("hidden") !== undefined) continue;
    const srcAttr = node.attr("src") ?? "";
    const alt = normalizeText(node.attr("alt") ?? "");
    let absoluteSrc: string;
    try {
      absoluteSrc = new URL(srcAttr, pageUrl).toString();
    } catch {
      images.push({ alt, hash: null, src: srcAttr, error: "invalid src" });
      continue;
    }
    const fetched = await fetchBytes(absoluteSrc, options);
    if (!fetched.ok) {
      images.push({ alt, hash: null, src: absoluteSrc, error: fetched.error });
      continue;
    }
    const hash = createHash("sha256").update(fetched.bytes).digest("hex");
    log.debug("fetch image", { url: absoluteSrc, hash: hash.slice(0, 12), bytes: fetched.bytes.length });
    images.push({ alt, hash, src: absoluteSrc });
  }

  const model: ContentModel = { texts, links, images };
  return { ok: true, model };
}

function findInScope(root: ReturnType<typeof prepareContentRoot>, selector: string) {
  return root.filter(selector).add(root.find(selector));
}

function headingWhere(
  headings: { h1: string; h2: string; h3: string },
  tag: string,
  text: string,
): string {
  if (tag === "h1") {
    headings.h1 = text;
    headings.h2 = "";
    headings.h3 = "";
    return text;
  }
  if (tag === "h2") {
    headings.h2 = text;
    headings.h3 = "";
    return [headings.h1, text].filter(Boolean).join(" › ") || text;
  }
  if (tag === "h3") {
    headings.h3 = text;
    return [headings.h1, headings.h2].filter(Boolean).join(" › ") || text;
  }
  return headings.h3 || headings.h2 || headings.h1 || text;
}

function nearestHeading(
  $: cheerio.CheerioAPI,
  node: ReturnType<typeof prepareContentRoot>,
): string {
  const inner = node.find("h1, h2, h3").first();
  if (inner.length) {
    const titled = normalizeText(inner.text());
    if (titled) return titled;
  }
  let cur = node;
  while (cur.length) {
    const prev = cur.prevAll("h1, h2, h3").first();
    if (prev.length) {
      const titled = normalizeText(prev.text());
      if (titled) return titled;
    }
    cur = cur.parent();
    if (cur.is("body") || cur.is("html")) break;
  }
  return "";
}

function linkLabel(node: ReturnType<typeof prepareContentRoot>): string {
  const heading = node.find("h1, h2, h3").first();
  if (heading.length) {
    const titled = normalizeText(heading.text());
    if (titled) return titled;
  }
  const own = normalizeText(node.text());
  if (own) return own;
  const aria = normalizeText(node.attr("aria-label") ?? "");
  if (aria) return aria;
  return normalizeText(node.find("img[alt]").attr("alt") ?? "");
}
