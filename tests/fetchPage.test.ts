import { describe, expect, it } from "vitest";
import { extractContentModel } from "../src/extract.js";
import { fetchPage } from "../src/fetchPage.js";
import { LAYOUT_WAIT_UNTIL } from "../src/layout.js";
import { parseMappingCsv } from "../src/discover.js";

describe("fetch and mapping safety", () => {
  it("rejects protocol-relative page paths", async () => {
    const result = await fetchPage("https://example.com", "//169.254.169.254/latest");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/path/i);
  });

  it("rejects unsafe mapping CSV paths", () => {
    const parsed = parseMappingCsv("old_path,new_path\n//169.254.169.254/,/a.html\n");
    expect(parsed.ok).toBe(false);
  });

  it("does not fetch link-local image URLs", async () => {
    const html = `<html><body><img src="http://169.254.169.254/secret.png" alt="x"></body></html>`;
    const result = await extractContentModel(html, "https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.images[0].hash).toBeNull();
    expect(result.model.images[0].error).toMatch(/blocked|private|metadata/i);
  });

  it("uses load instead of networkidle for layout", () => {
    expect(LAYOUT_WAIT_UNTIL).toBe("load");
  });
});
