import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { prepareContentRoot } from "../src/contentRoot.js";

describe("prepareContentRoot", () => {
  it("picks #site-content after stripping header, nav, breadcrumbs, and footer", () => {
    const $ = cheerio.load(`<!DOCTYPE html>
      <html><body>
        <header class="site-header"><p>Login</p></header>
        <nav class="c-main-nav"><p>Mega menu</p></nav>
        <div class="c-breadcrumbs"><p>Business Banking</p></div>
        <div id="site-content" role="main"><h1>Account Services</h1></div>
        <footer class="site-footer"><p>Cookies Notice</p></footer>
      </body></html>`);

    const root = prepareContentRoot($);
    expect(root.attr("id")).toBe("site-content");
    expect(root.find("h1").text()).toBe("Account Services");
    expect($.text()).not.toMatch(/Login|Mega menu|Business Banking|Cookies Notice/);
  });

  it("still prefers data-content on fixture-style pages", () => {
    const $ = cheerio.load(`<!DOCTYPE html>
      <html><body>
        <header class="topbar"><nav><a href="/">Home</a></nav></header>
        <main data-content><h1>Banking built on trust</h1></main>
        <footer class="site-foot">© Northridge Bank</footer>
      </body></html>`);

    const root = prepareContentRoot($);
    expect(root.is("[data-content]")).toBe(true);
    expect(root.find("h1").text()).toBe("Banking built on trust");
    expect($("header, footer, nav").length).toBe(0);
  });

  it("keeps siblings that follow a truncated main", () => {
    const $ = cheerio.load(`<!DOCTYPE html>
      <html><body>
        <div id="site-content" role="main"><h1>Account Services</h1></div>
        <h2>For growing corporates we offer tailored packages designed to meet your specific needs</h2>
      </body></html>`);

    const root = prepareContentRoot($);
    expect(root.length).toBeGreaterThan(1);
    expect(root.filter("h2").text()).toMatch(/For growing corporates/);
  });
});
