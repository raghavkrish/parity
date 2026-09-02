import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAll } from "../src/check.js";
import { discoverPairs } from "../src/discover.js";
import { loadMapping } from "../src/mapping.js";
import { fixturesRoot, startStaticServer, type StaticServer } from "../src/serve.js";

describe("integration against mock sites", () => {
  let oldServer: StaticServer;
  let newServer: StaticServer;

  beforeAll(async () => {
    const root = fixturesRoot();
    oldServer = await startStaticServer(path.join(root, "old-site"), 4173);
    newServer = await startStaticServer(path.join(root, "new-site"), 4174);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([oldServer.close(), newServer.close()]);
  });

  it(
    "allows color-only pages; flags layout, text, and image drift",
    async () => {
      const mapping = await loadMapping(path.join(fixturesRoot(), "mapping.csv"));
      expect(mapping.ok).toBe(true);
      if (!mapping.ok) return;

      const results = await checkAll(oldServer.origin, newServer.origin, mapping.pairs, {
        allowPrivate: true,
      });
      const byPath = Object.fromEntries(results.map((r) => [r.oldPath, r]));

      expect(byPath["/index.html"].status).toBe("pass");
      expect(byPath["/rates.html"].status).toBe("pass");

      expect(byPath["/about.html"].status).toBe("fail");
      expect(byPath["/about.html"].mismatches.some((m) => m.kind === "layout_changed")).toBe(true);

      expect(byPath["/products.html"].status).toBe("fail");
      expect(byPath["/products.html"].mismatches.some((m) => m.kind === "text_changed")).toBe(true);
      expect(byPath["/products.html"].mismatches.some((m) => m.kind.startsWith("layout_"))).toBe(
        false,
      );

      expect(byPath["/contact.html"].status).toBe("pass");
      expect(byPath["/contact.html"].mismatches.some((m) => m.kind.startsWith("image_"))).toBe(false);
      expect(byPath["/contact.html"].mismatches.some((m) => m.kind.startsWith("layout_"))).toBe(
        false,
      );
    },
    120_000,
    );

  it("discovers all five fixture pages from the old-site sitemap", async () => {
    const result = await discoverPairs({
      oldOrigin: oldServer.origin,
      oldPath: "/",
      newPath: "/",
      allowPrivate: true,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.source).toBe("sitemap");
    expect(result.pairs).toHaveLength(5);
    expect(result.pairs.map((p) => p.oldPath)).toEqual([
      "/index.html",
      "/about.html",
      "/products.html",
      "/rates.html",
      "/contact.html",
    ]);
  });
});
