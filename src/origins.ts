import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { log } from "./log.js";

export type ParsedSiteUrl = {
  origin: string;
  path: string;
};

export type ParseSiteUrlResult =
  | ({ ok: true } & ParsedSiteUrl)
  | { ok: false; error: string };

export type ParseSiteUrlOptions = {
  allowPrivate?: boolean;
};

export type SafeUrlResult = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "metadata.google.internal",
  "metadata.google.internal.",
  "metadata",
  "metadata.internal",
]);

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (start: string, end: string) => {
    const a = ipv4ToInt(start);
    const b = ipv4ToInt(end);
    return a !== null && b !== null && n >= a && n <= b;
  };
  return (
    inRange("0.0.0.0", "0.255.255.255") ||
    inRange("10.0.0.0", "10.255.255.255") ||
    inRange("127.0.0.0", "127.255.255.255") ||
    inRange("169.254.0.0", "169.254.255.255") ||
    inRange("172.16.0.0", "172.31.255.255") ||
    inRange("192.168.0.0", "192.168.255.255")
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]);
  return false;
}

export function isMetadataHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized.includes("metadata")) return true;
  if (normalized === "169.254.169.254") return true;
  const kind = isIP(normalized);
  if (kind === 4) {
    const n = ipv4ToInt(normalized);
    const start = ipv4ToInt("169.254.0.0");
    const end = ipv4ToInt("169.254.255.255");
    return n !== null && start !== null && end !== null && n >= start && n <= end;
  }
  return false;
}

export function isBlockedHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (isMetadataHost(normalized)) return true;
  if (BLOCKED_HOSTS.has(normalized)) return true;
  const kind = isIP(normalized);
  if (kind === 4) return isPrivateIpv4(normalized);
  if (kind === 6) return isPrivateIpv6(normalized);
  return false;
}

export function isSafeHttpPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

export async function assertSafeUrl(
  input: string | URL,
  options: ParseSiteUrlOptions & { expectedOrigin?: string } = {},
): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.toString());
  } catch {
    const reason = "invalid URL";
    log.warn("url rejected", { url: String(input), reason });
    return { ok: false, error: reason };
  }

  const reject = (reason: string): SafeUrlResult => {
    log.warn("url rejected", { url: url.toString(), reason });
    return { ok: false, error: reason };
  };

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("Only http and https URLs are allowed");
  }

  if (!url.hostname) {
    return reject("URL is missing a hostname");
  }

  if (isMetadataHost(url.hostname)) {
    return reject("Private, loopback, and metadata hosts are blocked");
  }

  if (options.expectedOrigin) {
    const expected = new URL(options.expectedOrigin);
    if (url.host !== expected.host || url.protocol !== expected.protocol) {
      return reject("URL is not on the compared origin");
    }
  }

  const allowPrivate = options.allowPrivate === true;
  if (!allowPrivate) {
    if (isBlockedHost(url.hostname)) {
      return reject("Private, loopback, and metadata hosts are blocked");
    }
    if (!isIP(normalizeHost(url.hostname))) {
      try {
        const { address } = await lookup(url.hostname, { all: false });
        if (isBlockedHost(address)) {
          return reject("That hostname resolves to a private address");
        }
      } catch {
        return reject("Could not resolve hostname");
      }
    }
  }

  return { ok: true, url };
}

export async function parseSiteUrl(
  input: string,
  options: ParseSiteUrlOptions = {},
): Promise<ParseSiteUrlResult> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "URL is required" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a full http(s) URL, e.g. https://example.com" };
  }

  const safe = await assertSafeUrl(url, options);
  if (!safe.ok) return safe;

  const path = `${safe.url.pathname || "/"}${safe.url.search}` || "/";
  return { ok: true, origin: safe.url.origin, path };
}
