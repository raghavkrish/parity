import { describe, expect, it } from "vitest";
import { diffLayouts, diffModels } from "../src/diff.js";
import { layoutBoxesEqual, summarizeLayoutBox } from "../src/layout.js";
import {
  compareText,
  consumeToMatch,
  flattenTexts,
  normalizeHref,
  normalizeText,
} from "../src/normalize.js";
import type { ContentModel, LayoutBox } from "../src/types.js";

describe("normalizeText", () => {
  it("collapses whitespace", () => {
    expect(normalizeText("  Hello\n  world\t")).toBe("Hello world");
  });
});

describe("compareText", () => {
  it("strips the AED currency token", () => {
    expect(compareText("less than AED 5M")).toBe("less than 5M");
    expect(compareText("Under AED 250m")).toBe("Under 250m");
  });
});

describe("flattenTexts", () => {
  it("joins split heading blocks into one string", () => {
    expect(
      flattenTexts([
        { text: "Account Services" },
        { text: "A choice of accounts as unique as your business" },
      ]),
    ).toBe("Account Services A choice of accounts as unique as your business");
  });
});

describe("consumeToMatch", () => {
  it("consumes split blocks that reassemble the target", () => {
    const blocks = [
      { text: "Account Services" },
      { text: "A choice of accounts as unique as your business" },
      { text: "Next card" },
    ];
    expect(
      consumeToMatch(
        "Account Services A choice of accounts as unique as your business",
        blocks,
        0,
      ),
    ).toBe(2);
  });

  it("returns null when the next block diverges", () => {
    expect(consumeToMatch("Earn tiered interest", [{ text: "Earn boosted interest" }], 0)).toBeNull();
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

  it("ignores image hash, alt, error, and extras", () => {
    const next: ContentModel = {
      ...base,
      images: [
        { alt: "hero", hash: "bbb", src: "http://x/b.png" },
        { alt: "extra", hash: null, src: "http://x/c.png", error: "HTTP 404" },
      ],
    };
    expect(diffModels(base, next).filter((m) => m.kind.startsWith("image_"))).toEqual([]);
  });

  it("flags image_missing when the new page dropped an image", () => {
    const next: ContentModel = {
      ...base,
      images: [],
    };
    expect(diffModels(base, next)).toEqual([
      expect.objectContaining({ kind: "image_missing", oldValue: expect.stringContaining("hero") }),
    ]);
  });

  it("returns empty when equal", () => {
    expect(diffModels(base, structuredClone(base))).toEqual([]);
  });

  it("ignores tag splits when flattened body copy matches", () => {
    const oldModel: ContentModel = {
      texts: [{ text: "Account Services A choice of accounts as unique as your business" }],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "Account Services" },
        { text: "A choice of accounts as unique as your business" },
      ],
      links: [],
      images: [],
    };
    expect(diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"))).toEqual([]);
  });

  it("still flags a real wording change after flatten", () => {
    const oldModel: ContentModel = {
      texts: [{ text: "Earn tiered interest on operating cash with same-day internal transfers." }],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [{ text: "Earn boosted interest on operating cash with same-day internal transfers." }],
      links: [],
      images: [],
    };
    expect(diffModels(oldModel, newModel)).toEqual([
      expect.objectContaining({
        kind: "text_changed",
        oldValue: "Earn tiered interest on operating cash with same-day internal transfers.",
        newValue: "Earn boosted interest on operating cash with same-day internal transfers.",
      }),
    ]);
  });

  it("aligns a split heading when later copy actually changes", () => {
    const oldModel: ContentModel = {
      texts: [
        { text: "Account Services A choice of accounts as unique as your business" },
        { text: "Card title" },
        { text: "Earn tiered interest on operating cash." },
      ],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "Account Services" },
        { text: "A choice of accounts as unique as your business" },
        { text: "Card title" },
        { text: "Earn boosted interest on operating cash." },
      ],
      links: [],
      images: [],
    };
    const text = diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"));
    expect(text).toEqual([
      expect.objectContaining({
        kind: "text_changed",
        oldValue: "Earn tiered interest on operating cash.",
        newValue: "Earn boosted interest on operating cash.",
      }),
    ]);
    expect(text.some((m) => String(m.oldValue ?? m.newValue).includes("Account Services"))).toBe(
      false,
    );
  });

  it("treats AED 5M and 5M as the same copy", () => {
    const oldModel: ContentModel = {
      texts: [{ text: "Designed specifically for entrepreneurs with annual turnover less than AED 5M" }],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [{ text: "Designed specifically for entrepreneurs with annual turnover less than 5M" }],
      links: [],
      images: [],
    };
    expect(diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"))).toEqual([]);
  });

  it("joins a split Under 250m heading after dropping AED", () => {
    const oldModel: ContentModel = {
      texts: [{ text: "For companies with turnover Under AED 250m" }, { text: "Business First" }],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "For companies with turnover" },
        { text: "Under 250m" },
        { text: "Business First" },
      ],
      links: [],
      images: [],
    };
    expect(diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"))).toEqual([]);
  });

  it("ignores a trailing new-only CTA after the old page is consumed", () => {
    const oldModel: ContentModel = {
      texts: [{ text: "Business First" }, { text: "Whether you are starting up" }],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "Business First" },
        { text: "Whether you are starting up" },
        { text: "Apply for Trade Finance Solutions" },
        { text: "Tailored solutions designed to support your business." },
      ],
      links: [],
      images: [],
    };
    expect(diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"))).toEqual([]);
  });

  it("still flags an extra card before the last shared card and keeps Where", () => {
    const oldModel: ContentModel = {
      texts: [
        { text: "Call Accounts", where: "Call Accounts" },
        { text: "Fixed Deposits", where: "Fixed Deposits" },
      ],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "Call Accounts", where: "Call Accounts" },
        { text: "Bonus Card", where: "Bonus Card" },
        { text: "Fixed Deposits", where: "Fixed Deposits" },
      ],
      links: [],
      images: [],
    };
    const text = diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"));
    expect(text).toEqual([
      expect.objectContaining({ kind: "text_extra", newValue: "Bonus Card", newWhere: "Bonus Card" }),
    ]);
  });

  it("resyncs after a split heading so later cards still match", () => {
    const oldModel: ContentModel = {
      texts: [
        { text: "For companies with turnover Under AED 250m" },
        { text: "Business First" },
        { text: "Whether you are starting up or growing your business" },
      ],
      links: [],
      images: [],
    };
    const newModel: ContentModel = {
      texts: [
        { text: "For companies with turnover" },
        { text: "Under 250m" },
        { text: "Business First" },
        { text: "Whether you are starting up or growing your business" },
      ],
      links: [],
      images: [],
    };
    const text = diffModels(oldModel, newModel).filter((m) => m.kind.startsWith("text_"));
    expect(text.some((m) => m.oldValue === "Business First" || m.newValue === "Business First")).toBe(
      false,
    );
    expect(text.some((m) => String(m.newValue).includes("Whether you are starting"))).toBe(false);
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
