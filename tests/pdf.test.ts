import { describe, expect, it } from "vitest";
import { withBrowser } from "../src/check.js";
import { renderPdf } from "../src/pdf.js";

describe("renderPdf", () => {
  it(
    "returns a PDF buffer from print HTML",
    async () => {
      const pdf = await withBrowser((browser) =>
        renderPdf(browser, "<!DOCTYPE html><html><body><h1>Parity dossier</h1></body></html>"),
      );
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(100);
    },
    60_000,
  );
});
