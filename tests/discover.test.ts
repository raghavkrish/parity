import { afterEach, describe, expect, it } from "vitest";
import { discoverPairs, parseMappingCsv } from "../src/discover.js";
import { resetLogSink, setLogSink, type LogRecord } from "../src/log.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetLogSink();
});

describe("parseMappingCsv", () => {
  it("parses old_path,new_path rows", () => {
    const parsed = parseMappingCsv("old_path,new_path\n/a.html,/a.html\n/b.html,/b-new.html\n");
    expect(parsed).toEqual({
      ok: true,
      pairs: [
        { oldPath: "/a.html", newPath: "/a.html" },
        { oldPath: "/b.html", newPath: "/b-new.html" },
      ],
    });
  });

  it("rejects a missing header", () => {
    const parsed = parseMappingCsv("/a.html,/a.html\n");
    expect(parsed.ok).toBe(false);
  });

  it("rejects a protocol-relative mapping path", () => {
    const parsed = parseMappingCsv("old_path,new_path\n//169.254.169.254/x,/a.html\n");
    expect(parsed.ok).toBe(false);
  });
});

describe("discoverPairs", () => {
  it("prefers an uploaded CSV and caps at maxPages", async () => {
    const csv = ["old_path,new_path", "/1.html,/1.html", "/2.html,/2.html", "/3.html,/3.html"].join(
      "\n",
    );
    const result = await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/",
      newPath: "/",
      mappingCsv: csv,
      maxPages: 2,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.source).toBe("csv");
    expect(result.truncated).toBe(true);
    expect(result.pairs).toHaveLength(2);
  });

  it("pairs sitemap paths onto the new origin", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://example.com/sitemap.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <urlset>
            <url><loc>https://example.com/index.html</loc></url>
            <url><loc>https://example.com/about.html</loc></url>
            <url><loc>https://other.example.com/skip.html</loc></url>
          </urlset>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };

    const result = await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/",
      newPath: "/",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.source).toBe("sitemap");
    expect(result.pairs).toEqual([
      { oldPath: "/index.html", newPath: "/index.html" },
      { oldPath: "/about.html", newPath: "/about.html" },
    ]);
  });

  it("resolves relative sitemap locs against the old origin", async () => {
    globalThis.fetch = async (input) => {
      if (String(input) === "http://127.0.0.1:4173/sitemap.xml") {
        return new Response(
          `<?xml version="1.0"?><urlset>
            <url><loc>/index.html</loc></url>
            <url><loc>/about.html</loc></url>
            <url><loc>/products.html</loc></url>
            <url><loc>/rates.html</loc></url>
            <url><loc>/contact.html</loc></url>
          </urlset>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };

    const result = await discoverPairs({
      oldOrigin: "http://127.0.0.1:4173",
      oldPath: "/",
      newPath: "/",
      allowPrivate: true,
    });
    expect(result).toMatchObject({
      source: "sitemap",
      truncated: false,
      pairs: [
        { oldPath: "/index.html", newPath: "/index.html" },
        { oldPath: "/about.html", newPath: "/about.html" },
        { oldPath: "/products.html", newPath: "/products.html" },
        { oldPath: "/rates.html", newPath: "/rates.html" },
        { oldPath: "/contact.html", newPath: "/contact.html" },
      ],
    });
  });

  it("marks sitemap results truncated from the pre-slice count", async () => {
    globalThis.fetch = async (input) => {
      if (String(input) === "https://example.com/sitemap.xml") {
        return new Response(
          `<?xml version="1.0"?><urlset>
            <url><loc>/a.html</loc></url>
            <url><loc>/b.html</loc></url>
            <url><loc>/c.html</loc></url>
          </urlset>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };

    const result = await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/",
      newPath: "/",
      maxPages: 2,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.source).toBe("sitemap");
    expect(result.truncated).toBe(true);
    expect(result.pairs).toHaveLength(2);
  });

  it("skips sitemap-index children that are not on the old origin", async () => {
    const fetched: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url === "https://example.com/sitemap.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <sitemapindex>
            <sitemap><loc>https://example.com/extra.xml</loc></sitemap>
            <sitemap><loc>http://169.254.169.254/meta.xml</loc></sitemap>
          </sitemapindex>`,
          { status: 200 },
        );
      }
      if (url === "https://example.com/extra.xml") {
        return new Response(
          `<?xml version="1.0"?><urlset><url><loc>/only.html</loc></url></urlset>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };

    const result = await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/",
      newPath: "/",
    });
    expect(fetched.some((u) => u.includes("169.254"))).toBe(false);
    expect(result).toMatchObject({
      source: "sitemap",
      pairs: [{ oldPath: "/only.html", newPath: "/only.html" }],
    });
  });

  it("warns when a sitemap-index child is on another host", async () => {
    const records: LogRecord[] = [];
    setLogSink((record) => {
      records.push(record);
    });
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://example.com/sitemap.xml") {
        return new Response(
          `<?xml version="1.0"?>
          <sitemapindex>
            <sitemap><loc>https://example.com/extra.xml</loc></sitemap>
            <sitemap><loc>http://169.254.169.254/meta.xml</loc></sitemap>
          </sitemapindex>`,
          { status: 200 },
        );
      }
      if (url === "https://example.com/extra.xml") {
        return new Response(
          `<?xml version="1.0"?><urlset><url><loc>/only.html</loc></url></urlset>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };

    await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/",
      newPath: "/",
    });

    expect(
      records.some(
        (r) =>
          r.event === "discover skip" &&
          r.level === "warn" &&
          String(r.loc).includes("169.254.169.254"),
      ),
    ).toBe(true);
  });

  it("falls back to the entered paths when there is no sitemap", async () => {
    globalThis.fetch = async () => new Response("missing", { status: 404 });
    const result = await discoverPairs({
      oldOrigin: "https://example.com",
      oldPath: "/contact.html",
      newPath: "/contact.html",
    });
    expect(result).toMatchObject({
      source: "single",
      pairs: [{ oldPath: "/contact.html", newPath: "/contact.html" }],
    });
  });
});
