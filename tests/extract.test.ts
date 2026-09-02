import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
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

describe("text compare ignores heading structure", () => {
  it("treats h1+sup and p+h2 as the same copy", async () => {
    const oldHtml = `<!DOCTYPE html><html><body>
      <div id="site-content" role="main">
        <h1><sup>Account Services</sup>
        A choice of accounts as unique as your business</h1>
      </div>
    </body></html>`;
    const newHtml = `<!DOCTYPE html><html><body>
      <div id="site-content" role="main">
        <p>Account Services</p>
        <h2>A choice of accounts as unique as your business</h2>
      </div>
    </body></html>`;

    const [oldExtract, newExtract] = await Promise.all([
      extractContentModel(oldHtml, "https://example.com/old"),
      extractContentModel(newHtml, "https://example.com/new"),
    ]);
    expect(oldExtract.ok && newExtract.ok).toBe(true);
    if (!oldExtract.ok || !newExtract.ok) return;
    expect(diffModels(oldExtract.model, newExtract.model).some((m) => m.kind.startsWith("text_"))).toBe(
      false,
    );
  });

  it("does not flag a split hero when a later paragraph changes", async () => {
    const oldHtml = `<!DOCTYPE html><html><body>
      <div id="site-content" role="main">
        <h1><sup>Account Services</sup>
        A choice of accounts as unique as your business</h1>
        <p>Earn tiered interest on operating cash.</p>
      </div>
    </body></html>`;
    const newHtml = `<!DOCTYPE html><html><body>
      <div id="site-content" role="main">
        <p>Account Services</p>
        <h2>A choice of accounts as unique as your business</h2>
        <p>Earn boosted interest on operating cash.</p>
      </div>
    </body></html>`;

    const [oldExtract, newExtract] = await Promise.all([
      extractContentModel(oldHtml, "https://example.com/old"),
      extractContentModel(newHtml, "https://example.com/new"),
    ]);
    expect(oldExtract.ok && newExtract.ok).toBe(true);
    if (!oldExtract.ok || !newExtract.ok) return;
    const text = diffModels(oldExtract.model, newExtract.model).filter((m) =>
      m.kind.startsWith("text_"),
    );
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({
      kind: "text_changed",
      oldValue: "Earn tiered interest on operating cash.",
      newValue: "Earn boosted interest on operating cash.",
    });
  });
});

describe("nested card wrappers", () => {
  const oldCard = `<!DOCTYPE html><html><body>
    <div id="site-content" role="main">
      <h3>Sustainable Call Account</h3>
      <p>Empowering a sustainable future for businesses</p>
      <h3>Retail Business Accounts</h3>
      <p>Designed specifically for entrepreneurs with annual turnover less than AED 5M</p>
    </div>
  </body></html>`;

  const newSameCopy = `<!DOCTYPE html><html><body>
    <div id="site-content" role="main">
      <li>
        <h3>Sustainable Call Account</h3>
        <p>Empowering a sustainable future for businesses</p>
      </li>
      <li>
        <h3>Retail Business Accounts</h3>
        <p>Designed specifically for entrepreneurs with annual turnover less than AED 5M</p>
      </li>
    </div>
  </body></html>`;

  it("extracts leaf title and body from li > h3 + p, not the wrapper", async () => {
    const result = await extractContentModel(newSameCopy, "https://example.com/new");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.texts.map((t) => t.text)).toEqual([
      "Sustainable Call Account",
      "Empowering a sustainable future for businesses",
      "Retail Business Accounts",
      "Designed specifically for entrepreneurs with annual turnover less than AED 5M",
    ]);
  });

  it("does not flag the same card copy when new wraps it in li", async () => {
    const [oldExtract, newExtract] = await Promise.all([
      extractContentModel(oldCard, "https://example.com/old"),
      extractContentModel(newSameCopy, "https://example.com/new"),
    ]);
    expect(oldExtract.ok && newExtract.ok).toBe(true);
    if (!oldExtract.ok || !newExtract.ok) return;
    expect(diffModels(oldExtract.model, newExtract.model).filter((m) => m.kind.startsWith("text_"))).toEqual(
      [],
    );
  });

  it("still flags AED 5M vs 5M and a new-only card", async () => {
    const newHtml = `<!DOCTYPE html><html><body>
      <div id="site-content" role="main">
        <li>
          <h3>Sustainable Call Account</h3>
          <p>Empowering a sustainable future for businesses</p>
        </li>
        <li>
          <h3>Retail Business Accounts</h3>
          <p>Designed specifically for entrepreneurs with annual turnover less than 5M</p>
        </li>
        <li>
          <h3>Business First</h3>
          <p>Whether you are starting up or growing your business</p>
        </li>
      </div>
    </body></html>`;

    const [oldExtract, newExtract] = await Promise.all([
      extractContentModel(oldCard, "https://example.com/old"),
      extractContentModel(newHtml, "https://example.com/new"),
    ]);
    expect(oldExtract.ok && newExtract.ok).toBe(true);
    if (!oldExtract.ok || !newExtract.ok) return;
    const text = diffModels(oldExtract.model, newExtract.model).filter((m) =>
      m.kind.startsWith("text_"),
    );
    expect(text).toEqual([
      expect.objectContaining({
        kind: "text_changed",
        oldValue: "Designed specifically for entrepreneurs with annual turnover less than AED 5M",
        newValue: "Designed specifically for entrepreneurs with annual turnover less than 5M",
      }),
      expect.objectContaining({
        kind: "text_extra",
        newValue: "Business First",
      }),
      expect.objectContaining({
        kind: "text_extra",
        newValue: "Whether you are starting up or growing your business",
      }),
    ]);
  });
});
