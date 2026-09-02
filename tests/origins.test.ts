import { describe, expect, it } from "vitest";
import { assertSafeUrl, isSafeHttpPath, parseSiteUrl } from "../src/origins.js";

describe("parseSiteUrl", () => {
  it("splits a public https URL into origin and path", async () => {
    const parsed = await parseSiteUrl("https://example.com/rates.html");
    expect(parsed).toEqual({
      ok: true,
      origin: "https://example.com",
      path: "/rates.html",
    });
  });

  it("defaults a bare origin to path /", async () => {
    const parsed = await parseSiteUrl("https://example.org");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.origin).toBe("https://example.org");
    expect(parsed.path).toBe("/");
  });

  it("keeps query string on the path", async () => {
    const parsed = await parseSiteUrl("https://example.com/search?q=rates");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.path).toBe("/search?q=rates");
  });

  it("rejects non-http schemes", async () => {
    const parsed = await parseSiteUrl("ftp://example.com/a");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/http/i);
  });

  it("rejects localhost and loopback", async () => {
    await expect(parseSiteUrl("http://localhost/index.html")).resolves.toMatchObject({
      ok: false,
    });
    await expect(parseSiteUrl("http://127.0.0.1/")).resolves.toMatchObject({ ok: false });
    await expect(parseSiteUrl("http://[::1]/")).resolves.toMatchObject({ ok: false });
  });

  it("rejects private and link-local IP literals", async () => {
    await expect(parseSiteUrl("http://10.1.2.3/")).resolves.toMatchObject({ ok: false });
    await expect(parseSiteUrl("http://192.168.1.9/about")).resolves.toMatchObject({ ok: false });
    await expect(parseSiteUrl("http://172.16.0.4/")).resolves.toMatchObject({ ok: false });
    await expect(parseSiteUrl("http://169.254.169.254/latest/meta-data")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("allows private origins when allowPrivate is set", async () => {
    const parsed = await parseSiteUrl("http://127.0.0.1:4173/index.html", { allowPrivate: true });
    expect(parsed).toEqual({
      ok: true,
      origin: "http://127.0.0.1:4173",
      path: "/index.html",
    });
  });

  it("rejects protocol-relative and off-origin URLs", async () => {
    expect(isSafeHttpPath("//169.254.169.254/latest")).toBe(false);
    expect(isSafeHttpPath("/about.html")).toBe(true);
    await expect(assertSafeUrl("http://169.254.169.254/x")).resolves.toMatchObject({ ok: false });
    await expect(
      assertSafeUrl("https://other.example.com/a", { expectedOrigin: "https://example.com" }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("fails closed when a hostname cannot be resolved", async () => {
    await expect(parseSiteUrl("https://this-host-should-not-resolve.invalid/")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("still blocks metadata hosts when allowPrivate is set", async () => {
    await expect(parseSiteUrl("http://169.254.169.254/latest/meta-data", { allowPrivate: true })).resolves.toMatchObject(
      { ok: false },
    );
  });
});
