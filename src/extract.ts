import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { prepareContentRoot } from "./contentRoot.js";
import { fetchBytes, type FetchOptions } from "./fetchPage.js";
import { log } from "./log.js";
import { normalizeHref, normalizeText } from "./normalize.js";
import type { ContentModel, ExtractResult, ImageItem, LinkItem, TextBlock } from "./types.js";

const TEXT_SELECTOR = "h1, h2, h3, p, li, td, th, button";

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
  rootEl.find(TEXT_SELECTOR).each((_, el) => {
    const node = $(el);
    if (node.attr("hidden") !== undefined) return;
    const text = normalizeText(node.text());
    if (text) texts.push({ text });
  });

  const links: LinkItem[] = [];
  rootEl.find("a[href]").each((_, el) => {
    const node = $(el);
    if (node.attr("hidden") !== undefined) return;
    const hrefRaw = node.attr("href") ?? "";
    const href = normalizeHref(hrefRaw, pageUrl);
    if (!href) return;
    links.push({ text: normalizeText(node.text()), href });
  });

  const images: ImageItem[] = [];
  const imgNodes = rootEl.find("img[src]").toArray();
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
