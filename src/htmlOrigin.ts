import * as cheerio from "cheerio";
import { parseSiteUrl, type ParseSiteUrlOptions, type ParseSiteUrlResult } from "./origins.js";

export function inferPageUrlFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const raw = $("link[rel='canonical']").attr("href") ?? $("base").attr("href");
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function withBaseHref(html: string, origin: string): string {
  const href = origin.endsWith("/") ? origin : `${origin}/`;
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${href}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return `${tag}${html}`;
}

export async function resolveUploadSite(
  html: string,
  typedUrl: string,
  options: ParseSiteUrlOptions & { label: string },
): Promise<ParseSiteUrlResult> {
  const inferred = inferPageUrlFromHtml(html);
  const candidate = inferred ?? typedUrl.trim();
  if (!candidate) {
    return {
      ok: false,
      error: `${options.label} HTML has no canonical or base URL. Type the site URL so images and CSS can resolve.`,
    };
  }
  const parsed = await parseSiteUrl(candidate, options);
  if (!parsed.ok) {
    return { ok: false, error: `${options.label} site: ${parsed.error}` };
  }
  return parsed;
}
