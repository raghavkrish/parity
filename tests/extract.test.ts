import { describe, expect, it } from "vitest";
import { extractContentModel } from "../src/extract.js";

describe("extractContentModel root fallback", () => {
  it("extracts from body when main and data-content are missing", async () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <h1>Welcome</h1>
        <p>Body copy</p>
        <a href="/next.html">Next</a>
      </body></html>`;

    const result = await extractContentModel(html, "https://example.com/index.html");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.texts.map((t) => t.text)).toEqual(["Welcome", "Body copy"]);
    expect(result.model.links).toEqual([{ text: "Next", href: "/next.html" }]);
  });

  it("still prefers data-content over body", async () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <nav><p>Skip me</p></nav>
        <div data-content>
          <h1>Only this</h1>
        </div>
      </body></html>`;

    const result = await extractContentModel(html, "https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.texts.map((t) => t.text)).toEqual(["Only this"]);
  });

  it("skips ADCB header, nav, breadcrumbs, and footer", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(Buffer.from("img"), { status: 200 });
    try {
      const html = `<!DOCTYPE html>
        <html><body>
          <header class="site-header">
            <a href="/en/personal/">Personal</a>
            <img src="/logo.png" alt="ADCB logo" />
            <p>Login</p>
          </header>
          <nav role="navigation" class="c-main-nav">
            <a href="/en/business/">Business</a>
            <li>Account Services menu</li>
          </nav>
          <div id="_breadcrumbs" class="c-breadcrumbs">
            <li>Business Banking</li>
            <a href="/en/business/index.aspx">Business Banking</a>
          </div>
          <div class="site-content" id="site-content" role="main">
            <h1>Account Services</h1>
            <p>Open a business account</p>
            <a href="/en/business/products-solutions/account-services/sustainable-call-account.aspx">Sustainable Call Account</a>
            <img src="/card.png" alt="Sustainable Call Account" />
          </div>
          <footer class="site-footer">
            <a href="https://facebook.com/ADCBOfficial">Facebook</a>
            <li>Cookies Notice</li>
          </footer>
        </body></html>`;

      const result = await extractContentModel(html, "https://example.com/en/business/");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const texts = result.model.texts.map((t) => t.text);
      expect(texts).toEqual(["Account Services", "Open a business account"]);
      expect(texts.join(" ")).not.toMatch(/Personal|Login|Business Banking|Cookies Notice|Account Services menu/);

      expect(result.model.links).toEqual([
        {
          text: "Sustainable Call Account",
          href: "/en/business/products-solutions/account-services/sustainable-call-account.aspx",
        },
      ]);
      expect(result.model.links.some((l) => /personal|facebook/i.test(l.href))).toBe(false);

      expect(result.model.images).toHaveLength(1);
      expect(result.model.images[0].alt).toBe("Sustainable Call Account");
      expect(result.model.images[0].src).toContain("/card.png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
