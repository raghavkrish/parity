import { describe, expect, it, vi } from "vitest";

vi.mock("../src/layout.js", async () => {
  const actual = await vi.importActual<typeof import("../src/layout.js")>("../src/layout.js");
  return {
    ...actual,
    extractLayoutBoxes: vi.fn(async () => ({ ok: false as const, error: "layout timeout" })),
  };
});

vi.mock("../src/fetchPage.js", () => ({
  fetchPage: vi.fn(async () => ({
    ok: true,
    status: 200,
    html: "<html><body><h1>Hello</h1></body></html>",
  })),
}));

vi.mock("../src/extract.js", () => ({
  extractContentModel: vi.fn(async (_html: string, pageUrl: string) => ({
    ok: true,
    model: {
      texts: [{ text: pageUrl.includes("new.example") ? "Hi" : "Hello" }],
      links: [],
      images: [],
    },
  })),
}));

import { checkPair } from "../src/check.js";

describe("checkPair layout failure", () => {
  it("keeps text mismatches when layout extraction fails", async () => {
    const result = await checkPair(
      "https://old.example.com",
      "https://new.example.com",
      { oldPath: "/a.html", newPath: "/a.html" },
      { allowPrivate: true },
    );
    expect(result.mismatches.some((m) => m.kind === "text_changed")).toBe(true);
    expect(result.status).toBe("fail");
    expect(result.errorReason).toMatch(/layout/i);
  });
});
