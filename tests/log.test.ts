import type { Browser } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/layout.js", async () => {
  const actual = await vi.importActual<typeof import("../src/layout.js")>("../src/layout.js");
  return {
    ...actual,
    createBrowserPage: vi.fn(async () => ({ close: async () => undefined })),
    extractLayoutBoxes: vi.fn(async () => ({ ok: true as const, boxes: [] })),
  };
});

import { checkPair } from "../src/check.js";
import { fetchPage } from "../src/fetchPage.js";
import { log, resetLogSink, setLogSink, withLogContext, type LogRecord } from "../src/log.js";

const originalFetch = globalThis.fetch;
const originalLevel = process.env.LOG_LEVEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.LOG_LEVEL = originalLevel;
  resetLogSink();
});

function capture(): LogRecord[] {
  const records: LogRecord[] = [];
  setLogSink((record) => {
    records.push(record);
  });
  return records;
}

describe("log levels", () => {
  it("suppresses info when LOG_LEVEL=error", () => {
    process.env.LOG_LEVEL = "error";
    const records = capture();
    log.info("compare start", { oldUrl: "https://example.com/a" });
    log.error("run failed", { error: "boom" });
    expect(records.map((r) => r.event)).toEqual(["run failed"]);
  });

  it("includes runId from log context", () => {
    const records = capture();
    withLogContext({ runId: "run-1" }, () => {
      log.info("fetch", { url: "https://example.com/" });
    });
    expect(records).toHaveLength(1);
    expect(records[0].runId).toBe("run-1");
    expect(records[0].event).toBe("fetch");
  });
});

describe("fetch and compare logs", () => {
  it("records fetch and compare start with the concrete URLs", async () => {
    globalThis.fetch = async () =>
      new Response("<html><body><h1>Hello</h1></body></html>", { status: 200 });

    const records = capture();
    await checkPair(
      "https://example.com",
      "https://example.org",
      { oldPath: "/old.html", newPath: "/new.html" },
      { browser: {} as Browser, allowPrivate: true, index: 1, total: 1 },
    );

    const compare = records.find((r) => r.event === "compare start");
    expect(compare).toMatchObject({
      oldUrl: "https://example.com/old.html",
      newUrl: "https://example.org/new.html",
    });

    const fetches = records.filter((r) => r.event === "fetch" && r.kind === "page");
    expect(fetches.map((r) => r.url).sort()).toEqual([
      "https://example.com/old.html",
      "https://example.org/new.html",
    ]);
    expect(fetches.every((r) => r.status === 200)).toBe(true);
  });

  it("logs a page fetch URL from fetchPage", async () => {
    globalThis.fetch = async () => new Response("<html></html>", { status: 200 });
    const records = capture();
    const result = await fetchPage("https://example.com", "/about.html", { allowPrivate: true });
    expect(result.ok).toBe(true);
    expect(records.some((r) => r.event === "fetch" && r.url === "https://example.com/about.html")).toBe(
      true,
    );
  });
});
