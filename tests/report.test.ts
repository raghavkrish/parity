import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../src/report.js";
import type { PageResult } from "../src/types.js";

const results: PageResult[] = [
  {
    oldPath: "/index.html",
    newPath: "/index.html",
    status: "pass",
    mismatches: [],
  },
  {
    oldPath: "/about.html",
    newPath: "/about.html",
    status: "fail",
    mismatches: [
      {
        kind: "text_changed",
        index: 0,
        oldValue: "Hello",
        newValue: "Hi",
      },
    ],
  },
];

describe("renderHtmlReport", () => {
  it("keeps GSAP and collapsed pass cards in interactive mode", () => {
    const html = renderHtmlReport(results);
    expect(html).toContain("gsap");
    expect(html).toContain('class="toolbar"');
    expect(html).toMatch(/<details\s*>/);
    expect(html).toContain('data-target="50"');
  });

  it("renders a static print document with every page open", () => {
    const html = renderHtmlReport(results, { printMode: true });
    expect(html).not.toContain("gsap");
    expect(html).not.toContain("cdn.jsdelivr.net/npm/gsap");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("print-mode");
    expect(html).toContain("@page");
    expect(html).toContain("break-inside: avoid");
    expect(html.match(/<details open>/g)?.length).toBe(2);
    expect(html).toMatch(/<strong class="count-pct"[^>]*>50<\/strong>/);
    expect(html).not.toContain('class="toolbar"');
    expect(html).not.toContain('class="bg-grid"');
  });
});
