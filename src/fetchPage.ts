import { log } from "./log.js";
import { assertSafeUrl, isSafeHttpPath, type ParseSiteUrlOptions } from "./origins.js";
import type { FetchResult } from "./types.js";

export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;

export type FetchOptions = ParseSiteUrlOptions & {
  expectedOrigin?: string;
};

async function readCapped(res: Response, max = FETCH_MAX_BYTES): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    throw new Error("response too large");
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error("response too large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchSafe(
  input: string | URL,
  options: FetchOptions = {},
): Promise<Response> {
  let current = typeof input === "string" ? new URL(input) : new URL(input.toString());
  for (let hop = 0; hop < 5; hop++) {
    const safe = await assertSafeUrl(current, options);
    if (!safe.ok) {
      throw new Error(safe.error);
    }
    const res = await fetch(safe.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect without location");
      const next = new URL(location, safe.url);
      log.debug("redirect", {
        from: safe.url.toString(),
        to: next.toString(),
        status: res.status,
        hop,
      });
      current = next;
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

export async function fetchPage(
  origin: string,
  path: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  if (!isSafeHttpPath(path)) {
    log.warn("fetch", {
      origin,
      path,
      error: "path must be a same-origin absolute path",
      kind: "page",
    });
    return { ok: false, status: 0, error: "path must be a same-origin absolute path" };
  }
  const url = new URL(path, origin.endsWith("/") ? origin : `${origin}/`);
  const started = Date.now();
  try {
    const res = await fetchSafe(url, { ...options, expectedOrigin: origin });
    const bytes = await readCapped(res);
    const html = bytes.toString("utf8");
    log.info("fetch", {
      method: "GET",
      url: url.toString(),
      status: res.status,
      bytes: bytes.length,
      ms: Date.now() - started,
      kind: "page",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, html, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const level = /too large|timeout|aborted/i.test(message) ? "warn" : "info";
    log[level]("fetch", {
      method: "GET",
      url: url.toString(),
      error: message,
      ms: Date.now() - started,
      kind: "page",
    });
    return { ok: false, status: 0, error: message };
  }
}

export async function fetchBytes(
  url: string,
  options: FetchOptions = {},
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const res = await fetchSafe(url, options);
    if (!res.ok) {
      log.warn("fetch", {
        method: "GET",
        url,
        status: res.status,
        error: `HTTP ${res.status}`,
        ms: Date.now() - started,
        kind: "bytes",
      });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const bytes = await readCapped(res);
    log.debug("fetch", {
      method: "GET",
      url,
      status: res.status,
      bytes: bytes.length,
      ms: Date.now() - started,
      kind: "bytes",
    });
    return { ok: true, bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("fetch", {
      method: "GET",
      url,
      error: message,
      ms: Date.now() - started,
      kind: "bytes",
    });
    return { ok: false, error: message };
  }
}
