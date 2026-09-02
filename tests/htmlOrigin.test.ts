import { describe, expect, it } from "vitest";
import { inferPageUrlFromHtml, resolveUploadSite, withBaseHref } from "../src/htmlOrigin.js";

describe("inferPageUrlFromHtml", () => {
  it("reads a canonical link", () => {
    expect(
      inferPageUrlFromHtml(
        `<html><head><link rel="canonical" href="https://example.com/en/page/"></head></html>`,
      ),
    ).toBe("https://example.com/en/page/");
  });

  it("falls back to base href", () => {
    expect(
      inferPageUrlFromHtml(`<html><head><base href="https://example.org/app/"></head></html>`),
    ).toBe("https://example.org/app/");
  });

  it("ignores relative and missing hosts", () => {
    expect(inferPageUrlFromHtml(`<html><head><base href="/local/"></head></html>`)).toBeNull();
    expect(inferPageUrlFromHtml(`<html><body><h1>No host</h1></body></html>`)).toBeNull();
  });
});

describe("withBaseHref", () => {
  it("injects a base tag when the snapshot has none", () => {
    const html = withBaseHref("<html><head></head><body></body></html>", "https://example.com");
    expect(html).toContain('<base href="https://example.com/">');
  });

  it("leaves an existing base tag alone", () => {
    const src = `<html><head><base href="https://cdn.example.com/"></head></html>`;
    expect(withBaseHref(src, "https://example.com")).toBe(src);
  });
});

describe("resolveUploadSite", () => {
  it("uses the typed URL when HTML has no origin", async () => {
    const site = await resolveUploadSite("<html><body></body></html>", "https://example.com/saved/", {
      allowPrivate: true,
      label: "Old",
    });
    expect(site).toEqual({ ok: true, origin: "https://example.com", path: "/saved/" });
  });

  it("rejects when neither HTML nor a typed URL can supply a host", async () => {
    const site = await resolveUploadSite("<html><body></body></html>", "", {
      allowPrivate: true,
      label: "New",
    });
    expect(site.ok).toBe(false);
    if (site.ok) return;
    expect(site.error).toMatch(/canonical or base URL/i);
  });
});
