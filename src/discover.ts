import { fetchSafe, type FetchOptions } from "./fetchPage.js";
import { log } from "./log.js";
import { isSafeHttpPath } from "./origins.js";
import type { MappingPair } from "./types.js";

export const DEFAULT_MAX_PAGES = 25;

export type DiscoverSource = "csv" | "sitemap" | "single";

export type DiscoverResult = {
  pairs: MappingPair[];
  source: DiscoverSource;
  truncated: boolean;
  note?: string;
};

export type ParseCsvResult =
  | { ok: true; pairs: MappingPair[] }
  | { ok: false; error: string };

/** Same format as fixtures/mapping.csv, but parsed from an upload instead of disk. */
export function parseMappingCsv(raw: string): ParseCsvResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) return { ok: false, error: "mapping CSV is empty" };

  const header = lines[0].split(",").map((h) => h.trim());
  if (header[0] !== "old_path" || header[1] !== "new_path") {
    return { ok: false, error: "mapping CSV needs headers old_path,new_path" };
  }

  const pairs: MappingPair[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.trim());
    const oldPath = cols[0] ?? "";
    const newPath = cols[1] ?? "";
    if (!isSafeHttpPath(oldPath) || !isSafeHttpPath(newPath)) {
      log.warn("mapping rejected", { oldPath, newPath });
      return { ok: false, error: "mapping CSV has an unsafe path" };
    }
    pairs.push({ oldPath, newPath });
  }

  if (pairs.length === 0) return { ok: false, error: "mapping CSV has no rows" };
  return { ok: true, pairs };
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

async function fetchText(url: string, options: FetchOptions = {}): Promise<string | null> {
  const started = Date.now();
  try {
    const res = await fetchSafe(url, options);
    const text = res.ok ? await res.text() : null;
    log.info("fetch", {
      method: "GET",
      url,
      status: res.status,
      bytes: text?.length ?? 0,
      ms: Date.now() - started,
      kind: "sitemap",
    });
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("fetch", {
      method: "GET",
      url,
      error: message,
      ms: Date.now() - started,
      kind: "sitemap",
    });
    return null;
  }
}

/**
 * Reads /sitemap.xml on the old origin (following one level of sitemap index)
 * and keeps same-host paths. Paths are reused verbatim on the new origin.
 */
export type SitemapPaths = {
  paths: string[];
  total: number;
};

function locToSameHostPath(loc: string, origin: string, originHost: string): string | null {
  let url: URL;
  try {
    url = new URL(loc, origin);
  } catch {
    return null;
  }
  if (url.host !== originHost) return null;
  return `${url.pathname}${url.search}` || "/";
}

export async function pathsFromSitemap(
  origin: string,
  maxPages: number = DEFAULT_MAX_PAGES,
  options: FetchOptions = {},
): Promise<SitemapPaths> {
  const fetchOpts = { ...options, expectedOrigin: origin };
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();
  const rootXml = await fetchText(sitemapUrl, fetchOpts);
  if (!rootXml) {
    log.info("discover sitemap", { url: sitemapUrl, status: "missing" });
    return { paths: [], total: 0 };
  }

  const originHost = new URL(origin).host;
  const locs = extractLocs(rootXml);
  const isIndex = /<sitemapindex/i.test(rootXml);

  let pageUrls: string[] = locs;

  if (isIndex) {
    pageUrls = [];
    for (const child of locs.slice(0, 5)) {
      let childUrl: URL;
      try {
        childUrl = new URL(child, origin);
      } catch {
        continue;
      }
      if (childUrl.host !== originHost) {
        log.warn("discover skip", { loc: child, reason: "other host" });
        continue;
      }
      const childXml = await fetchText(childUrl.toString(), fetchOpts);
      if (childXml) pageUrls.push(...extractLocs(childXml));
    }
  }

  const all: string[] = [];
  const seen = new Set<string>();
  for (const loc of pageUrls) {
    const path = locToSameHostPath(loc, origin, originHost);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    all.push(path);
  }

  return { paths: all.slice(0, maxPages), total: all.length };
}

/**
 * Decides which pages a job compares: uploaded CSV wins, then the old site's
 * sitemap, then just the two paths the user typed.
 */
export async function discoverPairs(options: {
  oldOrigin: string;
  oldPath: string;
  newPath: string;
  mappingCsv?: string;
  maxPages?: number;
  allowPrivate?: boolean;
}): Promise<DiscoverResult | { error: string }> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  if (options.mappingCsv && options.mappingCsv.trim()) {
    const parsed = parseMappingCsv(options.mappingCsv);
    if (!parsed.ok) return { error: parsed.error };
    const truncated = parsed.pairs.length > maxPages;
    const pairs = parsed.pairs.slice(0, maxPages);
    log.info("discover", { source: "csv", pairCount: pairs.length, truncated });
    return { pairs, source: "csv", truncated };
  }

  const sitemap = await pathsFromSitemap(options.oldOrigin, maxPages, {
    allowPrivate: options.allowPrivate,
  });
  if (sitemap.paths.length > 0) {
    const truncated = sitemap.total > maxPages;
    log.info("discover", {
      source: "sitemap",
      pairCount: sitemap.paths.length,
      truncated,
    });
    return {
      pairs: sitemap.paths.map((p) => ({ oldPath: p, newPath: p })),
      source: "sitemap",
      truncated,
    };
  }

  log.info("discover", { source: "single", pairCount: 1, truncated: false });
  return {
    pairs: [{ oldPath: options.oldPath || "/", newPath: options.newPath || "/" }],
    source: "single",
    truncated: false,
    note: "No sitemap.xml found, so only the entered pages were compared.",
  };
}
