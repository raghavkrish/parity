import { describe, expect, it } from "vitest";
import { diffLayouts, diffModels } from "../src/diff.js";
import { layoutBoxesEqual, summarizeLayoutBox } from "../src/layout.js";
import { normalizeHref, normalizeText } from "../src/normalize.js";
import type { ContentModel, LayoutBox } from "../src/types.js";

describe("normalizeText", () => {
  it("collapses whitespace", () => {
    expect(normalizeText("  Hello\n  world\t")).toBe("Hello world");
  });
});

describe("normalizeHref", () => {
  it("strips origin and hash", () => {
    expect(normalizeHref("https://old.example/about.html#team", "https://old.example/index.html")).toBe(
      "/about.html",
    );
  });

  it("keeps query and resolves relative paths", () => {
    expect(normalizeHref("./rates.html?x=1", "http://127.0.0.1:4173/products.html")).toBe(
      "/rates.html?x=1",
    );
  });

  it("returns null for empty or hash-only", () => {
    expect(normalizeHref("#", "http://127.0.0.1:4173/")).toBeNull();
    expect(normalizeHref("  ", "http://127.0.0.1:4173/")).toBeNull();
  });
});

describe("diffModels", () => {
  const base: ContentModel = {
    texts: [{ text: "A" }, { text: "B" }],
    links: [{ text: "Go", href: "/a.html" }],
    images: [{ alt: "hero", hash: "aaa", src: "http://x/a.png" }],
  };

  it("flags text_changed positionally", () => {
    const next: ContentModel = {
      ...base,
      texts: [{ text: "A" }, { text: "B-changed" }],
    };
    const m = diffModels(base, next);
    expect(m).toEqual([
      expect.objectContaining({ kind: "text_changed", index: 1, oldValue: "B", newValue: "B-changed" }),
    ]);
  });

  it("flags image_changed when hash differs", () => {
    const next: ContentModel = {
      ...base,
      images: [{ alt: "hero", hash: "bbb", src: "http://x/b.png" }],
    };
    expect(diffModels(base, next)[0].kind).toBe("image_changed");
  });

  it("flags image_error when hash is null", () => {
    const next: ContentModel = {
      ...base,
      images: [{ alt: "hero", hash: null, src: "http://x/b.png", error: "HTTP 404" }],
    };
    expect(diffModels(base, next)[0].kind).toBe("image_error");
  });

  it("returns empty when equal", () => {
    expect(diffModels(base, structuredClone(base))).toEqual([]);
  });
});

describe("layout geometry", () => {
  const box: LayoutBox = { tag: "p", x: 10, y: 20, w: 100, h: 40 };

  it("allows epsilon drift", () => {
    expect(layoutBoxesEqual(box, { ...box, x: 12, y: 18 })).toBe(true);
    expect(layoutBoxesEqual(box, { ...box, x: 13 })).toBe(false);
  });

  it("diffLayouts flags layout_changed", () => {
    const oldBoxes = [box];
    const newBoxes = [{ ...box, x: 40 }];
    expect(diffLayouts(oldBoxes, newBoxes)).toEqual([
      expect.objectContaining({
        kind: "layout_changed",
        oldValue: summarizeLayoutBox(box),
        newValue: summarizeLayoutBox(newBoxes[0]),
      }),
    ]);
  });
});
