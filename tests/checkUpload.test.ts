import type { Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/fetchPage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/fetchPage.js")>("../src/fetchPage.js");
  return {
    ...actual,
    fetchPage: vi.fn(async () => {
      throw new Error("page fetch should be skipped for uploads");
    }),
  };
});

vi.mock("../src/layout.js", async () => {
  const actual = await vi.importActual<typeof import("../src/layout.js")>("../src/layout.js");
  return {
    ...actual,
    createBrowserPage: vi.fn(async () => ({ close: async () => undefined })),
    extractLayoutBoxes: vi.fn(async () => {
      throw new Error("live layout should be skipped for uploads");
    }),
    extractLayoutFromHtml: vi.fn(async () => ({ ok: true as const, boxes: [] })),
  };
});

import { checkPair } from "../src/check.js";
import { fetchPage } from "../src/fetchPage.js";

const oldHtml = `<!DOCTYPE html><html><head>
  <link rel="canonical" href="https://example.com/en/account-services/">
</head><body>
  <header class="site-header"><p>Login</p></header>
  <div id="site-content" role="main">
    <h1><sup>Account Services</sup>
    A choice of accounts as unique as your business</h1>
    <p>Earn tiered interest on operating cash.</p>
  </div>
</body></html>`;

const newHtml = `<!DOCTYPE html><html><head>
  <link rel="canonical" href="https://example.org/en/account-services/">
</head><body>
  <header class="site-header"><p>Sign in</p></header>
  <div id="site-content" role="main">
    <p>Account Services</p>
    <h2>A choice of accounts as unique as your business</h2>
    <p>Earn boosted interest on operating cash.</p>
  </div>
</body></html>`;

describe("checkPair upload HTML", () => {
  it("extracts uploaded snapshots without fetching the page", async () => {
    const result = await checkPair(
      "https://example.com",
      "https://example.org",
      { oldPath: "/en/account-services/", newPath: "/en/account-services/" },
      {
        browser: {} as Browser,
        allowPrivate: true,
        html: { old: oldHtml, new: newHtml },
      },
    );

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.mismatches.some((m) => String(m.oldValue ?? m.newValue).includes("Account Services"))).toBe(
      false,
    );
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text_changed",
          oldValue: "Earn tiered interest on operating cash.",
          newValue: "Earn boosted interest on operating cash.",
        }),
      ]),
    );
    expect(result.status).toBe("fail");
  });
});
